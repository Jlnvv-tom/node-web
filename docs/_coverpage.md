![logo](https://nodejs.org/static/images/favicons/favicon.png)

# Node.js 核心源码解读

> 自顶向下、源码级的 Node.js 内核解读

- 回答一个问题：**敲下 `node app.js` 回车后，到你的代码执行，再到 I/O / 模块 / 内存 / 并发被管理——中间到底发生了什么？**
- 解读路径：`操作系统 → libuv → V8 → C++ Bindings → JS 核心模块 → 用户代码`

[开始阅读](README.md "开始阅读")

<hr/>

**篇章导航**

- `00` 总览篇 · `01` 操作系统层 · `02` libuv 层
- `03` V8 引擎层 · `04` C++ 绑定层 · `05` JS 核心模块
- `06` 事件循环专题 · `07` 内存与性能 · `08` Electron 集成 · `09` 跨平台实现

> 参考：Node.js 源码 · libuv 文档 · V8 文档 · Electron 架构文档
