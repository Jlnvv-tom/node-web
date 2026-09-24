# 02-01 libuv 事件循环六阶段源码解读

> 本章目标：彻底讲清楚 Node.js 的"心跳"——事件循环（event loop）。这是整个 Node 异步模型的发动机，也是后续所有 I/O、定时器、回调调度的基础。

---

## 1. 事件循环是什么

**事件循环是一个无限循环，反复做一件事：检查各个阶段的待处理队列，按顺序执行它们的回调，直到所有队列清空且无活动句柄。**

它不是 Node 发明的，而是 libuv 提供的跨平台机制。libuv 在 Linux 用 epoll、macOS/BSD 用 kqueue、Windows 用 IOCP，但对外暴露统一的 `uv_run()` 事件循环接口。Node 的 JS 层（timers、nextTick、setImmediate）都是在这个 C 层循环之上构建的。

---

## 2. 主循环：`uv_run` 的结构

源码位置：`deps/uv/src/unix/core.c`（Unix）/ `deps/uv/src/win/core.c`（Windows）。

```c
// 伪代码，提炼自 uv_run 的真实结构
int uv_run(uv_loop_t* loop, uv_run_mode mode) {
  int r;
  while (r = uv__loop_alive(loop)) {        // (A) 循环还在活吗？
    uv__update_time(loop);                   // (B) 更新当前时间（ms）
    uv__run_timers(loop);                    // (C) 阶段1: timers
    uv__run_pending(loop);                   // (D) 阶段2: pending callbacks
    uv__run_idle(loop);                      // (E) 阶段3a: idle
    uv__run_prepare(loop);                   // (E) 阶段3b: prepare
    uv__io_poll(loop, timeout);              // (F) 阶段4: poll（核心）
    uv__run_check(loop);                     // (G) 阶段5: check
    uv__run_closing_handles(loop);           // (H) 阶段6: close callbacks
    if (mode == UV_RUN_ONCE) break;
  }
  return r;
}
```

六个阶段按顺序执行，每一轮（tick）走过这六个阶段，然后回到顶部判断 `uv__loop_alive`。

---

## 3. 六阶段逐一拆解

```
┌──────────────────────────────────────────────────────────────┐
│                    ┌──────────────────────┐                  │
│               ┌──▶ │ ① timers            │                  │
│               │    │ setTimeout /         │                  │
│               │    │ setInterval 回调     │                  │
│               │    └──────────┬───────────┘                  │
│               │              ▼                               │
│               │    ┌──────────────────────┐                  │
│               │    │ ② pending callbacks  │                  │
│               │    │ 上一轮推迟的 I/O 回调 │                  │
│               │    └──────────┬───────────┘                  │
│               │              ▼                               │
│               │    ┌──────────────────────┐                  │
│               │    │ ③ idle / prepare     │                  │
│               │    │ 内部阶段（通常空）   │                  │
│               │    └──────────┬───────────┘                  │
│               │              ▼                               │
│               │    ┌──────────────────────┐                  │
│   (回到顶部)  │    │ ④ poll              │ ◀── 阻塞在这里等 │
│      ▲        │    │ 检索新 I/O 事件      │      新事件/超时 │
│      │        │    │ 执行 I/O 回调         │                  │
│      │        │    └──────────┬───────────┘                  │
│               │              ▼                               │
│               │    ┌──────────────────────┐                  │
│               │    │ ⑤ check             │                  │
│               │    │ setImmediate 回调     │                  │
│               │    └──────────┬───────────┘                  │
│               │              ▼                               │
│               │    ┌──────────────────────┐                  │
│               └────│ ⑥ close callbacks   │                  │
│                    │ socket.on('close')   │                  │
│                    │ uv_close 回调         │                  │
│                    └──────────────────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

### ① timers（定时器阶段）
- 执行所有**到期的** `setTimeout` / `setInterval` 回调。
- 由最小堆（min-heap）按到期时间排序，只处理"已到期"的（见 02-05 定时器章）。
- 注意：回调执行**可能很长**，会推迟后续阶段。Node 不会为了"准时"而中断长回调。

### ② pending callbacks（待定回调阶段）
- 执行上一轮事件循环中某些**推迟到本轮**的 I/O 回调。
- 典型例子：TCP socket 连接出错时的错误回调，会被推迟到这里，避免阻塞 poll 阶段。

### ③ idle / prepare（空闲与准备）
- `idle` 和 `prepare` 阶段：主要给 libuv 内部或 `uv_idle_t` / `uv_prepare_t` 句柄使用。
- 普通 Node 用户代码极少直接接触，但它们让 libuv 在 poll 前后有机会做内部维护。

### ④ poll（轮询阶段）★ 最核心
- 计算**阻塞超时时间 `timeout`**：
  - 若 timers 阶段有最早到期的定时器 → `timeout = 它到期时间 - 现在`。
  - 若没有任何待处理句柄/请求 → `timeout = 0`（不阻塞，立即返回）。
  - 否则 `timeout = 适当值`（等待 I/O 事件）。
- 调用底层 `epoll_wait` / `kqueue` 阻塞等待 I/O 事件（新数据到达、连接完成、可写等）。
- 取出就绪事件，执行对应的 I/O 回调（如 `socket.on('data')`、`fs` 线程池完成的回调通过 `uv_async` 在此触发）。
- `timeout` 的计算逻辑是面试高频题，详见 02-07 深度解析。

### ⑤ check（检查阶段）
- 执行 `setImmediate` 注册的回调。
- 设计意图：poll 阶段刚收集完 I/O 事件，check 阶段紧随其后，给"本轮 I/O 之后立刻执行"的场景一个固定落点。

### ⑥ close callbacks（关闭回调阶段）
- 执行被 `uv_close()` 关闭的句柄的回调，例如 `socket.on('close', ...)`。
- 以及 `process.exit()` 之前的清理性回调。

---

## 4. 阶段之间的"微任务"：nextTick 与 Promise

注意：六阶段是**宏任务（macrotask）** 的调度框架。但 JS 世界的 `Promise.then` / `queueMicrotask` 属于**微任务（microtask）**，它们**不在上述六个阶段里**。

Node 在**每个阶段切换之间**都会排空微任务队列，此外 `process.nextTick` 的队列优先级更高——它在阶段之间、甚至微任务之前就被清空。

简化优先级（同一次 tick 内）：
```
process.nextTick 队列   →   清空
Promise 微任务队列      →   清空
然后才进入下一个 libuv 阶段
```
（完整时序见 06-01 微任务 vs 宏任务章）

---

## 5. 一个完整的 tick 示例

```js
setTimeout(() => console.log('timeout'), 0);

setImmediate(() => console.log('immediate'));

Promise.resolve().then(() => console.log('promise'));

process.nextTick(() => console.log('nextTick'));

console.log('sync');
```

执行顺序（在主模块中，非 I/O 回调内）：
```
sync          // 顶层同步代码先跑
nextTick      // nextTick 队列优先
promise       // 微任务
timeout       // 进入 timers 阶段
immediate     // 之后 check 阶段
```

> 为什么 `timeout` 在 `immediate` 之前？因为第一轮 tick 从 timers 阶段开始，而主模块同步代码执行完后刚好轮到 timers。但若这段代码写在某个 **I/O 回调内部**，`setImmediate` 会先于 `setTimeout`——原因见 06-02。

---

## 6. `uv__loop_alive` 何时为假（循环退出）

事件循环持续运行，直到：
- 没有活跃句柄（如 server 没在 listen、timer 都清了）；
- 没有未完成的请求（如没有挂起的 I/O、没有 `process.nextTick` 死循环）；
- 没有活跃的 `uv_async` 或引用。

当主模块跑完、所有回调执行完、没有 server 在监听，循环自然退出，进程结束。调用 `process.exit()` 则直接终止，不等待循环。

---

## 7. `uv_run` 的三种模式

```c
typedef enum { UV_RUN_DEFAULT, UV_RUN_ONCE, UV_RUN_NOWAIT } uv_run_mode;
```
- `UV_RUN_DEFAULT`：一直跑，直到 `loop_alive` 为假（Node 主循环用这个）。
- `UV_RUN_ONCE`：最多处理一轮事件就返回（用于需要"手动驱动"的场景）。
- `UV_RUN_NOWAIT`：不阻塞，只处理当前已就绪的事件立即返回。

---

## 8. 可运行验证

```js
// 观察阶段顺序
const fs = require('fs');

fs.readFile(__filename, () => {
  console.log('I/O callback (poll phase)');
  setTimeout(() => console.log('timeout in I/O cb (next tick timers)'), 0);
  setImmediate(() => console.log('setImmediate in I/O cb (this tick check)'));
});

console.log('sync done');
```

预期输出：
```
sync done
I/O callback (poll phase)
setImmediate in I/O cb (this tick check)
timeout in I/O cb (next tick timers)
```
解释：I/O 回调在 poll 阶段执行；其内部 `setImmediate` 落在**紧接着的 check 阶段**（同一轮 tick），而 `setTimeout` 要等到**下一轮 tick 的 timers 阶段**。

---

## 9. 本章总结

- 事件循环 = `uv_run()` 的六阶段循环：timers → pending → (idle/prepare) → poll → check → close。
- poll 阶段通过 epoll/kqueue 阻塞等待 I/O，是整个循环的核心。
- 六阶段是宏任务框架；`nextTick`/`Promise` 微任务穿插在阶段之间清空。
- `setImmediate` 固定在 check 阶段；`setTimeout` 在 timers 阶段；二者顺序取决于"代码写在哪"。

---

## 10. 思考题

1. 如果一个 `setTimeout(fn, 0)` 的回调执行了 100ms，会对后续哪些阶段产生影响？
2. poll 阶段的 `timeout` 是怎么算出来的？如果此时正好有一个 5ms 后到期的定时器，会怎样？
3. 为什么 `process.nextTick` 不在六个阶段中的任何一个里，却能在每个阶段之间执行？
4. 在 I/O 回调里同时调用 `setTimeout(fn,0)` 与 `setImmediate(fn)`，谁先执行？为什么？
