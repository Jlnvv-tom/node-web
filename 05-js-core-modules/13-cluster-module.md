# 05-13 cluster 模块：多进程负载均衡

> 本章目标：深入理解 `cluster` 模块的内部机制——master/worker 模型、共享端口、连接分发、故障重启。这是对 05-10 中 cluster 部分的独立展开。

---

## 1. 为什么需要 cluster

（回顾 05-10）

单进程事件循环只能利用 1 个 CPU 核。在多核机器上，要让 Node 服务吃满所有核，标准方案是起多个进程。`cluster` 模块封装了"主进程 fork 多 worker + 共享端口"的模式。

---

## 2. 两种连接分发模式

### 模式 A：round-robin（旧版默认）
- master 进程 `listen` 端口，接收所有连接。
- 每来一个连接，master 用 round-robin 选一个 worker，通过 IPC 把 fd 发给它。
- 缺点：master 成瓶颈，且跨进程传 fd 有开销。

### 模式 B：共享 socket（现代默认）
- master 创建 server 并 bind 端口，然后 fork worker。
- worker 继承 server 的 fd，**各自直接 `accept`**。
- 内核负责把新连接均衡分发给某个 worker（基于 socket 队列）。
- 性能更好，master 不再经手每个连接。

Node 根据平台自动选择；Windows 等无 `SO_REUSEPORT` 的用 round-robin 变体。

---

## 3. 源码走读（概念）

```js
// lib/cluster.js （简化）
if (cluster.isPrimary) {
  for (let i = 0; i < numCPUs; i++) fork();   // 内部调 child_process.fork
} else {
  // worker 内：cluster 已建立 server handle 继承
  server.listen(8124);   // 实际 listen 的是继承来的 fd，非新 bind
}
```

- `cluster.fork()` 底层 = `child_process.fork` + 设置 `NODE_UNIQUE_ID` 环境变量，让子进程进入 worker 分支。
- worker 的 `server.listen(port)` 检测到已继承 fd 时，复用而非新建。
- worker 间通过 IPC 传递 `act: 'newconn'` 消息做连接分发（round-robin 模式）。

---

## 4. 故障与重启

```js
cluster.on('exit', (worker, code, signal) => {
  console.log(`worker ${worker.process.pid} died (${signal || code})`);
  cluster.fork();   // 自动拉起新 worker
});
```

- worker 崩溃不影响其他 worker（进程级隔离，回顾 05-10）。
- 自动重启保证可用性；配合负载均衡，用户无感知。
- 注意：崩溃瞬间的在途请求会失败，需客户端重试或反向代理兜底。

---

## 5. 与 PM2 / 容器的关系

- **PM2**：在 cluster 之上提供更多（日志聚合、零停机重载、监控）。可用 `pm2 start app.js -i max` 自动多核。
- **容器/K8s**：现代部署常用"每容器单进程 + 多副本"，把多核扩展交给编排层，而非进程内 cluster。两种方式不冲突，可组合。

---

## 6. 注意点

- worker 间**不共享内存**（独立 V8 Isolate）。共享状态需外部存储（Redis）或 IPC 传递。
- session/缓存默认每 worker 一份，需粘性会话或集中存储。
- `process.env.NODE_UNIQUE_ID` 区分主从，勿手动设置。

---

## 7. 可运行验证

```js
const cluster = require('cluster');
const http = require('http');
const os = require('os');
if (cluster.isPrimary) {
  os.cpus().forEach(() => cluster.fork());
  cluster.on('exit', w => cluster.fork());
} else {
  http.createServer((req, res) => res.end('pid ' + process.pid)).listen(8124);
}
// 多次 curl，可见响应 pid 在不同 worker 间轮换
```

---

## 8. 本章总结

- cluster = master fork N 个 worker，共享端口，利用多核。
- 两种连接分发：round-robin（master 分发 fd）与共享 socket（worker 直接 accept，内核均衡）。
- worker 崩溃自动重启，进程级隔离保证高可用。
- 状态不共享，需外部存储或 IPC；现代部署常配合 PM2 / 容器。

---

## 9. 思考题

1. 共享 socket 模式下，为什么"多个 worker 同时 accept 同一端口"不会冲突？内核如何做负载均衡？
2. worker 崩溃时，正在该 worker 处理的请求会怎样？如何在架构上兜底？
3. 既然有 cluster，为什么现代部署仍常用"单进程多副本容器"而非进程内 cluster？两者如何取舍？
