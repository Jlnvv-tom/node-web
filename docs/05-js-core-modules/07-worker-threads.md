# 05-07 worker_threads：多线程 JS 执行

> 本章目标：理解 Node 如何在**保持单线程事件循环模型的同时**，通过 worker_threads 提供真正的并行计算能力，以及它与 child_process 的本质区别。

---

## 1. 为什么需要 worker_threads

Node 的事件循环是单线程的。CPU 密集任务（加密、图像处理、大数组计算）会**阻塞主线程**，让所有 I/O 回调、定时器都卡住。

解决方案对比：

| 方案 | 隔离级别 | 通信成本 | 内存 |
|------|---------|---------|------|
| `child_process.fork` | 独立进程 | 高（序列化 + IPC） | 高（独立 V8 实例） |
| `worker_threads` | 同进程内线程 | 低（可传 ArrayBuffer/MessageChannel，零拷贝） | 低（共享进程内存，独立 V8 Isolate） |

`worker_threads` 是为"**在同一进程内并行跑 JS**"设计的——每个 worker 有**独立的 V8 Isolate、独立事件循环、独立 libuv loop**，但共享同一进程地址空间。

---

## 2. 基本用法

```js
// main.js
const { Worker } = require('worker_threads');

const worker = new Worker(`
  const { parentPort } = require('worker_threads');
  parentPort.postMessage('hello from worker');
  parentPort.on('message', (m) => console.log('worker got:', m));
`, { eval: true });

worker.on('message', (m) => console.log('main got:', m));
worker.postMessage('hi from main');

// 有结果后
worker.terminate();   // 或 worker 内 parentPort.close()
```

```js
// 更常见：引用独立文件
const worker = new Worker('./worker.js');
```

---

## 3. 通信机制

### 3.1 `MessagePort` / `postMessage`

每个 Worker 持有一个 `MessagePort`。`worker.postMessage(value, transferList)`：

- **结构化克隆**：默认把 `value` 深拷贝一份传给 worker（类似 JSON 但支持更多类型：Map/Set/TypedArray/Error 等）。
- **Transferable**：`transferList` 里列出的 `ArrayBuffer` / `MessagePort` 等会被**转移所有权**（零拷贝，原侧失效）。

```js
const { Worker } = require('worker_threads');
const sab = new SharedArrayBuffer(1024);
const worker = new Worker('./w.js');
worker.postMessage({ buf: sab }, [sab]);   // 转移 sab 所有权
// 转移后，main 侧不能再访问 sab（除非用 SharedArrayBuffer 而非转移）
```

### 3.2 `SharedArrayBuffer`（真正共享内存）

用 `SharedArrayBuffer` + `Atomics` 可实现**无拷贝共享内存**（多线程读写同一块内存，需原子操作防竞态）：

```js
const sab = new SharedArrayBuffer(4);
const view = new Int32Array(sab);
Atomics.store(view, 0, 42);   // 原子写
// worker 侧 Atomics.load(view, 0) 读到 42
```

> ⚠️ `SharedArrayBuffer` 因 Spectre 漏洞，需 `COOP/COEP` 响应头才能在主线程浏览器启用；Node 中默认可用。

---

## 4. 内部架构（源码视角）

文件：`src/node_worker.cc`、`lib/internal/worker.js`、`lib/worker_threads.js`

```
主线程                                          Worker 线程
──────                                         ────────
new Worker(file)
   │
   ├─ 创建子线程 (uv_thread_create)
   │
   ├─ 主线程侧: Worker 对象 (EventEmitter)
   │     └─ 持有 MessagePort 一端
   │
   ▼
[子线程启动]
   │
   ├─ 创建独立 Environment (新 V8 Isolate)
   │     └─ 独立 event loop / 独立 libuv loop
   │
   ├─ 加载 worker.js 作为入口模块
   │
   ├─ parentPort = 另一端的 MessagePort
   │
   ▼
两个 Environment 通过 libuv 的 async / 管道消息通道通信
```

关键点：
- 每个 worker 是一个**操作系统线程**（pthread），不是进程。
- 它有**自己的 V8 Isolate**，因此无法共享普通 JS 对象（只能传克隆/转移/SharedArrayBuffer）。
- 它有自己的事件循环——worker 内部也能用 `fs`、定时器、`EventEmitter` 等。
- 主 worker 间通过底层管道（libuv `uv_pipe_t`）传递消息，由 Node C++ 层驱动 `MessagePort` 的 `message` 事件。

---

## 5. 与主事件循环的关系

- **主线程的事件循环不会被 worker 阻塞**：worker 在另一个 OS 线程跑，做重计算时主线程照常处理 I/O。
- **但 worker 内部也是单线程**：worker 里跑 CPU 密集同样会阻塞该 worker 自身的事件循环。要进一步并行，开多个 worker。
- `worker_threads` 通常配合**线程池模式**：预建 N 个 worker，任务排队分发。

---

## 6. 与 child_process 的区别（再强调）

| 维度 | worker_threads | child_process.fork |
|------|----------------|-------------------|
| 隔离 | 同进程内线程（独立 Isolate） | 独立 OS 进程 |
| 启动成本 | 低 | 高（fork + 新 V8 实例） |
| 内存 | 共享进程内存 | 完全独立 |
| 通信 | MessagePort（可零拷贝/共享内存） | IPC（序列化） |
| 崩溃影响 | worker 崩可能拖垮进程 | 进程独立，互不影响 |
| 适用 | CPU 密集、需频繁通信 | 需强隔离、跑不同程序 |

---

## 7. 适用场景

✅ 适合：
- CPU 密集计算（加密、压缩、图像处理、规约）。
- 需要低延迟、高频通信的并行任务。
- 单进程内多核利用。

❌ 不适合：
- I/O 密集（主线程异步已经够用，加 worker 反而增加复杂度）。
- 需要强隔离（一个崩了不影响其他的）→ 用 child_process。
- 共享可变状态复杂（多线程竞态）→ 谨慎使用 SharedArrayBuffer。

---

## 8. 可运行验证

```js
// main.js
const { Worker } = require('worker_threads');
const w = new Worker(`
  const { parentPort } = require('worker_threads');
  let sum = 0;
  for (let i = 0; i < 1e8; i++) sum += i;   // 重计算
  parentPort.postMessage(sum);
`, { eval: true });

w.on('message', (s) => console.log('result:', s));
console.log('main thread not blocked, doing other work...');
```

主线程的 `console.log` 立即打印，重计算在 worker 线程进行——验证了并行性。

---

## 9. 本章总结

- `worker_threads` 在同一进程内创建独立 OS 线程，每个有独立 V8 Isolate + 独立事件循环。
- 通信靠 `MessagePort`：默认结构化克隆，可用 transferList 零拷贝转移，或用 SharedArrayBuffer 真共享内存。
- worker 不阻塞主线程事件循环，但 worker 内部仍是单线程。
- 相比 child_process：启动快、内存共享、通信成本低，但隔离弱。
- 适用 CPU 密集 + 高频通信；不适用需强隔离或纯 I/O 场景。

---

## 10. 思考题

1. 为什么说 worker 间"无法共享普通 JS 对象"？要共享状态必须用哪两种机制？
2. `transferList` 转移 ArrayBuffer 后，发送方为什么不能再访问它？这与 SharedArrayBuffer 有何不同？
3. 在 worker 里写 `setTimeout` 和 `fs.readFile` 能用吗？为什么？它们跑在哪个事件循环上？

---

## 附：可运行示例

> 配套验证脚本见 `src/05-js-core-modules/worker-threads-demo.js`
> Worker 跑 CPU 密集任务不阻塞主线程
