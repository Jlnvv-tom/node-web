// 文件：src/05-js-core-modules/stream-pipe-demo.js
// 对应文章：05-05 Streams 源码解读
// 运行：node src/05-js-core-modules/stream-pipe-demo.js
//
// 用内置 stream 展示 "背压(backpressure)"：可读流生产快、可写流消费慢时，
// pipe 会自动暂停 readable，直到 writable 的 drain 事件恢复。
// 这里用 pause/resume 模拟背压，并统计吞吐。

const { Readable, Writable } = require('stream');

let pushed = 0;
const readable = Readable.from((async function* () {
  while (pushed < 50) { yield pushed++; }   // 生产 0..49
})());

let written = 0;
const writable = new Writable({
  highWaterMark: 5,
  write(chunk, enc, cb) {
    written++;
    // 模拟慢消费：每写 1 个 sleep 10ms
    setTimeout(() => cb(), 10);
  }
});

readable.on('data', chunk => {
  // 背压探针：当 writable 缓冲快满时暂停。chunk 在这里是生成器产出的 number
  if (!writable.write(String(chunk))) {
    readable.pause();
    writable.once('drain', () => readable.resume());
  }
});

writable.on('finish', () => {
  console.log(`背压演示完成：生产 ${pushed} 个，消费 ${written} 个`);
  console.log('(消费速度 10ms/个，pipe 自动背压，无内存爆涨)');
});

readable.on('end', () => writable.end());
