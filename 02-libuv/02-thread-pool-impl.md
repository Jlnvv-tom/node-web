# 02-02 libuv 线程池实现

> 本章目标：理解 libuv 的线程池——它为什么存在、谁在用、默认多大、以及"完成后怎么通知主线程"。

---

## 1. 为什么需要线程池

事件循环是单线程的，靠非阻塞 I/O 避免阻塞。但**有些操作根本无法在非阻塞模式下进行**，或者跨平台没有统一的异步接口：

- **文件 I/O**：`read` / `write` / `stat` 等，POSIX 上没有像 `epoll` 那样普遍高效的"异步文件完成通知"（Linux 的 `io_uring` 是例外，但 libuv 仍走线程池）。
- **DNS 解析**：`dns.lookup`（通过 `getaddrinfo`，阻塞式系统调用）。注意 `dns.resolve` 走的是 c-ares 异步库，不走线程池。
- **部分 crypto**：`pbkdf2` / `scrypt` / `randomBytes` / 异步的 `sign` / `verify`。
- **子进程相关**部分操作。

libuv 的做法：**把这些"没法非阻塞"的工作丢到一个固定大小的线程池里，主线程继续跑事件循环，工作线程完成后通过异步通知把结果送回主线程**。

源码位置：`deps/uv/src/threadpool.c`

---

## 2. 线程池大小：`UV_THREADPOOL_SIZE`

- **默认 4 个线程**。
- **最大 1024**（硬编码上限）。
- 通过环境变量 `UV_THREADPOOL_SIZE` 设置。
- **必须在首次使用线程池之前设置**（libuv 惰性创建：第一次提交任务时才建池，建完就固定了）。

```c
// 伪代码，来自 threadpool.c 初始化逻辑
static uv_once_t once = UV_ONCE_INIT;
static int nthreads;
static uv_thread_t* threads;

static void init_threads(void) {
  nthreads = (UV_THREADPOOL_SIZE > 0 && UV_THREADPOOL_SIZE <= 1024)
             ? UV_THREADPOOL_SIZE : 4;   // 默认 4，越界则回退 4
  threads = calloc(nthreads, sizeof(uv_thread_t));
  for (i = 0; i < nthreads; i++)
    uv_thread_create(threads + i, worker, ...);
}
```

> ⚠️ 在 Node 里设置必须在任何 I/O 之前：
> ```js
> process.env.UV_THREADPOOL_SIZE = 12;  // 太晚！池可能已建好
> ```
> 正确方式是在**启动 Node 前**于 shell 设置：
> ```bash
> UV_THREADPOOL_SIZE=12 node app.js
> ```
> 或在 `node` 二进制加载前（进程最早阶段）设置。因为一旦首个线程池任务提交，池就固定了。

---

## 3. 提交任务：`uv_queue_work`

对外 API：

```c
int uv_queue_work(uv_loop_t* loop,
                  uv_work_t* req,
                  uv_work_cb work_cb,        // 在工作线程执行（禁止碰 V8/事件循环）
                  uv_after_work_cb after_work_cb);  // 回到主线程执行
```

- `work_cb`：**在工作线程**跑，做真正的阻塞操作（如 `read(fd, ...)`）。这里**绝对不能调用任何 V8 或 libuv 主循环 API**，因为它不在主线程。
- `after_work_cb`：**在主线程事件循环**里执行，拿到结果，回调到 JS。

### 内部机制

```
主线程                                 工作线程
──────                                 ────────
uv_queue_work(req)
   │
   ├─ 把 req 推入 工作队列 (互斥锁保护)
   │
   ├─ uv_sem_post()  ───────────────▶   worker() 被唤醒
   │                                      │
   │                                      ├─ 从队列取 req
   │                                      ├─ 执行 work_cb (阻塞 I/O)
   │                                      │
   │                                      ├─ uv_mutex_lock + 移入"完成队列"
   │                                      │
   │   ◀── uv_async_send(async) ──────── ┘
   │        （通过 async handle 通知主循环）
   ▼
uv_run 的 poll 阶段收到 async 事件
   │
   ├─ 调用 async 的回调：遍历完成队列
   │
   └─ 执行 after_work_cb → 最终回调到 JS
```

关键点：**工作线程执行完后，不是直接调 JS 回调，而是用 `uv_async_send` 唤醒主线程的事件循环**，由主线程在合适的时机（poll 阶段）执行 `after_work_cb`。这保证了所有 JS 回调都在主线程、单线程、无竞态地执行。

---

## 4. 队列与调度

`threadpool.c` 内部维护：
- 一个**待处理队列**（互斥锁 + 条件变量保护）。
- 多个**工作线程**在 `worker()` 里循环：`uv_mutex_lock` → 取任务 → `uv_mutex_unlock` → 执行 `work_cb` → 标记完成 → `uv_async_send`。

任务**没有优先级**，先进先出。如果你提交了大量 `fs` 操作而池只有 4 线程，后面的会排队——这就是为什么 **CPU 密集或大量文件 I/O 会拖慢整个事件循环**（所有任务共享这池子，包括 `fs`、DNS、`pbkdf2` 等）。

---

## 5. 一个常见误区

> "网络 I/O 走线程池吗？"

**不走。** TCP/UDP/pipe 的非阻塞操作直接注册到 epoll/kqueue，在主线程完成。只有上文列出的"阻塞式系统调用 + 无统一异步接口"的工作才进线程池。这也是为什么 `fs` 和 `net` 的底层路径完全不同（见 02-03、02-04）。

---

## 6. 可运行验证

```js
// 观察线程池被占满后任务的排队
const fs = require('fs');
const start = Date.now();

for (let i = 0; i < 8; i++) {
  fs.readFile(__filename, () => {
    console.log(`task ${i} done @ ${Date.now() - start}ms`);
  });
}
```

默认 4 线程：前 4 个几乎同时完成，后 4 个要等前面的释放线程。把 `UV_THREADPOOL_SIZE` 调到 8 再跑，8 个会近乎同时完成。

```bash
UV_THREADPOOL_SIZE=8 node pool.js
```

---

## 7. 本章总结

- 线程池用于"无法非阻塞"的操作：文件 I/O、`dns.lookup`、部分 crypto。
- 默认 4 线程，最大 1024，由 `UV_THREADPOOL_SIZE` 控制，**首次使用前设好**。
- `uv_queue_work` 拆分 `work_cb`（工作线程）与 `after_work_cb`（主线程）；完成通过 `uv_async_send` 唤醒主循环。
- 所有任务共享同一池，过量文件 I/O / 计算会饿死其他异步任务。

---

## 8. 思考题

1. 为什么说"工作线程里不能调用 V8 API"？若你强行在工作线程里触发了一个 JS 回调会怎样？
2. `dns.lookup` 和 `dns.resolve` 走的底层路径不同，这对线程池负载有什么实际影响？
3. 如果把 `UV_THREADPOOL_SIZE` 设成 1024，是越多越好吗？有什么代价？
