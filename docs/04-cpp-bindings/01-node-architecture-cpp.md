# 04-01 C++ 绑定层核心抽象：Environment / Realm / BaseObject

> 本章目标：进入 Node 的 C++ "骨架"，理解三个贯穿全局的核心类——`Environment`、`Realm`、`BaseObject`。读懂它们，就读懂了 Node 如何把 C++ 世界和 JS 世界缝合在一起。

---

## 1. 为什么需要 C++ 绑定层

V8 只提供"运行 JS、管理内存"的能力。当你调用 `fs.readFile`、创建 `net.Socket`、访问 `process`，这些都不是 V8 自带的——它们是 Node 用 C++ 写的，再通过 V8 的 API 暴露给 JS。

C++ 绑定层就是**这个"暴露"的胶水**：它把 libuv、OpenSSL、zlib 等库的能力，包装成 JS 可调用的函数/对象。

核心文件：`src/env.h`、`src/node_realm.h`、`src/base_object.h`。

---

## 2. `Environment`：进程/线程级状态容器

```cpp
// src/env.h （简化）
class Environment {
 public:
  uv_loop_t* event_loop() const;          // 本进程的事件循环
  v8::Isolate* isolate() const;            // 对应的 V8 实例
  v8::Local<v8::Context> context() const; // 默认上下文
  IsolateData* isolate_data() const;
  // 各类绑定表
  BindingDataStore& bindings();            // internalBinding 查找表
  // 内置模块表
  BuiltinLoader* builtin_loader();
  // 退出处理
  void Exit(int exit_code);
 private:
  uv_loop_t* const event_loop_;            // libuv 主循环
  v8::Isolate* const isolate_;             // V8 实例
  v8::Persistent<v8::Context> context_;    // 主 realm 的上下文
  // ... inspector agent、options、async hooks state、exit handlers ...
};
```

`Environment` 是一个 Node **进程（或 worker 线程）的全局状态中心**：

- 持有 `uv_loop_t*`（事件循环）。
- 持有 `v8::Isolate*`（V8 实例，内存与执行上下文的隔离单元）。
- 持有内置模块表、binding 表、inspector、退出处理器等。
- 由 `NodeMainInstance` 在启动期创建（见 00-03）。

> 记忆：**一个 Node 进程 = 一个主 Environment；每个 worker_thread = 一个独立 Environment（独立 Isolate + 独立 loop）。**

---

## 3. `Realm`：JS 执行上下文

```cpp
// src/node_realm.h （简化）
class Realm {
 public:
  Environment* env() const;                       // 反向指回 Environment
  v8::Local<v8::Context> context() const;          // 这个 realm 的 V8 上下文
  // 各类 JS 全局对象的持久引用
  v8::Persistent<v8::Object> process_object();      // process
  v8::Persistent<v8::Object> global_object();      // globalThis
  // builtin loader（每个 realm 有自己的模块加载器）
  BuiltinLoader* builtin_loader();
 private:
  Environment* env_;                               // 所属 Environment
  v8::Persistent<v8::Context> context_;            // 本 realm 的上下文
  // bindings：此 realm 已加载的 internalBinding 缓存
  // principal realm / shadow realm / worker realm
};
```

Node 中有三类 Realm：
- **Principal Realm**：主上下文（即你 `node app.js` 运行的地方）。
- **ShadowRealm**（实验性）：V8 ShadowRealm 支持。
- **Worker Realm**：每个 `worker_thread` 一个。

`Realm` 持有"这个上下文里有哪些全局对象、哪些 binding 已加载"。它是 JS 世界与 C++ 世界的**对接面**——`internalBinding` 的解析就是按 realm 缓存的。

---

## 4. `BaseObject`：有 JS 包装的 C++ 对象基类

```cpp
// src/base_object.h （简化）
class BaseObject : public MemoryRetainer {
 public:
  Environment* env() const;
  v8::Local<v8::Object> object() const;           // 对应的 JS 包装对象
  // 弱/强引用管理：JS 对象被 GC 时，C++ 侧如何清理
  void MakeWeak();                                 // 允许 JS 侧被回收
 protected:
  v8::Global<v8::Object> object_;                  // 与 JS 对象的双向引用
};
```

`BaseObject` 是所有"能在 JS 里拿到的 C++ 对象"的基类。它解决了一个核心问题：

> **C++ 的 `TCPWrap` 和 JS 的 `net.Socket` 如何相互引用？当 JS 对象被 GC 时，C++ 资源怎么释放？**

机制：
- `object_` 是 `net.Socket` 对应的 JS 对象的持久引用。
- 当 JS 侧不再引用 `net.Socket` 时，V8 会触发弱回调，`BaseObject` 的 `MakeWeak` 让 C++ 侧知道"可以清理 libuv handle 了"。
- 反之，C++ 侧在收到 I/O 事件时，通过 `object()` 找回 JS 对象，调用其上的回调。

---

## 5. 三者关系图

```
┌──────────────────────────────────────────────────────┐
│  Environment（进程级单例）                            │
│    ├─ uv_loop_t*         事件循环                     │
│    ├─ v8::Isolate*       V8 实例                     │
│    ├─ bindings 表         internalBinding 缓存        │
│    └─ Realm（主）         ─────────────┐             │
│                                         │ 持有        │
│                                         ▼            │
│         ┌─────────────────────────────────────┐      │
│         │  Realm（JS 执行上下文）               │      │
│         │   ├─ v8::Context                    │      │
│         │   ├─ process_object (JS)            │      │
│         │   └─ 已加载的 bindings 缓存          │      │
│         └─────────────────────────────────────┘      │
│                                          │           │
│         BaseObject 实例（如 TCPWrap）      │ 持有      │
│           └─ object_ → JS 的 net.Socket ───┘ 双向引用 │
└──────────────────────────────────────────────────────┘
```

简化记忆：
- **Environment** = "整个进程的地盘"（loop + isolate + 全局表）。
- **Realm** = "一块 JS 执行空间"（context + 全局对象）。
- **BaseObject** = "一个具体的 C++ 资源，能映射到 JS 对象"。

---

## 6. 一个具体例子：从 `net.Socket` 看三层

```js
const socket = new net.Socket();
```
```
JS:  net.Socket  (lib/net.js)
  │
  ▼
C++: TCPWrap  extends BaseObject
  │   Realm 的 internalBinding('tcp').TCPWrap 构造它
  │   object_ 指向 JS 的 socket 实例
  ▼
C++: uv_tcp_t  (libuv handle，注册到 Environment 的 loop)
  │
  ▼
OS: 内核 socket fd（epoll/kqueue 监听）
```

当 fd 可读时：libuv → `TCPWrap::OnRead` → `MakeCallback` → JS `socket.emit('data')`。

---

## 7. 本章总结

- `Environment` 是进程级状态中心（loop + isolate + 绑定表）；worker 有独立 Environment。
- `Realm` 是 JS 执行上下文，连接 JS 全局与 C++ binding，分 principal/shadow/worker 三类。
- `BaseObject` 是所有"JS 可见 C++ 对象"的基类，用 `object_` 与 JS 对象双向引用，并处理 GC 时资源清理。
- 三者构成 Node 运行时骨架：Environment 管地盘、Realm 管空间、BaseObject 管具体资源。

---

## 8. 思考题

1. 为什么 `Environment` 要持有 `uv_loop_t*` 和 `v8::Isolate*` 两个"引擎"的指针？
2. `internalBinding('fs')` 的返回值是按 Environment 缓存还是按 Realm 缓存？这有什么影响？
3. 如果 `BaseObject::MakeWeak` 没有被调用，会发生什么（内存角度）？
