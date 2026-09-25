// 文件：src/05-js-core-modules/worker-threads-demo.js
// 对应文章：05-07 worker_threads：多线程 JS 执行
// 运行：node src/05-js-core-modules/worker-threads-demo.js
//
// 主线程派生一个 Worker，通过 parentPort 收发消息。
// 演示：CPU 密集任务放到 Worker，不阻塞主线程事件循环。

const { Worker } = require('worker_threads');

const worker = new Worker(`
  const { parentPort } = require('worker_threads');
  // 模拟 CPU 密集：求和
  parentPort.on('message', (n) => {
    let s = 0; for (let i = 1; i <= n; i++) s += i;
    parentPort.postMessage(s);
  });
`, { eval: true });

worker.on('message', result => {
  console.log('Worker 返回 1..1e7 求和 =', result);
  worker.terminate();
});

// 主线程事件循环不被阻塞：这条 timer 仍会准时触发
setTimeout(() => console.log('主线程事件循环仍然活着 ✅'), 50);

worker.postMessage(10_000_000);
