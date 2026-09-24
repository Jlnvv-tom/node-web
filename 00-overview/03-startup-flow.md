# 00-03 从 `node_main.cc` 到你的代码执行

> 本章目标：把"敲下 `node app.js` 回车"到"你的第一行 JS 跑起来"之间的链路讲清楚。这是理解 Node 启动心智模型最重要的一篇。

---

## 1. 总体链路（先记住这条主干）

```
shell 执行 `node app.js`
        │
        ▼
┌─────────────────────────────────────────────┐
│ src/node_main.cc  :: main(argc, argv)         │  ← C++ 入口
└──────────────────────┬──────────────────────┘
                       ▼
┌─────────────────────────────────────────────┐
│ src/node.cc :: node::Start(...)              │  ← 进程级初始化
│   ├─ InitializeOncePerProcess()              │
│   ├─ NodeMainInstance 构造                    │
│   └─ NodeMainInstance::Run()                 │
└──────────────────────┬──────────────────────┘
                       ▼
┌─────────────────────────────────────────────┐
│ src/node_main_instance.cc                     │
│   └─ NodeMainInstance::Run()                 │
│       └─ Realm::BootstrapRealm()             │  ← 创建 JS 上下文
└──────────────────────┬──────────────────────┘
                       ▼
┌─────────────────────────────────────────────┐
│ lib/internal/bootstrap/realm.js               │  ← 注入全局对象
│   └─ 准备 global / process / internalBinding │
└──────────────────────┬──────────────────────┘
                       ▼
┌─────────────────────────────────────────────┐
│ lib/internal/bootstrap/node.js                │  ← 选择启动模式
│   └─ 决定走 run_main_module / eval / repl ... │
└──────────────────────┬──────────────────────┘
                       ▼
┌─────────────────────────────────────────────┐
│ lib/internal/main/run_main_module.js          │  ← 加载你的 app.js
│   └─ Module._load(process.argv[1])           │
└──────────────────────┬──────────────────────┘
                       ▼
             你的 app.js 开始执行 🎉
```

下面逐段展开。

---

## 2. C++ 入口：`src/node_main.cc`

`main()` 做的最少：解析少量早期参数，调用平台初始化，然后转交 `node::Start()`。

```cpp
// 伪代码，非逐行
int main(int argc, char* argv[]) {
  // 平台相关初始化（signal、locale...）
  return node::Start(argc, argv);
}
```

`node::Start` 是 Node 公共 API（在 `src/node.h` 声明），也是嵌入 Node 到其他程序的入口点。

---

## 3. 进程级初始化：`src/node.cc`

`node::Start` 大致流程：

1. **`InitializeOncePerProcess()`**
   - 初始化 V8 平台（`V8::InitializePlatform` / `V8::Initialize`）。
   - 加载启动快照（`InitializeSnapshotOnce`）。
   - 注册 Node 的内建模块（`RegisterBuiltinModules()`）——这步建立了 C++ 模块表，后续 `internalBinding` 才能查到。
   - 设置信号处理器（SIGINT/SIGTERM…）。

2. **构造 `NodeMainInstance`**
   - 持有一个 `v8::Isolate`（V8 实例）。
   - 在 `NodeMainInstance` 构造时初始化 Isolate、创建 `Environment` 的雏形。

3. **`NodeMainInstance::Run()`**
   - 进入 `env->Run()` 之前，先设置好主线程的 libuv loop（`uv_default_loop()`）。
   - 调用 `Realm::BootstrapRealm(env, context)` 真正创建 JS 执行上下文。

> 关键对象关系：**`Isolate`（V8）↔ `Environment`（Node 进程状态）↔ `Realm`（JS 上下文）**。一个进程一个主 `Environment`，每个 `worker_thread` 有独立 `Isolate`+`Environment`+`Realm`。

---

## 4. 引导 JS 上下文：`lib/internal/bootstrap/realm.js`

`Realm::BootstrapRealm` 会执行 `lib/internal/bootstrap/realm.js`（经 V8 编译后的快照代码）。它的职责是**搭建 JS 世界的骨架**：

- 创建 `globalThis`、`global` 对象。
- 注入 `process` 对象（来自 C++ `env` 的 `process_object`）。
- 定义 `internalBinding(name)` 与 `process.binding(name)`：JS 借此访问 C++ 绑定（受 `processBindingAllowList` 白名单限制）。
- 建立内置模块的 loader（让 `require('fs')` 能解析到 `lib/fs.js`）。
- 设置 `queueMicrotask`、`Promise` 等基础能力。

此时 JS 环境已经"活"了，但还没运行任何用户代码。

---

## 5. 选择启动模式：`lib/internal/bootstrap/node.js`

`bootstrap/node.js` 根据命令行参数决定**以什么模式启动**：

| 模式 | 入口脚本 | 触发条件 |
|------|---------|---------|
| 运行主模块 | `lib/internal/main/run_main_module.js` | 默认（`node app.js`） |
| 执行字符串 | `lib/internal/main/eval_string.js` | `node -e "..."` |
| 从 stdin | `lib/internal/main/eval_stdin.js` | `node -i < script.js` |
| REPL | `lib/internal/main/repl.js` | `node` 无参数 / `-i` |
| 语法检查 | `lib/internal/main/check_syntax.js` | `node --check` |
| 调试器 | `lib/internal/main/inspect.js` | `node inspect` |
| 测试运行器 | `lib/internal/main/test_runner.js` | `node --test` |
| 监听模式 | `lib/internal/main/watch_mode.js` | `node --watch` |
| Worker | `lib/internal/main/worker_thread.js` | 被 worker 启动时 |
| 嵌入模式 | `lib/internal/main/embedding.js` | `node --experimental-embedding` |
| 性能分析 | `lib/internal/main/prof_process.js` | `node --prof-process` |

默认情况下走 **`run_main_module.js`**。

---

## 6. 加载你的模块：`run_main_module.js`

`run_main_module.js` 的核心动作：

```js
// 伪代码
const { Module } = require('internal/modules/cjs/loader');
Module.runMain(process.argv[1]);   // 即 app.js
```

`Module.runMain` → `Module._load(path)` → 读取文件 → 包裹 `(function(exports, require, module, __filename, __dirname){ ... })` → `vm.runInThisContext` 编译执行。

此刻，你的 `app.js` 顶层代码开始跑。Node 的"启动阶段"正式结束，进入"用户代码 + 事件循环"阶段。

---

## 7. 事件循环何时启动？

注意一个常见的误解：**事件循环不是在某个显式 `uv_run()` 调用时才开始**。实际上：

- 启动引导（bootstrap）本身是在主线程同步执行的 JS。
- 一旦用户代码里注册了定时器、发起网络请求、`process.nextTick` 等，回调被挂到 libuv 的各队列。
- 当主模块执行完毕、同步栈清空后，Node 进入 `uv_run()` 主循环，开始消费这些回调。
- 如果所有队列都空且无待处理句柄，事件循环退出，进程结束。

可以这样理解：`node app.js` 启动阶段 = 同步构造好 JS 环境并跑一遍你的顶层代码；`uv_run` = 之后持续的"事件→回调"循环，直到没有事可做。

---

## 8. 可运行验证

你可以亲眼看到启动顺序：

```bash
# 观察 Node 内部启动日志（需 debug 构建，或依赖 --trace-*）
node --trace-events-enabled app.js

# 看 process 对象是如何在很早期就存在的
node -e "console.log(typeof process, typeof require, typeof internalBinding)"
# → function function function
```

`internalBinding` 在 REPL 里也能直接用，证明引导阶段已经把它注入到了全局。

---

## 9. 本章总结

- 启动是 **C++ 引导 → 创建 V8 Isolate/Environment/Realm → 执行 bootstrap JS → 选模式 → 加载 app.js** 的链条。
- `src/node_main.cc` → `node::Start`（`src/node.cc`）→ `NodeMainInstance::Run` → `Realm::BootstrapRealm`（`bootstrap/realm.js`）→ `bootstrap/node.js` → `run_main_module.js` → 你的代码。
- 事件循环在顶层同步代码清空后才真正"接管"回调调度。
- `internalBinding` 是 JS 触达 C++ 的钥匙，白名单由 `processBindingAllowList` 控制。

---

## 10. 思考题

1. 为什么 `process` 对象在 `app.js` 第一行就能用，而它明明是 C++ 层构建的？
2. 如果你写 `node -e "require('fs')"`，启动链路会跳过 `run_main_module.js` 而走哪个入口？
3. Worker 线程启动时会再跑一遍 `node_main.cc` 的 `main()` 吗？为什么需要独立的 `worker_thread.js` 入口？
