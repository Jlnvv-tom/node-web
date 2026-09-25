// 文件：src/01-os-layer/nonblocking-vs-blocking.js
// 对应文章：01-os-layer/02-file-descriptors.md、01-04 syscall-interface.md
// 运行：node src/01-os-layer/nonblocking-vs-blocking.js
//
// 直观对比：同步阻塞读 vs fs.promises 异步非阻塞读 的耗时差异。
// 说明 Node 如何用"异步 + 线程池/事件循环"避免系统调用卡住主线程。

const fs = require('fs');
const { readFile } = require('fs/promises');
const path = __filename;

async function main() {
  const t0 = Date.now();
  // 串行异步读 3 次：总耗时≈单次（互不阻塞主线程去做其他事）
  await Promise.all([readFile(path), readFile(path), readFile(path)]);
  console.log('async×3:', Date.now() - t0, 'ms');

  const t1 = Date.now();
  // 同步阻塞读 3 次：主线程被系统调用卡住，只能串行完成
  for (let i = 0; i < 3; i++) fs.readFileSync(path);
  console.log('sync×3 :', Date.now() - t1, 'ms');
}

main();
