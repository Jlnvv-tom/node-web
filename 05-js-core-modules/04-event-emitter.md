# 05-04 EventEmitter 源码解读

> 本章目标：理解 Node 异步事件模型的基石——`EventEmitter`。它如何存储回调、如何触发、为何"错误不监听就崩溃"。

---

## 1. 地位

`EventEmitter` 是 Node 异步编程范式的核心。几乎所有 I/O 对象（`net.Socket`、`fs.ReadStream`、`process`、`Worker`）都继承它。理解它等于理解 Node 的事件驱动风格。

源码：`lib/events.js`

---

## 2. 核心数据结构

```js
// lib/events.js （简化）
function EventEmitter() {
  EventEmitter.init.call(this);
}
EventEmitter.prototype._events = undefined;   // 事件名 → 监听器
EventEmitter.prototype._eventsCount = 0;

EventEmitter.init = function() {
  if (this._events === undefined) {
    this._events = Object.create(null);   // 无原型链，避免 __proto__ 冲突
    this._eventsCount = 0;
  }
};
```

`_events` 是一个**普通对象**，键是事件名，值是监听器：

- 只有一个监听器时，`_events[name] = listener`（函数）。
- 多个时，`_events[name] = [l1, l2, ...]`（数组）。

---

## 3. `on` / `addListener`：注册

```js
EventEmitter.prototype.addListener = function(type, listener) {
  return _addListener(this, type, listener, false);
};

function _addListener(target, type, listener, prepend) {
  let events = target._events;
  if (events === undefined) {
    events = target._events = Object.create(null);
  }
  // 特殊：'newListener' 事件触发
  if (events.newListener !== undefined) {
    target.emit('newListener', type, listener);
  }
  let existing = events[type];
  if (existing === undefined) {
    events[type] = listener;          // 单个 → 直接存函数
    ++target._eventsCount;
  } else {
    if (typeof existing === 'function') {
      existing = events[type] = prepend
        ? [listener, existing]        // 前插
        : [existing, listener];       // 后插
    } else {
      if (prepend) existing.unshift(listener);
      else existing.push(listener);
    }
  }
  return target;
}
```

要点：`on` 就是 `addListener`；`prependListener` 用 `prepend=true` 把监听器插到数组头部。

---

## 4. `emit`：触发（核心）

```js
EventEmitter.prototype.emit = function(type, ...args) {
  const events = this._events;
  if (events === undefined) return false;

  const handler = events[type];
  if (handler === undefined) return false;

  if (typeof handler === 'function') {
    // 单个监听器：直接调用（fast path）
    const result = handler.apply(this, args);
    return result !== undefined ? result : true;
  } else {
    // 多个：拷贝一份遍历，避免回调里 remove 导致索引错乱
    const listeners = handler.slice();
    for (let i = 0; i < listeners.length; i++) {
      listeners[i].apply(this, args);
    }
  }
  return true;
};
```

关键点：
1. **单监听器走 fast path**：直接 `apply`，不经过数组，性能最好。
2. **多监听器先 `slice()` 再遍历**：因为回调里可能 `removeListener`，若直接遍历原数组会导致跳过/重复。
3. **`'error'` 事件特殊**：若触发 `error` 但没有任何 `error` 监听器，`emit` 会抛出 `ERR_UNHANDLED_ERROR`（见下）。

---

## 5. 错误传播：`'error'` 规则

```js
// 在 emit 内部对 'error' 的特殊处理（简化）
if (type === 'error') {
  if (handler === undefined) {
    // 没有 error 监听器 → 抛出，且若这不是递归触发则直接 throw
    const err = args[0];
    if (typeof err === 'object' && err !== null) {
      throw err;   // ★ 未捕获的 error 事件会崩溃进程
    }
  }
}
```

这就是为什么 Node 常说：**"任何 EventEmitter，忘记监听 error 就可能让进程退出"**。修复方法：

```js
stream.on('error', (err) => { /* 处理 */ });
```

或在较新版本用 `process.on('uncaughtException')` 兜底（但不推荐依赖）。

---

## 6. `removeListener` / `once` / `off`

```js
EventEmitter.prototype.removeListener = function(type, listener) {
  const events = this._events;
  // 找到匹配项，从函数或数组中移除
  // 触发 'removeListener' 事件
};

EventEmitter.prototype.once = function(type, listener) {
  const state = { fired: false, wrapFn: undefined, target: this, type, listener };
  const wrapped = onceWrapper.bind(state);
  wrapped.listener = listener;
  this.on(type, wrapped);    // 触发一次后自动 remove
  return this;
};
```

`once` 用一个包装函数：首次触发时执行原 listener，然后 `removeListener` 自己。

`off` 是 `removeListener` 的别名。

---

## 7. 内存泄漏警告

当监听器数过多（默认 > 10）时，Node 会打印 `MaxListenersExceededWarning`，提示可能泄漏：

```js
server.setMaxListeners(0);  // 关闭警告（谨慎）
// 或用 require('events').setMaxListeners(...)
```

这是诊断"忘记 removeListener"导致内存涨的常用信号。

---

## 8. 与异步的关系

`emit` 是**同步**调用所有监听器（在当前调用栈内）。监听器内部若做异步操作（如 I/O），那是监听器自己的事。`emit` 返回后，所有同步监听器的副作用已生效。

```js
emitter.on('x', () => setTimeout(() => console.log('async'), 0));
emitter.emit('x');
console.log('after emit');   // 先打印，因为 setTimeout 是异步
```

---

## 9. 可运行验证

```js
const EventEmitter = require('events');
const e = new EventEmitter();

e.on('data', (d) => console.log('got', d));
e.on('data', (d) => console.log('also', d));
e.emit('data', 42);
// got 42
// also 42

e.emit('error', new Error('boom'));  // 无 error 监听器 → 抛异常崩溃
```

---

## 10. 本章总结

- `_events` 以事件名为键，单监听器存函数、多监听器存数组。
- `emit` 单监听器走 fast path；多监听器先 `slice` 再遍历防 `remove` 副作用。
- 未监听的 `error` 事件会抛出并可能终止进程——务必监听 `error`。
- `emit` 同步执行所有监听器；异步是监听器内部的事。
- `once` 用包装函数自动 remove；>10 监听器触发泄漏警告。

---

## 11. 思考题

1. 为什么 `emit` 在多监听器场景要先 `slice()` 再遍历？如果直接遍历原数组会怎样？
2. 为什么 Node 规定"error 事件必须有监听器"？设计意图是什么？
3. `EventEmitter` 是同步的，那为什么我们说 Node 是"异步事件驱动"？异步发生在哪？
