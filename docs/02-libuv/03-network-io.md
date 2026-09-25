# 02-03 网络 I/O：非阻塞路径

> 本章目标：看清 TCP/UDP/pipe 是如何在非阻塞模式下、不经过线程池、直接由主线程事件循环驱动的。这是与文件 I/O 最本质的区别。

---

## 1. 网络 I/O 的核心特征：非阻塞 + 多路复用

网络 fd（socket）从创建起就被设为 **O_NONBLOCK（非阻塞）**。所有读写操作立即返回，数据是否就绪由内核决定；"哪些 fd 就绪了"通过 **epoll（Linux）/ kqueue（BSD/macOS）** 多路复用查询。

这条路径**全程在主线程**，没有线程池参与。

---

## 2. 关键结构体

libuv 把底层 socket 抽象成句柄（handle）：

| libuv 类型 | 对应 |
|-----------|------|
| `uv_tcp_t` | TCP socket |
| `uv_udp_t` | UDP socket |
| `uv_pipe_t` | Unix domain socket / 命名管道 |
| `uv_stream_t` | 上述流的公共基类（TCP/UDP/pipe 都"是"stream） |

在 Node C++ 层再包一层（见 04-04 TCPWrap）：
```
JS net.Socket → C++ TCPWrap → uv_tcp_t → (epoll/kqueue) → 内核 socket
```

---

## 3. 连接建立流程（以 TCP server 为例）

源码：`deps/uv/src/unix/tcp.c`、`deps/uv/src/unix/stream.c`

```
node 侧: net.createServer() → server.listen(port)
   │
   ▼
C++: TCPWrap::Listen → uv_listen(handle, backlog, on_connection)
   │
   ▼
libuv: uv__io_start(loop, &handle->io_watcher, POLLIN)   // 向 epoll 注册"可读"事件
   │
   ▼
[内核] 客户端连接到达 → 触发 POLLIN
   │
   ▼
uv_run 的 poll 阶段: epoll_wait 返回 → 执行 handle 的 io 回调
   │
   ▼
uv__server_io() → uv_accept() 取出新连接 → 调用 on_connection
   │
   ▼
Node C++ 回调 → JS 'connection' 事件
```

对于**客户端连接**（`socket.connect`），流程类似：
```
uv_tcp_connect(req, handle, addr, on_connect)
   │  向 epoll 注册"可写"事件（连接完成会变为可写）
   ▼
连接握手完成 → poll 阶段触发 → on_connect → JS 'connect'
```

---

## 4. 数据收发：流式读写

### 发送
```
socket.write(data)
   │
   ▼
C++: 写入内部缓冲，调用 uv_write(req, stream, bufs, nbufs, on_write)
   │
   ▼
libuv: 尝试直接 write()；若内核缓冲满（EAGAIN）→ 注册 EPOLLOUT
   │
   ▼
可写时 poll 阶段触发 → 继续把剩余数据 write 出去 → 全部完成 → on_write
   │
   ▼
JS 'drain' / 回调
```

### 接收
```
内核收到数据 → socket 可读 → poll 阶段 epoll 返回 POLLIN
   │
   ▼
uv__read() 循环 read() 直到 EAGAIN（无更多数据）
   │
   ▼
每读到一块 → 调用 alloc_cb 分配缓冲 → 触发 on_read
   │
   ▼
Node C++ 回调 → JS 'data' 事件
```

> 因为 fd 是非阻塞的，`read()` 不会停等；读完立即返回 `EAGAIN`，控制权交还事件循环。

---

## 5. 与文件 I/O 的对比（核心差异）

| 维度 | 网络 I/O | 文件 I/O |
|------|---------|---------|
| fd 类型 | socket（非阻塞） | 普通文件 fd |
| 就绪通知 | epoll/kqueue 多路复用 | 无（文件不进 epoll） |
| 是否阻塞 | 不阻塞（EAGAIN 立即返回） | `read()` 可能真阻塞 |
| 是否走线程池 | **否** | **是** |
| 执行线程 | 主线程 | 工作线程（完成后回主线程） |
| libuv 类型 | `uv_tcp_t` / `uv_udp_t` | `uv_fs_t`（通过 `uv_queue_work`） |

为什么文件不能用 epoll？因为**常规文件系统不提供"文件数据就绪"的异步事件**（磁盘 I/O 由内核页缓存/调度器处理，不是像网络那样有"对端"）。Linux 的 `io_uring` 改变了这一点，但 libuv 目前仍用线程池处理 fs 以保持跨平台一致。

---

## 6. 可运行验证

```js
const net = require('net');
const server = net.createServer((socket) => {
  console.log('client connected (主线程事件循环处理)');
  socket.on('data', (d) => {
    console.log('received:', d.toString());
    socket.write('echo: ' + d);
  });
});
server.listen(8124, () => console.log('listening'));
```

用 `nc localhost 8124` 连接发送数据，所有回调都在主线程事件循环里跑——你可以同时维持成千上万连接而不需要"每连接一线程"。

---

## 7. 本章总结

- 网络 I/O 走非阻塞 fd + epoll/kqueue 多路复用，**全程主线程、零线程池**。
- 连接/读/写都通过"注册事件 → poll 阶段触发 → 回调"的模型完成。
- 与文件 I/O 的根本区别：文件无法用 epoll 通知就绪，所以文件走线程池，网络不走。
- 这正是 Node "单线程扛高并发"的底层支撑：上万个 socket 共享一个 epoll 实例。

---

## 8. 思考题

1. 为什么非阻塞 socket 上调用 `read()` 不会像文件那样真的卡住？EAGAIN 扮演什么角色？
2. 如果一个 TCP server 同时有 10 万连接但都"空闲"，事件循环的开销主要在哪里？
3. 为什么 libuv 决定"文件 I/O 走线程池"而不是为每个平台写不同的异步文件实现？代价是什么？
