# 03-05 V8 Embedding API：Node.js 如何嵌入 V8

> 本章目标：理解 Node.js 如何通过 V8 的 Embedding API 将 V8 引擎"嵌入"到自己的运行时中，建立从 C++ 到 JS 的桥梁。

## 导读

V8 本身只是一个 JavaScript 引擎——它知道如何解析、编译、执行 JS 代码和管理内存，但它不知道：
- 什么是文件（`fs.readFile`）
- 什么是网络（`http.createServer`）
- 什么是定时器（`setTimeout`）
- 什么是 `process.argv`

这些能力都是 **宿主**（Node.js）通过 V8 Embedding API 注入的。本章解读这个过程。

## V8 Embedding 的基本模式

```
┌─────────────────────────────────────────────┐
│              Node.js (C++)                   │
│                                              │
│  1. 创建 Isolate                              │
│  2. 创建 Context                              │
│  3. 在 Context 里注入 C++ 函数 (Binding)      │
│  4. 编译运行 JS 代码                          │
│  5. JS 调用注入的 C++ 函数 → V8 回调到 C++    │
│                                              │
│  ┌───────────────────────────────────────┐   │
│  │            V8 Engine                   │   │
│  │  ┌─────────┐  ┌──────────┐  ┌──────┐ │   │
│  │  │ Parser  │→ │ Compiler │→ │ 执行 │ │   │
│  │  └─────────┘  └──────────┘  └──────┘ │   │
│  │              Heap / GC                  │   │
│  └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## 第一步：创建 Isolate 和 Context

```cpp
// src/node.cc — 简化

// 1. 创建 Isolate
v8::Isolate::CreateParams create_params;
create_params.array_buffer_allocator =
    v8::ArrayBuffer::Allocator::NewDefaultAllocator();
isolate_ = v8::Isolate::New(create_params);

v8::Isolate::Scope isolate_scope(isolate_);
v8::HandleScope handle_scope(isolate_);

// 2. 创建 Context
v8::Local<v8::Context> context = v8::Context::New(isolate_);
v8::Context::Scope context_scope(context);
```

## 第二步：注入 C++ 函数（Binding）

V8 的函数绑定模式：

```cpp
// 定义一个 C++ 函数，可被 JS 调用
void Print(const v8::FunctionCallbackInfo<v8::Value>& args) {
  v8::Isolate* isolate = args.GetIsolate();
  v8::HandleScope scope(isolate);

  for (int i = 0; i < args.Length(); i++) {
    v8::String::Utf8Value str(isolate, args[i]);
    printf("%s ", *str);
  }
  printf("\n");

  args.GetReturnValue().SetUndefined();
}

// 注入到 global 对象
v8::Local<v8::Object> global = context->Global();
global->Set(context,
  v8::String::NewFromUtf8(isolate, "print").ToLocalChecked(),
  v8::FunctionTemplate::New(isolate, Print)->GetFunction(context).ToLocalChecked()
);
```

此后在 JS 里 `print("hello")` 就会调用 C++ 的 `Print` 函数。

## 第三步：Node.js 的实际绑定体系

Node.js 不是逐个手动注入——它有一套系统化的绑定机制：

```
src/node_bindings.cc
  ├── 注册所有内置模块到 Environment
  │     ├── fs (src/node_file.cc)
  │     ├── net (src/node_tcp.cc)
  │     ├── http (src/node_http_parser.cc)
  │     ├── crypto (src/node_crypto.cc)
  │     ├── child_process (src/node_child_process.cc)
  │     └── ... 约 30+ 模块
  │
  ├── 每个模块用 NODE_MODULE_CONTEXT_AWARE_INTERNAL 宏注册
  │     └── 模块初始化函数接收 (Environment*, v8::Local<v8::Object> exports)
  │
  └── 在 Context 创建后，遍历注册表，每个模块的 init 函数被调用
        └── init 函数在 exports 对象上挂载 C++ 函数
```

### 示例：`process.binding('fs')` 的注册

```cpp
// src/node_file.cc — 简化
void Initialize(v8::Local<v8::Object> target,
                v8::Local<v8::Value> unused,
                v8::Local<v8::Context> context,
                void* priv) {
  v8::Isolate* isolate = context->GetIsolate();

  v8::Local<v8::FunctionTemplate> stat =
      v8::FunctionTemplate::New(isolate, Stat);
  target->Set(context,
    v8::String::NewFromUtf8(isolate, "stat").ToLocalChecked(),
    stat->GetFunction(context).ToLocalChecked()).Check();
}

NODE_MODULE_CONTEXT_AWARE_INTERNAL(fs, Initialize)
```

## 第四步：从 JS 到 C++ 的完整调用链

以 `fs.statSync('/tmp')` 为例：

```
用户 JS: fs.statSync('/tmp')
  → lib/fs.js: statSync() 调用 binding.stat()
    → internalBinding('fs').stat      // JS 层到 C++ 的边界
      → src/node_file.cc: Stat()      // C++ 回调
        → uv_fs_stat()                 // libuv 系统调用
          → stat()                      // OS 盿调
        ← uv_fs_t.result
      ← v8::ReturnValue                // C++ → JS 返回值
    ← binding.stat 返回
  ← fs.statSync 返回 Stats 对象
```

## V8 Embedding API 关键类

| C++ 类 | 作用 | 生命周期 |
|--------|------|---------|
| `v8::Isolate` | V8 实例 | 进程级，手动创建/销毁 |
| `v8::Context` | JS 执行环境 | Isolate 内，多个 |
| `v8::HandleScope` | 局部句柄管理 | 栈上，RAII |
| `v8::Local<T>` | 局部引用 | HandleScope 内有效 |
| `v8::Global<T>` | 全局引用 | 手动管理，跨 scope |
| `v8::FunctionTemplate` | JS 函数模板 | 创建函数对象 |
| `v8::Object` | JS 对象 | V8 管理的堆对象 |
| `v8::Array` | JS 数组 | V8 管理的堆对象 |
| `v8::String` | JS 字符串 | V8 管理的堆对象 |

## Context 嵌入与 vm 模块

Node.js 的 `vm` 模块直接暴露了 V8 Context 创建：

```javascript
const vm = require('vm');
const sandbox = { x: 1, y: 2 };
const ctx = vm.createContext(sandbox);
vm.runInContext('x + y', ctx);  // 3
```

底层：

```
vm.createContext(sandbox)
  → v8::Context::New(isolate_, ...)
  → 将 sandbox 对象的属性映射到新 Context 的 global
```

> 可运行示例见 `src/00-mininode/layer1-vm-embed.js`（用 vm.createContext 实现最小模块加载器）

## 总结

| 要点 | 说明 |
|------|------|
| V8 是嵌入式引擎 | 不知道 I/O、网络、定时器 |
| 宿主通过 Embedding API 注入能力 | 创建 Context → 挂载 C++ 函数 → 运行 JS |
| Node.js 绑定是系统化的 | `NODE_MODULE_CONTEXT_AWARE_INTERNAL` 宏批量注册 |
| JS↔C++ 边界 | `FunctionCallbackInfo` 入参，`ReturnValue` 出参 |
| vm 模块直接暴露 Context 创建 | 同一 Isolate 内创建多个隔离沙箱 |

## 思考题

1. 如果 V8 升级导致 `FunctionCallbackInfo` 签名变了，哪些层会受影响？（提示：C++ Bindings → N-API）
2. N-API 为什么要发明？它和 V8 Embedding API 有什么关系？
3. Electron 同时嵌入了 Node.js 和 Chromium 的 V8。它们是如何共用一个 Isolate 的？（如果感兴趣，见 08-electron-integration 章节）