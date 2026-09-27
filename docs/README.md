# Node.js 核心源码解读教程

> 自顶向下、源码级的 Node.js 内核解读。回答一个问题:
> **"敲下 `node app.js` 回车后,到你的代码执行,再到 I/O / 模块 / 内存 / 并发被管理--中间到底发生了什么?"**

## 阅读路径

```
操作系统 → libuv → V8 → C++ Bindings → JS 核心模块 → 用户代码
```

## 目录

| 篇章 | 主题 | 入口 |
|------|------|------|
| 00 总览 | 架构全景 / 源码结构 / 启动流程 | [00-overview/](./00-overview/) |
| 01 操作系统 | epoll/kqueue/IOCP/io_uring · fd · 线程 · 系统调用 | [01-os-layer/](./01-os-layer/) |
| 02 libuv | 事件循环六阶段 · 线程池 · 网络/文件 I/O · 定时器 | [02-libuv/](./02-libuv/) |
| 03 V8 | 多级 JIT · GC · Isolate · Embedding API | [03-v8-engine/](./03-v8-engine/) |
| 04 C++ 绑定 | Environment/Realm/BaseObject · AsyncWrap · TCPWrap · N-API | [04-cpp-bindings/](./04-cpp-bindings/) |
| 05 JS 模块 | CJS/ESM 加载器 · EventEmitter · Stream · HTTP · net · fs · crypto · timers · worker · cluster · process | [05-js-core-modules/](./05-js-core-modules/) |
| 06 事件循环 | 微任务 vs 宏任务 · setImmediate 时序 · 阶段走读 | [06-event-loop-deep-dive/](./06-event-loop-deep-dive/) |
| 07 内存性能 | V8 堆 GC · 泄漏排查 · Buffer · perf_hooks | [07-memory-and-performance/](./07-memory-and-performance/) |
| 08 Electron | 双进程 · 共享 V8 · 事件循环合并 · IPC · preload 安全 | [08-electron-integration/](./08-electron-integration/) |
| 09 跨平台 | libuv 抽象 · child_process · 原生插件 | [09-cross-platform/](./09-cross-platform/) |
| 10 实战 | 源码编译 · 阅读方法 · GDB 调试 · 写原生插件 | [10-practical/](./10-practical/) |
| 附录 | 术语表 · 参考 · 源码索引 | [appendix/](./appendix/) |

## 编写状态

- ✅ 全部 63 篇完成（12 个章节/附录，详见 [PLAN.md](./PLAN.md)）
- ✅ 00 总览（3/3）
- ✅ 01 操作系统层（4/4）
- ✅ 02 libuv（7/7）
- ✅ 03 V8 引擎（6/6）
- ✅ 04 C++ 绑定（6/6）
- ✅ 05 JS 核心模块（14/14）
- ✅ 06 事件循环专题（4/4）
- ✅ 07 内存与性能（4/4）
- ✅ 08 Electron 集成（5/5）
- ✅ 09 跨平台（3/3）
- ✅ 10 实战篇（4/4）
- ✅ 附录（3/3：术语表 / 参考 / 源码索引）

## 约定

- 每篇结构:导读 → 架构图 → 源码走读 → 带注释代码 → 总结 → 思考题
- 源码引用标注文件路径与行号,如 `src/node.cc`、`deps/uv/src/unix/core.c`
- 术语保留英文(Isolate / Realm / Wrap / Binding / Tick...)

## 参考

- Node.js 源码:https://github.com/nodejs/node
- libuv 文档:https://docs.libuv.org
- V8 文档:https://v8.dev/docs
- Electron 架构:https://www.electronjs.org/docs/latest/
