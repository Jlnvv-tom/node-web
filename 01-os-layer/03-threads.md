# 01-03 线程、线程池与 pthread

> 本章目标：理解操作系统线程模型，以及为什么 libuv / Node 既依赖单线程事件循环、又需要后台线程池。这是理解"文件 I/O 为何走线程池"的最后一环。

---

## 1. 线程是什么

线程是** CPU 调度的最小单位**，同进程内的多个线程共享地址空间（堆、全局变量、文件描述符表），但各有独立栈与寄存器。

对比：

| 维度 | 进程 | 线程 |
|------|------|------|
| 地址空间 | 独立 | 共享（同进程） |
| 创建成本 | 高（拷贝/COW 页表） | 低（共享页表） |
| 通信 | IPC（管道/共享内存） | 直接读写共享变量（需同步） |
| 崩溃隔离 | 强 | 弱（一线程崩可能拖垮进程） |

---

## 2. pthread 基础

POSIX 线程（pthread）是类 Unix 的线程 API：

```c
pthread_t tid;
pthread_create(&tid, NULL, worker, arg);   // 创建线程
pthread_join(tid, NULL);                    // 等待结束
pthread_mutex_t lock;                       // 互斥锁
pthread_mutex_lock(&lock);
// 临界区
pthread_mutex_unlock(&lock);
```

Node 的 libuv 线程池正是用 pthread 在 `uv_thread_create` 里创建 N 个工作线程（见 02-02）。worker_threads 的每个 worker 也是一个 pthread（见 05-07）。

---

## 3. 为什么事件循环不"每连接一线程"

回到 C10K（01-01）：thread-per-connection 模型下，1 万连接 ≈ 80GB 栈内存 + 大量上下文切换。事件循环用**单线程 + 非阻塞 + 多路复用**规避了这点。

但单线程有死穴：**阻塞式系统调用会卡住整个循环**。于是 Node 采用混合策略：
- **主线程**：跑事件循环，处理网络 I/O（非阻塞，无线程）。
- **后台线程池**（默认 4，libuv）：处理真正阻塞的操作（文件 I/O、部分 crypto、DNS）。

这样"异步表象、线程实质"——用户代码从不接触线程，但底层用线程池消化阻塞工作（见 02-02、02-04）。

---

## 4. 同步原语与竞态

多线程共享内存，必须用同步原语防止竞态：

| 原语 | 用途 |
|------|------|
| 互斥锁 (mutex) | 保护临界区 |
| 条件变量 (cond) | 线程间等待/通知（libuv 线程池用 `uv_sem_post` 唤醒） |
| 读写锁 | 读多写少场景 |
| 原子操作 | 无锁计数 |

libuv 线程池的"主线程唤醒"机制：工作线程完成 → 加锁把任务移入完成队列 → `uv_sem_post`/async 通知主线程。主线程在 poll 阶段收到 async 后处理（见 02-02）。

---

## 5. Node 的多线程形态

| 机制 | 线程数 | 隔离 | 用途 |
|------|--------|------|------|
| 主事件循环 | 1（主线程） | — | 全部 JS 回调 |
| libuv 线程池 | 默认 4（≤1024） | 共享进程内存 | fs / dns.lookup / 部分 crypto |
| worker_threads | 用户自定义 | 独立 Isolate | CPU 密集并行 |
| child_process | 多个 OS 进程 | 进程级隔离 | 强隔离任务 |

注意：libuv 线程池的线程**不跑 JS**（没有 V8 上下文），只在 C 层做阻塞调用；worker_threads 的线程才运行 JS。

---

## 6. 可运行验证

```bash
# 查看 Node 进程及其线程数
node -e "setTimeout(()=>{}, 10000)" &
PID=$!
ps -eLf | grep $PID | wc -l    # 线程数（含主线程 + libuv 线程池）
cat /proc/$PID/status | grep Threads
```

默认你会看到主线程 + 若干 libuv 工作线程（通常 4 个，外加辅助线程）。

---

## 7. 本章总结

- 线程是 CPU 调度单位；同进程线程共享内存，成本低但隔离弱。
- 事件循环用单线程 + 非阻塞避免 thread-per-connection 的内存/切换爆炸。
- libuv 线程池用 pthread 处理阻塞调用；工作线程不跑 JS，只做 C 层阻塞工作。
- Node 多线程形态：主循环 / libuv 线程池 / worker_threads / child_process，各有隔离级别与用途。

---

## 8. 思考题

1. 为什么 libuv 线程池的工作线程"不能跑 JS"？技术上能不能让它们跑？为什么 Node 不这么做？
2. thread-per-connection 在今天的硬件下是否完全不可行？什么场景仍会用到多线程模型？
3. worker_threads 与 libuv 线程池都用了 pthread，为什么前者能跑 JS 而后者不能？
