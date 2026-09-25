# 02-07 异步句柄：io watcher 与 async handle

> 本章目标：理解 libuv 中两类底层机制——`uv__io_t`（I/O 监视器，挂在 epoll 上）与 `uv_async_t`（跨线程唤醒事件循环）。它们是"主线程等待 I/O"与"工作线程通知主线程"的共同基础。

---

## 1. `uv__io_t`：I/O 监视器

每个需要被 epoll/kqueue 监控的 fd，都对应一个 `uv__io_t`：

```c
// deps/uv/src/unix/internal.h
struct uv__io_s {
  uv__io_cb cb;            // 就绪时回调（如 TCPWrap::OnRead）
  void* watcher_queue[2];  // 链表节点
  int fd;                  // 监控的 fd
  int events;              // 关注的事件（POLLIN/POLLOUT）
  int pevents;             // 已注册到 epoll 的事件（pending）
};
typedef struct uv__io_s uv__io_t;
```

使用流程：
```c
uv__io_init(&w->io_watcher, cb, fd);          // 绑定 cb 与 fd
uv__io_start(loop, &w->io_watcher, POLLIN);   // 注册"可读"到 epoll
// ... poll 阶段 epoll_wait 就绪 → w->cb(loop, &w->io_watcher, events)
uv__io_stop(loop, &w->io_watcher, POLLIN);    // 取消注册
```

`uv__io_start` 把 watcher 加入 `loop->watchers` 数组（按 fd 索引），并在 poll 阶段时被 `uv__io_poll_sync` 同步到 epoll（增/删/改）。网络 socket、管道、signal fd 都靠它。

Node C++ 层的 `HandleWrap` 内部就持有 `uv__io_t`，把 libuv 的 I/O 事件翻译成 JS 回调（见 04-03）。

---

## 2. `uv_async_t`：跨线程唤醒

`uv_async_t` 解决一个关键问题：**工作线程（或任何非主线程）如何通知主线程的事件循环"我有事要处理"？**

```c
uv_async_t async_handle;
uv_async_init(loop, &async_handle, on_async);

// 在工作线程（或任意线程）调用：
uv_async_send(&async_handle);   // ← 唤醒主线程 event loop
```

原理（Linux）：
- `uv_async_init` 内部创建一个 `eventfd`（或 pipe），并把它的 fd 注册到 epoll（读事件）。
- `uv_async_send` 向该 fd 写入一个字节（原子），内核随即标记 epoll 就绪。
- 主线程 poll 阶段 `epoll_wait` 返回 → 触发 async 的回调 `on_async`。

这正是**线程池完成文件 I/O 后通知主线程**的机制（见 02-02、02-04）：工作线程调 `uv_async_send` → 主线程被唤醒 → 执行 `after_work_cb` → 回调到 JS。

特点：
- `uv_async_send` 是**线程安全**的，可从任意线程调用。
- 多次 `send` 在 epoll 层可能被合并（eventfd 只记"有事件"），不会堆积成 N 次回调；`on_async` 一次处理所有挂起工作。
- 常用于"生产者线程 → 消费者事件循环"模型。

---

## 3. 二者对比

| 机制 | 用途 | 谁触发 | 注册到 |
|------|------|--------|--------|
| `uv__io_t` | 监控 fd 的 I/O 就绪 | 内核（epoll） | epoll/kqueue |
| `uv_async_t` | 跨线程/跨句柄唤醒循环 | 用户线程 `uv_async_send` | epoll（经 eventfd/pipe） |

`uv_async_t` 本质也是借 `uv__io_t`（内部持有一个 io watcher 监控 eventfd）实现的——只是唤醒源是"另一个线程写了一个字节"，而非"网络数据到达"。

---

## 4. 与 Node 上层的关系

- **线程池完成通知**：`uv__work_done` 调 `uv_async_send(loop->wq_async)` → 主线程在 poll 阶段收到 → 执行被线程池完成的任务的 `after_work_cb`。
- **子进程退出**：子进程结束产生 `SIGCHLD`，经 signal fd 进入 epoll → 触发 `exit` 事件。
- **`process.nextTick`/微任务**：虽不在这儿，但 `InternalCallbackScope` 在主线程侧驱动，与 async 唤醒同属"主线程被叫醒做事"的大框架。

---

## 5. 可运行验证

```bash
# 用 strace 看 eventfd 与 async 唤醒
strace -f -e trace=eventfd,write,epoll_wait node -e "
const fs=require('fs');
fs.readFile(__filename, ()=>console.log('done'));
setTimeout(()=>{}, 5000);
" 2>&1 | grep -E 'eventfd|epoll' | head
```

你会看到 `eventfd` 创建、`write` 触发唤醒、`epoll_wait` 返回——印证线程池完成通知走 async handle。

---

## 6. 本章总结

- `uv__io_t` 是 fd 的 I/O 监视器，挂钩 epoll，负责把内核 I/O 事件分派到 C++ 回调。
- `uv_async_t` 用 eventfd/pipe + `uv_async_send` 实现跨线程唤醒主循环，是线程池完成通知的基石。
- 二者都最终通过 epoll 在主线程 poll 阶段被处理。
- `HandleWrap`（04-03）封装 `uv__io_t`，把 libuv I/O 翻译成 JS 事件。

---

## 7. 思考题

1. 为什么工作线程不能直接调用 JS 回调，而必须先 `uv_async_send` 唤醒主线程？根本原因是什么？
2. `uv_async_send` 连续调用 10 次，主线程的 `on_async` 会执行 10 次吗？为什么？
3. `uv__io_t` 和 `uv_async_t` 在内核层面最终都通过 epoll 被主线程感知，它们的事件源有何本质不同？
