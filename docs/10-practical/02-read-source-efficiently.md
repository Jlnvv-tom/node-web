# 10-02 如何高效阅读 Node.js 源码

> 本章目标：提供一套系统的 Node.js 源码阅读方法论，避免在百万行代码中迷失。

## 导读

Node.js 仓库约 **100 万行代码**（含 deps/）。直接从 `src/node_main.cc` 开始线性阅读会迷失。需要一套导航策略。

## 源码目录速查

```
node/
├── src/              # C++ 源码（Node.js 核心，约 10 万行）
│   ├── node_main.cc    # 程序入口
│   ├── node.cc         # Node::Start、初始化
│   ├── node_file.cc    # fs 模块 C++ 绑定
│   ├── node_tcp.cc     # net 模块 C++ 绑定
│   ├── node_http*      # http 模块 C++ 绑定
│   ├── node_crypto.cc  # crypto 模块
│   └── node_api.cc     # N-API 实现
├── lib/              # JavaScript 核心模块（约 3 万行）
│   ├── internal/       # 内部模块（不暴露给用户）
│   │   ├── bootstrap/  # 启动引导
│   │   ├── modules/    # 模块加载器
│   │   └── ...
│   ├── fs.js           # fs 模块 JS 层
│   ├── http.js         # http 模块 JS 层
│   ├── net.js          # net 模块 JS 层
│   └── ...
├── deps/             # 第三方依赖（约 80 万行）
│   ├── v8/             # V8 引擎（最大）
│   ├── uv/             # libuv
│   ├── openssl/        # OpenSSL
│   ├── acorn/          # JS 解析器
│   └── ...
├── test/             # 测试（约 20 万行，非常好的学习材料）
├── tools/            # 构建/代码生成工具
└── doc/              # 文档
```

## 阅读策略：自顶向下 + 带问题阅读

### 策略 1：从入口跟踪到用户代码

问题：`node app.js` 回车后发生了什么？

```
src/node_main.cc → main()
  → src/node.cc → node::Start()
    → InitializeOncePerProcess()
    → NodeMainInstance::Run()
      → Realm::BootstrapRealm()
        → lib/internal/bootstrap/realm.js
        → lib/internal/bootstrap/node.js
      → ExecuteInRealm()
        → lib/internal/modules/run_main.js
          → Module._load(process.argv[1])
            → lib/internal/modules/cjs/loader.js
              → 读取 app.js → 编译 → 执行
```

### 策略 2：从一个 JS API 追到底层

问题：`fs.readFileSync('/tmp/x')` 经过了哪些层？

```
lib/fs.js: readFileSync()
  → binding.readFileSync()        // JS → C++ 边界
    → src/node_file.cc: Read()    // C++ 回调
      → uv_fs_read()              // libuv
        → read()                  // 系统调用
```

### 策略 3：从一个现象理解机制

问题：为什么 `setTimeout(fn, 0)` 比 `setImmediate(fn)` 慢？

```
答案在事件循环阶段顺序：
  timers → pending → idle/prepare → poll → check → close
                                   ↑          ↑
                              (poll 可阻塞)  setImmediate 在 check
                              setTimeout 在 timers

  如果 setTimeout 延迟 ≥ 1ms（Node 最小钳制），且事件循环很快进入 poll，
  则 timers 在下一轮才触发。setImmediate 在本轮 check 阶段就触发了。
```

## 源码索引表

| 想了解 | 看哪里 |
|--------|--------|
| 启动流程 | `src/node_main.cc` → `src/node.cc` |
| 模块加载 | `lib/internal/modules/cjs/loader.js` |
| 事件循环 | `deps/uv/src/unix/core.c` (`uv_run`) |
| 定时器 | `deps/uv/src/unix/timer.c` + `lib/timers.js` |
| fs 模块 | `lib/fs.js` → `src/node_file.cc` |
| HTTP 解析 | `src/node_http_parser.cc` (llhttp) |
| Stream | `lib/internal/streams/` |
| Worker Threads | `src/node_worker.cc` |
| N-API | `src/node_api.cc` |
| GC / 堆 | V8 `src/heap/` |

## 工具辅助

### 1. grep / ripgrep

```bash
# 找函数定义
rg "void Start\(" src/

# 找所有 NODE_MODULE 注册
rg "NODE_MODULE_CONTEXT_AWARE_INTERNAL" src/

# 找 internalBinding 调用
rg "internalBinding\(" lib/
```

### 2. --trace 系列标志

```bash
node --trace-warnings app.js
node --trace-event-categories=node.async_hooks app.js
node --trace-deprecation app.js
node --trace-sync-io app.js
```

### 3. --print-bytecode

```bash
node --print-bytecode -e "for(let i=0;i<10;i++){}"
# 输出 V8 生成的字节码
```

### 4. 测试用例当文档

```bash
# test/parallel/test-fs-read.js
# test/parallel/test-vm-createcontext.js
# 这些测试展示了每个 API 的预期行为和边界条件
```

## 总结

| 方法 | 适用场景 |
|------|----------|
| 自顶向下追踪入口 | 理解启动流程 |
| 从 JS API 往下追 | 理解特定模块实现 |
| 从现象出发 | 理解事件循环、异步行为 |
| 读测试用例 | 快速了解 API 行为 |
| --trace 标志 | 观察运行时行为 |

## 思考题

1. 如果你想理解 `process.nextTick` 为什么比 `Promise` 微任务先执行，应该看哪些源码文件？
2. `deps/` 目录占了 80%+ 的代码量，但你几乎不需要直接读它。为什么？
3. `test/parallel/` 下的测试文件命名有什么规律？它如何帮助你定位源码？