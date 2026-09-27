# 08-02 V8 共享：Chromium 与 Node.js 的 V8 实例合并

> 本章目标：理解 Electron 如何让 Chromium 和 Node.js 共享同一个 V8 Isolate，以及这种共享带来的性能优势和工程挑战。

## 导读

Electron 在同一个进程里同时运行 Chromium（浏览器引擎）和 Node.js（服务端运行时）。两者都依赖 V8 引擎——如果各跑一个 V8 实例，内存浪费严重且无法互操作。

Electron 的核心创新之一：**让 Node.js 使用 Chromium 已有的 V8 Isolate**，而不是创建自己的。

## 架构：共享前 vs 共享后

### 独立 V8（早期方案，已废弃）

```
主进程
┌──────────────────────────────────┐
│  Chromium                          │
│  ┌──────────────────────────────┐ │
│  │  V8 Isolate A (Chromium)     │ │
│  │  Heap A                       │ │
│  └──────────────────────────────┘ │
│                                    │
│  Node.js                           │
│  ┌──────────────────────────────┐ │
│  │  V8 Isolate B (Node.js)      │ │
│  │  Heap B                       │ │
│  └──────────────────────────────┘ │
└──────────────────────────────────┘
→ 两份 V8 内存，JS 对象不互通
```

### 共享 V8（Electron 当前方案）

```
主进程
┌──────────────────────────────────┐
│  Chromium + Node.js                │
│  ┌──────────────────────────────┐ │
│  │  V8 Isolate (共享)            │ │
│  │  Heap                         │ │
│  │  ┌────────┐  ┌────────────┐  │ │
│  │  │ Context│  │ Context     │  │ │
│  │  │(Chrome)│  │(Node Realm) │  │ │
│  │  └────────┘  └────────────┘  │ │
│  └──────────────────────────────┘ │
│                                    │
│  libuv Event Loop                  │
│  Chromium MessagePump              │
└──────────────────────────────────┘
→ 一份 V8 内存，JS 对象可直接互访
```

## 实现机制

### 1. Node.js 编译为 Chromium V8

Electron 不使用 Node.js 官方发布的二进制。它从源码编译 Node.js，并将 V8 替换为 Chromium 版本：

```
// electron/script/node-tests.yaml（简化）
# Node.js 使用 Chromium 的 V8
gn gen out/Release --args="
  node_use_v8_platform=true
  v8_embedder_string=\"-electron.0\"
  is_official_build=true
"
```

### 2. Node.js 嵌入到 Chromium 的 Isolate

```cpp
// electron/shell/common/node_bindings.cc — 简化

class NodeBindings {
  void Initialize() {
    // 不创建新 Isolate，使用当前线程的 Isolate（Chromium 已创建）
    uv_loop_ = uv_default_loop();

    // Node.js 在 Chromium 的 Isolate 里创建 Context
    node::Environment* env = node::CreateEnvironment(
        uv_loop_,
        isolate_,  // ← Chromium 的 Isolate
        context);
  }
};
```

### 3. 事件循环合并

Node.js 的 libuv 事件循环和 Chromium 的 MessagePump 需要合并运行——详见 `08-03-event-loop-merge.md`。

## 共享后的能力

### 渲染进程直接 require Node.js 模块

```javascript
// 渲染进程（启用 nodeIntegration）
const fs = require('fs');     // Node.js fs
const { ipcRenderer } = require('electron');  // Electron IPC

// 在同一个 JS 执行环境里，混合使用 DOM API 和 Node.js API
document.body.textContent = fs.readFileSync('/etc/hostname', 'utf8');
```

### 零序列化数据传递

```
Chromium JS 对象 ──→ Node.js JS 对象
    （同一个 Heap，直接传引用，不需要 structuredClone）
```

## 安全问题与 contextBridge

启用 `nodeIntegration` 后渲染进程能直接调用 `fs`、`child_process`——如果加载了不可信网页，等于把整台机器暴露给网页。

Electron 推荐的安全模型：

```
┌─────────────────────┐     ┌─────────────────────┐
│  渲染进程 (沙箱)     │     │  主进程 (有 Node.js) │
│  nodeIntegration:   │     │                     │
│  false              │ IPC │  contextBridge      │
│  contextIsolation:  │←───→│  exposeInMainWorld  │
│  true               │     │  (只暴露安全 API)     │
└─────────────────────┘     └─────────────────────┘
```

```javascript
// preload.js
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  readFile: (path) => ipcRenderer.invoke('read-file', path)
});
```

## 工程挑战

| 挑战 | 说明 |
|------|------|
| V8 版本同步 | Chromium 和 Node.js 的 V8 版本必须一致，Electron 需要协调两者发布周期 |
| API 兼容 | V8 Embedding API 可能因版本变化，Node.js 绑定代码需要适配 |
| GC 压力 | Chromium + Node.js 的对象都在同一个 Heap，GC 停顿可能更长 |
| 调试 | 出问题时需要区分是 Chromium 侧还是 Node.js 侧导致的 |

## 总结

| 要点 | 说明 |
|------|------|
| 共享 V8 Isolate | Node.js 使用 Chromium 已有的 V8 实例 |
| 一个 Heap | Chromium JS + Node.js JS 共享堆，对象可直接互访 |
| 事件循环合并 | libuv + Chromium MessagePump |
| 安全 | nodeIntegration:false + contextBridge 暴露最小 API |

## 思考题

1. 如果 Chromium 和 Node.js 共享一个 Isolate，`process.memoryUsage()` 报告的 heapUsed 包含 Chromium 的对象吗？
2. `contextBridge.exposeInMainWorld` 传对象时，是同一个堆引用还是拷贝？为什么？
3. Electron 为什么不能简单地用两个独立 V8 实例 + IPC 通信？