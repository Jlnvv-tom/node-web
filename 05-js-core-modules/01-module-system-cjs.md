# 05-01 CommonJS 模块加载器源码解读

> 本章目标：彻底搞懂 `require('x')` 背后发生了什么——从路径解析、文件定位、编译包装到缓存，全部基于 `lib/internal/modules/cjs/loader.js`。

---

## 1. 一句话流程

```
require('x')
  → Module._load(request, parent)
      → Module._resolveFilename(request, parent)   // 路径解析
      → 查缓存 Module._cache[filename]
      → 没缓存则 new Module(filename, parent)
      → module.load(filename)
          → 按扩展名分派 _extensions['.js' / '.json' / '.node']
          → 读文件 → module._compile(content, filename)
              → 包裹成函数 (function(exports, require, module, __filename, __dirname){...})
              → vm.runInThisContext 执行
              → 返回 module.exports
```

---

## 2. `Module._load`：入口

```js
// lib/internal/modules/cjs/loader.js （简化）
Module._load = function(request, parent, isMain) {
  const filename = Module._resolveFilename(request, parent, isMain);

  // 1) 缓存命中直接返回
  const cachedModule = Module._cache[filename];
  if (cachedModule !== undefined) {
    return cachedModule.exports;
  }

  // 2) 内置模块（如 'fs'）走内置加载器
  const mod = loadBuiltinModule(filename, request);
  if (mod !== undefined) return mod.exports;

  // 3) 创建模块实例
  const module = cachedModule || new Module(filename, parent);
  Module._cache[filename] = module;

  // 4) 标记正在加载，防止循环依赖时无限递归
  if (isMain) {
    process.mainModule = module;
    module.id = '.';
  }

  // 5) 执行加载
  module.load(filename);
  return module.exports;
};
```

要点：
- **缓存优先**：已加载的模块直接返回 `exports`，不重复执行。
- **循环依赖安全**：模块在 `load` 前就写入 `_cache`，所以如果 A requires B 而 B requires A，B 拿到的是 A 加载到一半的 `exports`（见下文）。

---

## 3. `Module._resolveFilename`：路径解析

解析顺序（简化）：
1. **核心模块**（如 `fs`、`path`）：直接返回内置模块 id。
2. **相对/绝对路径**（`../x`、`./x`、`/abs/x`）：拼成真实路径，尝试加扩展名（`.js`/`.json`/`.node`）。
3. **裸模块名**（`lodash`）：从当前目录向上逐级查找 `node_modules/`，并支持 `package.json` 的 `exports` / `main` / `browser` 字段、`index.js` 目录入口。
4. 找不到 → 抛 `MODULE_NOT_FOUND`。

```js
Module._resolveFilename = function(request, parent, isMain, options) {
  // 先查内置模块表
  if (BuiltinModule.map.has(request)) return request;
  // 再走路径解析（含 NODE_PATH、node_modules 逐级上溯）
  return resolve(request, parent, isMain, options);
};
```

解析结果是一个**真实文件名**（如 `/project/node_modules/lodash/index.js`），作为缓存键。

---

## 4. `module.load` 与扩展名分派

```js
Module.prototype.load = function(filename) {
  this.filename = filename;
  this.paths = Module._nodeModulePaths(path.dirname(filename));

  const extension = findLongestRegisteredExtension(filename);
  // 分派到 _extensions[extension]
  Module._extensions[extension](this, filename);
  this.loaded = true;
};

Module._extensions['.js'] = function(module, filename) {
  const content = fs.readFileSync(filename, 'utf8');
  module._compile(content, filename);
};

Module._extensions['.json'] = function(module, filename) {
  const content = fs.readFileSync(filename, 'utf8');
  module.exports = JSON.parse(stripBOM(content));
};

Module._extensions['.node'] = function(module, filename) {
  // 原生插件：dlopen 加载 .node 文件
  return process.dlopen(module, path.toNamespacedPath(filename));
};
```

---

## 5. `module._compile`：函数包装器

这是 CJS 的核心魔法——**把你的模块代码包进一个函数**：

```js
Module.prototype._compile = function(content, filename) {
  // 1) 生成包装函数
  const wrapper = Module.wrap(content);
  // 2) 编译成函数
  const compiledWrapper = vm.runInThisContext(wrapper, {
    filename,
    lineOffset: 0,
    importModuleDynamically: ...,
  });
  // 3) 准备 require 等参数
  const require = makeRequireFunction(this);
  const dirname = path.dirname(filename);
  const exports = this.exports;
  const module = this;
  // 4) 执行
  compiledWrapper.call(exports, exports, require, module, filename, dirname);
  // 5) 返回 exports
  return module.exports;
};
```

`Module.wrap` 的模板：
```js
Module.wrap = function(script) {
  return Module.wrapper[0] + script + Module.wrapper[1];
};
Module.wrapper = [
  '(function (exports, require, module, __filename, __dirname) { ',
  '\n});'
];
```

**这就是为什么你的模块里能直接用 `require`、`module`、`exports`、`__filename`、`__dirname`**——它们不是全局变量，而是包装函数的形参。每个模块都是独立函数作用域，互不污染。

---

## 6. `require` 函数：`makeRequireFunction`

```js
function makeRequireFunction(mod) {
  const require = function(request) {
    return mod.require(request);
  };
  require.resolve = function(request) { ... };
  require.main = process.mainModule;
  require.cache = Module._cache;
  require.extensions = Module._extensions;
  return require;
}
```

`mod.require` 最终又回到 `Module._load`，但传入 `parent = mod`，所以路径解析以当前模块目录为基准。

---

## 7. 循环依赖如何处理

```js
// a.js
console.log('a starting');
exports.done = false;
const b = require('./b');          // 进入 b，b 里又 require('./a')
console.log('in a, b.done =', b.done);
exports.done = true;

// b.js
console.log('b starting');
exports.done = false;
const a = require('./a');          // a 已在 _cache，但 exports 还没填完
console.log('in b, a.done =', a.done);   // → undefined（半成品）
exports.done = true;
```

执行 `node a.js`：
```
a starting
b starting
in b, a.done = undefined     // a 的 exports 还是 {}
in a, b.done = true
```

原理：A 在 `load` 前已写入 `_cache`，B require A 时拿到的是**只执行到一半的 exports**。所以 CommonJS 循环依赖是"部分导出"，不会死循环，但可能拿到 `undefined`。这是与 ESM 的重要区别（见 05-02）。

---

## 8. 缓存与失效

- 缓存键是**绝对文件名**，`Module._cache[filename] = module`。
- 删除缓存：`delete require.cache[require.resolve('x')]` 可强制下次重新加载（热重载常见手法）。
- 注意：仅删 `_cache` 不够，若依赖链里其他模块已持有旧 `exports` 引用，仍会用旧的。

---

## 9. 本章总结

- `require` 走 `Module._load` → `_resolveFilename` → 缓存查 → `new Module` → `load` → `_extensions['.js']` → `_compile` → 包装函数执行。
- 模块被包进 `(function(exports, require, module, __filename, __dirname){...})`，形成独立作用域。
- 缓存以绝对路径为键，是性能与循环依赖安全的基础。
- 循环依赖得到"部分导出"（可能 undefined），不会死循环。

---

## 10. 思考题

1. 为什么每个模块里的 `require` 能正确解析相对路径？它和全局 `require` 是同一个吗？
2. 如果我在 `a.js` 顶部 `require('./b')`，B 的 `module.paths` 是怎么算出来的？
3. 在 ESM 文件里写 `require` 会怎样？CJS/ESM 互操作如何处理（预告 05-03）？
