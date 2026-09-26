// ============================================================
// Layer 1.5 — 最小 CommonJS 模块加载器（从零实现 require）
// 对应文章：05-01 CommonJS 模块加载器源码解读
//
// 不用 Node 内建的 require，手写一个能解析 .js 文件、
// 包装 CommonJS wrapper、缓存模块的 mini-require。
//
// 运行：node src/00-mininode/layer1-cjs-loader.js
// ============================================================

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const util = require('util');

// 模块缓存（对应 Node 的 Module._cache）
const moduleCache = {};

// CommonJS wrapper 函数模板（对应 Node 的 Module.wrap）
// 真正的 Node 源码：
//   const wrapper = Module.wrap(content);
//   => `(function(exports, require, module, __filename, __dirname) { ${content}\n});`
const WRAPPER = `
(function(exports, require, module, __filename, __dirname) {
  // ===== 用户代码开始 =====
%s
  // ===== 用户代码结束 =====
});
`;

function miniRequire(modulePath) {
  // 1. 路径解析（对应 Module._resolveFilename）
  let resolvedPath = path.resolve(modulePath);
  // 简化版：没有扩展名就补 .js（真正的 Node 会尝试 .js/.json/.node）
  if (!path.extname(resolvedPath)) {
    resolvedPath += '.js';
  }

  // 2. 查缓存（对应 Module._cache）
  if (moduleCache[resolvedPath]) {
    return moduleCache[resolvedPath].exports;
  }

  // 3. 创建模块对象（对应 new Module(id, parent)）
  const module = {
    id: resolvedPath,
    exports: {},
    filename: resolvedPath,
  };
  moduleCache[resolvedPath] = module;

  // 4. 读源码（对应 Module.prototype._compile）
  const source = fs.readFileSync(resolvedPath, 'utf8');

  // 5. 包装成 CommonJS wrapper（对应 Module.wrap）
  const wrappedCode = util.format(WRAPPER, source);

  // 6. 在 V8 中编译（对应 vm.Script）
  const script = new vm.Script(wrappedCode, {
    filename: resolvedPath,
    lineOffset: -3,  // wrapper 占 3 行
  });

  // 7. 执行 wrapper，传入 (exports, require, module, __filename, __dirname)
  const compiledWrapper = script.runInThisContext();
  compiledWrapper.call(
    module.exports,   // this = module.exports
    module.exports,   // exports
    miniRequire,      // require（递归）
    module,           // module
    resolvedPath,     // __filename
    path.dirname(resolvedPath)  // __dirname
  );

  return module.exports;
}

// ---- 测试：加载同目录的 user-app.js（一个依赖 user-lib.js 的小程序）
// ---- 测试：加载同目录的 user-app.js（一个依赖 user-lib.js 的小程序）
// user-app.js 内部会 require('./user-lib.js')，验证递归加载与缓存
const app = miniRequire(path.join(__dirname, 'user-app.js'));
console.log('[Layer 1.5] app 启动结果:', app);