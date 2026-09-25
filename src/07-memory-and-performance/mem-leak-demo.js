// 文件：src/07-memory-and-performance/mem-leak-demo.js
// 对应文章：07-01 V8 堆 GC / 07-02 内存泄漏排查实战
// 运行：node --expose-gc src/07-memory-and-performance/mem-leak-demo.js
//
// 模拟两类典型泄漏，并展示如何用 heap 快照定位：
//  (1) 意外的全局引用（忘记 const/let，挂到 global）
//  (2) 闭包持有大对象
// 这里构造泄漏，再打印 heapUsage 让你看到"只涨不跌"。

const leak = [];          // 模块级数组：持续 push 即泄漏
function addLeak() {
  // 闭包捕获大 buffer
  const big = Buffer.alloc(1 << 20);  // 1MB
  leak.push({ big, ts: Date.now() });
}

function snapshot(tag) {
  global.gc();
  const m = process.memoryUsage();
  console.log(`[${tag}] heapUsed=${(m.heapUsed >> 20)}MB external=${(m.external >> 20)}MB`);
}

snapshot('start');
for (let i = 0; i < 50; i++) addLeak();   // 泄漏 50MB
snapshot('after 50 pushes');
// 即使不再 addLeak，leak 数组仍被引用 → GC 无法回收
setTimeout(() => snapshot('after idle (仍占用)'), 100);
