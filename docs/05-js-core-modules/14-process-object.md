# 05-14 process 对象：运行时访问入口

> 本章目标：独立展开 `process` 对象——它是 JS 通往 Node 运行时与操作系统的桥梁。结合 05-10 的 cluster 视角，这里聚焦 process 的构建、事件与退出语义。

---

## 1. process 是什么

`process` 是 Node 的全局对象，**不是** libuv 对象，而是 Node C++ 层暴露给 JS 的接口（`src/node_process.cc` + `lib/internal/process/`）。它是 JS 与"运行时/OS"之间的唯一官方通道。

---

## 2. 构建：如何暴露给 JS

（回顾 00-03、04-01）

启动链路中，`lib/internal/bootstrap/node.js` 调用 C++ 绑定 `internalBinding('process')` 拿到原始 process 对象，再在 JS 层补充方法，最后挂到 `globalThis.process`：

```js
// lib/internal/bootstrap/node.js （简化）
const process = require('internal/process');   // C++ binding 提供核心
process.argv = [...];                           // 设置启动参数
process.env = createEnvProxy();                 // 环境变量代理
// ... 挂 nextTick / 信号监听 / 退出逻辑
global.process = process;
```

`process.nextTick` 在 JS 层实现为"把回调推入当前 tick 的 nextTickQueue"，由 `InternalCallbackScope` 在阶段间清空（见 06-01）。

---

## 3. 关键事件

| 事件 | 触发时机 | 用途 |
|------|---------|------|
| `exit` | 进程即将退出（同步清理） | 关闭句柄、flush 同步日志 |
| `beforeExit` | 事件循环清空但进程未退 | 可再排任务阻止退出 |
| `uncaughtException` | 未捕获异常 | 兜底（谨慎使用） |
| `unhandledRejection` | Promise rejection 未处理 | 兜底 |
| `SIGINT` / `SIGTERM` | 收到信号 | 优雅关闭（Ctrl+C） |

```js
process.on('SIGINT', () => {
  server.close(() => process.exit(0));   // 优雅退出
});
```

> 注意：`exit` 回调内**不能做异步操作**（进程即将结束，回调不会等待 I/O 完成）。

---

## 4. 退出语义

```js
process.exitCode = 1;     // 设置退出码，事件循环清空后退出
process.exit(1);          // 立即终止，不等待异步 I/O flush
```

`process.exit()` 是"硬退出"——不等待挂起的 `fs.write`/`socket` 刷新，可能丢数据（回顾 05-10 强调的优雅退出）。

---

## 5. 与事件循环的关系

- `process.nextTick` 是微任务（06-01），在阶段间清空，最高优先级。
- 信号（`SIGINT`）经 libuv 的 signalfd/kqueue 进入 poll 阶段，触发 JS 监听（见 02-06、09-02）。
- `beforeExit` 在 `uv_run` 即将返回（无更多任务）时触发，可在此时再排任务阻止退出。

---

## 6. 常见误用

1. 在 `exit` 事件里写异步日志 → 丢失。
2. 用 `process.exit()` 代替优雅关闭 → 丢在途请求/数据。
3. 滥用 `uncaughtException` 吞掉所有错误 → 进程处于未知状态继续运行，更危险。推荐让进程退出并由外部（PM2/K8s）重启。

---

## 7. 可运行验证

```js
process.on('beforeExit', (code) => console.log('beforeExit', code));
process.on('exit', (code) => console.log('exit', code));
setTimeout(() => console.log('timeout fired'), 100);
// 输出：timeout fired → beforeExit 0 → exit 0
```

---

## 8. 本章总结

- `process` 是 JS→运行时/OS 的官方通道，由 bootstrap/node.js 构建并挂到 global。
- 关键事件：`exit`（同步清理）、`beforeExit`、`uncaughtException`、`SIGINT`。
- `process.exit()` 硬退出不 flush 异步，应优先优雅关闭。
- nextTick 是微任务；信号经 libuv 进事件循环；beforeExit 可阻止退出。

---

## 9. 思考题

1. 为什么 `process.exit()` 会导致数据丢失，而 `server.close()` 再 `exit` 更可靠？底层差异是什么？
2. `exit` 事件回调里为什么不能做异步 I/O？如果需要 flush 日志怎么办？
3. 为什么 Node 官方不推荐在 `uncaughtException` 里"吞掉"错误继续运行？什么才是合理用法？
