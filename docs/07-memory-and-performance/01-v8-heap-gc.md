# 07-01 V8 堆内存与垃圾回收（GC）

> 本章目标：理解 Node 进程的内存从哪来、V8 如何自动回收、为什么有时会"内存涨不降"，以及 GC 如何影响延迟。这是排查内存泄漏与性能抖动的基础。

---

## 1. Node 进程的内存构成

Node 进程内存不只 V8 堆：

```
进程内存
├── V8 堆（Heap）        ← JS 对象、闭包、字符串
│     ├── 新生代 (Young/Nursery)
│     └── 老生代 (Old)
├── V8 非堆               ← 代码、JIT 编译产物、map、全局句柄
├── Buffer / TypedArray   ← 来自 Node 的 C++ 堆（ArrayBuffer），不在 V8 堆统计内！
├── libuv / 线程池         ← C++ 侧分配
└── 系统 / 其他
```

**关键陷阱**：`Buffer` 的内存（尤其是 `Buffer.allocUnsafe` 或大 Buffer）来自 Node 的 C++ 堆（`ArrayBuffer` 后备存储），**不计入 V8 堆上限 `max-old-space-size`**。所以"V8 堆没满但进程 RSS 很大"常常是 Buffer 占用。

---

## 2. 分代式堆结构

V8 把堆分为代，基于"弱代假说"（多数对象朝生夕死）：

```
┌─────────────────────────────────────────────┐
│  新生代 (Young Generation)                   │
│     ├── From-Space (Semi-Space A)            │
│     └── To-Space  (Semi-Space B)             │
│     存放新创建、短命对象                       │
├─────────────────────────────────────────────┤
│  老生代 (Old Generation)                     │
│     存放存活久、大对象                         │
│     使用 Mark-Sweep + Mark-Compact            │
└─────────────────────────────────────────────┘
```

---

## 3. 新生代 GC：Scavenge（复制算法）

- 新对象分配在 From-Space。
- 当 From-Space 满，触发 Scavenge：
  1. 标记 From-Space 中的存活对象。
  2. 把存活对象**复制**到 To-Space。
  3. 交换 From/To 角色。
- 特点：**快（只处理少数存活对象）、但浪费一半空间**（双空间）。
- 存活过多次（默认 ~2 次）的对象**晋升（promote）**到老生代。

```js
function foo() {
  const obj = { a: 1 };   // 分配在新生代 From-Space
  return obj;             // 若 foo 返回后 obj 仍被引用 → 可能晋升老生代
}
```

---

## 4. 老生代 GC：Orinoco（Mark-Sweep + Mark-Compact）

老生代用并行的 **Mark-Sweep（标记-清除）** 与 **Mark-Compact（标记-整理）**：

1. **Mark（标记）**：从 GC Roots（全局对象、当前调用栈、闭包引用等）出发，标记所有可达对象。
2. **Sweep（清除）**：回收未标记（不可达）对象的内存。产生碎片。
3. **Compact（整理）**：把存活对象移到连续空间，消除碎片（成本较高，仅在碎片影响分配时做）。

V8 的 Orinoco 引擎做了大量优化：
- **并行标记**：多核同时标记。
- **并发标记**：在 JS 运行时后台标记（不暂停主线程）。
- **增量标记**：把标记拆成小步，穿插在 JS 执行之间，降低单次停顿。

---

## 5. GC 停顿（Stop-The-World）

尽管有并发/增量优化，**某些阶段仍需短暂暂停 JS 执行（STW）**。老生代 GC 的停顿可达**毫秒到几十毫秒**级别（大堆更久）。在高吞吐/低延迟服务里，GC 停顿会表现为**偶发延迟尖刺**。

监控 GC 停顿：
```bash
node --trace-gc app.js
# 输出每次 GC 的类型、暂停时长、回收量

node --trace-gc-verbose app.js   # 更详细
```

```bash
# 生成 GC 跟踪文件，用 Chrome DevTools 分析
node --trace-event-categories=v8,gc --trace-event-file=gc.json app.js
```

---

## 6. 内存上限与调优

Node 默认对 V8 老生代有上限（历史默认 ~1.4GB 老生代 / 32-bit 更小；现代版本随内存自动调整但仍有默认）。超过触发 OOM：

```bash
# 调大老生代上限（避免大内存应用 OOM）
node --max-old-space-size=4096 app.js     # 4GB

# 调新生代大小
node --max-semi-space-size=128 app.js     # 128MB

# 关闭代码压缩（调试用）
node --no-compilation-cache app.js
```

> 注意：调大上限只是延迟 OOM，真正的修复是找到泄漏。

---

## 7. 常见内存泄漏模式

1. **闭包/全局变量持有**：意外把大对象挂到 `global` 或长生命周期对象上。
   ```js
   const cache = {};
   function handler(req) { cache[req.id] = bigData; }  // 永不删除 → 泄漏
   ```
2. **EventEmitter 监听器未移除**：`on` 而忘记 `off`，监听器累积（见 05-04）。
3. **定时器未清理**：`setInterval` 持有闭包引用，永不 `clearInterval`。
4. **队列/数组无限增长**：消息堆积未消费。
5. **Buffer 累积**：大 Buffer 被长期引用（注意它们不在 V8 堆统计里，需要用 `process.memoryUsage().external` 观察）。

---

## 8. 诊断工具

```js
// process.memoryUsage() 各字段含义
const { rss, heapTotal, heapUsed, external, arrayBuffers } = process.memoryUsage();
// rss:          进程常驻内存（含所有）
// heapTotal:    V8 堆总大小
// heapUsed:     V8 堆已用
// external:     V8 管理的外部内存（如 Buffer 后备）
// arrayBuffers: ArrayBuffer 相关（含 Buffer）
```

工具链：
- `node --inspect app.js` + Chrome DevTools → Memory 面板 heap snapshot 对比。
- `clinic.js` / `0x` / `heapdump` 模块做快照分析。

---

## 9. 可运行验证

```js
// 观察 GC 触发
node --trace-gc -e "
const arr = [];
for (let i = 0; i < 1e6; i++) arr.push({ x: i, y: new Array(100).fill(i) });
setTimeout(() => console.log('done, heapUsed:', process.memoryUsage().heapUsed), 1000);
"
// 你会看到 --trace-gc 输出多次 scavenge / mark-sweep
```

---

## 10. 本章总结

- Node 内存 = V8 堆 + V8 非堆 + Buffer/ArrayBuffer（C++ 堆，不计入 V8 上限）。
- 分代：新生代用 Scavenge（复制，快），老生代用 Mark-Sweep/Compact（Orinoco，并行+并发+增量）。
- GC 仍有 STW 停顿，表现为延迟尖刺；用 `--trace-gc` 观察。
- 调优用 `--max-old-space-size`，但根因是修泄漏。
- 常见泄漏：全局缓存未清、监听器未移除、定时器未清理、Buffer 累积。

---

## 11. 思考题

1. 为什么"进程 RSS 很大但 heapUsed 很小"？哪类数据会导致这种差异？
2. 新生代为什么用复制算法而不是标记-清除？代价是什么？
3. 如果你的服务出现"每隔几秒有一次 50ms 延迟尖刺"，你会怀疑什么？如何确认是 GC 导致的？
