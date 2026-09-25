# 01-02 文件描述符、系统调用与阻塞语义

> 本章目标：补齐操作系统层的基础知识——"一切皆文件"的 fd 抽象、关键系统调用，以及"阻塞/非阻塞"在系统调用层面的真实含义。这是理解 libuv 网络/文件分流的底层前提。

---

## 1. 文件描述符（File Descriptor, fd）

Unix 哲学：**一切皆文件**。普通文件、目录、socket、管道、设备，都用一个**非负整数 fd** 来引用。

```c
int fd = open("/etc/hostname", O_RDONLY);   // 返回 fd，如 3
read(fd, buf, 100);                          // 通过 fd 读写
close(fd);                                   // 关闭
```

- `fd 0` = stdin、`fd 1` = stdout、`fd 2` = stderr（进程启动时由 shell/父进程打开）。
- 新打开的资源分配**当前最小可用**的 fd 编号。
- socket 也是 fd：`int sock = socket(AF_INET, SOCK_STREAM, 0);`

Node 中的体现：
```js
const fs = require('fs');
fs.open('a.txt', 'r', (err, fd) => {
  fs.read(fd, buffer, 0, 100, 0, (e, n) => { /* ... */ });
  // fd 就是底层整数
});
```
`libuv` 与 `src/node_file.cc` 全程用 `uv_file`（即 `int fd`）操作。

---

## 2. 阻塞 vs 非阻塞（系统调用层面）

默认 `open` 的 fd 是**阻塞**的：调用 `read()` 时，若数据未就绪，线程**睡眠直到数据到达**。

通过 `fcntl(fd, F_SETFL, O_NONBLOCK)` 可把 fd 设为**非阻塞**：

```c
fcntl(sock, F_SETFL, O_NONBLOCK);
int n = read(sock, buf, 100);
// 可能返回：
//   n > 0   读到数据
//   n == 0  对端关闭
//   n == -1 且 errno == EAGAIN/EWOULDBLOCK  → 暂无数据，立刻返回，不睡眠
//   n == -1 且 errno == EINTR              → 被信号中断，重试
```

**非阻塞的核心价值**：`read()`/`write()` 永不睡眠，立即返回。这让单线程能用 epoll 高效地"等所有 fd 就绪后再读"，而不会卡在某个慢 fd 上。

Node 的所有网络 socket 都是 `O_NONBLOCK`（见 02-03）。文件 fd 默认阻塞（所以才要走线程池，见 02-04）。

---

## 3. 关键系统调用速查

| 系统调用 | 作用 | Node 中对应 |
|---------|------|------------|
| `open` / `openat` | 打开文件得 fd | `fs.open` |
| `read` / `pread` | 读（pread 指定偏移，线程安全） | `fs.read` / 线程池 |
| `write` / `pwrite` | 写 | `fs.write` |
| `close` | 关闭 fd | `fs.close` |
| `stat` / `fstat` / `lstat` | 元信息 | `fs.stat` |
| `socket` | 创建 socket fd | `net` 内部 |
| `connect` | 发起 TCP 连接 | `net.Socket.connect` |
| `accept` | 接受连接 | server 'connection' |
| `bind` / `listen` | 绑定端口 + 监听 | `server.listen` |
| `epoll_create` / `epoll_ctl` / `epoll_wait` | I/O 多路复用 | libuv poll 阶段 |
| `fcntl` | 设置 O_NONBLOCK 等 | libuv 内部 |
| `setsockopt` | 套接字选项（SO_REUSEADDR 等） | libuv 内部 |
| `fork` / `execve` | 创建子进程 | `child_process` |
| `pipe` / `socketpair` | 进程间通道 | IPC |
| `mmap` / `munmap` | 内存映射 | V8 / SharedArrayBuffer |

---

## 4. 网络编程陷阱（与 Node 相关）

- **TIME_WAIT 堆积**：主动关闭 TCP 连接的一方进入 TIME_WAIT（约 2 分钟），端口被占用。短连接风暴会耗尽端口。Node 服务端默认 `SO_REUSEADDR` 缓解，但客户端大量短连接仍可能报 `EADDRNOTAVAIL`。解法：连接池、keep-alive、或 `SO_LINGER` 调优。
- **缺 SO_REUSEADDR**：重启监听同一端口报 `EADDRINUSE`。Node `server.listen` 默认已设。
- **Nagle + delayed-ACK**：小包可能累积 ~200ms 延迟。实时场景（如游戏、RPC）设 `TCP_NODELAY`（Node `socket.setNoDelay(true)`）。
- **缓冲过小**：默认 socket 发送/接收缓冲有限，高吞吐需调大。

---

## 5. 系统调用与 libuv 的对应关系

```
JS:      socket.write('hi')
   ▼
C++:     TCPWrap::Write → uv_write
   ▼
libuv:   uv__write  → 尝试 write()（非阻塞）
   ▼
系统调用: write(sock_fd, buf, len)  → 若 EAGAIN 注册 EPOLLOUT
   ▼
内核:    数据进入发送缓冲，由 TCP 栈发送到网络
```

每次"网络收发"的底层都是若干次 `write`/`read` + `epoll_wait` 系统调用。Node 的"零拷贝"特例：`sendfile` 系统调用可让文件直接进 socket，绕过用户态缓冲（用于 `fs.copyFile` 优化与静态文件服务）。

---

## 6. 可运行验证

```bash
# 观察 Node 进程的系统调用
strace -f -e trace=network,desc,read,write node -e "require('net').createConnection(80,'example.com',()=>console.log('c'))" 2>&1 | head -30
```
你会看到 `socket()` → `connect()` → `epoll_create1` → `epoll_ctl` → `epoll_wait` 的序列，印证本文所述的 fd + 多路复用模型。

> 没有 strace（macOS/Windows）？可用 `src/01-os-layer/nonblocking-vs-blocking.js` 对比同步阻塞读与异步非阻塞读的主线程耗时。

---

## 7. 本章总结

- fd 是 Unix "一切皆文件"的抽象，socket 也是 fd；Node 全程以整型 fd 操作。
- 阻塞 `read` 会睡眠；`O_NONBLOCK` 下 `read` 立即返回 `EAGAIN`，是非阻塞 I/O 的基础。
- 网络 fd 非阻塞（走 epoll）；文件 fd 默认阻塞（故走线程池）。
- 常见陷阱：TIME_WAIT、`EADDRINUSE`、Nagle 延迟、缓冲过小，Node 已合理默认处理大部分。
- 每次网络 I/O 底层都是 `write/read + epoll_wait` 系统调用序列。

---

## 8. 思考题

1. 为什么非阻塞 `read` 返回 `EAGAIN` 不算错误？调用方应该怎么处理？
2. 文件 fd 为什么不能像 socket 那样用 epoll 做"就绪通知"？这如何导致 libuv 对文件走线程池？
3. `SO_REUSEADDR` 解决了什么具体问题？为什么重启服务时常遇到 `EADDRINUSE`？
