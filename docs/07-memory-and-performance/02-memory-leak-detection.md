# 07-02 内存泄漏排查实战

> 本章目标：把 07-01 的 GC 理论变成可操作技能——如何用 `--inspect`、`heapdump`、Chrome DevTools、clinic.js 定位与确认内存泄漏。

---

## 1. 泄漏的典型信号

- 进程 RSS 持续上涨，GC 后不回落。
- `process.memoryUsage().heapUsed` 随请求/时间单调增长。
- `external`（Buffer）异常大（见 05-12、07-01）。
- 响应延迟逐渐变慢（老生代 GC 更频繁、停顿更长）。

---

## 2. 第一步：观察内存

```js
setInterval(() => {
  const { rss, heapUsed, external } = process.memoryUsage();
  console.log(`rss=${(rss/1e6).toFixed(1)}MB heap=${(heapUsed/1e6).toFixed(1)}MB ext=${(external/1e6).toFixed(1)}MB`);
}, 5000);
```

或者用 `--trace-gc` 看 GC 是否频繁且回收不掉（07-01）。

---

## 3. 第二步：生成 Heap Snapshot

方式一：`--inspect` + DevTools
```bash
node --inspect app.js
# Chrome 打开 chrome://inspect → 点击目标 → Memory → Take heap snapshot
```
方式二：`heapdump` 模块
```js
const heapdump = require('heapdump');
setInterval(() => heapdump.writeSnapshot('/tmp/' + Date.now() + '.heapsnapshot'), 30000);
```
方式三：`v8.getHeapSnapshot()`（Node 内置）
```js
const { writeHeapSnapshot } = require('v8');
writeHeapSnapshot('/tmp/snap.heapsnapshot');
```

---

## 4. 第三步：对比快照找增长

操作流程：
1. 在"泄漏发生前"拍一张快照 A。
2. 触发泄漏场景（如跑 1000 次请求）。
3. 拍快照 B。
4. DevTools 选 **Comparison**（对比 A）或 **Summary**，按 **Retained Size** 排序，找"持续变大的对象类型"。
5. 展开其 **retainers**（谁引用着它），定位到你的代码（缓存、闭包、监听器）。

常见元凶（见 07-01）：
- 全局/长生命周期对象上的缓存未清理。
- `EventEmitter` 监听器只 `on` 不 `off`（05-04）。
- `setInterval` 未 `clearInterval`，闭包持有大对象。
- 队列/数组无限增长。
- `Buffer` 被长期引用（看 `external`）。

---

## 5. 第四步：clinic.js 一键诊断

```bash
npm install -g clinic
clinic doctor -- node app.js     # 生成性能/内存画像
clinic flame -- node app.js      # 生成火焰图
# 打开生成的 HTML 报告
```

clinic.js 自动采集 GC、事件循环延迟、CPU，给出可视化诊断。

---

## 6. 真实案例：监听器泄漏

```js
// 错误：每次请求都给 db 加监听，从不移除
app.get('/data', (req, res) => {
  db.on('result', (r) => res.json(r));   // 泄漏！每次请求加一个
});
// 正确：用 once 或移除
app.get('/data', (req, res) => {
  db.once('result', (r) => res.json(r));
});
```

对比快照会看到 `db` 的 `events.result` 数组随请求数线性增长——典型泄漏标记。

---

## 7. 预防措施

- 大对象缓存设上限（LRU，如 `lru-cache`）。
- 监听器成对 `on`/`off`，或用 `once`。
- `setInterval` 配对 `clearInterval`。
- 用 `WeakMap`/`WeakRef` 做可回收的副作用缓存。
- 压测（`autocannon`/`wrk`）后观察内存是否稳定。

---

## 8. 本章总结

- 第一步用 `memoryUsage()` / `--trace-gc` 确认增长趋势。
- 第二步生成 heap snapshot（`--inspect` / `heapdump` / `v8.getHeapSnapshot`）。
- 第三步对比快照，按 Retained Size 排序，查 retainers 定位代码。
- 工具：`clinic.js` 一键画像，火焰图定位热点。
- 预防：缓存上限、监听器配对、压测验证。

---

## 9. 思考题

1. 为什么"对比两个时间点的 heap snapshot"比"只看一个快照"更能定位泄漏？
2. 如果你发现 `external` 持续增长而 `heapUsed` 不变，最可能是什么泄漏？该看哪里？
3. `EventEmitter` 监听器泄漏在 heap snapshot 里会表现出什么特征？
