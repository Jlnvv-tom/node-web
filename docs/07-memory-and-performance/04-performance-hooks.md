# 07-04 Performance Hooks 与诊断工具

> 本章目标：掌握 Node.js 内置的性能测量 API（perf_hooks）、诊断工具链（--inspect、--prof、clinic）、以及如何定位性能瓶颈。

## 导读

Node.js 提供了多层次的性能观测能力：

| 层级 | 工具 | 用途 |
|------|------|------|
| JS API | `perf_hooks` / `performance.measure()` | 函数级计时 |
| V8 层 | `--prof` / `--prof-process` | CPU 热点分析 |
| Node 层 | `--inspect` + Chrome DevTools | 断点/堆快照/Performance 面板 |
| 事件循环 | `--trace-event-categories` | 异步钩子追踪 |
| 第三方 | clinic.js | 综合诊断套件 |

## perf_hooks：Performance API

```javascript
const { performance, PerformanceObserver } = require('perf_hooks');

// 测量一段代码
performance.mark('start');
for (let i = 0; i < 1e6; i++) {}
performance.mark('end');
performance.measure('loop', 'start', 'end');

// 观察结果
const obs = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log(`${entry.name}: ${entry.duration}ms`);
  }
});
obs.observe({ entryTypes: ['measure'] });
// loop: 5.23ms
```

### Node.js 内置 Performance Entry

Node.js 自动记录了一些关键节点：

| Entry Type | 含义 |
|------------|------|
| `node.http.request` | HTTP 请求耗时 |
| `node.http.incoming_message` | HTTP 入站消息 |
| `node.http.outgoing_message` | HTTP 出站消息 |
| `node.perf.timerify` | `timerify` 包装的函数调用 |
| `gc` | GC 事件（需 `perf_hooks.performance.eventLoopUtilization`） |

## --inspect：Chrome DevTools 调试

```bash
node --inspect app.js
# 或暂停在第一行
node --inspect-brk app.js
```

然后在 Chrome 打开 `chrome://inspect` → 点击 inspect。

**DevTools 功能**：
- **Console**：实时 REPL
- **Sources**：断点调试、watch 变量
- **Memory**：堆快照（Heap Snapshot）、分配时间线（Allocation Timeline）
- **Performance**：CPU 火焰图
- **Node Profiler**：V8 采样分析

## --prof：CPU Profile

```bash
# 1. 运行并采集
node --prof app.js
# → 生成 isolate-0xNNN-NN-v8.log

# 2. 处理日志
node --prof-process isolate-0xNNN-NN-v8.log > prof.txt
```

输出包含：
- **Tick count**：各函数被采样到的次数
- **Lazy Compile / Script**：JS 函数耗时排名
- **C++ entry points**：C++ 函数耗时

## --trace-event-categories：事件追踪

```bash
node --trace-event-categories=node.async_hooks app.js
# → 生成 node_trace.1.log

# 用 chrome://tracing 打开
```

可以看到事件循环中每个异步操作的完整生命周期。

## clinic.js：综合诊断套件

```bash
npx clinic doctor app.js
# → 生成 HTML 报告，推荐下一步工具
#   - CPU 密集 → clinic flame
#   - I/O 等待 → clinic bubbleprof
#   - 内存问题 → clinic heapprofiler
```

## 常见性能问题与定位方法

### 1. 事件循环延迟（Event Loop Lag）

```javascript
const { performance, eventLoopUtilization } = require('perf_hooks');

let last = eventLoopUtilization();
setInterval(() => {
  const current = eventLoopUtilization();
  const lag = current.idle - last.idle;
  console.log(`event loop utilization: ${lag.toFixed(3)}`);
  last = current;
}, 1000);
```

如果 utilization 持续接近 1.0，说明事件循环几乎不空闲。

### 2. 内存泄漏

```bash
# 方法 1：--inspect + Memory面板 + Allocation Timeline
node --inspect app.js

# 方法 2：heapdump
const heapdump = require('heapdump');
setInterval(() => heapdump.writeSnapshot(`/tmp/heap-${Date.now()}.heapsnapshot`), 60000);
```

> 可运行示例见 `src/07-memory-and-performance/mem-leak-demo.js`

### 3. CPU 热点

```bash
# 方法 1：--prof
node --prof app.js && node --prof-process isolate-*.log | head -50

# 方法 2：--inspect + Performance 面板 → Record → Stop → Flame Chart
```

## 总结

| 工具 | 适用层级 | 典型场景 |
|------|----------|----------|
| `perf_hooks` | JS 函数 | 精确计时 |
| `--inspect` | 全栈 | 断点/堆快照/CPU 面板 |
| `--prof` | V8 | CPU 热点采样 |
| `--trace-event-categories` | Runtime | 异步操作追踪 |
| clinic.js | 综合 | 自动化瓶颈定位 |

## 思考题

1. `performance.mark/measure` 比 `Date.now()` 更好在哪里？（提示：单调时钟、精度）
2. 如果 Event Loop utilization 持续 0.95+，说明什么？你会怎么排查？
3. `--prof` 的采样频率是多少？它对运行性能有多大影响？