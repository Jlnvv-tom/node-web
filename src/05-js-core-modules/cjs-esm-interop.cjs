// 文件：src/05-js-core-modules/cjs-esm-interop.cjs
// 对应文章：05-js-core-modules/03-cjs-esm-interop.md
// 运行：node src/05-js-core-modules/cjs-esm-interop.cjs
//
// 演示：ESM import 一个 CJS 模块（默认导入 + 命名导入），
//       以及 CJS 内用 await import() 加载 ESM。

// 先准备一个 CJS 模块到同目录 cjs-pkg.cjs（见同目录）
const path = require('path');
const { createRequire } = require('module');
const require = createRequire(__filename);

// 1) ESM 导入 CJS：用动态 import() 在 CJS 文件里加载 .mjs
(async () => {
  // 注意：本文件是 .cjs，不能直接写 import 语法，故用 import()
  const esm = await import('./esm-pkg.mjs');
  console.log('ESM default:', esm.default());        // 'fn'
  console.log('ESM named  :', esm.val);              // 42

  // 2) 用 createRequire 在 ESM 语义环境里加载 CJS
  const cjsRequire = createRequire(__filename);
  const cjs = cjsRequire('./cjs-pkg.cjs');
  console.log('CJS module.exports.n:', cjs.n);        // 1
  console.log('CJS module.exports.f():', cjs.f());    // 'ok'
})();
