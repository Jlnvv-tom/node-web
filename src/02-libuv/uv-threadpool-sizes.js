// 文件：src/02-libuv/uv-threadpool-sizes.js
// 对应文章：02-02 libuv 线程池实现 / 02-04 文件 I/O 走线程池
// 运行：node src/02-libuv/uv-threadpool-sizes.js
//
// 观测 libuv 默认线程池大小(4)，以及 UV_THREADPOOL_SIZE 环境变量如何扩容。
// 通过并行 fs 读取观察并发上限。

const fs = require('fs');
const { performance } = require('perf_hooks');

console.log('libuv 线程池大小 =', process.env.UV_THREADPOOL_SIZE || '默认 4');

const t0 = performance.now();
const N = 8;
let done = 0;
for (let i = 0; i < N; i++) {
  fs.readFile(__filename, () => {
    if (++done === N) {
      console.log(`${N} 次文件读完成，累计 ${performance.now() - t0 | 0}ms`);
    }
  });
}
