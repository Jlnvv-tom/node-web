* [首页](../README.md)
* [计划文档 PLAN](../PLAN.md)

* **00 · 总览篇**
  * [00-01 Node.js 分层架构全景](../00-overview/01-node-architecture.md)
  * [00-02 Node.js 源码目录结构与构建系统](../00-overview/02-source-code-structure.md)
  * [00-03 从 `node_main.cc` 到你的代码执行](../00-overview/03-startup-flow.md)

* **01 · 操作系统层**
  * [01-01 异步 I/O 模型：从 select 到 io_uring](../01-os-layer/01-async-io-models.md)
  * [01-02 文件描述符、系统调用与阻塞语义](../01-os-layer/02-file-descriptors.md)
  * [01-03 线程、线程池与 pthread](../01-os-layer/03-threads.md)
  * [01-04 系统调用：用户态与内核态的边界](../01-os-layer/04-syscall-interface.md)

* **02 · libuv 层**
  * [02-01 libuv 事件循环六阶段源码解读](../02-libuv/01-event-loop-phases.md)
  * [02-02 libuv 线程池实现](../02-libuv/02-thread-pool-impl.md)
  * [02-03 网络 I/O：非阻塞路径](../02-libuv/03-network-io.md)
  * [02-04 文件 I/O：为什么走线程池](../02-libuv/04-file-io.md)
  * [02-05 定时器：libuv 如何实现 setTimeout/setInterval](../02-libuv/05-timers.md)
  * [02-06 poll 阶段深度解析](../02-libuv/06-poll-deep-dive.md)
  * [02-07 异步句柄：io watcher 与 async handle](../02-libuv/07-async-handles.md)

* **03 · V8 引擎层**
  * [03-01 V8 引擎概览](../03-v8-engine/01-v8-overview.md)
  * [03-02 V8 JIT 编译管线：Ignition → Sparkplug → Maglev → TurboFan](../03-v8-engine/02-jit-pipeline.md)
  * [03-03 V8 垃圾回收（Orinoco）](../03-v8-engine/03-garbage-collection.md)
  * [03-04 V8 嵌入 API 与 Node 如何使用它](../03-v8-engine/04-isolate-embedding.md)
  * [03-04 V8 Isolate / Heap / Context](../03-v8-engine/04-v8-isolate-heap.md)
  * [03-05 V8 Embedding API：Node.js 如何嵌入 V8](../03-v8-engine/05-v8-embedding-api.md)

* **04 · C++ 绑定层**
  * [04-01 C++ 绑定层核心抽象：Environment / Realm / BaseObject](../04-cpp-bindings/01-node-architecture-cpp.md)
  * [04-02 AsyncWrap：异步资源生命周期追踪](../04-cpp-bindings/02-async-wrap.md)
  * [04-03 HandleWrap 与 StreamBase：libuv handle 的 C++ 包装](../04-cpp-bindings/03-handle-wrap.md)
  * [04-04 TCPWrap 源码精读：从 `net.Socket` 到 `uv_tcp_t`](../04-cpp-bindings/04-tcp-wrap-deep-dive.md)
  * [04-05 fs 模块的 C++ 绑定](../04-cpp-bindings/05-fs-binding.md)
  * [04-06 N-API：稳定的原生插件接口](../04-cpp-bindings/06-napi.md)

* **05 · JS 核心模块**
  * [05-01 CommonJS 模块加载器源码解读](../05-js-core-modules/01-module-system-cjs.md)
  * [05-02 ESM 模块加载器源码解读](../05-js-core-modules/02-module-system-esm.md)
  * [05-03 CJS 与 ESM 互操作](../05-js-core-modules/03-cjs-esm-interop.md)
  * [05-04 EventEmitter 源码解读](../05-js-core-modules/04-event-emitter.md)
  * [05-05 Streams 源码解读](../05-js-core-modules/05-streams.md)
  * [05-06 http / net：网络栈从 C++ 到 JS](../05-js-core-modules/06-http-net.md)
  * [05-07 worker_threads：多线程 JS 执行](../05-js-core-modules/07-worker-threads.md)
  * [05-08 crypto 模块：同步、异步与线程池](../05-js-core-modules/08-crypto.md)
  * [05-09 fs 模块（JS 层）：从回调到 Promise](../05-js-core-modules/09-fs-module-js.md)
  * [05-10 process 与 cluster：进程模型与多核利用](../05-js-core-modules/10-process-cluster.md)
  * [05-11 timers 与 perf_hooks：计时 API 与性能测量](../05-js-core-modules/11-timers-perf.md)
  * [05-12 Buffer：二进制数据与内存边界](../05-js-core-modules/12-buffer.md)
  * [05-13 cluster 模块：多进程负载均衡](../05-js-core-modules/13-cluster-module.md)
  * [05-14 process 对象：运行时访问入口](../05-js-core-modules/14-process-object.md)

* **06 · 事件循环专题**
  * [06-01 微任务 vs 宏任务：nextTick 与 Promise](../06-event-loop-deep-dive/01-microtask-vs-macrotask.md)
  * [06-02 setImmediate vs setTimeout 时序谜题](../06-event-loop-deep-dive/02-setImmediate-setTimeout.md)
  * [06-03 逐阶段源码走读（Phase Source Walkthrough）](../06-event-loop-deep-dive/03-phases-source-walkthrough.md)
  * [06-04 阻塞事件循环：CPU 密集型任务的危害与解决方案](../06-event-loop-deep-dive/04-blocking-event-loop.md)

* **07 · 内存与性能**
  * [07-01 V8 堆内存与垃圾回收（GC）](../07-memory-and-performance/01-v8-heap-gc.md)
  * [07-02 内存泄漏排查实战](../07-memory-and-performance/02-memory-leak-detection.md)
  * [07-03 Buffer 与 TypedArray：Node.js 的二进制数据模型](../07-memory-and-performance/03-buffers-and-typed-arrays.md)
  * [07-04 Performance Hooks 与诊断工具](../07-memory-and-performance/04-performance-hooks.md)

* **08 · Electron 集成**
  * [08-01 Electron 架构：Node.js 如何嵌入 Chromium](../08-electron-integration/01-electron-architecture.md)
  * [08-02 V8 共享：Chromium 与 Node.js 的 V8 实例合并](../08-electron-integration/02-v8-sharing.md)
  * [08-03 事件循环合并：libuv 与 Chromium MessagePump](../08-electron-integration/03-event-loop-merge.md)
  * [08-04 IPC 通信：主进程与渲染进程的桥接](../08-electron-integration/04-ipc-communication.md)
  * [08-05 Preload 脚本与 contextBridge 安全模型](../08-electron-integration/05-preload-security.md)

* **09 · 跨平台实现**
  * [09-01 跨平台抽象层](../09-cross-platform/01-platform-abstraction.md)
  * [09-02 child_process：进程创建与 IPC](../09-cross-platform/02-child-process.md)
  * [09-03 原生插件开发与 ABI 兼容](../09-cross-platform/03-native-addons.md)
