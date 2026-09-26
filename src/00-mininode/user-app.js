// 被 layer1-cjs-loader.js 加载的"用户应用"——模拟 app.js
// 它用 miniRequire 加载 user-lib.js，验证递归加载与缓存
const lib = require('./user-lib');

console.log('[mini-app] greet:', lib.greet('mini-node'));
console.log('[mini-app] add(1+2):', lib.add(1, 2));

// 导出结果供 loader 脚本检查
module.exports = { started: true, libVersion: '1.0.0' };