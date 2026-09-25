# 00-01 Node.js 分层架构全景

> 本章目标：建立 Node.js 的整体心智模型，理解"某个功能究竟属于哪一层"，为后续逐层源码解读铺路。

---

## 1. 一句话定位

**Node.js = V8（JavaScript 引擎）+ libuv（事件循环与异步 I/O 库）+ 一组 C++/JS 绑定 + 标准库 + 应用**。

它不是一个从零造的虚拟机，而是把"高性能 JS 执行（V8）"和"跨平台异步 I/O（libuv）"用胶水代码粘起来的运行时。V8 只负责把 JS 编译成机器码并管理内存；**V8 并不知道文件、网络、定时器是什么**。这些能力全部由 Node.js 自己通过 C++ 层桥接到操作系统。

---

## 2. 四层架构图

```
┌──────────────────────────────────────────────────────────────┐
│  (5) 用户代码  app.js / 你的业务模块                            │
├──────────────────────────────────────────────────────────────┤
│  (4) JS 核心模块层   lib/                                     │
│      fs.js  net.js  http.js  events.js  stream.js             │
│      timers.js  crypto.js  worker_threads.js ...             │
│      lib/internal/**  （内部模块，不直接对外暴露）              │
├──────────────────────────────────────────────────────────────┤
│  (3) C++ 绑定层   src/*.cc   （Node 原生胶水）                 │
│      node_file.cc  tcp_wrap.cc  node_crypto.cc ...            │
│      核心抽象: Environment / Realm / BaseObject /             │
│               AsyncWrap / HandleWrap                          │
│      通过 V8 API 把 C++ 函数暴露给 JS                          │
├───────────────────────────────┬──────────────────────────────┤
│  (2a) libuv                   │  (2b) V8 引擎                 │
│   事件循环 (uv_run)            │   编译执行 JS (Ignition/...)   │
│   线程池 (threadpool.c)        │   内存管理 (Orinoco GC)        │
│   网络 I/O / 文件 I/O          │   Isolate / Context / Heap    │
│   DNS / 信号 / 子进程          │                               │
├───────────────────────────────┴──────────────────────────────┤
│  (1) 操作系统层                                                │
│     Linux:   epoll        macOS/BSD: kqueue                   │
│     Windows: IOCP         (Linux 5.1+: io_uring)              │
│     pthread 线程 / 系统调用 (read/write/accept/fcntl)          │
└──────────────────────────────────────────────────────────────┘
```

要点：
- **(1) 操作系统层**：提供最底层的 I/O 多路复用（epoll/kqueue/IOCP）、文件描述符、线程等原语。
- **(2) 运行时双核**：`libuv` 负责"何时、用什么 I/O"；`V8` 负责"JS 怎么跑、内存怎么管"。两者由 Node 的 C++ 层驱动。
- **(3) C++ 绑定层**：这是 Node.js 真正的"灵魂"。它用 V8 的 C++ API（如 `v8::FunctionTemplate`）创建 JS 可调用的函数，内部调用 libuv / OpenSSL / zlib 等库。
- **(4) JS 核心模块层**：用 JS 写的标准库，多数最终都下钻到 (3) 的 C++ 绑定。例如 `fs.readFile` 在 `lib/fs.js` 里调用 C++ 的 `fs.read`。
- **(5) 用户代码**：站在 (4) 的肩膀上。

---

## 3. 一次调用的完整数据流（以 `fs.readFile` 为例）

```
用户代码: fs.readFile('a.txt', cb)
   │
   ▼
lib/fs.js  (JS 层)
   │  构造 FSReqCallback，调用 binding.fs.read
   ▼
src/node_file.cc  (C++ 绑定层)
   │  uv_fs_read(req, fd, buf, ...)
   ▼
deps/uv/src/unix/fs.c  (libuv 线程池)
   │  在线程池中调用 POSIX read()
   ▼
内核  (操作系统层)
   │  read() 系统调用，数据从磁盘进入内核缓冲区
   ▼
线程池回调 → uv_async_send 通知主线程事件循环
   │
   ▼
libuv 在 poll/check 阶段把结果通过 MakeCallback 抛回 JS
   │
   ▼
用户的 cb(err, data) 被执行
```

注意第 4 步：文件 I/O **走线程池**，而网络 I/O 直接在非阻塞 fd 上注册到 epoll/kqueue，不在线程池。这是后续 libuv 章节的重点。

---

## 4. 关键技术概念速记

| 概念 | 一句话 |
|------|--------|
| 单线程事件循环 | 主线程只有一个，靠 libuv 调度回调，避免多线程竞态 |
| 非阻塞 I/O | 发起 I/O 不等待结果，结果通过回调/ Promise 返回 |
| libuv | 跨平台的异步 I/O 库，抽象了 epoll/kqueue/IOCP 差异 |
| V8 不管 I/O | V8 只懂 JS 与内存；文件/网络由 Node C++ 层提供 |
| C++ 绑定 | `internalBinding()` 暴露的 C++ 功能，是 JS 掉到原语的桥 |
| N-API | 稳定的 C ABI，让原生插件跨 Node 版本免重编译 |
| 线程池 | libuv 默认 4 线程，处理 fs / 部分 crypto / DNS 等 |

---

## 5. 与其他运行时的对比

| 运行时 | JS 引擎 | 事件循环 / I/O | 语言绑定 |
|--------|---------|---------------|---------|
| **Node.js** | V8 | libuv | C++ |
| **Deno** | V8 | tokio (Rust) / hyper | Rust |
| **Bun** | JavaScriptCore (JSC) | 自研 (Zig) | Zig |
| **浏览器** | V8/JSC | 浏览器主线程事件循环 | C++ |

三者都遵循"单线程事件循环 + 非阻塞 I/O"范式，区别在绑定语言与 I/O 库的实现。理解 Node 的 libuv 模型，对理解其他运行时也有迁移价值。

---

## 6. 本章总结

- Node.js 的本质是 **V8 + libuv + 绑定层** 的组合，而非独立发明的执行引擎。
- 排查问题时，先判断"这个能力在哪一层的代码里"：是 JS 标准库的逻辑、C++ 绑定、还是 libuv / 操作系统行为。
- 后续章节将自底向上逐层拆开：操作系统 I/O 模型 → libuv → V8 → C++ 绑定 → JS 模块。

---

## 7. 思考题

1. 为什么说"V8 不知道文件是什么"？如果只用 V8 而不接 libuv，能跑出 `fs.readFile` 吗？
2. 网络 I/O 和文件 I/O 在 Node 里走了不同的底层路径，为什么要这样设计？
3. 当你在终端输入 `node app.js`，最先被执行的代码位于哪一层？
