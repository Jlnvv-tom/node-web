# 02-06 poll 阶段深度解析

> 本章目标：深入 `uv__io_poll`——事件循环最重要的阶段。理解 epoll 如何被调用、超时如何计算、I/O 回调如何被触发，以及"为什么事件循环能空转不占 CPU"。

---

## 1. poll 阶段的职责

`uv__io_poll` 是六阶段的核心：它**调用底层多路复用（epoll_wait/kqueue/IOCP）阻塞等待 I/O 事件**，并驱动所有注册的 I/O 回调。其他阶段只是"处理已就绪的各类回调"，而 poll 才是"等待新事件"的地方。

---

## 2. 阻塞时长 `timeout`

`timeout` 由 `uv__backend_timeout` 计算（见 02-05），进入 `uv__io_poll` 时作为参数：

```
timeout 的可能值：
  0      → 立即返回，不阻塞（有未决任务 / 无活跃句柄 / 有 pending）
  ≥1ms   → 阻塞到最近定时器到期
  -1     → 无限阻塞（无定时器、有活跃 I/O，一直等到事件来）
```

```c
// deps/uv/src/unix/core.c :: uv__io_poll (简化)
void uv__io_poll(uv_loop_t* loop, int timeout) {
  struct epoll_event events[1024];
  int nevents;

  // 把 loop 上所有待监控的 fd 合并进 epoll（增/删/改）
  uv__io_poll_sync(loop);   // 处理 watcher 的注册变更

  // 阻塞等事件
  nevents = epoll_wait(loop->backend_fd, events, 1024, timeout);

  if (nevents < 0) {
    if (errno == EINTR) return;   // 被信号中断，直接返回（下一轮再等）
    abort();
  }

  // 逐个处理就绪事件
  for (int i = 0; i < nevents; i++) {
    struct epoll_event* ev = &events[i];
    uv__io_t* w = ev->data.ptr;
    int events_mask = ev->events;
    // 标记可读/可写，调用 watcher 回调（如 TCPWrap::OnRead）
    w->cb(loop, w, events_mask);
  }

  // 处理已就绪但需延迟执行的回调、更新时间
}
```

---

## 3. "空转不占 CPU"的原理

当**没有任何定时器、没有活跃句柄**时，事件循环本应退出（`uv__loop_alive` 为假）。但只要还有一个 server 在 `listen` 或任意一个活跃 handle，循环继续。

此时 `timeout = -1`（无限阻塞），`epoll_wait` 会让主线程**睡眠在内核态**，直到有网络事件（新连接、数据到达）才唤醒。**睡眠期间 CPU 占用为 0**——这就是为什么 Node 服务"空闲时几乎不耗 CPU"。

一旦事件到达，poll 阶段执行回调（如 `socket.emit('data')`），这些回调可能注册新的定时器或 I/O，循环继续。若无任何新任务，下一轮 `uv__loop_alive` 为假，进程退出。

---

## 4. 事件如何被分派到 C++ 回调

每个 libuv handle（如 `uv_tcp_t`）持有一个 `io_watcher`（`uv__io_t`），内含 fd 与 `cb` 函数指针。Node 的 C++ 层（如 `TCPWrap`）注册这个 `cb`：

```c
// TCPWrap 注册：当 fd 可读时调用 TCPWrap::OnRead
uv__io_init(&handle->io_watcher, TCPWrap::OnRead, fd);
uv__io_start(loop, &handle->io_watcher, POLLIN);   // 向 epoll 注册读事件
```

poll 阶段 `epoll_wait` 返回就绪 fd → 通过 `ev->data.ptr` 拿到 `uv__io_t*` → 调用其 `cb`（即 `TCPWrap::OnRead`）→ `MakeCallback` 回 JS。

---

## 5. 边沿触发 vs 水平触发（ET vs LT）

libuv 在 Linux 默认使用 **EPOLLLT（水平触发）**，因为：
- LT 容错：没读完数据下次 `epoll_wait` 仍会通知，不会丢失事件。
- ET 要求一次读尽（`read` 到 EAGAIN），否则数据滞留，较易出 bug。

Node 的 `net` 读取循环（`uv__read` 反复 `read` 到 EAGAIN）在 LT 下也能正确工作。

---

## 6. 信号与子进程的穿插

poll 阶段还会处理某些非 I/O 事件：
- **signal**：通过 `signalfd`（Linux）或 kqueue 的 EVFILT_SIGNAL 把信号纳入 epoll，使 `process.on('SIGINT')` 能在事件循环中响应（而非异步信号处理器里的限制）。
- **child_process**：子进程退出通过 `SIGCHLD` + epoll 通知，触发 `exit` 事件。

这让 Node 的"一切皆异步"在信号/子进程上也能成立。

---

## 7. 可运行验证

```bash
# 观察空转时 CPU 占用（应接近 0）
node -e "require('net').createServer(()=>{}).listen(8124, ()=>console.log('idle server'))"
# 用 top/htop 观察，空闲时 CPU ~0%
```

```bash
# 观察 epoll 调用
strace -f -e trace=epoll_wait node -e "
const net=require('net');
const s=net.createServer().listen(8124);
setTimeout(()=>{}, 100000);
" 2>&1 | head
# 会看到 epoll_wait 以较大 timeout 阻塞，直到事件到达
```

---

## 8. 本章总结

- poll 阶段调用 `epoll_wait`（或 kqueue）阻塞等 I/O，是事件循环唯一"等待"的地方。
- `timeout` 由最近定时器/活跃句柄决定：0（不阻塞）、≥1ms（到定时器）、-1（无限阻塞）。
- 空闲时 `timeout=-1`，主线程睡眠在内核态，CPU 占用 0；事件到达唤醒后驱动回调。
- 就绪 fd 通过 `uv__io_t->cb` 分派到 C++ 回调（如 TCPWrap::OnRead）。
- libuv 默认 LT 触发；信号/子进程也并入 epoll 实现全异步。

---

## 9. 思考题

1. 为什么事件循环在"无任务"时不会变成 100% CPU 的忙等？具体是哪个调用让线程睡眠？
2. 如果 poll 阶段 `epoll_wait` 阻塞 1000ms（等定时器），期间新连接到达，Node 会立即响应还是等满 1000ms？
3. libuv 用 EPOLLLT 而非 EPOLLET，对 `net.Socket` 的数据读取逻辑有什么影响？如果改用 ET 会要求上层做什么改变？
