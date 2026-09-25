# 09-01 跨平台抽象层

> 本章目标：理解 Node 如何在源码层面屏蔽操作系统差异——libuv 作为统一抽象层，让上层的 `fs` / `net` / `child_process` 在各 OS 行为一致。这是 Node "一次编写、处处运行"的基石。

---

## 1. 抽象的目的

同一段 JS 代码，`require('fs').readFile` 在 Linux/macOS/Windows 上都要工作。但底层：
- 网络 I/O：Linux 用 epoll、macOS 用 kqueue、Windows 用 IOCP（见 01-01）。
- 文件路径：Windows 用 `C:\a\b`、POSIX 用 `/a/b`。
- 子进程：Windows 用 `CreateProcess`，POSIX 用 `fork/exec`。
- 信号：POSIX 有 SIGTERM，Windows 信号模型不同。

Node 用 **libuv** 统一这些差异，上层 JS API 不感知 OS。

---

## 2. libuv 的跨平台角色

```
JS (fs/net/child_process)
   ▼
Node C++ 绑定 (src/*.cc)
   ▼
libuv (uv_fs_t / uv_tcp_t / uv_process_t ...)
   ▼  平台分派（编译期条件宏）
┌──────────┬──────────┬──────────┐
│ unix/*   │ darwin/* │  win/*   │   （deps/uv/src/{unix,win}/）
│ epoll    │ kqueue   │ IOCP     │
│ fork/exec│ launchd  │ CreateProc│
└──────────┴──────────┴──────────┘
   ▼
操作系统
```

libuv 的 `src/` 分 `unix/`、`win/` 两个实现目录，上层通过 `uv_*` 统一 API 调用，编译期由平台宏决定用哪套实现。

---

## 3. 文件路径抽象

Node 在 `lib/path.js` 和 C++ 层处理路径：
- `path.posix` / `path.win32` 两套实现。
- `path.join`、`path.resolve` 自动按平台分隔符拼接。
- `fs` 模块内部把 JS 路径转成 OS 理解的格式（Windows 长路径 `\\?\` 前缀、UNC 等）。
- `fs.realpath` 在 Windows 处理符号链接/ junctions 差异。

```js
const path = require('path');
console.log(path.join('a', 'b'));   // POSIX: a/b   Windows: a\b
```

---

## 4. 文件 I/O 的跨平台一致性

（回顾 02-04）

无论 OS 如何，`fs.readFile` 的语义一致：
- POSIX：阻塞 `pread` 在 libuv 线程池执行。
- Windows：同样在 libuv 线程池，用 `ReadFile` 异步（Proactor 模型）。
- 上层只看到统一的回调 `(err, data)`。

`fs` 模块把平台差异收敛进 `uv_fs_*` 调用，JS 侧无需 `if (process.platform === 'win32')` 分支（除非路径/权限等固有差异）。

---

## 5. 进程与信号差异

| 维度 | POSIX | Windows |
|------|-------|---------|
| 创建子进程 | `fork` + `execve` | `CreateProcess` |
| 进程间信号 | `SIGTERM`/`SIGKILL`/`SIGINT` | 无 POSIX 信号，用 `GenerateConsoleCtrlEvent` / `TerminateProcess` |
| 优雅退出 | `SIGTERM` 可被捕获 | `CTRL_C_EVENT` |

Node 在 `process.kill(pid, signal)` 上做映射：Windows 上的 `SIGTERM` 实际用 `GenerateConsoleCtrlEvent`，`SIGKILL` 用 `TerminateProcess`。JS 代码用统一 API，底层行为差异由 Node 处理。

---

## 6. 为什么 Windows 支持是特例

Windows 的 I/O 模型（IOCP Proactor）与 POSIX（Reactor）根本不同。libuv 在 Windows 用 IOCP 同时模拟"就绪通知"行为（回顾 01-01 Reactor vs Proactor），让上层 `uv_poll` 等 API 语义一致。这是 libuv 工程量的大头。

Electron 也受益：主进程在 Windows 同样走 IOCP，渲染进程 Chromium 已跨平台（08-01）。

---

## 7. 可运行验证

```js
// 同一段代码跨平台行为一致
const fs = require('fs');
fs.readFile(__filename, (err, data) => {
  if (err) throw err;
  console.log('read', data.length, 'bytes');
});
```

```bash
# 在 Windows 与 Linux 上分别运行，行为一致
node app.js
```

---

## 8. 本章总结

- libuv 是 Node 的跨平台抽象层，统一网络 I/O（epoll/kqueue/IOCP）、文件 I/O、进程、信号。
- 源码分 `unix/` 与 `win/` 两套实现，编译期按平台选择。
- 路径（`path`）、文件 I/O、进程信号都被收敛为统一 JS API。
- Windows 的 Proactor 模型被 libuv 模拟成 Reactor 语义，保证上层一致。

---

## 9. 思考题

1. 如果没有 libuv，Node 核心模块直接调用 epoll/kqueue，会对代码库产生什么影响？为什么 libuv 的抽象层有价值？
2. Windows 的 IOCP 是 Proactor 模型，而 POSIX 是 Reactor。libuv 如何让上层 `uv_poll` 在两套模型下语义一致？
3. 为什么 `path.join` 要区分 `posix` 与 `win32` 两套？如果强行统一用 `/` 会有什么问题？
