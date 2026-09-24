# 05-03 CJS 与 ESM 互操作

> 本章目标：理解 CommonJS 与 ES Module 在 Node 中如何互相调用——这是实际项目里最常见的痛点。讲清 `import` 一个 CJS 模块、以及用 `require` 加载 ESM 的规则与陷阱。

---

## 1. 互操作总览

| 方向 | 语法 | 机制 | 限制 |
|------|------|------|------|
| ESM 导入 CJS | `import x from 'cjs'` / `import { y } from 'cjs'` | 静态分析 + 默认导出整个 `module.exports` | 命名导入靠 cjs-module-lexer 推断 |
| CJS 导入 ESM | `require('esm')` ❌ 不支持 | — | 必须改用 `await import()` |
| ESM 在 CJS 里 | `const m = await import('esm')` | 异步 ESM loader | 需用 `createRequire` 获取 require |

核心矛盾：**CJS 是同步的，`require` 必须立即返回；ESM 加载是异步的**。因此 `require` 一个 ESM 模块在语义上不可能（同步等异步结果 = 死锁风险），Node 强制你用 `import()`。

---

## 2. ESM `import` 一个 CJS 模块

### 2.1 默认导入

```js
// cjs-pkg/index.cjs
module.exports = { hello: () => 'hi' };
module.exports.version = '1.0';

// esm.mjs
import pkg from 'cjs-pkg';
console.log(pkg.hello());   // 'hi'
console.log(pkg.version);   // '1.0'
```
默认导入 = 整个 `module.exports` 对象。这是确定的、可靠的。

### 2.2 命名导入（named import）

```js
// esm.mjs
import { hello, version } from 'cjs-pkg';
```

Node 用 **`cjs-module-lexer`** 静态分析 CJS 源码，找出 `exports.x = ...` / `module.exports.x = ...` 模式，把 `x` 当作命名导出。所以：

```js
// 能被识别
exports.foo = 1;
module.exports.bar = 2;
this.baz = 3;   // 部分情况

// 不能可靠识别（动态赋值、getter）
exports[someKey] = 1;       // ❌ 静态分析拿不到
Object.defineProperty(exports, 'q', { get() {...} });  // ❌
```

如果命名导入解析失败，会报 `SyntaxError: ... does not provide an export named 'x'`。此时退化方案：

```js
import pkg from 'cjs-pkg';
const { x } = pkg;   // 用默认导入 + 解构
```

### 2.3 live binding 的说明

ESM 导入 CJS 时，**不存在 live binding**——CJS 的 `module.exports` 在加载时已确定，ESM 侧拿到的是那一刻的快照值。CJS 后续修改 `exports` 不会反映到 ESM 导入。Node 提供 `module.syncBuiltinESMExports()` 供内置模块同步命名导出（见 ESM 章节 05-02 提到）。

---

## 3. CJS `require` 一个 ESM 模块

```js
// esm.mjs
export const val = 42;
export default function() { return 'fn'; }

// cjs.cjs
const m = require('esm');   // ❌ ERR_REQUIRE_ESM
```
Node 会抛 `ERR_REQUIRE_ESM`，提示改用 `import()`。

### 正确做法：`await import()`

```js
// cjs.cjs
(async () => {
  const m = await import('esm.mjs');   // 异步加载 ESM
  console.log(m.val);          // 42
  console.log(m.default());    // 'fn'
})();
```
因为 `import()` 是异步的，CJS 里调用它必须用 async 函数或 `.then()`。

### `createRequire`：在 ESM 里用 require

```js
// esm.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const cjsPkg = require('cjs-pkg');   // 在 ESM 文件里用 CJS 加载器
```
`createRequire(import.meta.url)` 生成一个以当前模块 URL 为基准的 `require` 函数，用于加载 CJS 模块、JSON 等。

---

## 4. `__dirname` / `__filename` 的迁移

ESM 没有 CJS 的 `__dirname` / `__filename`（因为 ESM 用 URL 且是静态的）。替代：

```js
// esm.mjs
import { fileURLToPath } from 'url';
import { dirname } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
```

或用 `import.meta.dirname`（较新 Node 版本直接提供）。

---

## 5. 双格式包（dual package）的坑

一个包同时提供 CJS 与 ESM（如 `{"main": "cjs/index.js", "exports": {...ESM...}}`），可能出现**两份实例**（CJS 一份、ESM 一份），导致：

```js
// 同一 class 在两边判断 instanceof 失败
import A from 'pkg';           // ESM 实例
const B = require('pkg');      // CJS 实例
new A() instanceof B.default   // false！原型链不同
```

规避：包作者应避免状态共享，或用条件导出让 ESM 内部也引用同一份 CJS。这是生态迁移期的已知痛。

---

## 6. 可运行验证

```js
// cjs.cjs
module.exports = { n: 1, f: () => 'ok' };

// esm.mjs
import pkg, { f } from './cjs.cjs';
console.log(pkg.n, f());   // 1 'ok'

// 反向：cjs.cjs 加载 esm
const { import: _import } = require('module');
_import('./esm.mjs').then(m => console.log(m.default));
```

---

## 7. 本章总结

- ESM `import` CJS：默认导入 = 整个 `module.exports`；命名导入靠 cjs-module-lexer 静态推断（动态赋值不可靠）。
- ESM 导入 CJS **无 live binding**，是加载时快照。
- CJS `require` ESM **不被支持**（ERR_REQUIRE_ESM）；改用 `await import()`。
- ESM 内用 `createRequire(import.meta.url)` 调 CJS loader；用 `fileURLToPath` 取得 `__dirname`。
- 双格式包可能导致两份实例，`instanceof` 失效。

---

## 8. 思考题

1. 为什么 `require()` 一个 ESM 模块在语义上"不可能同步完成"？根本矛盾是什么？
2. cjs-module-lexer 为什么无法识别 `exports[dynamicKey] = 1` 这种命名导出？这对包作者有什么启示？
3. 双格式包导致 `instanceof` 跨格式失败，根本原因是什么？包作者如何缓解？
