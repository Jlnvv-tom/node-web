# 08-01 Electron 架构：Node.js 如何嵌入 Chromium

> 本章目标：理解 Electron 如何把 Node.js 运行时塞进 Chromium 的多进程壳里——双进程模型、V8 共享、事件循环合并、以及最重要的安全边界（preload + contextIsolation）。

---

## 1. Electron 是什么

Electron 用 **Chromium 渲染 Web 页面 + Node.js 提供系统能力**，让前端技术栈（HTML/CSS/JS）能写桌面应用。VSCode、Slack、Discord、Figma（早期）都基于它。

它本质上是一个**定制版的 Chromium**，其中：
- 主进程（Main）= Chromium 的浏览器进程 + 完整 Node.js 运行时。
- 渲染进程（Renderer）= 一个 Chromium 渲染页 + （可选）Node.js 运行时。

---

## 2. 多进程架构

```
┌──────────────────────────────────────────────────────────┐
│  Main Process (Node.js 完整运行时)                        │
│   ├─ 管理 BrowserWindow、菜单、托盘、原生 API             │
│   ├─ 每个窗口通过 IPC 与渲染进程通信                      │
│   └─ 拥有自己的 V8 Isolate + libuv event loop             │
└───────────────┬──────────────────────────────────────────┘
                │ IPC (ipcMain / ipcRenderer)
   ┌────────────┴─────────────┐   ┌────────────────────────┐
   │ Renderer Process A        │   │ Renderer Process B      │
   │  (BrowserWindow 1)        │   │  (BrowserWindow 2)      │
   │  ├─ Chromium 渲染引擎     │   │  ├─ Chromium 渲染引擎   │
   │  ├─ V8 (渲染页 JS)        │   │  │  ├─ V8               │
   │  └─ [Node.js 可选]        │   │  │  └─ [Node.js 可选]   │
   └───────────────────────────┘   └────────────────────────┘
   ┌───────────────────────────┐
   │ GPU Process / Utility Proc │  (Chromium 自有，独立进程)
   └───────────────────────────┘
```

每个进程都是**独立的 OS 进程**，有独立的 V8 Isolate 与事件循环。崩溃隔离：一个渲染进程崩了不影响主进程。

---

## 3. Node.js 如何嵌入 Chromium

### 3.1 共享 V8（node_shared）

构建 Electron 时设置 `node_shared=true`：
- 关闭 Node.js 自带的 V8 副本。
- 复用 Chromium 已打包的 V8 引擎。
- 好处：减小体积、保证渲染进程和主进程用同一 V8 版本，避免 ABI 冲突。

### 3.2 事件循环合并

这是关键的工程难点——**Chromium 有自己的 MessageLoop（消息泵），Node 有 libuv 的 `uv_run`**。两者都是"死循环等事件"，不能各跑各的。

Electron 的做法：把 **libuv 的事件循环集成进 Chromium 的 MessagePump**：

```
Chromium MessageLoop::Run()
   │
   ├─ 处理 Chromium 任务（UI、渲染调度...）
   │
   ├─ 在适当时机调用 uv_run(loop, UV_RUN_NOWAIT)   // 不阻塞，只处理已就绪
   │     → 执行 Node 的定时器、I/O 回调、setImmediate
   │
   └─ 回到 Chromium 任务
```

即：每次 Chromium 消息泵转一圈，顺便"不阻塞地"驱动一下 libuv。这样既处理浏览器事件，又不漏掉 Node 事件。底层靠 `uv_backend_fd()` 拿到 libuv 的 epoll/kqueue fd，注册进 Chromium 的 `MessagePump`，让 Chromium 的 `epoll_wait` 同时等待浏览器事件和 Node I/O。

---

## 4. 版本对照（以 Electron 32.0.0 / 2025 为例）

| 组件 | 版本 |
|------|------|
| Chromium | 128 |
| V8 | 12.8 |
| Node.js | 20.16.0 |

Electron 版本通常落后上游 Chromium/Node 若干个版本（因需做集成与回归），但功能面与对应 Node 主线基本一致。

---

## 5. 安全边界：nodeIntegration / preload / contextIsolation

这是 Electron 最容易被误用的地方。

### 5.1 危险配置（已不推荐）

```js
new BrowserWindow({
  webPreferences: {
    nodeIntegration: true,   // ❌ 渲染页 JS 直接有 require / process / fs
  }
});
```

若渲染页加载了**不可信的远程内容**（如内嵌网页、用户生成 HTML），攻击者可用 `require('child_process')` 执行任意命令。**绝对不要对加载远程内容的窗口开启 `nodeIntegration`**。

### 5.2 推荐架构：preload + contextIsolation

```js
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,          // ✅ 关闭
    contextIsolation: true,          // ✅ 隔离渲染页与预加载脚本的 JS 上下文
    sandbox: true,                   // ✅ 可选加强沙箱
    preload: path.join(__dirname, 'preload.js'),
  }
});
```

**preload.js**（运行在独立、有 Node 权限的上下文）：
```js
// preload.js —— 唯一能安全使用 Node API 的地方
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 只暴露必要的最小接口，绝不暴露整个 require
  readConfig: () => ipcRenderer.invoke('read-config'),
  saveData: (d) => ipcRenderer.send('save-data', d),
});
```

**渲染页（不可信代码）**：
```html
<script>
  // 只能访问 window.api，拿不到 process / require / fs
  window.api.readConfig().then(cfg => render(cfg));
</script>
```

要点：
- `contextIsolation: true` 确保渲染页的 JS 与 preload 的 JS 在**不同的 V8 上下文**，彼此全局变量不互通。
- `contextBridge.exposeInMainWorld` 是**唯一**的受控桥，显式把白名单方法挂到 `window.api`。
- 渲染页无法逃逸到 Node 环境。

---

## 6. IPC 通信

```js
// 主进程 main.js
const { ipcMain } = require('electron');
ipcMain.handle('read-config', async () => {
  return await fs.promises.readFile('config.json', 'utf8');
});

// 渲染页通过 preload 暴露的 api 调用
// window.api.readConfig() → ipcRenderer.invoke('read-config')
```

- `ipcRenderer.invoke` / `ipcMain.handle`：请求-响应（Promise）。
- `ipcRenderer.send` / `ipcMain.on`：单向事件。
- `channel` 名称需白名单校验，避免任意 IPC 被滥用。

---

## 7. 应用生命周期

```js
const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({ ... });
  win.loadFile('index.html');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
```

- `ready`：app 初始化完成。
- `window-all-closed`：所有窗口关闭（macOS 通常保留 app 运行）。
- `activate`：点击 dock 图标重新开窗。

---

## 8. 与纯 Node.js 的区别小结

| 维度 | 纯 Node.js | Electron |
|------|-----------|---------|
| 运行时 | 单进程 + libuv 循环 | 多进程（主+渲染+GPU） |
| 事件循环 | `uv_run` 独占 | libuv 并入 Chromium MessagePump |
| V8 | Node 自带 | 与 Chromium 共享（node_shared） |
| 浏览器能力 | 无 | 完整 Chromium 渲染 |
| 安全模型 | 信任全部代码 | 必须隔离不可信渲染内容 |

---

## 9. 可运行验证

```bash
# 启动一个最简 Electron 应用（需先 npm i electron）
npx electron --version
# 用 --inspect 调试主进程
npx electron --inspect=9229 main.js
```

在 DevTools 里可见：主进程与渲染进程是独立的 JS 上下文；开启 contextIsolation 后，`window.require` 为 undefined，而 `window.api` 由 preload 暴露。

---

## 10. 本章总结

- Electron = Chromium（渲染）+ Node.js（系统能力），主进程与渲染进程是独立 OS 进程。
- 通过 `node_shared=true` 共享 V8；libuv 事件循环并入 Chromium MessagePump 实现双引擎驱动。
- **安全红线**：不可信远程内容绝不开 `nodeIntegration`；用 `contextIsolation: true` + preload + `contextBridge` 暴露白名单接口。
- IPC 用 `invoke/handle` 或 `send/on`，channel 需白名单。
- 理解这些，才能既享受 Node 能力又不引入 RCE 风险。

---

## 11. 思考题

1. 为什么 Electron 要把 libuv 循环并入 Chromium MessagePump，而不是"两个循环各跑各的"？会出什么问题？
2. `nodeIntegration: true` 在加载本地 `index.html`（可信）时是否安全？那为什么官方仍建议关闭？
3. `contextIsolation: true` 下，preload 脚本和渲染页的 JS 为什么不能直接共享全局变量？它们不是在同一个窗口里吗？

---

## 附：可运行示例

> 配套验证脚本见 `src/08-electron-integration/main-preload-bridge.js`
> 主进程↔渲染进程 contextBridge 安全桥接范式
