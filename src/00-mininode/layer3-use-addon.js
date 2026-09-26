// ============================================================
// Layer 3 — JS 端加载 N-API 原生模块
// 对应文章：04-06 N-API / 00-03 启动流程
//
// 这个脚本加载 Layer 3 编译出的 C 原生模块，
// 展示"C → N-API → JS"的完整桥梁。
//
// 前置：cd src/00-mininode && npx node-gyp configure build
// 运行：node src/00-mininode/layer3-use-addon.js
// ============================================================

const addon = require('./build/Release/mini_node_addon.node');

console.log('[Layer 3] 加载原生模块:', addon);
console.log('[Layer 3] Runtime info:', addon.getRuntimeInfo());
addon.print('Hello from C via N-API!');

// 这就是 Node 内建模块的终极秘密：
//   require('fs')     → lib/fs.js → binding/fs.cc → libuv uv_fs_*()
//   require('net')     → lib/net.js → binding/tcp_wrap.cc → libuv uv_tcp_t
//   require('crypto')  → lib/crypto.js → binding/crypto.cc → OpenSSL
//
// 我们这个 mini-node-addon 做的完全是同样的事，只是更简单。