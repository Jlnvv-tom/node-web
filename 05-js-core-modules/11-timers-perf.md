# 05-11 timers 与 perf_hooks：计时 API 与性能测量

> 本章目标：理解 Node 的定时器 API（`setTimeout`/`setInterval`/`setImmediate`/`process.nextTick`）以及 `perf_hooks` 如何精确测量 JS 与事件循环性能。这是性能诊断的最后一块拼图。

---

## 1. 定时器 API 全景（回顾 02-05、06-01、06-02）

| API | 阶段 | 优先级 | 说明 |
|-----|------|--------|------|
| `process.nextTick(cb)` | 阶段之间 | 最高 | 微任务，当前操作后立即执行（见 06-01） |
| `Promise.then(cb)` | 阶段之间 | 高 | 微任务 |
| `setImmediate(cb)` | check 阶段 | 中 | poll 之后立即执行（见 06-02） |
| `setTimeout(cb, 0)` | timers 阶段 | 低（但实为 ≥1ms） | 定时器（见 02-05） |
| `setInterval(cb, n)` | timers 阶段 | 同上 | 重复定时器 |

优先级（同一 tick 内从先到后）：**nextTick > Promise > setImmediate > setTimeout(0)**。

---

## 2. `setTimeout` 的精度陷阱（回顾 02-05）

- `setTimeout(fn, 0)` 实际最小 **1ms**（非 0）。
- 若 timers 阶段前的回调执行很久，后续定时器**延迟**触发（不保证准时）。
- `setInterval` 是"相对上次到期 repeat"，长回调会**跳过**而非积压。

诊断延迟：用 `performance.now()` 测量实际触发时间偏移。

---

## 3. `perf_hooks`：精确性能测量

`perf_hooks` 暴露 W3C 性能时间 API + Node 特有的事件循环监控：

```js
const { performance, PerformanceObserver } = require('perf_hooks');

// 1) 标记 + 测量
performance.mark('A');
// ... 做事 ...
performance.mark('B');
performance.measure('A-to-B', 'A', 'B');
const entries = performance.getEntriesByName('A-to-B');
console.log(entries[0].duration);   // 毫秒

// 2) 监控事件循环延迟（Event Loop Lag）
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log('loop lag:', entry.duration);   // 循环延迟
  }
});
observer.observe({ entryTypes: ['eventLoopUtilization', 'function'], buffered: true });
```

### 3.1 事件循环利用率（ELU）

```js
const { monitorEventLoopDelay } = require('perf_hooks');
const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();
// ... 跑一段时间 ...
console.log('p99 延迟(ms):', h.percentile(99));
console.log('最大延迟(ms):', h.max);
```

`h.resolution` 控制采样粒度；`percentile(99)` 给出 99 分位延迟——这是诊断"偶发卡顿"的金指标。

---

## 4. `performance.now()` vs `Date.now()`

| API | 单位 | 单调性 | 用途 |
|-----|------|--------|------|
| `Date.now()` | 毫秒（墙钟时间） | 否（可被 NTP 回调） | 显示日期 |
| `performance.now()` | 高精度毫秒/微秒（相对进程启动） | 是（单调） | 测量耗时 |

**永远用 `performance.now()` 测耗时**——`Date.now()` 可能因系统时间调整出现负值间隔。

---

## 5. 与 GC / async_hooks 的协同

- `--trace-gc` 可叠加性能日志（07-01）。
- `perf_hooks` 的 `async_hooks` 集成可追踪每次异步操作的耗时（04-02、05 章节提及的 asyncId 体系）。

```js
const { asyncWrapProviders } = require('perf_hooks');   // 实际用 async_hooks 模块
```

---

## 6. 性能测量最佳实践

1. **不要在生产高频路径用 `console.time`**（有 I/O 开销）。用 `performance.mark` / `measure`。
2. **用 `monitorEventLoopDelay` 看 p99 延迟**，而非平均值——平均会掩盖尖刺。
3. **定时器延迟是"相对"的**：测调度延迟用 `performance.now()` 对比预期。
4. **采样而非全量**：`PerformanceObserver` 异步回调，不阻塞主线程。

---

## 7. 可运行验证

```js
const { performance, monitorEventLoopDelay } = require('perf_hooks');
const h = monitorEventLoopDelay();
h.enable();

setTimeout(() => {
  console.log('p99 lag ms:', h.percentile(99).toFixed(2));
  console.log('max lag ms:', h.max.toFixed(2));
}, 1000);

// 制造负载：阻塞事件循环
setInterval(() => { const s = Date.now(); while (Date.now() - s < 50) {} }, 100);
```

你会看到 lag p99 升高，对应那些 50ms 的阻塞。

---

## 8. 本章总结

- 定时器优先级：nextTick > Promise > setImmediate > setTimeout(0)。
- `setTimeout(0)` 实为 ≥1ms；定时器不保证准时，长回调延迟后续、setInterval 跳过。
- `perf_hooks` 提供 `mark/measure`、事件循环延迟监控（ELU / `monitorEventLoopDelay`）。
- 用时用 `performance.now()`（单调）而非 `Date.now()`；诊断看 p99 而非均值。

---

## 9. 思考题

1. 为什么诊断"事件循环卡顿"要看 p99 延迟而不是平均值？举个具体场景说明。
2. `performance.now()` 与 `Date.now()` 在"测量函数耗时"场景下，哪个更可靠？为什么？
3. 如果 `monitorEventLoopDelay().percentile(99)` 高达 200ms，你会优先怀疑哪类代码？如何定位元凶？
