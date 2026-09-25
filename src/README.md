# 代码示例索引（src/）

本目录存放各篇文章里**可独立运行、用于验证源码结论**的示例代码，按对应章节组织。
运行前确保已安装 Node.js（建议 ≥ 18 LTS）。带 `--expose-gc` 的示例需该参数才能手动触发 GC。

## 示例总览（覆盖全部 10 章）

| 章节 | 文件 | 对应文章 | 运行命令 |
| --- | --- | --- | --- |
| 00 总览 | `00-overview/inspect-layers.js` | 00-01/02/03 分层·结构·启动 | `node src/00-overview/inspect-layers.js` |
| 01 操作系统层 | `01-os-layer/nonblocking-vs-blocking.js` | 01-02 fd / 01-04 系统调用 | `node src/01-os-layer/nonblocking-vs-blocking.js` |
| 01 操作系统层 | `01-os-layer/thread-pool.js` | 01-03 线程/线程池 | `node src/01-os-layer/thread-pool.js` |
| 02 libuv | `02-libuv/event-loop-order.js` | 02-01 六阶段 / 06-01 微任务 | `node src/02-libuv/event-loop-order.js` |
| 02 libuv | `02-libuv/uv-threadpool-sizes.js` | 02-02 线程池 / 02-04 文件 I/O | `node src/02-libuv/uv-threadpool-sizes.js` |
| 02 libuv | `02-libuv/timer-clamp.js` | 02-05 定时器 | `node src/02-libuv/timer-clamp.js` |
| 03 V8 | `03-v8-engine/gc-probe.js` | 03-03 GC / 07-01 堆 GC | `node --expose-gc src/03-v8-engine/gc-probe.js` |
| 04 C++ 绑定 | `04-cpp-bindings/napi-addon/` | 04-06 N-API | `cd src/04-cpp-bindings/napi-addon && npm i node-gyp && npx node-gyp configure build` |
| 05 JS 模块 | `05-js-core-modules/event-emitter-impl.js` | 05-04 EventEmitter | `node src/05-js-core-modules/event-emitter-impl.js` |
| 05 JS 模块 | `05-js-core-modules/stream-pipe-demo.js` | 05-05 Streams 背压 | `node src/05-js-core-modules/stream-pipe-demo.js` |
| 05 JS 模块 | `05-js-core-modules/worker-threads-demo.js` | 05-07 worker_threads | `node src/05-js-core-modules/worker-threads-demo.js` |
| 05 JS 模块 | `05-js-core-modules/buffer-encoding-demo.js` | 05-12 Buffer | `node src/05-js-core-modules/buffer-encoding-demo.js` |
| 05 JS 模块 | `05-js-core-modules/cjs-esm-interop.cjs` | 05-03 CJS/ESM 互操作 | `node src/05-js-core-modules/cjs-esm-interop.cjs`（同目录 cjs-pkg.cjs / esm-pkg.mjs 配套） |
| 05 JS 模块 | `05-js-core-modules/cluster-multi-core.js` | 05-10 process 与 cluster | `node src/05-js-core-modules/cluster-multi-core.js` |
| 05 JS 模块 | `05-js-core-modules/process-object-demo.js` | 05-14 process 对象 | `node src/05-js-core-modules/process-object-demo.js` |
| 06 事件循环 | `06-event-loop-deep-dive/order-cheatsheet.js` | 06-01/02 微任务·时序 | `node src/06-event-loop-deep-dive/order-cheatsheet.js` |
| 07 内存性能 | `07-memory-and-performance/mem-leak-demo.js` | 07-01/02 GC·泄漏排查 | `node --expose-gc src/07-memory-and-performance/mem-leak-demo.js` |
| 08 Electron | `08-electron-integration/main-preload-bridge.js` | 08-01 Electron 架构 | 概念样例（需 Electron 运行时，文件内注释完整） |
| 09 跨平台 | `09-cross-platform/child-process-demo.cjs` | 09-02 child_process | `node src/09-cross-platform/child-process-demo.cjs`（同目录 child-echo.js） |

## 约定
- 纯 JS 示例：直接 `node <file>` 即可复现（标 `--expose-gc` 的需加参数）。
- 原生插件（N-API，04 章）：需 `node-gyp` 编译，详见文件头注释。
- Electron 示例（08 章）：为概念范式，需 Electron 运行时，文件内已写明 main/preload/renderer 三段代码。
- 文中引用统一用相对仓库根路径，例如 `src/02-libuv/event-loop-order.js`。
