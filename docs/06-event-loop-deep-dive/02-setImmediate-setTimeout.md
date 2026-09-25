# 06-02 setImmediate vs setTimeout 时序谜题

> 本章目标：彻底厘清 Node 中最常考、也最容易说错的一对——`setImmediate` 与 `setTimeout(fn, 0)` 到底谁先执行。答案取决于"代码写在哪"。

---

## 1. 一句话结论

- **在 I/O 回调内部**：`setImmediate` 先于 `setTimeout(fn, 0)` 执行。
- **不在 I/O 回调内（如主模块顶层）**：顺序不确定，但 `setTimeout` 通常先执行。

这个差异让无数人困惑。下面拆开讲。

---

## 2. 两者的本质归属

| API | 所在 libuv 阶段 | 注册位置 |
|-----|----------------|---------|
| `setTimeout(fn, 0)` | **timers 阶段** | `timer_heap`（最小堆） |
| `setImmediate(fn)` | **check 阶段** | `check_handles` 链表 |

六阶段顺序：**timers → ... → poll → check → close...**

所以"如果两者都已就绪"，在没有 I/O 干扰的情况下，timers（setTimeout）在 check（setImmediate）**之前**，理论 setTimeout 先。

---

## 3. 情况一：代码在主模块顶层（先看这个）

```js
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));
```

典型输出：
```
timeout
immediate
```

为什么？
1. 主模块同步代码执行完，进入第一轮 `uv_run`。
2. **timers 阶段**：此时 `setTimeout` 的到期时间 = `now + 1ms`（注意：Node 把 `0` 视为 `1`）。若主模块执行耗时 < 1ms，timer 还没到期 → 跳过。
3. 进入 poll 阶段，无 I/O，计算 `timeout` = 最近 timer 剩余时间（约 1ms），`epoll_wait` 阻塞 ~1ms。
4. 阻塞结束，`setTimeout` 到期 → **下一轮 timers 阶段**执行 `timeout`。
5. 本轮 check 阶段执行 `setImmediate` → `immediate`。

但注意：如果主模块执行**超过 1ms**（比如前面有大量代码），timer 在第一轮就到期了，`timeout` 会在第一轮 timers 先执行。这就是为什么**顶层顺序不确定**——取决于进入事件循环时 timer 是否已到期。

> 经验法则：顶层同时写这两句，顺序**不可靠**，别依赖。

---

## 4. 情况二：代码在 I/O 回调内部（确定！）

```js
const fs = require('fs');
fs.readFile(__filename, () => {
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
});
```

**稳定输出：**
```
immediate
timeout
```

为什么这次 `setImmediate` 赢了？

1. `readFile` 回调属于 **poll 阶段**（I/O 事件触发）。
2. 在 poll 阶段内执行该回调：
   - `setImmediate` 注册到 **check 阶段**（本轮即将执行）。
   - `setTimeout` 注册到 **timers 阶段**（下一轮才轮到）。
3. poll 阶段结束，**紧接着就是 check 阶段** → 执行 `setImmediate` → `immediate`。
4. 本轮走完所有阶段，进入下一轮 **timers 阶段** → 执行 `setTimeout` → `timeout`。

关键洞察：**I/O 回调在 poll 阶段执行，而 check 阶段紧接 poll。所以 I/O 内部注册的 setImmediate 能在"同一轮 tick 内"立刻跑，而 setTimeout 要等下一轮 timers**。

---

## 5. 可视化对比

### 顶层（顺序不确定）
```
┌─ uv_run 第1轮 ─────────────┐
│ timers:   [setTimeout? 可能未到期]
│ poll:     无 I/O，阻塞 ~1ms
│ check:    [setImmediate 执行]  → immediate
└────────────────────────────┘
┌─ uv_run 第2轮 ─────────────┐
│ timers:   [setTimeout 到期]  → timeout
└────────────────────────────┘
```
也可能第1轮 timers 就到期（取决于耗时），则 timeout 先。

### I/O 回调内（确定）
```
┌─ uv_run 某轮 ──────────────┐
│ poll:  readFile 回调执行
│         ├ 注册 setImmediate (本轮 check)
│         └ 注册 setTimeout (下轮 timers)
│ check: [setImmediate 执行]  → immediate
└────────────────────────────┘
┌─ uv_run 下轮 ──────────────┐
│ timers: [setTimeout 执行]   → timeout
└────────────────────────────┘
```

---

## 6. `setImmediate` 的设计意图

`setImmediate` 字面意思是"在当前事件循环迭代结束后、下一个迭代开始前立即执行"，实际落在 **check 阶段**——即 poll 收集完 I/O 事件后立即执行。它本是为"在 I/O 之后立刻做点事"而设计的，因此在 I/O 回调里它比 `setTimeout(0)` 更"贴身"。

历史背景：`setImmediate` 最早是浏览器提案（IE 实现过），Node 借来用。它与 `process.nextTick` 的区别：nextTick 优先级更高、在阶段之间清空，而 setImmediate 固定在 check 阶段。

---

## 7. 与 `process.nextTick` 的三方对比

```js
fs.readFile(__filename, () => {
  setImmediate(() => console.log('setImmediate'));
  setTimeout(() => console.log('setTimeout'), 0);
  process.nextTick(() => console.log('nextTick'));   // 注意加这一句
});
```

输出：
```
nextTick        // 阶段之间立即清空，最高优先级
setImmediate    // 本轮 check
setTimeout      // 下轮 timers
```

优先级：**`process.nextTick` > `setImmediate` > `setTimeout(0)`（在 I/O 内）**。

---

## 8. 实践建议

- **不要让 `setTimeout(fn,0)` 和 `setImmediate()` 的先后顺序成为程序正确性的依赖**。
- 想"本轮 I/O 之后立刻执行" → 用 `setImmediate`。
- 想"当前操作完成后立刻执行（最高优先）" → 用 `process.nextTick`（但小心递归饿死循环，见 06-01）。
- 需要"至少延迟到下一轮" → 用 `setTimeout(fn, 0)`（注意实际最小 1ms）。

---

## 9. 可运行验证

```bash
node -e "setTimeout(()=>console.log('t'),0); setImmediate(()=>console.log('i'))"
# 多跑几次，顶层顺序可能变化

node -e "const fs=require('fs'); fs.readFile(__filename,()=>{setTimeout(()=>console.log('t'),0);setImmediate(()=>console.log('i'))})"
# 每次都是 i 先 t 后
```

---

## 10. 本章总结

- `setTimeout(0)` 在 timers 阶段，`setImmediate` 在 check 阶段。
- **顶层**：顺序不确定（取决于进入循环时 timer 是否到期）。
- **I/O 回调内**：`setImmediate` 稳定先于 `setTimeout(0)`——因 poll 之后紧接 check，而 timers 要等下一轮。
- 优先级（I/O 内）：nextTick > setImmediate > setTimeout(0)。
- 不要依赖二者的顺序做正确性保证；按意图选 API。

---

## 11. 思考题

1. 为什么 Node 把 `setTimeout(fn, 0)` 实际当成 `1ms` 而非 `0ms`？这如何影响顶层顺序？
2. 在 I/O 回调里，如果同时注册 `setImmediate` 和 `setTimeout(fn, 2)`，谁先？为什么？
3. 如果在一个 `setImmediate` 回调里再调用 `setImmediate`，会进入无限循环吗？与 `process.nextTick` 递归有何不同？
