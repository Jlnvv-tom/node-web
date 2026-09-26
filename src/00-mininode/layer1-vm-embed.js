// ============================================================
// Layer 1 — 用 vm 模块嵌入 V8：模拟 Node 的启动链路
// 对应文章：03-04 V8 嵌入 API / 00-03 启动流程
//
// 真正的 Node 用 C++ 调用 V8 的 Isolate::New() / Context::New()。
// 这里用 Node 暴露的 `vm` 模块在 JS 层做同样的事：
//   1. 创建一个新的 V8 Context（= Isolate 内的执行环境）
//   2. 在 Context 里执行用户代码
//   3. 模拟 require() 最小实现
//
// 这就是 Node 启动链路的 JS 版缩影。
//
// 运行：node src/00-mininode/layer1-vm-embed.js
// ============================================================

const vm = require('vm');

// ---- Step 1: 创建 V8 Context（对应 Node 的 CreateContext()）
//
// 一个 Context 包含：
//   - 全局对象（global / globalThis）
//   - 内建函数（Object, Array, JSON, Math...）
//   - 模板作用域
//
// Node 在 C++ 层用 v8::Context::New()，这里用 vm.createContext()。
const sandbox = {
  console,           // 注入 console（真正的 Node 用 process.out 绑定）
  setTimeout,        // 注入 setTimeout（libuv 定时器）
  require: miniRequire,  // 注入 require（对应 Node 的 Module._load）
  __export: undefined,  // 供模块代码挂载导出
};

const context = vm.createContext(sandbox);

console.log('[Layer 1] V8 Context 已创建');

// ---- Step 2: 模拟"内建模块注册"
//
// Node 在 Bootstrap 阶段把 C++ 绑定和 JS 包装函数注册到模块系统。
// 这里手动写一个最小 require：
const moduleCache = {};

function miniRequire(name) {
  if (moduleCache[name]) return moduleCache[name].exports;

  // 模拟 Module._cache + Module._compile
  const module = { exports: {} };
  moduleCache[name] = module;

  // 把 module/exports/require 注入当前 vm context
  context.module = module;
  context.exports = module.exports;
  context.require = miniRequire;

  // 模拟 CommonJS wrapper：(function(exports, require, module) { ... })
  switch (name) {
    case 'minilib':
      vm.runInContext(`
        (function(exports, require, module) {
          exports.greet = function(name) {
            return 'Hello from minilib, ' + name;
          };
          exports.version = '1.0.0';
        })(module.exports, require, module);
      `, context, { filename: 'minilib.js' });
      break;
    default:
      throw new Error(`Cannot find module '${name}'`);
  }

  return module.exports;
}

// ---- Step 3: 在 V8 Context 里执行"用户代码"（模拟 app.js）
const userCode = `
  // 这就是"你的 app.js"——运行在 V8 Context 内
  var lib = require('minilib');
  console.log('[Layer 1] 用户代码执行：', lib.greet('mini-node'));
  console.log('[Layer 1] 模块版本：', lib.version);
  setTimeout(function() {
    console.log('[Layer 1] 事件循环仍在运行');
  }, 20);
`;

console.log('[Layer 1] 开始执行用户代码（vm.runInContext）...');
vm.runInContext(userCode, context, {
  filename: 'app.js',
  timeout: 5000,   // 对应 Node 的 --stack-size / 超时保护
});
console.log('[Layer 1] 用户代码同步部分执行完毕');

// ---- 对应 Node 启动链路回顾：
//
//  C++ 层                          | 本 demo 的 JS 层
//  -------------------------------|---------------------------
//  node_main.cc → Start()         | node 命令本身
//  v8::Isolate::New()             | (vm 内部复用当前 Isolate)
//  v8::Context::New()             | vm.createContext(sandbox)
//  BootstrapShebang / RunBootstrapping | miniRequire 注册
//  ExecuteEnvironment(&main_argv) | vm.runInContext(userCode)
//  uv_run(loop, UV_RUN_DEFAULT)   | setTimeout 回调触发后退出