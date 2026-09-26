// 被 layer1-cjs-loader.js 加载的"用户库"——一个最小可用模块
// 对应文章：05-01 CommonJS 模块加载器源码解读

function greet(name) {
  return 'Hello, ' + name + '!';
}

function add(a, b) {
  return a + b;
}

// module.exports 模式（而非 exports.xxx = ...）
module.exports = { greet, add };