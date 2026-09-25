# 03-04 V8 嵌入 API 与 Node 如何使用它

> 本章目标：理解 V8 的 C++ 嵌入接口（Isolate / Context / Handle / Template），以及 Node 如何用这套 API 把 C++ 函数和对象"暴露"给 JS 世界。

---

## 1. 嵌入 API 是什么

V8 不只是个"解释器"，它提供了一套 **C++ API（`v8.h`）**，允许宿主程序（如 Node）嵌入 V8、执行 JS、并在 JS 与 C++ 之间互相调用。正是这套 API 让 Node 能把 `fs`、`net`、`process` 等 C++ 能力暴露给 JS。

核心类型（见 03-01）：
- `v8::Isolate`：引擎实例。
- `v8::Context`：执行上下文。
- `v8::Local<T>` / `v8::Persistent<T>`：对象句柄。
- `v8::FunctionTemplate` / `v8::ObjectTemplate`：描述如何把 C++ 暴露为 JS。

---

## 2. 把 C++ 函数暴露给 JS：`FunctionTemplate`

```cpp
// 伪代码：把一个 C++ 函数暴露为 JS 全局函数
void MyAdd(const v8::FunctionCallbackInfo<v8::Value>& args) {
  double a = args[0]->NumberValue(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
  double b = args[1]->NumberValue(args.GetIsolate()->GetCurrentContext()).FromMaybe(0);
  args.GetReturnValue().Set(a + b);
}

// 注册
v8::Local<v8::FunctionTemplate> t = v8::FunctionTemplate::New(isolate, MyAdd);
v8::Local<v8::Function> fn = t->GetFunction(context).ToLocalChecked();
global->Set(context, v8::String::NewFromUtf8Literal(isolate, "add"), fn).Check();
```

之后 JS 就能调用 `add(1, 2)`。

Node 的 `internalBinding('fs')`、`TCPWrap` 等都是通过这种方式，把 C++ 类/函数挂到 JS 全局或模块对象上（见 04-01、04-04）。

---

## 3. Handle 与 HandleScope

V8 的 GC 需要知道哪些 JS 对象还被 C++ 引用。`Local` 是栈上的临时引用，必须活在 `HandleScope` 内：

```cpp
{
  v8::HandleScope scope(isolate);
  v8::Local<v8::String> s = v8::String::NewFromUtf8Literal(isolate, "hi");
  // s 在 scope 结束前有效
}
// 离开 scope 后，s 可能立即被回收（除非另有 Persistent 引用）
```

`Persistent` 用于长期持有（如 `BaseObject::object_`，见 04-01）：它存在堆上，不受 HandleScope 限制，但需手动 `Reset` 释放，否则内存泄漏。

---

## 4. Node 与 V8 的交互点

| Node 行为 | 用到的 V8 API |
|-----------|--------------|
| 启动 JS 上下文 | `Isolate::New` / `Context::New` |
| 执行模块代码 | `Script::Compile` / `Module::Evaluate`（ESM） |
| 暴露 `process`/`require` | `ObjectTemplate::Set` / `FunctionTemplate::New` |
| C++ 绑定 | `FunctionTemplate` / `SetProtoMethod` |
| 异步回调回 JS | `MakeCallback` / `Function::Call` |
| 微任务 | `MicrotasksScope`（nextTick/Promise 清空，见 06-01） |
| GC 钩子 | `Isolate::AddGCEpilogueCallback` 等 |

`BaseObject`（04-01）正是用 `Persistent<v8::Object>` 持有 JS 对象，并在 V8 GC 时通过弱引用回调清理 C++ 资源。

---

## 5. `MakeCallback`：C++ 调用 JS 的标准姿势

当 libuv 完成 I/O，需要回调 JS 时，Node 不能直接 `Function::Call`，而要用 `MakeCallback`：

```cpp
// src/node_internals.h 风格
void MakeCallback(Environment* env, v8::Local<v8::Object> recv,
                  v8::Local<v8::Function> cb, int argc, v8::Local<v8::Value>* argv) {
  // 1) 进入 InternalCallbackScope（触发 async_hooks before、清空 nextTick/microtask）
  // 2) 调用 cb->Call(env->context(), recv, argc, argv)
  // 3) 退出 scope（触发 after、处理异常边界）
}
```

这保证了每次回调 JS 都遵循一致的"异步上下文"规则（async hooks、微任务清空、异常隔离），不会破坏事件循环语义。

---

## 6. 嵌入 V8 的注意事项

- **Isolate 不可跨线程**：一个 Isolate 同一时刻只能被一个线程访问（worker_threads 各持独立 Isolate）。
- **异常**：JS 抛错在 C++ 侧表现为 `TryCatch`，必须处理，否则可能崩溃。
- **句柄泄漏**：忘记 `Reset` Persistent 会泄漏 JS 对象（GC 无法回收）。
- **API 版本敏感**：V8 API 变动频繁，Node 用 `NODE_MODULE_VERSION` 锁定 ABI（见 04-06 N-API 的动机）。

---

## 7. 可运行验证（概念）

Node 本身的启动就演示了嵌入：
```bash
node --trace -e "console.log('hi')"   # 观察 V8 初始化与脚本编译
```

或读 `src/node.cc` 的 `Start`：能看到 `Isolate::New` → `Context::New` → `Script::Run` 的标准嵌入流程。

---

## 8. 本章总结

- V8 嵌入 API（Isolate/Context/Handle/Template）让宿主把 C++ 暴露给 JS。
- `FunctionTemplate` 是 Node C++ 绑定（如 `internalBinding`）的基石。
- `Local` 临时、`Persistent` 长期；`HandleScope` 批量管理生命周期。
- `MakeCallback` 是 C++ 回调 JS 的标准姿势，统一了异步语义。
- Isolate 单线程、句柄泄漏、异常与 ABI 是嵌入的注意点。

---

## 9. 思考题

1. 如果不使用 `MakeCallback` 而是直接 `Function::Call` 来回调 JS，会破坏 Node 的哪些语义？
2. `Local` 句柄为什么必须活在 `HandleScope` 内？如果跨 scope 持有 `Local` 会怎样？
3. 为什么每个 worker_threads 必须有独立 Isolate，而不能共享主线程的 Isolate？
