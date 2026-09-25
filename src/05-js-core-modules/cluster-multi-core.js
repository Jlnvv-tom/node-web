// 文件：src/05-js-core-modules/cluster-multi-core.js
// 对应文章：05-js-core-modules/10-process-cluster.md（或 12-cluster-module.md）
// 运行：node src/05-js-core-modules/cluster-multi-core.js
// 观察：ps 看到 1 个 master + N 个 worker；多次 curl 可见 pid 轮换
//
// 用 cluster 把 HTTP 服务铺满所有 CPU 核，worker 崩溃自动重启。

const cluster = require('cluster');
const http = require('http');
const os = require('os');

if (cluster.isPrimary) {
  const cpus = os.cpus().length;
  console.log(`master ${process.pid} fork ${cpus} workers`);
  for (let i = 0; i < cpus; i++) cluster.fork();
  cluster.on('exit', (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died (${signal || code}), restart...`);
    cluster.fork();
  });
} else {
  http.createServer((req, res) => {
    res.end('pid ' + process.pid + '\n');
  }).listen(8124, () => {
    console.log(`worker ${process.pid} listening on 8124`);
  });
}
