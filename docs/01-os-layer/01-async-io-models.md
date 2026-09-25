# 01-01 异步 I/O 模型：从 select 到 io_uring

> 本章目标：在深入 Node/libuv 之前，先理解"异步 I/O"在操作系统层的演进——为什么需要事件循环、各种 I/O 多路复用机制的优劣，以及它们如何映射到 libuv。

---

## 1. 问题起源：C10K 问题

1999 年 Dan Kegel 提出 **C10K** 问题：如何在一台机器上同时服务 1 万个客户端连接？

### 1.1 线程/进程每连接模型（thread-per-connection）

```
每个连接 → 一个线程（或进程）
栈大小 1~8MB × 10000 ≈ 80GB 内存（仅栈！）
+ 上下文切换开销随连接数线性增长
```

问题明显：内存爆炸 + 调度开销大。当大部分连接空闲时，绝大多数线程在睡眠，资源浪费严重。

### 1.2 事件驱动（event-driven）思路

```
单线程（或少量线程）+ 非阻塞 fd + 一个"就绪事件"通知机制
睡眠时零成本，工作正比于"就绪事件数"而非"总连接数"
```

这正是 Node、Nginx、Redis 的核心范式。关键是有个高效的"哪些 fd 就绪了"查询工具——即 I/O 多路复用。

---

## 2. I/O 多路复用演进

### 2.1 `select`（POSIX, 1983）

```c
fd_set read_fds;
FD_ZERO(&read_fds);
FD_SET(sockfd, &read_fds);
select(max_fd+1, &read_fds, NULL, NULL, &timeout);
```

- **缺点**：
  - `FD_SETSIZE` 硬上限 1024（常被魔改但麻烦）。
  - 每次调用要把整个 fd 集合**从用户态拷贝到内核态**。
  - 返回后要**遍历所有 fd** 找就绪的（O(n)）。
  - 内核不记住监听集合，每次都重传。

### 2.2 `poll`（1997）

```c
struct pollfd fds[N];
fds[0].fd = sockfd; fds[0].events = POLLIN;
poll(fds, N, timeout);
```

- 改进：无 1024 数量上限（用动态数组）。
- 仍问题：每次拷贝 fd 数组 + 返回后 O(n) 遍历。

### 2.3 `epoll`（Linux 2.5.46, 2002）★

```c
int epfd = epoll_create1(0);
struct epoll_event ev;
ev.events = EPOLLIN; ev.data.fd = sockfd;
epoll_ctl(epfd, EPOLL_CTL_ADD, sockfd, &ev);   // 注册（一次）
struct epoll_event events[MAX];
int n = epoll_wait(epfd, events, MAX, timeout); // 只取就绪的
```

- **核心改进**：
  - 内核**维护"兴趣列表"**（红黑树），`epoll_ctl` 注册一次，无需每次拷贝。
  - `epoll_wait` 只返回**就绪的 fd**（O(k)，k=就绪数），不遍历全部。
  - 支持**边缘触发（ET）**与**水平触发（LT，默认）**。
- 这是 Linux 上事件循环的事实标准，libuv 在 Linux 走 epoll。

**LT vs ET**：
- **LT（默认）**：只要 fd 可读，每次 `epoll_wait` 都报告。容错好，但可能多次通知。
- **ET（边缘触发）**：只在状态变化时通知一次，必须一次读完所有数据（循环 `read` 到 EAGAIN），否则丢失事件。性能更高但易错。

### 2.4 `kqueue`（FreeBSD 4.1, 2000 / macOS）

```c
int kq = kqueue();
struct kevent changelist, eventlist[N];
EV_SET(&changelist, sockfd, EVFILT_READ, EV_ADD, 0, 0, NULL);
kevent(kq, &changelist, 1, eventlist, N, NULL);
```

- BSD/macOS 上的等价物，设计更统一：`kevent` 可同时监听 **fd、信号、定时器、文件变更、子进程**等，一个接口管所有异步事件。
- libuv 在 macOS/BSD 走 kqueue。

### 2.5 `IOCP`（Windows）

```c
HANDLE iocp = CreateIoCompletionPort(...);
BOOL ok = ReadFile(hFile, buf, len, NULL, &overlapped);  // 立即返回
// 完成后：
GetQueuedCompletionStatus(iocp, &bytes, &key, &ovl, INFINITE);
```

- Windows 用 **Proactor 模型**（完成通知）：发起 I/O 后立刻返回，内核完成后再通知你"结果已就绪"。
- 与 epoll/kqueue 的 **Reactor 模型**（就绪通知：fd 可读了你再去读）相反。
- libuv 在 Windows 用 IOCP，并在上层把 Proactor 模拟成 Reactor 风格，统一接口。

### 2.6 `io_uring`（Linux 5.1, 2019）

```c
// 提交队列（SQ）+ 完成队列（CQ），内核共享环形缓冲
io_uring_setup(entries, &params);
io_uring_prep_read(sqe, fd, buf, len, offset);
io_uring_submit(&ring);
io_uring_wait_cqe(&ring, &cqe);   // 等待完成
```

- 最新方案：用户态与内核态通过**共享内存环形队列**通信，几乎免去系统调用开销。
- 支持**真异步文件 I/O**（以往文件无法用 epoll，只能线程池）。
- 应用复杂度高，libuv 尚未全面采用（Node 的文件 I/O 仍走线程池，但未来可能演进）。

---

## 3. Reactor vs Proactor

```
Reactor（epoll/kqueue）："fd 就绪了，你自己去读"
   事件循环: epoll_wait → 发现可读 → 调用 read() 取数据

Proactor（IOCP/io_uring）："读操作完成了，数据已给你"
   事件循环: 提交读请求 → 内核完成 → 通知"数据已就绪在缓冲"
```

libuv 在 Windows 用 IOCP（Proactor），但通过"内部预读"技巧把它包装成 Reactor 行为，让上层 API 一致。这是 libuv 跨平台抽象的典型例子。

---

## 4. 各机制对比表

| 机制 | 平台 | 模型 | 注册成本 | 取就绪 | 文件 I/O | 其他事件 |
|------|------|------|---------|--------|---------|---------|
| select | 跨 POSIX | Reactor | O(n) 每次拷贝 | O(n) 遍历 | 否 | 信号/子进程部分 |
| poll | 跨 POSIX | Reactor | O(n) 每次拷贝 | O(n) 遍历 | 否 | — |
| epoll | Linux | Reactor | O(1) 一次注册 | O(k) 就绪 | 否 | 定时器（min-heap） |
| kqueue | BSD/macOS | Reactor | O(1) | O(k) | 部分 | 信号/文件/子进程 |
| IOCP | Windows | Proactor | O(1) | O(k) 完成 | 是 | — |
| io_uring | Linux 5.1+ | Proactor | O(1) | O(k) 完成 | **是** | 广泛 |

---

## 5. 与 libuv / Node 的映射

```
操作系统层                      libuv 层                    Node JS 层
─────────                      ────────                    ──────────
epoll/kqueue/IOCP   →   uv__io_poll (uv_run 的 poll 阶段)   →  'data'/'connect' 等事件
                                                      →  定时器（独立 min-heap，非靠 OS 定时器）
                                                      →  fs（线程池模拟异步）
```

注意：**Node 的定时器不是靠 OS 定时器实现的**，而是 libuv 用最小堆自己管理，在 poll 阶段计算 `timeout` 传入 epoll_wait。这与"文件 I/O 走线程池"一样，是 libuv 为统一跨平台行为做的抽象。

---

## 6. 网络编程常见陷阱（与 Node 相关）

| 陷阱 | 现象 | 解决 |
|------|------|------|
| TIME_WAIT 堆积 | 端口耗尽，新连接失败 | 连接池 / keep-alive |
| 缺 SO_REUSEADDR | 重启报 "Address already in use" | 监听前 setsockopt |
| Nagle + delayed-ACK | 约 200ms 延迟 | 设 TCP_NODELAY |
| 连接池过小 | 吞吐上不去 | 调大池 / 复用连接 |
| SYN flood | 资源耗尽 | SYN cookies |

Node 已默认合理处理大部分（如 TCP server 默认 `SO_REUSEADDR`），但客户端短连接风暴仍可能触发 TIME_WAIT 问题。

---

## 7. 可运行验证

```bash
# 观察一个 Node TCP 服务的 fd 监听机制
strace -f -e trace=epoll_ctl,epoll_wait,read,write node server.js 2>&1 | head -40
```
你会看到 `epoll_ctl` 注册 socket，然后 `epoll_wait` 阻塞等待，客户端连接到达后触发 `read`——这正是 Reactor 模型。

---

## 8. 本章总结

- 事件驱动是解决 C10K 的关键：单线程 + 非阻塞 fd + 多路复用，开销正比于就绪数。
- `select/poll` 已淘汰；现代用 `epoll`（Linux）/ `kqueue`（BSD/macOS）/ `IOCP`（Windows）；`io_uring` 是未来。
- Reactor（就绪通知）vs Proactor（完成通知）：libuv 在 Windows 用 Proactor 但包装成 Reactor。
- libuv 的 `uv__io_poll` 抽象了 epoll/kqueue/IOCP 差异，定时器与文件 I/O 是 libuv 自建的模拟层。

---

## 9. 思考题

1. 为什么 `epoll` 比 `select` 在万级连接下快得多？关键改进在哪两处？
2. Reactor 与 Proactor 的编程模型有何不同？Node 开发者需要关心这个区别吗？
3. `io_uring` 让"文件异步 I/O"成为可能，如果 libuv 改用 io_uring，Node 的文件 I/O 路径会发生什么变化？
