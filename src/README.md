# 代码示例索引（src/）

本目录存放各篇文章里**可独立运行、用于验证源码结论**的示例代码，按对应章节组织。
运行前确保已安装 Node.js（建议 ≥ 18 LTS）。

| 章节 | 文件 | 对应文章 | 运行命令 |
| --- | --- | --- | --- |
| 01 操作系统层 | `01-os-layer/nonblocking-vs-blocking.js` | 01-02 fd / 01-04 系统调用 | `node src/01-os-layer/nonblocking-vs-blocking.js` |
| 02 libuv | `02-libuv/event-loop-order.js` | 02-01 事件循环六阶段 / 06-01 微任务 vs 宏任务 | `node src/02-libuv/event-loop-order.js` |
| 04 C++ 绑定 | `04-cpp-bindings/napi-addon/` | 04-06 N-API | `cd src/04-cpp-bindings/napi-addon && npm i node-gyp && npx node-gyp configure build` |
| 05 JS 模块 | `05-js-core-modules/cluster-multi-core.js` | 05-10 process 与 cluster | `node src/05-js-core-modules/cluster-multi-core.js` |
| 05 JS 模块 | `05-js-core-modules/cjs-esm-interop.cjs` | 05-03 CJS/ESM 互操作 | `node src/05-js-core-modules/cjs-esm-interop.cjs`（同目录含 cjs-pkg.cjs / esm-pkg.mjs 配套） |

## 约定
- 纯 JS 示例：直接 `node <file>` 即可复现。
- 原生插件（N-API）：需 `node-gyp` 编译，详见文件头注释。
- 文中引用统一用相对路径（相对仓库根），例如 `src/02-libuv/event-loop-order.js`。
