# 03-04 V8 Isolate / Heap / Context

> 本章目标：理解 V8 的三个核心概念——Isolate（隔离实例）、Heap（堆）、Context（执行上下文），以及 Node.js 如何使用它们。

## 导读

V8 是一个**嵌入式** JavaScript 引擎。它不知道文件系统、网络、定时器是什么——这些都是宿主（Node.js / Chrome / Electron）提供的。V8 只负责：编译执行 JS、管理内存。

V8 用三个概念实现隔离：

| 概念 | 类比 | 说明 |
|------|------|------|
| **Isolate** | 一个独立的 V8 虚拟机实例 | 独立的堆、GC、JIT 编译器状态。两个 Isolate 之间不共享对象 |
| **Heap** | Isolate 的内存空间 | 管理 JS 对象的分配与回收。一个 Isolate 一个 Heap |
| **Context** | 一个 JS 执行环境 | 全局对象、内置函数、作用域。一个 Isolate 可有多个 Context |

## 架构图

```
┌─────────────────────────────────────────────────────┐
│                    Process                           │
│                                                      │
│  ┌───────────────────┐  ┌───────────────────┐       │
│  │   Isolate A       │  │   Isolate B       │       │
│  │  (主线程)          │  │  (Worker Thread)  │       │
│  │                   │  │                   │       │
│  │  ┌─────────────┐  │  │  ┌─────────────┐  │       │
│  │  │    Heap     │  │  │  │    Heap     │  │       │
│  │  │  ┌────────┐ │  │  │  │  ┌────────┐ │  │       │
│  │  │  │ 新生代  │ │  │  │  │  │ 新生代  │ │  │       │
│  │  │  ├────────┤ │  │  │  │  ├────────┤ │  │       │
│  │  │  │ 老生代  │ │  │  │  │  │ 老生代  │ │  │       │
│  │  │  └────────┘ │  │  │  │  └────────┘ │  │       │
│  │  └─────────────┘  │  │  └─────────────┘  │       │
│  │                   │  │                   │       │
│  │  ┌─────────────┐  │  │  ┌─────────────┐  │       │
│  │  │  Context 1  │  │  │  │  Context 1  │  │       │
│  │  │  (主 Realm) │  │  │  │  (Worker)   │  │        │
│  │  │  globalThis│  │  │  │  globalThis │  │       │
│  │  └─────────────┘  │  │  └─────────────┘  │       │
│  │  ┌─────────────┐  │  │                   │       │
│  │  │  Context 2  │  │  │                   │       │
│  │  │ (vm.createContext)│ │                   │       │
│  │  └─────────────┘  │  │                   │       │
│  └───────────────────┘  └───────────────────┘       │
└─────────────────────────────────────────────────────┘
```

## Isolate：V8 的"独立宇宙"

```cpp
// V8 API
v8::Isolate::CreateParams create_params;
create_params.array_buffer_allocator = v8::ArrayBuffer::Allocator::NewDefaultAllocator();
v8::Isolate* isolate = v8::Isolate::New(create_params);
```

- 一个 Isolate = 一个独立的 V8 实例 = 一个独立堆 + 一个独立 GC
- **两个 Isolate 的对象不能直接互访**（需要序列化或 SharedArrayBuffer）
- Node.js 主线程有一个 Isolate，每个 `worker_threads` Worker 有自己的 Isolate
- `vm.createContext()` 在同一个 Isolate 内创建新 Context（不是新 Isolate）

> 可运行示例见 `src/03-v8-engine/gc-probe.js`（用 `--expose-gc` 观察 GC 行为）

## Heap：V8 的内存管理

V8 堆分为两代：

| 代 | 大小 | GC 策略 | 特点 |
|----|------|---------|------|
| **新生代 (Young Generation)** | 1-8 MB | Scavenge（复制式） | 短命对象，频繁回收，停顿短 |
| **老生代 (Old Generation)** | 初始 0，按需增长 | Mark-Sweep-Compact | 长命对象，回收较慢 |

### GC 触发条件

- 新生代满了 → Scavenge
- 老生代增长到阈值 → Mark-Sweep
- 显式调用 `global.gc()`（需 `--expose-gc`）

```javascript
// gc-probe.js
const used = () => process.memoryUsage().heapUsed / 1024 / 1024;
console.log('before:', used().toFixed(1), 'MB');
for (let i = 0; i < 1e6; i++) { let x = { a: i, b: 'hello' }; }
console.log('after alloc:', used().toFixed(1), 'MB');
if (typeof gc === 'function') gc();
console.log('after gc:', used().toFixed(1), 'MB');
```

## Context：JS 执行环境

```cpp
v8::Local<v8::Context> context = v8::Context::New(isolate);
v8::Context::Scope context_scope(context);
// 在此 scope 内执行 JS
context->Global()->Set(context, v8::String::NewFromUtf8(isolate, "x").ToLocalChecked(),
                         v8::Number::New(isolate, 42));
```

- Context 定义了 `global` 对象、内置函数（`Math`、`Array`、`JSON` 等）
- 一个 Isolate 可以有多个 Context（互相隔离的 JS 沙箱）
- Node.js 的 `vm.createContext()` 就是创建新 Context

```javascript
const vm = require('vm');
const ctx1 = vm.createContext({ x: 1 });
const ctx2 = vm.createContext({ x: 2 });
vm.runInContext('x', ctx1);  // 1
vm.runInContext('x', ctx2);  // 2
```

## Node.js 如何使用 Isolate / Context

```
src/node.cc
  ├── 创建 Isolate (platform->Isolate())
  ├── 创建 Context (NewContext)
  │     ├── 挂载 process 对象
  │     ├── 挂载 setTimeout / setImmediate / ...
  │     └── 注册 C++ 绑定函数
  ├── 运行 bootstrap/realm.js (初始化模块系统)
  ├── 运行 bootstrap/node.js (加载内置模块)
  └── 运行 run_main_module.js (执行用户入口文件)
```

### Worker Threads 的 Isolate 隔离

```
主线程 Isolate                 Worker Isolate
┌──────────────┐              ┌──────────────┐
│  Heap A      │              │  Heap B      │
│  Context     │   MessagePort │  Context    │
│  (主 Realm)  │ ←──────────→ │  (Worker)    │
│              │  structured   │              │
│              │  clone        │              │
└──────────────┘              └──────────────┘

SharedArrayBuffer 可在两个 Isolate 间共享（不复制）
```

## 总结

| 概念 | 核心 | Node.js 中的体现 |
|------|------|-----------------|
| Isolate | 独立 V8 实例 | 主线程一个，每个 Worker 一个 |
| Heap | Isolate 内的 JS 对象内存 | 新生代 Scavenge + 老生代 Mark-Sweep |
| Context | JS 执行环境 | 主 Realm + `vm.createContext()` 沙箱 |

## 思考题

1. `worker_threads` 创建的新线程有自己的 Isolate。两个 Isolate 的 JS 对象能直接 `===` 比较吗？为什么？
2. `vm.createContext()` 创建的是新 Isolate 还是新 Context？这对性能意味着什么？
3. 如果一个 Isolate 里 GC 正在运行，另一个 Isolate 的 JS 会暂停吗？