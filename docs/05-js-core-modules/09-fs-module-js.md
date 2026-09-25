# 05-09 fs 模块（JS 层）：从回调到 Promise

> 本章目标：理解 `fs` 模块在 JS 层如何组织——回调式 API、Promise 式（`fs.promises`）、同步式（`fs.readFileSync`），以及它们如何最终落到 libuv 线程池（回顾 02-04、04-05）。

> 注意：crypto 相关内容在 `05-08-crypto`（见 05-08 原编号已用于 crypto，本章为 fs JS 层，对应 PLAN 中 `08-fs-module-js`）。

---

## 1. 三层 API

| 风格 | 例子 | 执行 |
|------|------|------|
| 回调 | `fs.readFile(path, cb)` | 异步，走 libuv 线程池 |
| Promise | `await fs.promises.readFile(path)` | 同上，Promise 包装 |
| 同步 | `fs.readFileSync(path)` | 阻塞主线程（在调用线程同步读） |

```js
const fs = require('fs');
// 回调
fs.readFile('a.txt', 'utf8', (err, data) => { if (err) throw err; });
// Promise
await fs.promises.readFile('a.txt', 'utf8');
// 同步（阻塞事件循环！）
const data = fs.readFileSync('a.txt', 'utf8');
```

---

## 2. 回调式如何落到线程池

（回顾 04-05、02-04）

`fs.readFile` 的 JS 层在 `lib/fs.js`：
```js
function readFile(path, options, cb) {
  // 1) 标准化参数
  // 2) 调 binding.readFile → C++ FSReqCallback
  // 3) C++ 层 uv_fs_read 在线程池执行 pread
  // 4) 完成后 WorkComplete → after 回调 → 用户 cb
}
```

C++ 绑定（`src/node_file.cc`）把请求包成 `FSReqCallback`（继承 AsyncWrap），提交 `uv_queue_work`（02-02）。线程池完成 → `WorkComplete` → `MakeCallback` → 用户回调（04-05 详述）。

---

## 3. Promise 化的实现

`fs.promises` 用 `util.promisify` 把回调 API 包装成 Promise。底层仍是线程池异步。Node 14+ 也提供了原生 `fs/promises` 模块，避免加载整个 `fs`。

```js
const { readFile } = require('fs/promises');
const data = await readFile('a.txt', 'utf8');   // 底层同线程池路径
```

---

## 4. 同步变体的代价

`fs.readFileSync` **不走 libuv 线程池**，而是直接在调用线程阻塞 `pread`：

```c
// src/node_file.cc :: ReadFileSync
int err = uv_fs_read(nullptr, &req, fd, buf, len, offset, nullptr);
// 同步等待完成，主线程卡住直到磁盘返回
```

后果：在事件循环线程调用会**阻塞所有 I/O**（定时器、网络、其他请求）。只适合启动期配置加载、CLI 工具，绝不在服务请求路径使用。

---

## 5. 流式文件 I/O

大文件用 `fs.createReadStream` / `createWriteStream`（继承 Stream，见 05-05）：

```js
fs.createReadStream('big.iso').pipe(fs.createWriteStream('copy.iso'));
// 边读边写，内存恒定，底层仍走线程池读/写
```

`fs.copyFile` 在支持的 OS 上用 `copy_file_range` / `sendfile` 零拷贝优化（01-02 提到的 sendfile）。

---

## 6. 文件监听：`fs.watch`

`fs.watch` 底层优先用 OS 的 inotify（Linux）/ FSEvents（macOS）/ ReadDirectoryChangesW（Windows），而非轮询。回调在事件循环中被触发（经 libuv 的 fs 事件 handle）。

---

## 7. 可运行验证

```js
const fs = require('fs');
const { performance } = require('perf_hooks');
const t = performance.now();
fs.readFile(__filename, () => {
  console.log('async read done @', (performance.now()-t).toFixed(1), 'ms');
});
setImmediate(() => console.log('event loop not blocked by fs.readFile'));
// 先打印 "event loop not blocked"，证明异步不阻塞
```

---

## 8. 本章总结

- `fs` 三层 API：回调（线程池）、Promise（包装）、同步（阻塞主线程）。
- 回调/Promise 经 C++ 绑定提交 `uv_queue_work`，线程池完成回调 JS。
- `readFileSync` 直接阻塞 `pread`，服务路径禁用。
- 大文件用流（`pipe`）保持内存恒定；`copyFile` 可能零拷贝。
- `fs.watch` 用 OS 原生文件事件，非轮询。

---

## 9. 思考题

1. `fs.readFileSync` 为什么不走 libuv 线程池？如果它走了线程池，语义会变成什么样？
2. 在服务请求处理函数里调用 `fs.readFileSync` 可能引发什么线上事故？为什么？
3. `fs.promises.readFile` 和 `fs.readFile` 在底层执行路径上有什么相同与不同？
