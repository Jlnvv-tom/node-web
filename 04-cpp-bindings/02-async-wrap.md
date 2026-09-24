# 04-02 AsyncWrap：异步资源生命周期追踪

> 本章目标：理解 Node 如何给"每一个异步操作"打上 ID 并追踪其完整生命周期——这是 `async_hooks`、`diagnostics_channel`、以及异步上下文（AsyncLocalStorage）的底层基石。

---

## 1. 问题背景

异步代码里，一个请求会"分叉"出无数回调：`setTimeout` → I/O 回调 → `Promise` → 子 I/O…。当出错时，错误栈往往只显示"事件循环里某回调"，**你无法知道这个异步操作是从哪里发起的**。

`AsyncWrap` 就是 Node 用来解决这个问题的 C++ 机制：它给每个异步资源分配一个 `asyncId`，并记录"谁触发了它"（父 `triggerAsyncId`），从而构建出一棵异步调用树。

---

## 2. 核心类

```cpp
// src/async_wrap.h （简化）
class AsyncWrap : public BaseObject {
 public:
  AsyncWrap(Environment* env,
            v8::Local<v8::Object> object,
            AsyncWrap::ProviderType provider,
            double execution_async_id = kInvalidAsyncId,
            bool silent = false);

  double get_async_id() const;                  // 本资源的 asyncId
  double get_trigger_async_id() const;          // 触发者的 asyncId

  // 生命周期钩子入口
  void EmitAsyncInit();                          // init 阶段
  void EmitAsyncBefore();                        // before 阶段
  void EmitAsyncAfter();                         // after 阶段
  void EmitDestroy();                            // destroy 阶段
 private:
  double async_id_;                             // 唯一 ID
  double trigger_async_id_;                     // 父 ID
};
```

每个 `AsyncWrap` 子类（如 `TCPWrap`、`FSReqCallback`、定时器）都继承这套机制，自动获得 asyncId 追踪。

---

## 3. 四个生命周期阶段

Node 在异步操作的四个关键时刻触发钩子（供 `async_hooks` 监听）：

```
init     资源被创建（分配 asyncId + triggerAsyncId）
  │
before   资源对应的回调即将执行（进入 JS 前）
  │         （多次回调会多次 before/after 配对）
after     回调执行完毕
  │
destroy  资源被销毁（fd 关闭 / GC）
```

对应关系（`async_hooks` 回调）：
| AsyncWrap 方法 | async_hooks 事件 |
|----------------|------------------|
| `EmitAsyncInit` | `init(asyncId, type, triggerAsyncId, resource)` |
| `EmitAsyncBefore` | `before(asyncId)` |
| `EmitAsyncAfter` | `after(asyncId)` |
| `EmitDestroy` | `destroy(asyncId)` |

---

## 4. asyncId 与 triggerAsyncId

- **asyncId**：本异步资源的唯一编号，全局递增。
- **triggerAsyncId**："当前执行上下文的 asyncId"——即**是谁在代码执行期间创建了我**。

举例：
```js
fs.readFile('a.txt', cb);   // 假设这行代码在 asyncId=2 的上下文执行
```
那么 `readFile` 创建的 FSReqCallback 资源的 `triggerAsyncId = 2`，自己的 `asyncId = 7`。这表示"asyncId 7 是由 asyncId 2 触发创建的"。

由此可以从任意回调反查整条异步链：`7 → 2 → 1（root）`。

---

## 5. 实际作用：AsyncLocalStorage

你可能用过：
```js
const als = new AsyncLocalStorage();
als.run({ userId: 42 }, () => {
  fs.readFile('a.txt', () => {
    console.log(als.getStore());  // { userId: 42 } —— 即使过了多层异步！
  });
});
```

这背后的原理就是 AsyncWrap：
1. `als.run` 把当前 asyncId 关联的 store 记下来。
2. `readFile` 创建新 asyncId（7），其 `triggerAsyncId` 指向 run 时的上下文。
3. 当 `readFile` 回调执行前，`EmitAsyncBefore` 触发，Node 根据 trigger 链找到 store 并"恢复"到当前上下文。
4. `als.getStore()` 就能拿到正确的值。

**没有 AsyncWrap 的 asyncId 链，AsyncLocalStorage 无法实现。**

---

## 6. 性能代价

`async_hooks` 的 init/before/after/destroy 钩子一旦注册，会对**每一个**异步资源产生开销（每次创建/销毁都要调用你的 JS/原生钩子）。所以生产中：
- 不要全局常开 `async_hooks` 监听做常规日志。
- `AsyncLocalStorage` 本身做了优化（仅在 `run` + 跨越异步边界时成本较低），比手写 `async_hooks` 轻。
- 排查问题用 `--trace-async-hooks` 或短暂开启。

---

## 7. 与其他机制的关联

| 上层能力 | 底层依赖 |
|---------|---------|
| `async_hooks` | `AsyncWrap` 的 Emit* 方法 |
| `AsyncLocalStorage` | asyncId 链 + store 映射 |
| `diagnostics_channel` | 在 before/after 处发布消息 |
| 错误链追踪（--async-stack-traces） | triggerAsyncId 链 |

---

## 8. 本章总结

- `AsyncWrap`（继承 `BaseObject`）给每个异步资源分配 `asyncId` + `triggerAsyncId`，构建异步调用树。
- 四个生命周期钩子 `init/before/after/destroy` 对应 `async_hooks` 的回调。
- 这是 `AsyncLocalStorage`、异步错误追踪、诊断通道的底层基础。
- 钩子有性能成本，生产环境慎用全局监听。

---

## 9. 思考题

1. 为什么 `AsyncLocalStorage` 能在多层异步回调后仍然拿到 `run` 里设的值？靠的是哪条链路？
2. 如果一个异步资源从未触发回调（比如定时器被 `clearTimeout`），它的 `destroy` 会在何时触发？
3. `Promise` 是否也有 asyncId？为什么 `async_hooks` 对 Promise 的处理和 I/O 资源有所不同？
