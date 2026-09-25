# 05-05 Streams 源码解读

> 本章目标：理解 Node 流式处理的骨架——`Stream` 基类、`Readable` / `Writable` / `Duplex` 的模式，以及背压（backpressure）机制。

---

## 1. 为什么需要 Stream

一次性 `fs.readFile` 把整个文件读进内存，对大文件不可行。Stream 让数据**边产生边消费**，内存占用恒定。所有 I/O 对象（`fs.ReadStream`、`process.stdin`、`http.IncomingMessage`、`net.Socket`）都是流。

源码：`lib/stream.js`、`lib/internal/streams/`（实现）、`lib/_stream_readable.js`、`lib/_stream_writable.js`、`lib/_stream_duplex.js`。

---

## 2. 四种流

| 类型 | 说明 | 例子 |
|------|------|------|
| `Readable` | 只可读 | `fs.createReadStream`、`process.stdin`、`http` 请求体 |
| `Writable` | 只可写 | `fs.createWriteStream`、`process.stdout`、`http` 响应 |
| `Duplex` | 双向 | `net.Socket`、`tls.TLSSocket` |
| `Transform` | 双向 + 变换 | `zlib.createGzip`、`crypto.createCipheriv` |

`Duplex` = Readable + Writable；`Transform` 在写入时转换数据再读出。

---

## 3. Readable 的两种模式

```js
// lib/internal/streams/readable.js
const STATE = Symbol('state');   // 每个流有独立状态对象
```

Readable 有两种模式：
- **Flowing 模式**：数据自动推给 `data` 事件消费者（"流动"）。
- **Paused 模式**：必须显式调用 `read()` 拉取数据。

模式切换：
```js
stream.on('data', cb);          // → 进入 flowing
stream.pause();                 // → 回到 paused
stream.resume();                // → 回到 flowing
stream.pipe(writable);          // → flowing
```

---

## 4. `_read` 与数据生产

自定义 Readable 必须实现 `_read()`：

```js
const { Readable } = require('stream');
const r = new Readable({
  read(size) {
    // 有数据时调用 this.push(chunk)
    // 没数据时什么都不做（size 提示期望字节数）
    // push(null) 表示流结束
  }
});
```

`push(chunk)` 把数据放入内部缓冲。若缓冲超过 `highWaterMark`（默认 16KB 对象 / 16KB 字节），`push` 返回 `false`，提示生产者**放慢**——这就是背压的起点。

---

## 5. Writable 与背压

```js
const { Writable } = require('stream');
const w = new Writable({
  write(chunk, encoding, callback) {
    // 处理 chunk，完成后调 callback() 通知可继续
    // 传 err 给 callback 表示写入失败
  }
});
```

`writable.write(chunk)` 返回布尔：
- `true`：缓冲未超 `highWaterMark`，可继续写。
- `false`：缓冲已满，**应暂停写入**，等 `'drain'` 事件再继续。

```js
function writeAll(data, cb) {
  let i = 0;
  function step() {
    while (i < data.length) {
      const ok = w.write(data[i++]);
      if (!ok) {
        w.once('drain', step);   // ★ 背压：等 drain 再写
        return;
      }
    }
    w.end(cb);
  }
  step();
}
```

---

## 6. 背压（Backpressure）机制

背压是 Node 流的核心性能机制——**当消费者慢于生产者时，自动反压让生产者减速，避免内存爆掉**。

```
生产者 (Readable)             消费者 (Writable)
   push(chunk) ──────────▶     接收进缓冲
   缓冲 > hwm? ── 否 ──▶ 继续
        │ 是
        ▼
   push 返回 false
        │
        ▼
   暂停读 / 等待 drain
        │
   'drain' 事件 ──▶ 恢复
```

`pipe` 自动处理背压：
```js
readable.pipe(writable);   // 内部：readable 的 data 事件 → writable.write
                           // 若 write 返回 false → readable.pause()
                           // writable 'drain' → readable.resume()
```
你无需手写背压逻辑，`pipe` 已封装。

---

## 7. `pipe` 的内部逻辑（简化）

```js
Readable.prototype.pipe = function(dest, pipeOpts) {
  // 1) 监听 source 'data' → dest.write(chunk)
  // 2) 监听 source 'end' → dest.end()
  // 3) dest.write 返回 false → source.pause()
  // 4) dest 'drain' → source.resume()
  // 5) 错误处理、优雅关闭
  source.on('data', ondata);
  function ondata(chunk) {
    const ok = dest.write(chunk);
    if (!ok) source.pause();
  }
  dest.on('drain', () => source.resume());
  source.on('end', () => dest.end());
  return dest;
};
```

---

## 8. Object Mode

默认流处理 Buffer/string。设 `objectMode: true` 可传输任意 JS 对象（如 JSON 行、数据库记录）：

```js
const r = new Readable({ objectMode: true, read() { this.push({ id: 1 }); } });
```

此时 `highWaterMark` 按**对象个数**计（默认 16），而非字节。

---

## 9. 与 EventEmitter 的关系

`Stream` 继承 `EventEmitter`。`'data'`、`'end'`、`'error'`、`'drain'`、`'finish'` 等都是事件。这正是 05-04 知识的应用——流本质是"带缓冲协议的特殊事件发射器"。

---

## 10. 可运行验证

```js
const { Readable, Writable } = require('stream');

const r = Readable.from(['a', 'b', 'c']);   // 便捷构造
const w = new Writable({
  write(chunk, enc, cb) {
    console.log('write:', chunk.toString());
    cb();
  }
});
r.pipe(w);
// write: a
// write: b
// write: c
```

---

## 11. 本章总结

- 流分 Readable / Writable / Duplex / Transform，核心是"边产边消、内存恒定"。
- Readable 有 flowing/paused 两模式；`_read` + `push` 生产数据。
- Writable 的 `write` 返回 false 表示缓冲满，应等 `'drain'`——背压机制。
- `pipe` 自动处理背压与生命周期，无需手写。
- 流继承 EventEmitter，事件是其底层通信方式。

---

## 12. 思考题

1. 如果用 `fs.readFile` 读 10GB 文件再 `res.send`，vs 用 `fs.createReadStream().pipe(res)`，内存曲线有何不同？
2. 背压为什么重要？如果没有背压，快生产者 + 慢消费者会导致什么？
3. `pipe` 内部如何保证"源结束→目标也结束"且"错误能正确传播"？

---

## 附：可运行示例

> 配套验证脚本见 `src/05-js-core-modules/stream-pipe-demo.js`
> pipe 背压 pause/resume 实测
