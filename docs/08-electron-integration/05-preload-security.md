# 08-05 Preload 脚本与 contextBridge 安全模型

> 本章目标：理解 Electron preload 脚本的执行时机、contextIsolation 原理、以及 contextBridge 如何构建安全的渲染进程 API 边界。

## 导读

Electron 应用的最大安全风险：渲染进程加载了不可信网页（XSS、恶意页面），如果渲染进程有 Node.js 权限（`nodeIntegration: true`），攻击者可以用 `require('child_process').exec('rm -rf /')` 完全控制用户机器。

**安全模型**：渲染进程不应该有 Node.js 权限。preload 脚本 + contextBridge 是 Electron 推荐的安全桥梁。

## contextIsolation：两个世界

```
渲染进程 V8 Isolate
┌─────────────────────────────────────┐
│                                       │
│  ┌──────────────┐  ┌──────────────┐  │
│  │ Context A    │  │ Context B    │  │
│  │ (Chromium    │  │ (Preload     │  │
│  │  World)      │  │  World)      │  │
│  │              │  │              │  │
│  │ DOM API      │  │ require()    │  │
│  │ window       │  │ process      │  │
│  │ document     │  │ fs, net      │  │
│  │ (网页 JS)    │  │ (Node.js)   │  │
│  │              │  │              │  │
│  │  contextBridge│  │              │  │
│  │  ↑暴露API    │  │              │  │
│  └──────────────┘  └──────────────┘  │
│        ↕ (同一个 V8 Isolate/Heap)    │
└─────────────────────────────────────┘
        ↕ IPC pipe
   主进程
```

`contextIsolation: true` 让 preload 脚本在**独立的 V8 Context** 中运行，与网页的 Context 隔离。

- 两个 Context 在同一个 Isolate/Heap 中（共享内存），但有独立的 global 对象
- preload 能 `require('fs')`，但网页 JS 不能直接访问 preload 的变量
- contextBridge 在两个 Context 之间暴露安全的 API

## preload 执行时机

```
BrowserWindow 创建
  → Chromium 创建渲染进程
    → V8 Isolate 初始化
      → 创建 preload Context
        → 执行 preload.js
          → contextBridge.exposeInMainWorld('api', {...})
      → 创建 Chromium World (网页 Context)
        → 加载页面 (loadURL / loadFile)
          → 网页 JS 执行
```

preload 在网页 JS **之前**执行，可以设置好安全 API 供网页使用。

## contextBridge 工作原理

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('myAPI', {
  version: process.versions.node,
  readFile: (path) => ipcRenderer.invoke('read-file', path),
  onEvent: (callback) => ipcRenderer.on('update', (e, data) => callback(data))
});
```

### 数据传递规则

| 类型 | 行为 |
|------|------|
| string / number / boolean | 值复制 |
| 普通对象 / 数组 | 深度克隆 |
| 函数 | 包装为跨 Context 代理（可调用，但不能访问 preload World 的变量） |
| ArrayBuffer / TypedArray | 复制（不是共享） |
| Class 实例 | 丢失原型链，变成普通对象 |
| Symbol / 函数属性 | 忽略 |

### 安全保证

1. **网页无法访问 preload 的 `require`**：contextIsolation 隔离了 Context
2. **暴露的函数执行在 preload Context**：参数值复制过来，返回值复制回去
3. **ipcRenderer 不直接暴露**：暴露的 `onEvent` 只接收 callback，网页不能自己 `ipcRenderer.send`

### 常见错误模式

```javascript
// ❌ 危险：暴露了整个 ipcRenderer
contextBridge.exposeInMainWorld('ipc', ipcRenderer);

// ❌ 危险：暴露了 require
contextBridge.exposeInMainWorld('require', require);

// ❌ 危险：暴露了 process
contextBrowser.exposeInMainWorld('process', process);

// ✅ 安全：只暴露需要的函数
contextBridge.exposeInMainWorld('api', {
  readFile: (path) => ipcRenderer.invoke('read-file', path)
});
```

## 完整安全清单

```javascript
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,       // 渲染进程无 Node.js
    contextIsolation: true,       // preload 隔离
    sandbox: true,                // 渲染进程沙箱
    preload: path.join(__dirname, 'preload.js')
  }
});
```

| 配置 | 作用 | 推荐值 |
|------|------|--------|
| `nodeIntegration` | 渲染进程能否 require Node.js | false |
| `contextIsolation` | preload 与网页不同 Context | true |
| `sandbox` | 渲染进程 Chromium 沙箱 | true |
| `preload` | preload 脚本路径 | 必须指定 |

## 总结

| 要点 | 说明 |
|------|------|
| contextIsolation | preload 和网页在不同 V8 Context |
| contextBridge | 安全暴露 API，数据深度克隆 |
| 最小权限 | 只暴露必要的函数，不暴露 require/process/ipcRenderer |
| 执行时机 | preload 在网页 JS 之前执行 |

## 思考题

1. 如果 `contextIsolation: false`，有什么安全风险？preload 和网页在同一 Context 意味着什么？
2. contextBridge 暴露的函数中 `this` 指向哪里——preload Context 还是网页 Context？
3. `sandbox: true` 额外做了什么？它和 contextIsolation 是什么关系？