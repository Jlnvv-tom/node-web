# 08-04 IPC 通信：主进程与渲染进程的桥接

> 本章目标：理解 Electron IPC 的底层实现——ipcMain / ipcRenderer / contextBridge 如何实现跨进程消息传递。

## 导读

Electron 的主进程和渲染进程是**独立的操作系统进程**。JS 对象不能跨进程直接传递——IPC（Inter-Process Communication）是唯一的桥梁。

## IPC 架构

```
主进程 (Main)                    渲染进程 (Renderer)
┌─────────────────┐             ┌─────────────────┐
│  ipcMain        │             │  ipcRenderer    │
│  (Node.js Event)│             │  (Node.js Event)│
│       ↕         │             │       ↕         │
│  Electron       │             │  Electron       │
│  IPC Bus        │             │  IPC Bus        │
│       ↕         │             │       ↕         │
│  Chromium IPC   │  ← pipe →  │  Chromium IPC   │
│  (Mojo/Channel) │             │  (Mojo/Channel) │
└─────────────────┘             └─────────────────┘
```

底层传输使用 Chromium 的 IPC 机制（基于命名管道 / Unix Domain Socket），数据序列化使用 V8 的 ValueSerializer（结构化克隆算法）。

## 三种 IPC 模式

### 1. ipcRenderer.send / ipcMain.on（单向）

```javascript
// main.js
const { app, BrowserWindow, ipcMain } = require('electron');
let win;
app.whenReady().then(() => {
  win = new BrowserWindow({ webPreferences: { preload: 'preload.js' } });
  win.loadFile('index.html');
});

ipcMain.on('do-something', (event, arg) => {
  console.log('received:', arg);
});
```

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  send: (data) => ipcRenderer.send('do-something', data)
});
```

```javascript
// renderer.html
<script>
  window.api.send('hello from renderer');
</script>
```

### 2. ipcRenderer.invoke / ipcMain.handle（双向 Promise）

```javascript
// main.js
ipcMain.handle('read-file', async (event, path) => {
  const fs = require('fs/promises');
  return await fs.readFile(path, 'utf8');
});

// preload.js
contextBridge.exposeInMainWorld('api', {
  readFile: (path) => ipcRenderer.invoke('read-file', path)
});

// renderer
const content = await window.api.readFile('/etc/hostname');
```

### 3. MessagePort（双向流式）

```javascript
// main.js
const { port1, port2 } = new MessageChannelMain();
win.webContents.postMessage('port', null, [port1]);
port2.on('message', (e) => console.log('from renderer:', e.data));
port2.postMessage('hello from main');

// preload.js
ipcRenderer.on('port', (e) => {
  const [port] = e.ports;
  port.on('message', (ev) => console.log('from main:', ev.data));
  port.postMessage('hello from renderer');
});
```

## 底层实现链路

```
ipcRenderer.send(channel, ...args)
  → electron/shell/renderer/api/ipc_renderer.cc
    → electron/shell/common/api/message_sender.cc
      → mojo::Remote<electron::mojom::ElectronApi>::Send()
        → Chromium Mojo IPC（序列化 + 管道传输）
          → 主进程 Mojo 接收
            → electron/shell/browser/api/electron_api_ipc.cc
              → v8::Function::Call() → 触发 ipcMain EventEmitter
```

### 序列化：V8 Structured Clone

跨进程传递的参数经过 V8 的 `ValueSerializer` / `ValueDeserializer`：

```cpp
// V8 结构化克隆
v8::ValueSerializer serializer(isolate);
serializer.WriteHeader();
serializer.WriteValue(value);
auto buffer = serializer.Release();  // std::vector<uint8_t>

// → 通过 Mojo pipe 发送字节流
// 接收端反序列化
v8::ValueDeserializer deserializer(isolate, buffer.data(), buffer.size());
deserializer.ReadHeader();
v8::Local<v8::Value> value;
deserializer.ReadValue(&value);
```

**能传递的类型**：string / number / boolean / null / undefined / Array / 普通对象 / Date / RegExp / ArrayBuffer / Map / Set / Error

**不能传递**：函数、Symbol、Class 实例（原型链丢失）、DOM 节点

## contextBridge 的安全作用

`contextBridge.exposeInMainWorld` 在隔离的上下文之间传递数据时，会进行**深度克隆**——不是传引用：

```javascript
// preload.js
const { contextBridge } = require('electron');
const secret = { key: 'private-key' };

contextBridge.exposeInMainWorld('api', {
  getSecret: () => secret  // 返回的是 secret 的拷贝，不是引用
});

// renderer.js
const s = window.api.getSecret();
s.key = 'hacked';
// 主进程的 secret.key 不受影响（因为是拷贝）
```

## 总结

| 模式 | 特点 | 适用场景 |
|------|------|----------|
| send/on | 单向 | 通知主进程做事 |
| invoke/handle | 双向 Promise | 请求-响应 |
| MessagePort | 双向流式 | 频繁双向通信 |
| 序列化 | V8 Structured Clone | 跨进程安全 |
| contextBridge | 深度克隆 | 安全暴露 API 到渲染进程 |

## 思考题

1. `ipcRenderer.invoke('read-file', '/huge.dat')` 返回 1GB 的 Buffer。这会发生什么？（提示：序列化开销、内存复制）
2. contextBridge 为什么用深度克隆而不是传引用？如果传引用有什么安全风险？
3. Mojo IPC 和 node-ipc（node-pty）有什么区别？Electron 为什么用 Mojo？