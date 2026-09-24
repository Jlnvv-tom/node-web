# 01-04 系统调用：用户态与内核态的边界

> 本章目标：理解"系统调用"这一基础机制——JS 代码如何一步步穿过 Node 的 C++ 绑定、libuv，最终陷入内核执行特权操作。这是把前面所有层串起来的"最后一跳"。

---

## 1. 用户态 vs 内核态

CPU 有特权级别（x86 的 ring 0/3）。普通应用跑在**用户态（ring 3）**，不能直接访问硬件或内核数据结构。需要 I/O（读写磁盘、收发网络、创建进程）时，必须切换到**内核态（ring 0）**执行内核代码，这就是**系统调用（syscall）**。

```
┌─ 用户态 ─────────────────────────────────────┐
│  JS: socket.write('hi')                       │
│     ↓ (V8 执行)                               │
│  C++: TCPWrap::Write → uv_write               │
│     ↓                                         │
│  libuv: 尝试 write()（非阻塞）                │
│     ↓                                         │
│  ──── syscall 指令（如 syscall / int 0x80）── │  ← 陷入内核
└──────────────────────────────────────────────┘
┌─ 内核态 ─────────────────────────────────────┐
│  sys_write / sys_sendto                       │
│  → TCP/IP 协议栈                              │
│  → 网卡驱动 DMA 发送                          │
│  → 返回（切回用户态）                         │
└──────────────────────────────────────────────┘
```

---

## 2. 系统调用的成本

每次 syscall 都有固定开销：
- **上下文切换**：保存用户态寄存器、切换到内核栈、TLB/缓存部分失效。
- **权限检查**：内核校验参数合法性（如指针是否可写、fd 是否有效）。
- **复制**：部分调用需把用户缓冲区拷贝进内核（如 `write` 把用户 buf 拷到内核 socket 发送缓冲）。

因此"大量小 syscall"比"少量大 syscall"慢。这也是为什么：
- 网络用**缓冲区聚合**（Nagle 算法，见 01-02）。
- 文件用**大块读写**而非逐字节。
- `io_uring`（01-01）通过共享内存环形队列**减少 syscall 次数**，把开销降到极低。

---

## 3. Node 中常见的系统调用

| JS 操作 | 中间层 | 最终 syscall（Linux） |
|---------|--------|----------------------|
| `fs.readFile` | libuv 线程池 `uv_fs_read` | `pread` / `read` |
| `socket.write` | `uv_write` | `write` / `sendto`（非阻塞） |
| `server.listen` | `uv_tcp_bind`/`listen` | `bind` / `listen` |
| 新连接到达 | `uv_accept` | `accept4` |
| `setTimeout` | libuv 最小堆（无 syscall） | 无（靠 epoll_wait 超时） |
| 等待 I/O | `uv__io_poll` | `epoll_wait` / `kevent` |
| 进程创建 | `child_process` | `fork` + `execve` / `clone` |
| 文件映射 | V8 / Buffer | `mmap` |

注意：**定时器不触发 syscall**——libuv 把最近定时器作为 `epoll_wait` 的 `timeout` 参数，由单次 epoll 等待同时处理"I/O 就绪 + 超时"（见 02-05）。

---

## 4. 陷入与返回：syscall 指令

- x86-64 Linux：用户态调用 `syscall` 指令，RAX 放系统调用号，参数放 RDI/RSI/RDX...；内核 `entry_SYSCALL_64` 处理，结果回 RAX。
- 32 位旧方式：`int 0x80`（软中断）。
- BSD/macOS：`syscall` / `mach_msg`。

glibc 的 `open`/`read`/`write` 等是对这些指令的封装。libuv / V8 最终都通过 glibc 或直接汇编触发。

---

## 5. vDSO：免陷入的"伪系统调用"

有些"查询类"调用（如 `gettimeofday`、`clock_gettime`）被内核映射到用户态的 **vDSO（virtual Dynamic Shared Object）**——一段内核提供的只读代码，直接在用户态执行，**无需陷入内核**。这极大降低了高频时间查询的成本。

Node 的 `process.hrtime` / `performance.now()` 在底层受益于 vDSO，所以拿高精度时间很便宜。

---

## 6. strace / dtrace：观察 syscall

```bash
# Linux：跟踪某 Node 进程的所有 syscall
strace -f -e trace=network,desc node app.js 2>&1 | head -40

# 统计 syscall 次数
strace -c node app.js
```

你会直观看到：每个"异步"操作的底层都是若干次 syscall；事件循环的"等待"就是 `epoll_wait` 这一次 syscall。

---

## 7. 可运行验证

```bash
# 观察一个简单 HTTP 服务的 syscall 序列
strace -f -e trace=network,desc,epoll_wait \
  node -e "require('http').createServer((q,r)=>r.end('ok')).listen(8124,()=>console.log('up'))" 2>&1 | head -30
```
可见 `socket()` → `bind()` → `listen()` → `epoll_create1()` → `epoll_ctl()` → `epoll_wait()` 的链路，正是前面各章讲的内容落到内核的证据。

---

## 8. 本章总结

- 系统调用是用户态应用请求内核服务的唯一通道；每次都有上下文切换与权限检查成本。
- Node 的 JS → C++ 绑定 → libuv → syscall 是一条完整链路，最终由内核执行 I/O。
- 定时器不触发 syscall（靠 epoll_wait 超时）；`io_uring` 旨在减少 syscall 次数。
- vDSO 让高频时间查询免陷入内核，支撑廉价的高精度计时。
- `strace` 可直观观察所有底层 syscall，验证前述各层理论。

---

## 9. 思考题

1. 为什么说"大量小 syscall 比少量大 syscall 慢"？这如何影响 Node 的网络/文件性能优化？
2. `setTimeout` 不触发 syscall，那"定时"是靠什么实现的？（提示：02-05、01-01）
3. vDSO 是什么？为什么 `performance.now()` 能廉价地高频调用而不陷入内核？
