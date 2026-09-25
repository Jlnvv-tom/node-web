# 06-01 微任务 vs 宏任务：nextTick 与 Promise

> 本章目标：厘清 Node 里三类"异步回调"的优先级——`process.nextTick`、`Promise` 微任务、以及 libuv 的宏任务阶段。这是事件循环最容易混淆、也是面试最高频的知识点。

---

## 1. 三类任务的层级

在 Node 中，回调按"被执行的时机"可分为三层：

```
┌─────────────────────────────────────────────────┐
│ 最高优先级（阶段之间立即清空）                    │
│   process.nextTick 队列                           │
├─────────────────────────────────────────────────┤
│ 高优先级（每个阶段切换前清空）                    │
│   Promise.then / queueMicrotask（微任务）         │
├─────────────────────────────────────────────────┤
│ 普通优先级（按 libuv 阶段顺序执行）              │
│   setTimeout / setImmediate / I/O 回调（宏任务） │
└─────────────────────────────────────────────────┘
```

关键认知：**`process.nextTick` 和 `Promise` 不属于 libuv 的六个阶段**，它们是 V8/Node 自己在阶段切换间隙清空的队列。

---

## 2. `process.nextTick`：不在事件循环里

`process.nextTick(cb)` 把 `cb` 推入一个**独立的 nextTick 队列**。它的执行时机是：

> **在当前操作完成后、事件循环继续到下一个阶段之前，立即、同步地清空整个 nextTick 队列。**

源码视角：`lib/internal/process/next_tick.js` 维护 `tickCallback` 链表。每次 Node 的 C++ 侧"即将把控制权交还事件循环"前，会调用 `InternalCallbackScope` 的析构逻辑，优先排空 nextTick 队列。

```js
console.log('A');
process.nextTick(() => console.log('nextTick'));
Promise.resolve().then(() => console.log('promise'));
console.log('B');
// 输出: A → B → nextTick → promise
```

为何 `nextTick` 在 `promise` 之前？因为 nextTick 队列在微任务之前被清空。

---

## 3. `Promise` 微任务：V8 的 microtask 队列

`Promise.then` / `queueMicrotask` / `async-await` 的续体都属于 V8 的 microtask 队列。Node 在**每个 libuv 阶段之间**，通过 `MicrotasksScope` 清空微任务队列。

V8 的 microtask 清空时机由 `v8::MicrotaskQueue` 控制；Node 配置成"每次从 C++ 回到 JS 边界时清空"（即阶段切换处）。

---

## 4. 宏任务：六个 libuv 阶段

`setTimeout`（timers）、`setImmediate`（check）、I/O 回调（poll）、close 回调（close）都属于宏任务，受六阶段顺序约束（见 02-01）。

---

## 5. 完整执行时序（单 tick 内）

假设当前正在执行某段 JS（同步栈），期间注册了各种回调：

```
[同步代码执行中]
   ├─ process.nextTick(fn1)   → 推入 nextTick 队列
   ├─ Promise.resolve().then(fn2) → 推入 microtask 队列
   ├─ setTimeout(fn3, 0)      → 推入 timers 阶段队列
   └─ setImmediate(fn4)       → 推入 check 阶段队列
        │
        ▼ 同步代码结束
[清空 nextTick 队列]  → fn1
[清空 microtask 队列] → fn2
        ▼
[继续事件循环下一阶段...]
timers 阶段  → fn3（若已到期）
   ...
check 阶段  → fn4
```

注意：`nextTick` 和 `microtask` 在"同步代码结束那一刻"就被清空，远早于 timers/check 阶段。

---

## 6. 危险：nextTick 递归饥饿事件循环

因为 `nextTick` 总是优先清空，所以在 `nextTick` 回调里再调度 `nextTick` 会形成无限同步清空，**永远不让事件循环进入下一阶段**（定时器、I/O 全被饿死）：

```js
function starve() {
  process.nextTick(starve);
}
starve();
// 事件循环再也无法前进，setTimeout 永不触发
```

Node 对此有**防御**：单个 tick 内 nextTick 队列过长会打印警告（Deprecation/MaxListeners 类似机制）。但 Promise 的"微任务递归"(`Promise.resolve().then(p);`) 同样会饿死循环且无警告，所以生产代码要避免无界递归的微任务。

---

## 7. 可运行验证

```js
const fs = require('fs');

fs.readFile(__filename, () => {
  console.log('1: I/O callback (poll)');
  process.nextTick(() => console.log('2: nextTick in I/O'));
  Promise.resolve().then(() => console.log('3: promise in I/O'));
  setImmediate(() => console.log('4: setImmediate in I/O'));
  setTimeout(() => console.log('5: setTimeout in I/O'), 0);
});

console.log('0: sync');
```

预期：
```
0: sync
1: I/O callback (poll)
2: nextTick in I/O
3: promise in I/O
4: setImmediate in I/O
5: setTimeout in I/O
```
解释：I/O 回调在 poll 阶段执行；其内部 nextTick → 立即清空；microtask → 清空；随后 check 阶段执行 setImmediate；下一 tick 的 timers 阶段才执行 setTimeout。

---

## 8. 本章总结

- `process.nextTick` 队列优先级最高，在阶段之间立即清空，且**不属于**六阶段。
- `Promise` 微任务次之，在阶段切换处由 V8 清空。
- 宏任务（timers/check/I/O/close）严格按六阶段顺序。
- 无界递归的 nextTick / Promise 会饿死事件循环——要警惕。
- 记忆口诀：**nextTick > microtask > 宏任务阶段**。

---

## 9. 思考题

1. `process.nextTick` 和 `Promise.then` 都不在 libuv 六阶段里，那它们由谁负责调度？
2. 为什么 `async/await` 的续体表现得像 `Promise.then`（同属 microtask）？
3. 如果在 `setTimeout` 回调里递归调用 `setTimeout`，会饿死事件循环吗？和 nextTick 递归有何不同？

---

## 附：可运行示例

> 配套验证脚本见 `src/06-event-loop-deep-dive/order-cheatsheet.js`
> 一次循环内各任务优先级实测
