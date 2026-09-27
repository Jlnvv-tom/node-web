# 术语表 (Glossary)

本表收录教程中出现的关键术语，按字母排序。

| 术语 | 英文 | 释义 |
|------|------|------|
| ABI | Application Binary Interface | 二进制接口。ABI 稳定意味着编译后的库不需要重编译即可在新版本运行 |
| ArrayBuffer | ArrayBuffer | V8 提供的固定长度二进制数据缓冲区，可在堆外分配 |
| AsyncWrap | AsyncWrap | Node.js C++ 层异步资源基类，用于异步追踪和诊断 |
| BaseObject | BaseObject | Node.js C++ 层对象基类，关联 V8 对象与 C++ 对象生命周期 |
| CJS | CommonJS | Node.js 传统模块系统，`require()` / `module.exports` |
| Context | V8 Context | V8 的 JS 执行环境，包含全局对象和内置函数。一个 Isolate 可有多个 |
| Epoll | epoll | Linux 高效 I/O 多路复用机制，O(1) 就绪通知 |
| ESM | ECMAScript Modules | ES6 标准模块系统，`import` / `export` |
| Event Loop | 事件循环 | Node.js 的核心调度机制，单线程轮询处理定时器/I/O 回调 |
| FD | File Descriptor | 文件描述符，Unix 系统对 I/O 资源的整数句柄 |
| GYP | Generate Your Projects | Google 的构建系统配置生成器，Node.js 使用它生成 Makefile |
| HandleScope | HandleScope | V8 栈上句柄管理器，RAII 管理局部引用 |
| Heap | Heap | V8 管理的 JS 对象内存空间，分新生代/老生代 |
| IOCP | I/O Completion Ports | Windows 完成端口模型，Proactor 模式 |
| io_uring | io_uring | Linux 5.1+ 的高效异步 I/O 接口，提交/完成队列 |
| IPC | Inter-Process Communication | 进程间通信 |
| Isolate | V8 Isolate | V8 的独立实例，包含独立堆和 GC。两个 Isolate 不共享对象 |
| JIT | Just-In-Time Compilation | 即时编译，V8 的多层编译策略（Ignition→Sparkplug→Maglev→TurboFan） |
| kqueue | kqueue | BSD/macOS 的 I/O 多路复用机制 |
| libuv | libuv | Node.js 的跨平台异步 I/O 库，提供事件循环、线程池、文件/网络 I/O |
| MessagePump | MessagePump | Chromium 的消息泵，Electron 中与 libuv 合并 |
| N-API | Node API | Node.js 的稳定 C ABI，用于编写原生插件 |
| NAT | Native Abstractions for Node.js | 第一代插件 API，直接绑定 V8 C++ API，已不推荐 |
| nextTick | process.nextTick | Node.js 特有的微任务，在当前操作完成后、下一个事件循环阶段前执行 |
| poll | poll 阶段 | 事件循环中等待 I/O 事件的阶段 |
| Realm | Realm | Node.js 对 V8 Context 的封装，包含模块系统和全局对象 |
| Scavenge | Scavenge | V8 新生代 GC 算法（复制式） |
| setImmediate | setImmediate | 在事件循环 check 阶段执行的回调 |
| setTimeout | setTimeout | 在事件循环 timers 阶段执行的回调 |
| SharedArrayBuffer | SharedArrayBuffer | 可在多个 Isolate/线程间共享的 ArrayBuffer |
| StreamBase | StreamBase | Node.js C++ 层流的抽象基类 |
| Thread-Safe Function | TSFN | N-API 中从 Worker 线程安全回调主线程的机制 |
| Tick | Tick | 一轮事件循环迭代 |
| TypedArray | TypedArray | V8 提供的类型化数组视图（Int8Array、Uint8Array 等） |
| uv_async_t | uv_async_t | libuv 的跨线程唤醒句柄 |
| uv_queue_work | uv_queue_work | libuv 线程池任务提交接口 |
| uv_run | uv_run | libuv 事件循环主函数 |
| V8 | V8 JavaScript Engine | Google 的 JavaScript 引擎，用于 Chrome 和 Node.js |
| Worker Thread | Worker Thread | Node.js 的多线程方案，每个 Worker 有独立 Isolate |