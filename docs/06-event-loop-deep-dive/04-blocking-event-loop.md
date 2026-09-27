# 06-04 阻塞事件循环：CPU 密集型任务的危害与解决方案

> 本章目标：理解事件循环为什么会被"阻塞"、阻塞后会有什么后果、以及如何用 Worker Threads / 子进程拆分 CPU 密集型任务。

## 导读

Node.js 的事件循环是**单线程**的。这意味着：

- 如果某个回调函数执行了 500ms，那么这 500ms 内事件循环完全停转
- 所有其他定时器、I/O 回调、新连接全部排队等待
- HTTP 服务器无法响应新请求，WebSocket 无法收发消息

这不是 Node.js 的"bug"，而是其并发模型的根本特征——**事件循环适合 I/O 密集型任务，不适合 CPU 密集型任务**。

## 事件循环阻塞的直观演示

```javascript
// block-demo.js
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.url === '/heavy') {
    // 模拟 CPU 密集计算：计算 40 亿次加法
    let sum = 0;
    for (let i = 0; i < 4e9; i++) sum += i;
    res.end(`sum = ${sum}\n`);
  } else {
    res.end('ok\n');
  }
});

server.listen(3000, () => console.log('http://localhost:3000'));
```

```bash
# 终端 1：启动服务
node block-demo.js

# 终端 2：发起重计算请求
curl http://localhost:3000/heavy   # 需要数秒才返回

# 终端 3：同时发起普通请求
curl http://localhost:3000/        # 也要等到 /heavy 完成后才返回！
```

终端 3 的请求被阻塞了——这就是事件循环阻塞的直观后果。

## 根因：uv_run 是单线程的

```
// deps/uv/src/unix/core.c — uv_run() 简化

while (uv__loop_alive(loop)) {
    uv__update_time(loop);
    uv__run_timers(loop);       // 定时器回调
    uv__run_pending(loop);       // pending 回调
    uv__run_idle(loop);
    uv__run_prepare(loop);
    uv__io_poll(loop, timeout);  // I/O 回调 ← 如果回调里跑了 500ms，下面全部排队
    uv__run_check(loop);         // setImmediate 回调
    uv__run_closing_handles(loop);
}
```

`uv__io_poll` 拿到就绪的 I/O 事件后，**同步调用**对应的 JS 回调。回调不返回，事件循环就不往下走。

## 解决方案 1：Worker Threads

```javascript
// main.js — 主线程
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

if (isMainThread) {
  const worker = new Worker(__filename, {
    workerData: { n: 4e9 }
  });
  worker.on('message', (msg) => console.log('result:', msg));
  worker.on('error', (err) => console.error('error:', err));
} else {
  // Worker 线程：CPU 密集计算
  let sum = 0;
  for (let i = 0; i < workerData.n; i++) sum += i;
  parentPort.postMessage(sum);
}
```

**原理**：`worker_threads` 创建真正的操作系统线程（通过 `uv_thread_create`），各自拥有独立的 V8 Isolate 和事件循环。CPU 计算在 Worker 线程跑，不阻塞主线程事件循环。

**适用场景**：纯计算任务（加解密、图像处理、大数据排序），不需要共享 DOM/窗口对象。

> 📖 源码入口：`lib/worker_threads.js` → `lib/internal/worker.js` → `src/node_worker.cc` → `uv_thread_create`

## 解决方案 2：子进程（child_process）

```javascript
const { fork } = require('child_process');

if (process.argv[2] !== 'child') {
  const child = fork(__filename, ['child']);
  child.on('message', (msg) => console.log('result:', msg));
  child.send({ n: 4e9 });
} else {
  process.on('message', (msg) => {
    let sum = 0;
    for (let i = 0; i < msg.n; i++) sum += i;
    process.send(sum);
  });
}
```

**原理**：`fork()` 创建全新的进程（`uv_spawn`），拥有独立的内存空间和事件循环。进程间通过 IPC pipe 通信。

**适用场景**：需要隔离的场景（插件系统、不稳定代码沙箱）、可以利用多核的独立服务。

> 📖 源码入口：`lib/child_process.js` → `lib/internal/child_process.js` → `src/node_child_process.cc` → `uv_spawn`

## 解决方案 3：任务分片（yield to event loop）

```javascript
// 将大任务拆成小块，每块跑完后用 setImmediate 让出事件循环
function chunkedCompute(total, chunkSize, callback) {
  let i = 0, sum = 0;
  function nextChunk() {
    const end = Math.min(i + chunkSize, total);
    for (; i < end; i++) sum += i;
    if (i < total) {
      setImmediate(nextChunk); // 让出事件循环
    } else {
      callback(sum);
    }
  }
  nextChunk();
}

chunkedCompute(4e9, 1e7, (result) => console.log('sum =', result));
```

**优点**：无需多线程/多进程，单线程内"公平调度"。
**缺点**：总耗时更长（每次 setImmediate 有微小开销），不适合真正计算密集的场景。

## 解决方案 4：N-API 原生模块

将 CPU 密集部分用 C/C++ 编写为 N-API addon，在 C 层使用 `napi_create_async_work`（底层 `uv_queue_work`）将计算放到 libuv 线程池，完成后回调主线程。

```c
// addon.c
napi_value Compute(napi_env env, napi_callback_info info) {
  // ...参数解析...
  napi_create_async_work(env, NULL, name, execute_cb, complete_cb, data, &work);
  napi_queue_async_work(env, work);
  return NULL;  // 返回 Promise，C 层异步执行
}
```

**适用场景**：已有 C/C++ 计算库需要集成、性能要求极高。

## 方案对比

| 方案 | 隔离级别 | 通信成本 | 适用场景 | 复杂度 |
|------|----------|----------|----------|--------|
| Worker Threads | 线程 | 低（SharedArrayBuffer） | 纯计算 | 中 |
| 子进程 | 进程 | 高（IPC 序列化） | 需要完全隔离 | 低 |
| 任务分片 | 无 | 无（同一线程） | 轻量、可拆分任务 | 低 |
| N-API | 线程池 | 中（napi 调用） | 已有 C 库 / 极致性能 | 高 |

## 总结

| 要点 | 说明 |
|------|------|
| 事件循环是单线程的 | 一个回调阻塞，全部停转 |
| I/O 密集 → 事件循环 | 非阻塞 I/O + 回调，Node.js 的强项 |
| CPU 密集 → Worker / 子进程 | 不要在事件循环里做重计算 |
| Worker Threads 共享内存 | SharedArrayBuffer + Atomics，适合数据并行 |
| 子进程完全隔离 | 安全但通信开销大 |

## 思考题

1. `setImmediate(fn)` 能解决 CPU 密集型任务阻塞吗？为什么？
2. Worker Threads 共享一块 `SharedArrayBuffer`，需要加锁吗？用什么加？
3. `uv_queue_work` 把任务交给线程池后，主线程事件循环会阻塞吗？为什么？