// 文件：src/01-os-layer/thread-pool.js
// 对应文章：01-03 线程/线程池 · 01-04 系统调用边界
// 运行：node src/01-os-layer/thread-pool.js
//
// 印证"Node 用 libuv 线程池把阻塞系统调用(如 CPU 密集/老式同步 API)卸载到子线程"：
// 用 crypto.pbkdf2(同步会卡住主线程) 在 libuv 线程池并行，主线程仍响应。

const crypto = require('crypto');
const { performance } = require('perf_hooks');
const t0 = performance.now();

// 不 await，让它们排队进 libuv 线程池并行执行
for (let i = 0; i < 4; i++) {
  crypto.pbkdf2('pw', 'salt', 1e4, 32, 'sha512', () => {
    console.log(`任务 ${i} 完成，累计 ${(performance.now() - t0).toFixed(0)}ms`);
  });
}

// 主线程立刻打印，证明未被阻塞
setImmediate(() => console.log(`主线程事件循环未被阻塞 (${performance.now() - t0 | 0}ms)`));
