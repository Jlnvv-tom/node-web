// 文件：src/03-v8-engine/gc-probe.js
// 对应文章：03-03 V8 垃圾回收(Orinoco) / 07-01 V8 堆与 GC
// 运行：node --expose-gc src/03-v8-engine/gc-probe.js
// 注意：必须带 --expose-gc 才能手动触发 GC
//
// 观察：新生代(scavenge) vs 老生代(mark-sweep/compact)对大对象的回收行为。

function makeGarbage(n) {
  // 制造大量对象占用堆
  const arr = [];
  for (let i = 0; i < n; i++) arr.push({ i, s: 'x'.repeat(16) });
  return arr;
}

// 注册 GC 回调：每次 GC 打印一次
const { performance } = require('perf_hooks');
const start = performance.now();

console.log('初始堆:', JSON.stringify(process.memoryUsage().heapUsed >> 20) + ' MB');

// 制造老生代压力
let keep = [];
for (let i = 0; i < 20; i++) keep.push(makeGarbage(200000));

console.log('加压后堆:', (process.memoryUsage().heapUsed >> 20) + ' MB');
console.log('手动触发 GC...');
global.gc();
console.log('GC 后堆  :', (process.memoryUsage().heapUsed >> 20) + ' MB');
console.log('耗时(ms) :', (performance.now() - start).toFixed(1));
