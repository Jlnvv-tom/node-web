# 03-01 V8 引擎概览

> 本章目标：建立 V8 的整体心智模型——它是什么、在 Node 中扮演什么角色，以及它的核心组件（Isolate / Context / Heap / GC / JIT）如何与 Node 配合。

---

## 1. V8 是什么

V8 是 Google 开发的**开源 JavaScript 与 WebAssembly 引擎**，用 C++ 编写。它被用在：
- Chrome / Chromium 浏览器
- Node.js（作为 JS 执行核心）
- Electron（共享 Chromium 的 V8）
- Deno / Bun（Bun 用 JSC 而非 V8）

V8 负责：**把 JS 源码编译成机器码 + 管理内存（GC）+ 提供嵌入 API（让宿主程序调用 JS）**。它**不提供**文件、网络、DOM——这些由嵌入者（Node / 浏览器）自己提供。

---

## 2. V8 在 Node 中的位置

```
Node C++ 层 (src/)
   │  通过 V8 嵌入 API 创建 Isolate、编译脚本、调用 JS 函数
   ▼
V8 引擎
   ├─ Isolate        （独立 V8 实例，含堆、GC、编译管线）
   ├─ Context        （独立的全局对象/执行上下文，一个 Isolate 可有多个）
   ├─ Heap + GC      （内存管理）
   ├─ Compiler       （Ignition / Sparkplug / Maglev / TurboFan 管线）
   └─ API (v8.h)     （C++ 嵌入接口，Node 用它暴露 require/process 等）
   ▼
JS 代码执行
```

Node 启动时（`src/node.cc`）创建**一个主 Isolate**，主 `Realm` 的 `v8::Context`（见 00-03、04-01）。worker_threads 给每个 worker 创建独立 Isolate（见 05-07）。

---

## 3. 核心概念速记

| 概念 | 说明 |
|------|------|
| **Isolate** | 一个独立的 V8 引擎实例，拥有自己的堆、GC、编译状态。进程内可有多个（worker），但同一 Isolate 不可跨线程共享。 |
| **Context** | 一个独立的 JS 执行上下文（全局对象 `globalThis`）。同 Isolate 内可有多个 Context（用于隔离不同 JS 环境，如 ShadowRealm）。 |
| **Handle** | 对 V8 内部对象的引用。`Local`（栈上、随作用域失效）与 `Persistent`（堆上、长期持有，如 `BaseObject::object_`）。 |
| **HandleScope** | 批量管理 `Local` 句柄的生命周期，离开作用域时统一释放。 |
| **Script / Module** | 编译单元。`Script::Compile` 编译普通脚本；`Module` 编译 ES Module。 |
| **FunctionTemplate / ObjectTemplate** | 描述 C++ 函数/对象如何暴露给 JS，是绑定层的基础。 |

---

## 4. 执行 JS 的最小嵌入示例（概念）

```cpp
// 伪代码：宿主如何用 V8 跑一段 JS（参考 V8 官方 sample）
v8::Isolate* isolate = v8::Isolate::New(params);
{
  v8::Isolate::Scope isolate_scope(isolate);
  v8::HandleScope handle_scope(isolate);
  v8::Local<v8::Context> context = v8::Context::New(isolate);
  v8::Context::Scope context_scope(context);

  v8::Local<v8::String> src = v8::String::NewFromUtf8Literal(isolate, "'hi'");
  v8::Local<v8::Script> script = v8::Script::Compile(context, src).ToLocalChecked();
  v8::Local<v8::Value> result = script->Run(context).ToLocalChecked();
  // result 是 "hi"
}
isolate->Dispose();
```

Node 的 `src/node.cc` 就是在这个框架上做了大量扩展：注入 `process`、`require`、`internalBinding` 等（见 00-03、04-01）。

---

## 5. JIT 编译（预告）

V8 不是解释器，也不是传统 AOT 编译器，而是**分层 JIT（Just-In-Time）**：
- 先快速把 JS 编译成字节码（Ignition）并执行。
- 对热点函数逐步用更激进的优化编译器（Sparkplug → Maglev → TurboFan）编译成高效机器码。

详见 03-02。

---

## 6. 内存与 GC（预告）

V8 用分代堆 + 多色标记 GC（Orinoco）。Node 的内存上限、GC 停顿、内存泄漏都源于此。详见 03-03、07-01。

---

## 7. 可运行验证

```js
// 观察 V8 版本与编译信息
console.log(process.versions.v8);
// 观察 JIT：用 --trace-opt / --trace-deopt 看优化与去优化
```

```bash
node --trace-opt -e "function add(a,b){return a+b} for(let i=0;i<1e6;i++) add(i,i)" 2>&1 | head
# 会显示 add 被 TurboFan 优化
```

---

## 8. 本章总结

- V8 是 JS/Wasm 引擎，负责编译执行 + 内存管理 + 嵌入 API；不含 I/O / DOM。
- 在 Node 中：主 Isolate 对应主进程，每个 worker 独立 Isolate。
- 核心概念：Isolate（实例）、Context（执行上下文）、Handle（对象引用）、Template（绑定描述）。
- V8 用分层 JIT 与分代 GC，是 Node 性能与内存行为的根源。

---

## 9. 思考题

1. 为什么一个 V8 Isolate 不能被多个 OS 线程同时访问？Node 如何用 worker_threads 规避这一点？
2. `Context` 和 `Isolate` 的层级关系是什么？一个 Isolate 可以有多个 Context 有什么用处？
3. `Local` 和 `Persistent` 句柄的生命周期管理有何不同？Node 的 `BaseObject::object_` 用的是哪种？
