# 05-10 process 与 cluster：进程模型与多核利用

> 本章目标：理解 Node 的进程级 API（`process`）与多进程扩展（`cluster`）——前者是 JS 与运行时/OS 的接口，后者是在单进程事件循环之外利用多核的标准方案。

---

## 1. `process` 对象

`process` 是 Node 全局对象，提供对当前 Node 进程的控制与信息。它**不是** libuv 对象，而是 Node C++ 层（`src/node_process.cc` + `lib/internal/process/`）暴露给 JS 的接口。

### 1.1 关键属性

| 属性 | 说明 |
|------|------|
| `process.pid` | 进程 ID（OS 分配） |
| `process.argv` | 启动参数数组（[node, script, ...args]） |
| `process.env` | 环境变量（注意：修改只影响当前进程） |
| `process.cwd()` / `chdir()` | 当前工作目录 |
| `process.platform` / `arch` | 平台 / 架构 |
| `process.uptime()` | 进程运行时长 |
| `process.memoryUsage()` | 内存统计（见 07-01） |
| `process.versions` | Node / V8 / libuv 等版本 |
| `process.exitCode` / `exit()` | 退出码 / 强制退出 |

### 1.2 关键方法/事件

```js
process.on('uncaughtException', (err) => { /* 兜底未捕获异常 */ });
process.on('unhandledRejection', (reason) => { /* Promise rejection */ });
process.on('SIGINT', () => { /* Ctrl+C */ });
process.on('exit', (code) => { /* 同步清理，不能异步 */ });

process.nextTick(cb);        // 最高优先级微任务（见 06-01）
process.on('beforeExit', cb); // 事件循环清空但进程未退出
```

`process.nextTick` 虽叫"nextTick"，实际是**微任务**，在各阶段之间清空，优先级高于 Promise（见 06-01）。

---

## 2. 退出机制

```js
process.exit(1);   // 立即终止（不保证 flush 异步 I/O！）
```

注意：`process.exit()` **不会等待**挂起的异步回调/流刷新，可能丢数据。优雅退出应：
```js
server.close(() => process.exit(0));   // 先停监听，等连接关闭
```

---

## 3. `cluster`：多进程利用多核

单进程事件循环只能用 1 个 CPU 核（即使机器有 32 核）。`cluster` 模块让一个主进程（master）fork 多个工作进程（worker），**共享同一端口**，由 OS 内核负载均衡分发连接。

```js
const cluster = require('cluster');
const http = require('http');
const os = require('os');

if (cluster.isPrimary) {
  const cpus = os.cpus().length;
  for (let i = 0; i < cpus; i++) cluster.fork();   // 启动 N 个 worker
  cluster.on('exit', (worker) => {                 // worker 崩了自动重启
    console.log(`worker ${worker.process.pid} died`);
    cluster.fork();
  });
} else {
  http.createServer((req, res) => res.end('ok')).listen(8124);
  // 所有 worker 都 listen 同一端口，OS 分发
}
```

### 3.1 工作原理

```
主进程 (master)
  ├─ 创建 TCP server（bind 端口）
  ├─ fork N 个 worker（child_process）
  ├─ 每个 worker 继承 master 的 server handle
  └─ 连接到达 → master 用 round-robin（或共享 fd）分发给某 worker
        │
   ┌────┴─────┐
worker1    worker2   ... workerN   （各自独立事件循环、独立 V8 Isolate）
```

- 早期 Node 用 `round-robin` 主进程分发（master 收连接再发给 worker）。
- 现代用**共享 socket fd**（worker 直接 accept），由 OS 内核做负载均衡，性能更好。
- 每个 worker 是**独立进程**：独立 V8 Isolate、独立事件循环、独立内存。一个崩了不影响其他（自动重启）。

### 3.2 cluster vs worker_threads

| 维度 | cluster | worker_threads |
|------|---------|----------------|
| 隔离 | 进程级（独立内存，崩溃隔离强） | 线程级（共享内存，崩溃可能拖垮进程） |
| 启动成本 | 高（fork + 新 V8 实例） | 低 |
| 通信 | IPC（序列化） | MessagePort（可零拷贝/共享内存） |
| 适用 | 多核 HTTP 服务、强隔离 | CPU 密集计算、高频通信 |

经验：**HTTP 服务多核 → cluster**（或容器/PM2 多实例）；**单进程内并行计算 → worker_threads**。

---

## 4. `child_process` 简述（详 09-03）

`cluster` 底层就是 `child_process.fork`。更通用的子进程 API：

```js
const { fork, spawn, exec, execFile } = require('child_process');
const child = fork('./worker.js');           // 通信友好的 fork（带 IPC channel）
child.on('message', (m) => {});
child.send({ cmd: 'ping' });

const p = spawn('ls', ['-la']);              // 流式 stdout/stderr
p.stdout.on('data', d => console.log(d.toString()));
```

`spawn`/`exec` 是阻塞外部命令的核心；`fork` 是 Node 进程间通信的便捷封装（建立 IPC，见 09-03 专题）。

---

## 5. 与事件循环/OS 的关系

- `process` 是 JS 通往 OS/运行时的桥梁（信号、环境变量、退出、内存）。
- `cluster` 把"多核"问题交给 OS 内核 + 多进程解决，本质是**绕过**单进程事件循环的限制。
- 信号（`SIGINT`/`SIGTERM`）经 libuv 的 signal fd 进入事件循环（见 02-06），触发 JS 的 `process.on('SIGINT')`。

---

## 6. 可运行验证

```bash
# 观察 cluster 起的进程数
node -e "
const cluster=require('cluster'); const os=require('os');
if(cluster.isPrimary){for(let i=0;i<os.cpus().length;i++)cluster.fork();}
else{console.log('worker',process.pid);setInterval(()=>{},1000);}
"
ps -eLf | grep node | wc -l   # 主 + 各 worker
```

---

## 7. 本章总结

- `process` 是 JS 通往运行时/OS 的全局接口（pid/env/信号/内存/退出）。
- `process.exit()` 不等待异步刷新，优雅退出应 `server.close` 后再退。
- `cluster` 用主进程 fork 多 worker 共享端口，由 OS 负载均衡，利用多核；worker 崩溃自动重启。
- cluster 适合 HTTP 多核，worker_threads 适合进程内并行；二者互补。

---

## 8. 思考题

1. 为什么单进程 Node 服务即使部署在 32 核机器上，默认也只能用 1 核？`cluster` 如何从 OS 层面解决？
2. 为什么 `cluster` 的 worker 崩了不会影响其他 worker？代价是什么（相比 worker_threads）？
3. `process.exit()` 为什么可能导致数据丢失？什么场景下你会刻意避免用它？
