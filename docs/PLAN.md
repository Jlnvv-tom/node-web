# Node.js 核心源码解读教程 · 计划文档

> 项目路径：`/Users/wujihuan/code/web_workplace/node-web`
> 创建时间：2026-09-25
> 目标读者：有 Node.js 使用经验、希望理解底层原理的开发者
> 参考来源：Node.js 官方文档、Node.js GitHub 源码、libuv 文档、V8 引擎文档、Electron 架构文档、操作系统 I/O 模型资料

---

## 📚 教程整体定位

本教程不是 API 使用手册，而是**自顶向下的源码级解读**，回答一个核心问题：

> **"当你在终端敲下 `node app.js` 回车后，到你的 JavaScript 代码开始执行，中间发生了什么？执行过程中 Node.js 又是如何管理 I/O、模块、内存和并发的？"**

解读路径：`操作系统 → libuv → V8 → C++ Bindings → JS 核心模块 → 用户代码`

---

## 📁 目录结构与篇章规划

```
node-web/
├── README.md                          # 教程总览与阅读指南
├── 00-overview/                      # 总览篇
│   ├── 01-node-architecture.md       # Node.js 分层架构全景
│   ├── 02-source-code-structure.md   # 源码目录结构与构建系统
│   └── 03-startup-flow.md             # 从 node_main.cc 到用户代码执行
├── 01-os-layer/                        # 操作系统层
│   ├── 01-async-io-models.md          # epoll / kqueue / IOCP 对比
│   ├── 02-file-descriptor.md          # 文件描述符与 Unix 哲学
│   ├── 03-thread-pool-os.md           # 操作系统线程与线程池基础
│   └── 04-syscall-interface.md         # 系统调用与用户态/内核态
├── 02-libuv/                            # libuv 层
│   ├── 01-event-loop-phases.md         # 事件循环六阶段源码解读
│   ├── 02-thread-pool-impl.md          # 线程池实现（uv_thread_t / uv_queue_work）
│   ├── 03-network-io.md                # 网络 I/O（TCP / UDP / pipe 非阻塞路径）
│   ├── 04-file-io.md                   # 文件 I/O（为什么走线程池）
│   ├── 05-timers.md                    # 定时器最小堆实现
│   ├── 06-async-callbacks.md           # uv_async_t 与跨线程通信
│   └── 07-poll-phase-deep-dive.md      # poll 阶段深度解析
├── 03-v8-engine/                        # V8 引擎层
│   ├── 01-v8-overview.md               # V8 架构与多段 JIT 管线
│   ├── 02-ignition-sparkplug-maglev-turbofan.md  # 编译层级
│   ├── 03-garbage-collection.md        # 分代垃圾回收（Orinoco）
│   ├── 04-v8-isolate-heap.md           # Isolate / Heap / Context
│   └── 05-v8-embedding-api.md          # Node.js 如何嵌入 V8
├── 04-cpp-bindings/                      # C++ 绑定层
│   ├── 01-node-architecture-cpp.md     # Environment / Realm / BaseObject 三大基类
│   ├── 02-async-wrap.md                # AsyncWrap 与异步资源跟踪
│   ├── 03-handle-wrap.md               # HandleWrap / StreamBase 体系
│   ├── 04-tcp-wrap-deep-dive.md         # TCPWrap 源码精读（从 net.Socket 到 uv_tcp_t）
│   ├── 05-fs-binding.md                # fs 模块 C++ 绑定
│   └── 06-node-api-napi.md             # N-API 稳定 ABI 设计
├── 05-js-core-modules/                  # JavaScript 核心模块层
│   ├── 01-module-system-cjs.md          # CommonJS 模块加载器源码（loader.js）
│   ├── 02-module-system-esm.md          # ESM 加载器源码（esm/loader.js）
│   ├── 03-cjs-esm-interop.md            # CJS/ESM 互操作机制
│   ├── 04-events-eventemitter.md        # EventEmitter 实现
│   ├── 05-stream-system.md             # Stream 体系（Readable / Writable / Transform / Pipeline）
│   ├── 06-http-module.md                # HTTP 模块源码解读
│   ├── 07-net-module.md                 # TCP 网络层
│   ├── 08-fs-module-js.md              # fs 模块 JS 层
│   ├── 09-crypto-module.md             # crypto 模块与 OpenSSL 集成
│   ├── 10-timers-js.md                  # timers 模块（setTimeout / setImmediate / process.nextTick）
│   ├── 11-worker-threads.md              # worker_threads 模块
│   ├── 12-cluster-module.md              # cluster 模块与多进程
│   └── 13-process-object.md              # process 对象的构建
├── 06-event-loop-deep-dive/              # 事件循环专题
│   ├── 01-microtask-vs-macrotask.md      # Promise / nextTick / 阶段间微任务排空
│   ├── 02-setimmediate-vs-settimeout.md  # 执行顺序之谜
│   ├── 03-phases-source-walkthrough.md   # 逐阶段源码走读
│   └── 04-blocking-event-loop.md         # CPU 密集型任务的危害与解决方案
├── 07-memory-and-performance/            # 内存与性能
│   ├── 01-v8-heap-and-gc.md               # V8 堆结构与管理
│   ├── 02-memory-leak-detection.md        # 内存泄漏排查（heapdump / --inspect）
│   ├── 03-buffers-and-typed-arrays.md     # Buffer 内存模型
│   └── 04-performance-hooks.md            # perf_hooks 与诊断工具
├── 08-electron-integration/              # Electron 与 Node.js 集成
│   ├── 01-electron-architecture.md        # Electron 双进程模型
│   ├── 02-v8-sharing.md                   # Chromium 与 Node.js 共享 V8 实例
│   ├── 03-event-loop-merge.md             # libuv 事件循环与 Chromium MessagePump 合并
│   ├── 04-ipc-communication.md           # 主进程/渲染进程 IPC 通信机制
│   └── 05-preload-security.md            # preload 脚本与 contextBridge 安全模型
├── 09-cross-platform/                      # 跨平台实现
│   ├── 01-platform-abstraction.md          # libuv 如何抽象 Linux/macOS/Windows 差异
│   ├── 02-child-process-impl.md            # child_process 跨平台实现
│   └── 03-native-addons.md                 # 原生插件开发与 ABI 兼容
├── 10-practical/                            # 实战篇
│   ├── 01-build-node-from-source.md        # 从源码编译 Node.js
│   ├── 02-read-source-efficiently.md       # 如何高效阅读 Node.js 源码
│   ├── 03-debug-node-with-gdb.md           # 用 GDB/LLDB 调试 Node.js
│   └── 04-write-a-native-addon.md          # 编写一个 N-API 原生插件
└── appendix/
    ├── glossary.md                         # 术语表
    ├── references.md                       # 参考资料与延伸阅读
    └── source-map.md                       # 关键源码文件索引
```

---

## 📖 各篇章详细说明

### 第 0 章：总览篇

| 文件 | 内容 | 涉及源码 |
|------|------|---------|
| `01-node-architecture.md` | Node.js 四层架构图（JS API → C++ Bindings → V8 + libuv → OS）、各层职责划分、数据流走向 | 全局视角 |
| `02-source-code-structure.md` | `lib/` `src/` `deps/` `test/` `tools/` `doc/` 各目录详解、GYP 构建系统、`configure` 脚本 | `node.gyp`, `configure.py` |
| `03-startup-flow.md` | `node_main.cc → node::Start → InitializeOncePerProcess → NodeMainInstance → Realm::BootstrapRealm → bootstrap/realm.js → bootstrap/node.js → run_main_module.js → 用户代码`，完整启动链路 | `src/node_main.cc`, `src/node.cc`, `lib/internal/bootstrap/` |

**学习目标**：理解 Node.js 的分层架构，能在源码中快速定位"某个功能属于哪一层"。

---

### 第 1 章：操作系统层

| 文件 | 内容 | 关键概念 |
|------|------|---------|
| `01-async-io-models.md` | `select`（1983, FD_SETSIZE 1024限制）→ `poll`（无上限但仍 O(n)）→ `epoll`（Linux, O(1) 就绪通知）→ `kqueue`（BSD/macOS, 统一接口）→ `IOCP`（Windows, 完成端口模型）→ `io_uring`（Linux 5.1+, 提交/完成队列） | Reactor vs Proactor 模型 |
| `02-file-descriptor.md` | Unix "一切皆文件"哲学、fd 整数句柄、socket 也是 fd、`open/read/write/close` 系统调用、`fcntl` 设置非阻塞 | `/dev/fd/`, stdin=0/stdout=1/stderr=2 |
| `03-thread-pool-os.md` | pthread（POSIX线程）、线程栈大小（1-8MB）、上下文切换开销、C10K 问题与线程模型崩溃 | 线程 vs 进程 |
| `04-syscall-interface.md` | 用户态→内核态切换、`read()`/`write()`/`accept()`/`epoll_wait`、strace 追踪 Node.js 系统调用 | 内核态/用户态 |

**学习目标**：理解为什么 Node.js 需要异步 I/O，操作系统层面提供了哪些基础设施。

---

### 第 2 章：libuv 层（核心重点）

| 文件 | 内容 | 涉及源码 |
|------|------|---------|
| `01-event-loop-phases.md` | 六阶段详解：`timers → pending → idle/prepare → poll → check → close`，每阶段的回调队列、阶段间微任务排空、`uv_run` 主循环源码 | `deps/uv/src/unix/core.c` (`uv_run`), `deps/uv/src/win/core.c` |
| `02-thread-pool-impl.md` | `UV_THREADPOOL_SIZE`（默认4, 最大1024）、`uv_queue_work` 实现、线程池任务队列、完成后通过 `uv_async_send` 通知主线程 | `deps/uv/src/threadpool.c` |
| `03-network-io.md` | TCP/UDP/pipe 如何注册到 epoll/kqueue/IOCP、`uv_tcp_t` / `uv_udp_t` / `uv_pipe_t` 结构体、连接建立→数据收发→关闭全流程 | `deps/uv/src/unix/tcp.c`, `deps/uv/src/unix/stream.c` |
| `04-file-io.md` | 为什么文件 I/O 走线程池（跨平台异步文件 I/O 缺失）、`uv_fs_t` 操作类型、与网络 I/O 路径对比 | `deps/uv/src/unix/fs.c` |
| `05-timers.md` | 最小堆（min-heap）管理定时器、`uv_timer_t`、setTimeout 与 setInterval 的底层差异 | `deps/uv/src/unix/timer.c` |
| `06-async-callbacks.md` | `uv_async_t` 实现跨线程唤醒事件循环、Worker Threads 通信基础、pipe 内部机制 | `deps/uv/src/unix/async.c` |
| `07-poll-phase-deep-dive.md` | poll 阻塞超时计算逻辑、何时阻塞何时立即返回、与 timers/check 阶段的协调 | `deps/uv/src/unix/core.c` (`uv__io_poll`) |

**学习目标**：能画出事件循环完整流程图，解释 `setTimeout(fn, 0)` 和 `setImmediate(fn)` 谁先执行以及为什么。

---

### 第 3 章：V8 引擎层

| 文件 | 内容 | 关键概念 |
|------|------|---------|
| `01-v8-overview.md` | V8 在 Node.js 中的角色（JS编译执行+内存管理）、V8 不是 Node.js 运行时、V8 不知文件/网络/模块存在 | Embedding 模型 |
| `02-ignition-sparkplug-maglev-turbofan.md` | 四级 JIT：Ignition（字节码解释器）→ Sparkplug（基线编译）→ Maglev（中层优化）→ TurboFan（顶层优化）、热点代码分层优化、反优化（deoptimization） | Tiered compilation |
| `03-garbage-collection.md` | 新生代（Scavenge）/老生代（Mark-Sweep/Mark-Compact）、Orinoco 并行/并发GC、增量标记、大对象空间 | 分代GC |
| `04-v8-isolate-heap.md` | Isolate（独立V8实例）、Heap（堆内存）、Context（执行上下文）、Worker Thread 每个有独立 Isolate | Isolate 隔离 |
| `05-v8-embedding-api.md` | `v8::Isolate::New()`、`v8::Context::New()`、模板函数、`FunctionTemplate`、Node.js 如何用 V8 API 暴露 C++ 函数给 JS | V8 Embedders Guide |

**学习目标**：理解 V8 的编译管线，能解释"为什么 JS 代码跑得快"和"什么时候会反优化"。

---

### 第 4 章：C++ 绑定层

| 文件 | 内容 | 涉及源码 |
|------|------|---------|
| `01-node-architecture-cpp.md` | `Environment`（进程/线程级状态）、`Realm`（JS执行上下文）、`BaseObject`（有JS包装的C++对象基类）三大核心抽象 | `src/env.h`, `src/node_realm.h`, `src/base_object.h` |
| `02-async-wrap.md` | `AsyncWrap` 追踪异步资源生命周期、`async_hooks` 模块的底层支持、`init`/`before`/`after`/`destroy` 钩子 | `src/async_wrap.h`, `src/async_wrap.cc` |
| `03-handle-wrap.md` | `HandleWrap` → `StreamBase` → `ConnectionWrap` 继承体系、libuv handle 的 RAII 管理 | `src/handle_wrap.h`, `src/stream_base.h` |
| `04-tcp-wrap-deep-dive.md` | 从 `new net.Socket()` 到 `uv_tcp_t` 完整链路：JS Socket → TCPWrap C++ → uv_tcp_init → epoll 注册 → uv_read_start → 回调到 JS | `src/tcp_wrap.cc`, `lib/net.js` |
| `05-fs-binding.md` | `fs.readFile` JS → `FSReqCallback` C++ → `uv_fs_read` 线程池 → 回调链 | `src/node_file.cc`, `lib/fs.js` |
| `06-node-api-napi.md` | N-API 稳定 ABI 设计原理、`napi_create_function`/`napi_get_cb_info`、跨版本不重编译原理 | `src/node_api.cc` |

**学习目标**：理解 JS 调用如何穿透到 C++ 层，能追踪一个 API 从 JS 到系统调用的完整路径。

---

### 第 5 章：JavaScript 核心模块层

| 文件 | 内容 | 涉及源码 |
|------|------|---------|
| `01-module-system-cjs.md` | `Module._load` → `_resolveFilename` → `_findPath` → `_extensions['.js']` → `Module.wrap` → `compile`，完整 CJS 加载链路、模块缓存机制、函数包装器 | `lib/internal/modules/cjs/loader.js` |
| `02-module-system-esm.md` | ESM loader 架构、`resolve` → `get_format` → `load` → `translate` → `module_job` 链路、URL-based 解析、静态分析、顶层 await | `lib/internal/modules/esm/loader.js`, `lib/internal/modules/esm/resolve.js` |
| `03-cjs-esm-interop.md` | `import` CJS 模块的 default/named exports 提取（`cjs-module-lexer`）、`createRequire` 桥接、`__esModule` 标记、循环依赖处理差异 | `lib/internal/modules/esm/translators.js` |
| `04-events-eventemitter.md` | `EventEmitter` 类实现、事件监听器数组管理、`once` 包装、`removeListener` 的 `removeWrapper` 机制、最大监听器数与内存泄漏预警 | `lib/events.js` |
| `05-stream-system.md` | Stream 状态机（Readable 的 2态3模式、Writable 的状态）、背压（backpressure）与 `highWaterMark`、`pipe` 实现、`pipeline` 与错误传播、`Transform` 的 `_transform`/`_flush` | `lib/internal/streams/` |
| `06-http-module.md` | HTTP Server 创建→连接处理→请求解析（llhttp）→响应写入、`IncomingMessage`/`ServerResponse` 与 Stream 的关系、Keep-Alive 连接复用 | `lib/http.js`, `lib/_http_server.js`, `lib/_http_incoming.js` |
| `07-net-module.md` | `net.createServer` → TCPWrap → 监听流程、Socket 连接建立、数据读写、`end`/`destroy` 语义、与 `uv_tcp_t` 的映射 | `lib/net.js` |
| `08-fs-module-js.md` | fs 模块 JS 层封装、Promises API 实现、同步/异步路径分叉、`FileHandle` 对象、`Dir` 迭代器 | `lib/fs.js`, `lib/fs/promises.js` |
| `09-crypto-module.md` | `crypto` 与 OpenSSL 集成、`pbkdf2`/`scrypt` 走线程池、`createHash`/`createCipher` 流式API、WebCrypto API | `lib/crypto.js`, `src/node_crypto.cc` |
| `10-timers-js.md.md` | `setTimeout`/`setInterval`（macrotask, timers 阶段）、`setImmediate`（check 阶段）、`process.nextTick`（阶段间微任务，最高优先级）、执行顺序规则 | `lib/timers.js`, `lib/internal/linkedlist.js` |
| `11-worker-threads.md` | `worker_threads` 实现：独立 V8 Isolate + 独立 libuv loop、`MessageChannel` 通信、`SharedArrayBuffer` 共享内存、`postMessage` 序列化 | `lib/worker_threads.js`, `src/node_worker.cc` |
| `12-cluster-module.md` | `cluster` 基于 `child_process.fork`、轮询调度（round-robin）、共享端口监听（SO_REUSEPORT）、主从通信 | `lib/cluster.js`, `lib/internal/cluster/` |
| `13-process-object.md` | `process` 对象的构建：C++ 层注入 `process.argv`/`process.env`/`process.version`、`uncaughtException` 处理、`exit` 事件、`process.nextTick` 真正实现 | `lib/internal/process/` |

**学习目标**：从源码理解每个核心模块的设计动机和实现细节，能独立追踪任意 API 的源码实现。

---

### 第 6 章：事件循环专题

| 文件 | 内容 |
|------|------|
| `01-microtask-vs-macrot.md` | microtask（Promise.then / queueMicrotask）vs macrotask（setTimeout / setImmediate）、`process.nextTick` 的特殊地位（优先于 microtask）、每个阶段间排空微任务队列的源码位置 |
| `02-setimmediate-vs-settimeout.md` | 在 I/O 回调中 `setImmediate` 先于 `setTimeout` 执行；在主模块中顺序不确定；原理是 phase 顺序（poll → check → timers）|
| `03-phases-source-walkthrough.md` | 逐阶段走读 `uv__run_timers` → `uv__run_pending` → `uv__io_poll` → `uv__run_check` → `uv__run_closing_handles`，标注每步对应的源码行 |
| `04-blocking-event-loop.md` | CPU 密集型任务阻塞事件循环的原理、`worker_threads` 解决方案、`child_process` 分离进程、`N-API` 线程安全异步插件 |

**学习目标**：能用源码级视角解答任何事件循环相关的面试题。

---

### 第 7 章：内存与性能

| 文件 | 内容 |
|------|------|
| `01-v8-heap-and-gc.md` | V8 堆分区（New Space / Old Space / Large Object Space / Code Space）、GC 触发条件、`--max-old-space-size` 调参 |
| `02-memory-leak-detection.md` | `--inspect` + Chrome DevTools Heap Snapshot、`process.memoryUsage()`、`v8.getHeapStatistics()`、常见泄漏模式（闭包/全局变量/EventEmitter未清理/Timer未清除）|
| `03-buffers-and-typed-arrays.md` | `Buffer` 基于 `ArrayBuffer` 的实现、`Buffer.alloc` vs `Buffer.allocUnsafe`、Buffer 池化（8KB 预分配池）、与 `Uint8Array` 的关系 |
| `04-performance-hooks.md` | `perf_hooks` 模块、`PerformanceObserver`、`performance.eventLoopUtilization`、`--cpu-prof` / `--heap-prof` 标志 |

**学习目标**：能定位 Node.js 内存问题，理解 V8 GC 对应用性能的影响。

---

### 第 8 章：Electron 与 Node.js 集成

| 文件 | 内容 | 关键概念 |
|------|------|---------|
| `01-electron-architecture.md` | Electron = Chromium + Node.js、双进程模型（主进程=Node.js / 渲染进程=Chromium）、VS Code/Slack/Figma 案例 | Multi-process model |
| `02-v8-sharing.md` | 构建时 `node_shared=true`、关闭 Node.js 内置 V8、共享 Chromium 的 V8 实例、内存节省与统一 GC | V8 instance sharing |
| `03-event-loop-merge.md` | Node.js libuv 事件循环与 Chromium MessagePump 合并方案、libuv 作为主循环、MessagePump 集成到 libuv、确保不互相阻塞 | Event loop unification |
| `04-ipc-communication.md` | `ipcMain`/`ipcRenderer` 机制、`contextBridge.exposeInMainWorld` 安全桥接、同步/异步 IPC、`MessageChannel` | IPC patterns |
| `05-preload-security.md` | `nodeIntegration: false` 默认安全策略、`contextIsolation: true` 隔离、preload 脚本权限边界、CSP 策略 | Security model |

**学习目标**：理解 Electron 如何让 Node.js 和 Chromium 共存，以及为什么 Electron 应用内存占用大。

---

### 第 9 章：跨平台实现

| 文件 | 内容 | 涉及源码 |
|------|------|---------|
| `01-platform-abstraction.md` | libuv 对 Linux（epoll）/macOS（kqueue）/Windows（IOCP）的抽象层、条件编译（`#ifdef _WIN32`）、API 统一接口设计 | `deps/uv/src/unix/`, `deps/uv/src/win/` |
| `02-child-process-impl.md` | `child_process.spawn` 在 Unix（fork+exec）和 Windows（CreateProcess）的差异、IPC pipe 建立、stdio 信号处理 | `src/process_wrap.cc` |
| `03-native-addons.md` | 原生插件发展史：NAN → N-API → Node-API、`node-gyp` 构建、`.node` 文件加载、ABI 稳定性矩阵 | `src/node_api.cc` |

**学习目标**：理解跨平台 C 库如何抽象操作系统差异。

---

### 第 10 章：实战篇

| 文件 | 内容 |
|------|------|
| `01-build-node-from-source.md` | `./configure --prefix=... && make -j$(nproc) && make install`、调试符号、自适应构建选项 |
| `02-read-source-efficiently.md` | 推荐阅读顺序、工具推荐（ctags / cscope / Sourcegraph）、关键文件导航表 |
| `03-debug-node-with-gdb.md` | GDB/LLDB 基础、断点设置、V8 对象检查、`--abort-on-uncaught-exception` |
| `04-write-a-native-addon.md` | 从零编写 N-API 插件：`napi_create_function` → 编译 → `require('./build/Release/addon.node')` |

**学习目标**：能从源码编译 Node.js、使用调试器追踪源码执行、编写原生插件。

---

### 附录

| 文件 | 内容 |
|------|------|
| `glossary.md` | Isolate, Realm, Handle, Request, Wrap, Binding, Tick, Microtask 等术语表 |
| `references.md` | Node.js 官方文档、libuv 文档、V8 文档、Electron 文档、推荐书籍/文章链接 |
| `source-map.md` | 关键源码文件索引表：文件路径 → 功能说明 → 所属章节 |

---

## 📐 知识依赖关系

```
┌─────────────┐
│ 00 总览篇    │ ← 先读这里，建立全局视角
└──────┬──────┘
       │
       ▼
┌─────────────┐     ┌──────────────┐
│ 01 OS 层    │────▶│ 02 libuv 层  │ ← 核心重点
└─────────────┘     └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
       ┌──────────┐ ┌───────────┐ ┌────────────┐
       │ 03 V8 层 │ │ 04 C++层  │ │ 06 事件循环 │
       └────┬─────┘ └─────┬─────┘ └──────┬─────┘
            │              │                │
            └──────┬───────┘                │
                   ▼                          │
            ┌─────────────┐                    │
            │ 05 JS 模块  │◀───────────────────┘
            └──────┬──────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
 ┌──────────┐ ┌────────┐ ┌──────────┐
 │07 内存性能│ │08 Elec│ │09 跨平台  │
 └──────────┘ └────────┘ └──────────┘
                   │
                   ▼
            ┌─────────────┐
            │ 10 实战篇    │
            └─────────────┘
```

---

## 🛠 涉及的关键技术栈与外部知识

| 知识领域 | 在教程中的角色 | 推荐预备知识 |
|---------|--------------|-------------|
| **C/C++** | 阅读 Node.js 核心源码与 V8 API | 基本语法、类继承、模板、智能指针 |
| **操作系统** | 理解 I/O 模型、进程/线程、内存映射 | 进程/线程概念、文件系统、网络基础 |
| **V8 引擎** | 理解 JS 编译执行与 GC | 无需深入，教程会提供必要背景 |
| **libuv** | 理解事件循环与异步 I/O | 无需预备，教程从零讲解 |
| **Electron** | 理解 Node.js 在桌面应用中的集成 | 了解 Electron 的基本使用 |
| **网络协议** | 理解 net/http 模块源码 | TCP 三次握手、HTTP 请求/响应模型 |

---

## 📊 源码文件索引表（核心文件速查）

| 源码文件 | 功能 | 所属章节 |
|---------|------|---------|
| `src/node_main.cc` | 程序入口 `main()` | 00-03 |
| `src/node.cc` | `node::Start()` 初始化与启动 | 00-03 |
| `src/env.h` / `src/env.cc` | `Environment` 进程级状态 | 04-01 |
| `src/node_realm.h` | `Realm` JS执行上下文 | 04-01 |
| `src/base_object.h` | `BaseObject` 基类 | 04-01 |
| `src/async_wrap.cc` | `AsyncWrap` 异步追踪 | 04-02 |
| `src/tcp_wrap.cc` | TCPWrap 实现 | 04-04 |
| `src/node_file.cc` | fs C++ 绑定 | 04-05 |
| `src/node_api.cc` | N-API 实现 | 04-06 |
| `lib/internal/modules/cjs/loader.js` | CommonJS 模块加载器 | 05-01 |
| `lib/internal/modules/esm/loader.js` | ESM 模块加载器 | 05-02 |
| `lib/internal/modules/esm/translators.js` | CJS→ESM 转换 | 05-03 |
| `lib/events.js` | EventEmitter | 05-04 |
| `lib/internal/streams/readable.js` | Readable Stream | 05-05 |
| `lib/http.js` | HTTP 模块入口 | 05-06 |
| `lib/net.js` | TCP 网络层 | 05-07 |
| `lib/fs.js` | fs 模块 | 05-08 |
| `lib/timers.js` | 定时器 | 05-11 |
| `lib/worker_threads.js` | Worker 线程 | 05-12 |
| `lib/cluster.js` | 集群 | 05-13 |
| `deps/uv/src/unix/core.c` | libuv 事件循环（Unix） | 02-01 |
| `deps/uv/src/threadpool.c` | libuv 线程池 | 02-02 |
| `deps/uv/src/unix/tcp.c` | libuv TCP 实现 | 02-03 |
| `deps/uv/src/unix/fs.c` | libuv 文件 I/O | 02-04 |
| `deps/uv/src/unix/timer.c` | libuv 定时器 | 02-05 |

---

## 📝 编写规范

1. **每篇文件结构**：导读 → 架构图 → 源码走读 → 关键代码片段（带行号注释）→ 总结 → 思考题
2. **代码引用**：标注源码文件路径和大致行号，如 `src/node.cc:420`
3. **图示**：关键流程配 ASCII 图或 Mermaid 流程图
4. **可运行示例**：每篇至少一个可运行的 Node.js 脚本验证所述内容
5. **语言**：中文为主，术语保留英文原文

---

## ⏱ 预估工作量

| 章节 | 文件数 | 预估每篇字数 | 优先级 |
|------|--------|------------|--------|
| 00 总览篇 | 3 | 3000-5000 | ⭐⭐⭐⭐⭐ |
| 01 OS 层 | 4 | 2000-4000 | ⭐⭐⭐ |
| 02 libuv 层 | 7 | 3000-6000 | ⭐⭐⭐⭐⭐ |
| 03 V8 层 | 5 | 3000-5000 | ⭐⭐⭐⭐ |
| 04 C++ 绑定层 | 6 | 3000-6000 | ⭐⭐⭐⭐⭐ |
| 05 JS 核心模块 | 13 | 2000-5000 | ⭐⭐⭐⭐ |
| 06 事件循环专题 | 4 | 2000-4000 | ⭐⭐⭐⭐⭐ |
| 07 内存与性能 | 4 | 2000-4000 | ⭐⭐⭐ |
| 08 Electron 集成 | 5 | 2000-4000 | ⭐⭐⭐ |
| 09 跨平台 | 3 | 2000-3000 | ⭐⭐ |
| 10 实战篇 | 4 | 1500-3000 | ⭐⭐⭐ |
| 附录 | 3 | 1000-2000 | ⭐ |
| **合计** | **61** | — | — |

---

## 🚀 建议的编写顺序

**第一批（地基）**：00-01 → 00-02 → 00-03 → 02-01
**第二批（核心循环）**：02-02 → 02-03 → 02-04 → 06-01 → 06-03
**第三批（绑定层）**：04-01 → 04-02 → 04-04 → 04-05
**第四批（JS 模块）**：05-01 → 05-02 → 05-04 → 05-05 → 05-07
**第五批（扩展）**：03-01 → 08-01 → 10-01

其余文件按需补充。

---

*本计划文档将随教程编写进度持续更新。*
