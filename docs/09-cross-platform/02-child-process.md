# 09-02 child_process：进程创建与 IPC

> 本章目标：理解 `child_process` 模块——它如何在 OS 层面创建子进程、stdio 的五种模式，以及 IPC channel 如何实现父子进程通信。这是"在 Node 里跑外部命令或另一个 Node"的标准工具。

---

## 1. 四种创建方式

| API | 用途 | 通信 |
|-----|------|------|
| `spawn` | 底层，流式 stdout/stderr | 流式，可管道 |
| `exec` | shell 执行命令，缓冲输出 | 一次性回调返回全部输出 |
| `execFile` | 直接执行文件（不 shell） | 同 exec |
| `fork` | 特化的 Node 子进程 | **内置 IPC channel**，可 `send` 对象 |

---

## 2. POSIX 底层：`fork` + `execve`

（回顾 09-01、01-02）

在 POSIX 系统，spawn 的核心是：
```c
pid_t pid = fork();          // 复制当前进程
if (pid == 0) {
  execve(path, argv, envp);  // 子进程替换为目标程序
}
```
Node 在 `src/child_process.cc` 封装这套调用，并处理 stdio 重定向、信号处理、退出事件。

Windows 无 `fork`，改用 `CreateProcess`，Node 在 `deps/uv/src/win/process.c` 实现等价行为。

---

## 3. stdio 选项（回顾 01-02 摘要）

`stdio` 数组每个元素可为：
- `'pipe'`：父子间建立管道（默认，可 `child.stdout.on('data')`）。
- `'inherit'`：子进程直接使用父进程的 stdin/stdout/stderr。
- `'ignore'`：重定向到 `/dev/null`（Windows 的 `NUL`）。
- `'overlapped'`：Windows 专用，FILE_FLAG_OVERLAPPED 异步管道。
- `Stream` / `fd 整数`：复用已有 fd 或流。
- `'ipc'`：建立 IPC channel，启用 `child.send()` 与 `message` 事件（**最多一个 IPC fd**）。

```js
const { spawn } = require('child_process');
const child = spawn('ls', ['-la'], { stdio: ['inherit', 'pipe', 'ignore'] });
// stdin 用父进程、stdout 管道、stderr 丢弃
child.stdout.on('data', d => console.log(d.toString()));
```

---

## 4. IPC channel 与 `fork`

`child_process.fork` 是给 Node 子进程专用的便捷封装，自动建立 IPC：

```js
// parent.js
const { fork } = require('child_process');
const child = fork('./child.js');
child.on('message', (m) => console.log('parent got:', m));
child.send({ hello: 'from parent' });

// child.js
process.on('message', (m) => {
  console.log('child got:', m);   // { hello: 'from parent' }
  process.send({ reply: 'ok' });
});
```

原理：
- `fork` 时在 `stdio` 加一个 `'ipc'` fd，建立 libuv pipe。
- 父进程持 `child.send` 经该 pipe 发送（结构化克隆）。
- 子进程 `process.on('message')` 接收。
- IPC 通道由 libuv 管理，消息经 `uv_pipe_t` 传送，主线程 poll 阶段处理（见 02-06、02-07）。

> 若子进程在注册 `message` 处理器前就有消息到达，IPC channel 会被 `unref()`（不阻止进程退出），避免消息丢失时父进程挂起。

---

## 5. 同步变体：阻塞事件循环

`spawnSync` / `execSync` / `execFileSync` **阻塞主线程**直到子进程结束：

```js
const { execSync } = require('child_process');
const out = execSync('ls -la').toString();   // 主线程卡住这里
```

用途：启动脚本、CLI 工具内嵌执行。缺陷：阻塞事件循环（无法处理其他请求）→ 不要在服务运行时用。

> 注意：`execFileSync` 选项含 `cwd`/`input`/`uid`/`gid`/`timeout`/`killSignal`(默认 SIGTERM)/`maxBuffer`/`encoding`。`timeout` 到期会发 `killSignal` 杀进程。

---

## 6. 与 cluster 的关系（回顾 05-10）

`cluster` 模块底层就是 `child_process.fork`——主进程 fork worker，通过 IPC 传递 server handle（fd）或分发连接。所以理解 `fork` 的 IPC 是理解 `cluster` 的前提。

---

## 7. 安全注意

- `exec(cmd)` 走 shell，**命令注入风险**：永远用 `execFile` / `spawn` 传参数组，避免拼接 shell 字符串。
  ```js
  // 危险
  exec('ls ' + userInput);   // 若 userInput = '; rm -rf /' → 灾难
  // 安全
  spawn('ls', [userInput]);  // userInput 只是参数，不被 shell 解析
  ```
- `shell: true` 选项会启用 shell，需谨慎。

---

## 8. 可运行验证

```js
const { fork } = require('child_process');
const child = fork('-e', [
  "process.on('message', m => process.send({ echo: m }))"
]);
child.on('message', m => { console.log(m); child.disconnect(); });
child.send({ hi: 1 });
// { echo: { hi: 1 } }
```

---

## 9. 本章总结

- `child_process` 四种方式：spawn/exec/execFile/fork；fork 专用于 Node 子进程，自带 IPC。
- POSIX 底层是 `fork`+`execve`；Windows 用 `CreateProcess`；libuv 封装差异。
- stdio 五模式：pipe/inherit/ignore/overlapped/ipc/fd；`ipc` 最多一个，启用 `send`/`message`。
- 同步变体阻塞事件循环，慎用；`exec` 有命令注入风险，优先用 `spawn`/`execFile`。
- `cluster` 底层即 `fork` + IPC。

---

## 10. 思考题

1. `spawn` 与 `exec` 在输出处理上有什么根本区别？什么场景该用哪个？两者对 shell 的使用有何不同？
2. `fork` 的 IPC channel 底层是 libuv 的什么机制在驱动消息接收？（提示：02-06/02-07）
3. 为什么 `exec('ls ' + userInput)` 是危险的？如何改成安全写法？这体现了哪类安全漏洞？

---

## 附：可运行示例

> 配套验证脚本见 `src/09-cross-platform/child-process-demo.cjs`
> fork 子进程经 IPC 收发消息
