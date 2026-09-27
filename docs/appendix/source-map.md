# 关键源码文件索引

> 本索引列出教程涉及的主要源码文件，按层分组，方便快速定位。

## 入口层

| 文件 | 路径 | 说明 |
|------|------|------|
| main() | `src/node_main.cc` | C 程序入口，调用 `node::Start()` |
| Node::Start | `src/node.cc` | Node.js 初始化入口 |
| NodeMainInstance | `src/node_main_instance.cc` | 主实例运行 |
| InitializeOncePerProcess | `src/node.cc` | 进程级初始化 |

## OS 层

| 文件 | 路径 | 说明 |
|------|------|------|
| uv_run | `deps/uv/src/unix/core.c` | 事件循环主函数 |
| uv__io_poll | `deps/uv/src/unix/linux-core.c` | Linux epoll 实现 |
| uv__io_poll | `deps/uv/src/unix/darwin-proctitle.c` | macOS kqueue 实现 |
| 线程池 | `deps/uv/src/threadpool.c` | libuv 线程池 |
| 定时器 | `deps/uv/src/unix/timer.c` | uv_timer_t 实现 |
| 文件 I/O | `deps/uv/src/unix/fs.c` | uv_fs_t 实现 |
| 网络 I/O | `deps/uv/src/unix/tcp.c` | uv_tcp_t 实现 |
| async | `deps/uv/src/unix/async.c` | uv_async_t 跨线程唤醒 |

## V8 引擎层

| 文件 | 路径 | 说明 |
|------|------|------|
| Isolate | `v8/src/api/api.cc` | Isolate 创建/管理 |
| Heap | `v8/src/heap/heap.cc` | V8 堆管理 |
| GC | `v8/src/heap/mark-compact.cc` | Mark-Sweep-Compact |
| Ignition | `v8/src/interpreter/interpreter.cc` | 字节码解释器 |
| TurboFan | `v8/src/compiler/compiler.cc` | 顶层 JIT 编译器 |
| Embedding | `v8/src/api/embed.cc` | V8 嵌入 API |

## C++ 绑定层

| 文件 | 路径 | 说明 |
|------|------|------|
| Environment | `src/env.cc` | Node.js 环境对象 |
| Realm | `src/node_realm.cc` | V8 Context 封装 |
| AsyncWrap | `src/async_wrap.cc` | 异步资源跟踪 |
| HandleWrap | `src/handle_wrap.cc` | libuv handle 封装 |
| StreamBase | `src/stream_base.cc` | 流抽象 |
| TCPWrap | `src/tcp_wrap.cc` | TCP 绑定 |
| FSReqCallback | `src/node_file.cc` | fs 模块绑定 |
| N-API | `src/node_api.cc` | N-API 实现 |

## JS 核心模块层

| 文件 | 路径 | 说明 |
|------|------|------|
| Bootstrap | `lib/internal/bootstrap/realm.js` | 启动引导 |
| Bootstrap | `lib/internal/bootstrap/node.js` | Node 初始化 |
| CJS Loader | `lib/internal/modules/cjs/loader.js` | CommonJS 加载器 |
| ESM Loader | `lib/internal/modules/esm/loader.js` | ESM 加载器 |
| fs | `lib/fs.js` | fs 模块 JS 层 |
| http | `lib/http.js` | http 模块 |
| net | `lib/net.js` | net 模块 |
| Stream | `lib/internal/streams/readable.js` 等 | Stream 实现 |
| EventEmitter | `lib/events.js` | EventEmitter |
| timers | `lib/timers.js` | setTimeout/setInterval |
| worker_threads | `lib/worker_threads.js` | Worker 模块 |
| cluster | `lib/cluster.js` | cluster 模块 |
| process | `lib/internal/process/` | process 对象构建 |

## Electron 集成

| 文件 | 路径 | 说明 |
|------|------|------|
| NodeBindings | `electron/shell/common/node_bindings.cc` | V8 共享 + 事件循环合并 |
| ElectronApiIPC | `electron/shell/browser/api/electron_api_ipc.cc` | 主进程 IPC |
| IpcRenderer | `electron/shell/renderer/api/ipc_renderer.cc` | 渲染进程 IPC |
| ContextBridge | `electron/shell/common/api/context_bridge.cc` | contextBridge 实现 |

## 构建系统

| 文件 | 路径 | 说明 |
|------|------|------|
| configure | `configure.py` | 配置脚本 |
| 顶层 GYP | `node.gyp` | 构建描述 |
| JS 打包 | `tools/js2c.py` | lib/*.js → C++ 字节数组 |