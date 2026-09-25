// 文件：src/02-libuv/timer-clamp.js
// 对应文章：02-05 定时器：libuv 如何实现 setTimeout/setInterval
// 运行：node src/02-libuv/timer-clamp.js
//
// 印证 libuv 对 timers 的"最小超时"处理：setTimeout(fn, 0) 实际约 1ms，
// 而嵌套超时(>=5层)会被浏览器/Node 钳制到 ≥4ms。

const { performance } = require('perf_hooks');

function measure(delay) {
  const t0 = performance.now();
  setTimeout(() => {
    console.log(`setTimeout(${delay}) 实际 ≈ ${(performance.now() - t0).toFixed(2)}ms`);
  }, delay);
}

measure(0);
measure(1);
measure(10);

// 嵌套超时演示 4ms 钳制
let depth = 0;
const t = performance.now();
(function nest() {
  if (depth++ < 6) return setTimeout(nest, 0);
  console.log(`嵌套 setTimeout(0)×6 末层 ≈ ${(performance.now() - t).toFixed(1)}ms (≈ 每层被钳制)`);
})();
