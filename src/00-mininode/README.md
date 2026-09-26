// ============================================================
 * mini-node — 从零到一的最小 Node.js 运行时 Demo
 * ============================================================
 *
 * 这个 demo 回答一个核心问题：
 *   "从 node app.js 回车到 JS 代码执行，中间发生了什么？"
 *
 * 分 4 层，从简到繁：
 *
 *   Layer 0   纯 JS，零依赖              layer0-bare-js.js
 *   Layer 1   vm 嵌入 V8 + mini-require   layer1-vm-embed.js
 *   Layer 1.5 手写 CommonJS 加载器         layer1-cjs-loader.js
 *   Layer 2   C + libuv 事件循环           layer2-uv-loop.c
 *   Layer 3   N-API 原生模块（C→JS 桥梁） layer3-napi-addon.c
 *
 * 运行方式：
 *   node layer0-bare-js.js          # Layer 0
 *   node layer1-vm-embed.js         # Layer 1
 *   node layer1-cjs-loader.js        # Layer 1.5
 *   cc -o layer2-uv-loop layer2-uv-loop.c $(pkg-config --libs --cflags libuv) && ./layer2-uv-loop  # Layer 2
 *   npx node-gyp configure build && node layer3-use-addon.js  # Layer 3
 *
 * 或者一键运行全部 JS 层：
 *   node run-all.js