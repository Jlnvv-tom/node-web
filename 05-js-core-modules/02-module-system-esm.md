# 05-02 ESM 模块加载器源码解读

> 本章目标：理解 ES Module（`import`）在 Node 中的加载链路——它与 CommonJS 的同步缓存模型完全不同，是**异步、URL 驱动、静态分析优先**的。

---

## 1. ESM vs CJS 的本质差异

| 维度 | CommonJS | ESM |
|------|----------|-----|
| 加载 | 同步、运行时 `require` | 异步、静态 `import` |
| 解析单位 | 文件路径（字符串） | URL（`file://` / `node:` / `https:`） |
| 导出 | 运行时赋值 `module.exports` | 静态绑定（live binding） |
| 循环依赖 | 部分导出（undefined 风险） | 完整 live binding（读到最终值） |
| 顶层 await | 不支持 | 支持 |
| 缓存 | 绝对路径 | URL 字符串 |

---

## 2. 加载链路总览

```
import { x } from './mod.mjs'
  ▼
lib/internal/modules/esm/loader.js :: ModuleJob 创建
  ▼
resolve:  ESMResolver → 把说明符解析成 URL
          （lib/internal/modules/esm/resolve.js）
  ▼
load:     根据 URL 的 format（'module'/'commonjs'/'json'/'wasm'）选加载器
  ▼
translate: 把源码转成可执行的模块（必要时经 --experimental-loader 钩子）
  ▼
ModuleJob 执行：new SourceTextModule / CJS bridge → 链接 exports
  ▼
返回命名空间对象 { x }
```

---

## 3. `resolve`：`lib/internal/modules/esm/resolve.js`

ESM 的解析**必须先把说明符变成 URL**，再算真实路径：

```js
// lib/internal/modules/esm/resolve.js （简化）
export async function resolve(specifier, parentURL, options) {
  // 1) 内置模块 'node:fs' → 直接返回 node: URL
  if (specifier.startsWith('node:')) {
    return { url: specifier, shortCircuit: true };
  }
  // 2) 裸说明符 'lodash' → 查 package.json exports / node_modules
  //    受 "exports" / "imports" / "type" 字段约束
  // 3) 相对 './mod.mjs' → 拼成 file://.../mod.mjs
  const url = new URL(specifier, parentURL).href;
  // 4) 检查 package.json 的 "type": "module" 决定 format
  const format = await getFormat(url);
  return { url, format };
}
```

关键：**ESM 严格走 `package.json` 的 `exports` 字段**。CJS 的 `require` 对 `exports` 支持是后补的，而 ESM 默认就尊重它——很多"模块找不到"的问题源于 ESM 下 `exports` 映射未包含某子路径。

---

## 4. `load` 与 `format` 分派

```js
// lib/internal/modules/esm/loader.js （简化）
export async function load(url, context) {
  const format = await getFormat(url);   // module / commonjs / json / wasm
  switch (format) {
    case 'module':   return { format, source: await read(url) };
    case 'commonjs': return { format, source: null };  // 走 CJS bridge
    case 'json':     return { format, source: await read(url) };
  }
}
```

`format` 决定后续：若是 `.mjs` 或 `type:module` 的 `.js` → `module`；若是 `.cjs` 或 `type:commonjs` → `commonjs`（桥接）。

---

## 5. `ModuleJob`：模块执行单元

`lib/internal/modules/esm/module_job.js` 负责真正执行：

```js
class ModuleJob {
  async run() {
    // 1) 若是 ESM 源码：用 V8 的 SourceTextModule 编译
    //    （vm.SourceTextModule，需 --experimental-vm-modules 或在内部使用）
    // 2) 链接（link）：递归 resolve 所有 import，建立 live bindings
    // 3) 执行模块顶层代码
    // 4) 返回 module namespace（{ x, y }）
  }
}
```

ESM 的**静态分析**在此体现：引擎在链接阶段扫描所有 `import`/`export`，构建依赖图（dependency graph），再自底向上执行。这允许**循环依赖的 live binding**——即使 A 和 B 互相 import，只要不是顶层就立刻用值，最终都能拿到正确结果（因为绑定是"活的引用"，不是快照）。

---

## 6. 顶层 `await`

ESM 支持顶层 `await`，因为整个加载链路是异步的：

```js
// mod.mjs
const data = await fetch('https://api.example.com');   // 合法！
export const result = await data.json();
```

CJS 做不到这点（`require` 是同步的）。这让 ESM 天然适合"模块加载时做异步初始化"。

---

## 7. 与 CJS 的区别：循环依赖示例

```js
// a.mjs
import { bDone } from './b.mjs';
export let aDone = false;
console.log('a: bDone =', bDone);   // false（此时 b 还没跑完赋值）
aDone = true;

// b.mjs
import { aDone } from './a.mjs';
export let bDone = false;
console.log('b: aDone =', aDone);   // undefined（a 的 aDone 已声明但未赋值）
bDone = true;
```

ESM 通过 live binding：导入的是**绑定本身**，不是值快照。执行到访问时若对方已赋值则取到值；这是与 CJS "部分导出" 不同的语义——更可预测，但要求注意"初始化顺序"。

---

## 8. 自定义 loader 钩子（实验性）

`--experimental-loader ./my-loader.mjs` 可拦截 `resolve`/`load`/`translate`：

```js
export async function resolve(specifier, context, next) {
  // 改写说明符、插件、虚拟模块...
  return next(specifier, context);
}
export async function load(url, context, next) {
  // 改写源码、注入代码...
  return next(url, context);
}
```

这是 ESM 比 CJS 更灵活的地方——加载过程可被用户代码 hook。

---

## 9. 与 CJS 互操作（预告 05-03）

- `import` 一个 CJS 模块：`import pkg from 'cjs-pkg'` → 默认导入整个 `module.exports`；命名导入 `{ x }` 通过 `cjs-module-lexer` 静态分析 `exports.x =` 提取。
- `require` 一个 ESM 模块：**不支持同步 require**——需 `await import()`。

详见 05-03。

---

## 10. 本章总结

- ESM 加载是异步、URL 驱动：`resolve → load → translate → ModuleJob 执行`。
- `resolve` 强制走 `package.json` 的 `exports`；`format` 决定走 ESM 还是 CJS bridge。
- 静态分析 + live binding 让循环依赖更安全；顶层 `await` 天然支持。
- 自定义 loader 钩子使加载过程可编程。

---

## 11. 思考题

1. 为什么 ESM 的循环依赖不会像 CJS 那样得到 `undefined`，而是"活的绑定"？代价是什么？
2. `import x from 'cjs-pkg'` 的默认导入在 Node 里是怎么实现的？命名导入 `{ y }` 呢？
3. 为什么 `require()` 一个 ESM 模块需要写成 `await import()`？根本限制来自哪里？
