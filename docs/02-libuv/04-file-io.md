# 02-04 文件 I/O：为什么走线程池

> 本章目标：理解文件 I/O 在 libuv 中的特殊路径——它为什么必须绕开主线程，以及完整的"提交→线程执行→回主线程回调"链路。

---

## 1. 一句话结论

**文件 fd 无法用 epoll/kqueue 做"就绪通知"，且普通 `read()`/`write()` 可能真正阻塞线程；因此 libuv 把所有文件操作塞进线程池，主线程继续跑事件循环，工作线程完成后再把结果送回。**

---

## 2. 为什么文件不能用 epoll

网络 socket 有"对端"——数据到达由网卡中断触发，内核知道"可读/可写"。但**普通文件没有对端**：

- 读文件时，数据可能在页缓存（快）也可能要从磁盘读（慢），但**内核不会为"文件可读"产生异步事件**。
- 你无法把一个常规文件 fd 注册到 epoll 并期望"数据就绪时通知你"——`epoll` 对常规文件会报 `EPERM`。
- 因此 `read()` 一旦遇到磁盘 I/O，会**真阻塞调用线程**直到完成。

若在主线程直接 `read()`，事件循环会被卡住，整个 Node 进程冻结。所以必须把这些调用挪到工作线程。

> 例外：Linux 5.1+ 的 `io_uring` 确实能让文件 I/O 异步化，但 libuv 为了跨平台一致性仍统一走线程池。未来版本可能演进。

---

## 3. 提交：从 JS 到线程池

源码：`src/node_file.cc`（C++ 绑定）、`deps/uv/src/unix/fs.c`（libuv 实现）

```js
fs.readFile('a.txt', (err, data) => { ... });
```
```
lib/fs.js
   │ 构造 FSReqCallback，调用 binding.read(...)
   ▼
src/node_file.cc :: Read(const FunctionCallbackInfo& args)
   │ 设置 uv_fs_t，调用 uv_fs_read(uv_default_loop(), &req, fd, buf, ...)
   ▼
deps/uv/src/unix/fs.c :: uv_fs_read
   │ uv__fs_req_init + uv__work_submit(loop, &req->work_req, ...)
   ▼
threadpool.c :: uv__work_submit
   │ 把任务推入队列 + uv_sem_post() 唤醒工作线程
   ▼
工作线程: uv__fs_work() → 实际调用 POSIX read()/pread()
   │
   ▼
完成后移入完成队列 + uv_async_send(loop->async_watcher)
   │
   ▼
主线程 poll 阶段收到 async → 执行 after_work_cb → Node 回调 → JS cb
```

注意：JS 侧 `fs.readFile` 的回调**永远在主线程**执行，尽管真正的 `read()` 在工作线程跑。这就是 libuv 的"异步表象、线程池实质"。

---

## 4. `uv_fs_t` 操作类型

`uv_fs_*` 是一族函数，覆盖几乎所有文件操作：

| 函数 | 操作 |
|------|------|
| `uv_fs_open` | 打开文件 |
| `uv_fs_read` / `uv_fs_write` | 读写 |
| `uv_fs_close` | 关闭 |
| `uv_fs_stat` / `uv_fs_fstat` / `uv_fs_lstat` | 文件元信息 |
| `uv_fs_unlink` / `uv_fs_rename` / `uv_fs_mkdir` / `uv_fs_rmdir` | 目录/文件操作 |
| `uv_fs_scandir` / `uv_fs_readdir` | 列举目录 |
| `uv_fs_fsync` / `uv_fs_fdatasync` | 刷盘 |
| `uv_fs_sendfile` | 零拷贝文件传输（用于 `fs.copyFile` 优化） |

每个操作共享同一个 `uv_fs_t` 结构体，字段 `req->fs_type` 区分类型，`uv__fs_work` 内部按类型分派到对应的 POSIX 调用。

---

## 5. 同步 API 呢？

`fs.readFileSync` 等同步方法**不走线程池**——它们在主线程直接阻塞调用 POSIX 函数。这意味：

```js
const data = fs.readFileSync('big.iso');  // 主线程卡住直到读完
```

同步 API 会**冻结整个事件循环**（包括其他请求的回调、定时器）。仅在启动期或 CLI 工具里可接受；在线服务中应避免。

---

## 6. 与网络 I/O 的对照图

```
网络 I/O                              文件 I/O
────────                              ────────
socket fd (非阻塞)                    文件 fd (可能阻塞)
   │                                     │
epoll/kqueue 注册                       uv_queue_work 提交
   │                                     │
主线程 poll 阶段触发                    工作线程执行 read()
   │                                     │
直接回调 JS                             uv_async_send → 主线程 poll 触发
                                         │
                                        回调 JS（仍主线程）
```

两条路径**最终回调都在主线程**，但中间是否经过线程池是根本差异。

---

## 7. 可运行验证

```js
const fs = require('fs');

// 同步：会卡住事件循环（观察下面的定时器被推迟）
console.time('sync read');
const buf = fs.readFileSync(__filename);
console.timeEnd('sync read');

setTimeout(() => console.log('timer after sync (被推迟了)'), 0);

// 异步：不阻塞，但占用线程池一个名额
fs.readFile(__filename, () => console.log('async read done'));
setTimeout(() => console.log('timer still fires ~on time'), 0);
```

同步读取时，紧跟的 `setTimeout(0)` 要等同步读完成才执行；异步读取则定时器基本按时触发（只要你没把线程池占满）。

---

## 8. 本章总结

- 文件 fd 不能用 epoll 做就绪通知，且 `read()` 可能真阻塞 → 必须走线程池。
- 全链路：`fs.readFile` → `uv_fs_read` → `uv__work_submit` → 工作线程 `read()` → `uv_async_send` → 主线程 poll 回调。
- 回调**始终在主线程**，用户无感知线程切换。
- 同步 API 直接在主线程阻塞，冻结事件循环，慎用。

---

## 9. 思考题

1. 如果磁盘特别慢，`fs.readFile` 会让事件循环卡住吗？为什么？
2. 既然"回调在主线程"，那线程池的意义到底是什么？它解决了哪个问题？
3. 同步 `fs.readFileSync` 和异步 `fs.readFile` 在事件循环层面有什么本质区别？
