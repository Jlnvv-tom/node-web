// ============================================================
// Layer 0 — 纯 JS 最小"app"
// 对应文章：00-03 从 node_main.cc 到你的代码执行
//
// 这是"最终被运行的那段代码"。
// 不 require 任何内建模块，只是执行一段 JS。
// 真正的 Node 启动链路（src/node_main.cc → NodeMainInstance → RunBootstrapping）
// 最终会走到这一层。
//
// 运行：node src/00-mininode/layer0-bare-js.js
// ============================================================

// Node 的启动链路在执行到用户代码之前已经完成了：
//   1. V8 Isolate / Context 创建
//   2. libuv loop 初始化
//   3. 内建模块注册（require('fs') 等在这一步可用）
//   4. Bootstrap script（lib/internal/bootstrap/*.js）执行
//   5. 加载用户入口模块（你的 app.js）
//
// 这里模拟第 5 步——"你的代码"：
function main() {
  const message = 'Hello from Layer 0 — 纯 JS，零依赖';
  console.log(message);

  // 证明 V8 已就绪：箭头函数、模板字符串、可选链都能跑
  const greet = (name) => `Hi, ${name ?? 'anonymous'}`;
  console.log(greet('mini-node'));

  // 证明事件循环已就绪：setTimeout 是 libuv 定时器
  setTimeout(() => {
    console.log('Layer 0: libuv 定时器触发，事件循环正常运行');
  }, 10);
}

main();