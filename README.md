# Node.js 核心源码解读教程

[![GitHub Pages](https://img.shields.io/badge/Docs-GitHub%20Pages-blue)](https://jlnvv-tom.github.io/node-web/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E?logo=javascript)

自顶向下、源码级的 Node.js 内核解读：**操作系统 → libuv → V8 → C++ 绑定 → JS 核心模块**。
配套 Docsify 文档站，离线可用（依赖已内置于 `vendor/`）。

## 🎯 项目简介

这是一套**深度源码教程**，回答核心问题：  
> **"敲下 `node app.js` 回车后，到你的代码执行，再到 I/O / 模块 / 内存 / 并发被管理——中间到底发生了什么？"**

通过 **63 篇完整文章 + 可运行代码示例**，帮助你理解：
- ✅ 操作系统 I/O 模型（epoll/kqueue/IOCP/io_uring）
- ✅ libuv 事件循环六阶段与线程池
- ✅ V8 引擎 JIT 编译与 GC 机制
- ✅ Node.js C++ 层架构与绑定原理
- ✅ JS 核心模块实现（fs/net/http/stream/cluster/worker 等）
- ✅ 微任务/宏任务时序与异步编程
- ✅ 内存泄漏排查与性能优化
- ✅ Electron 双进程与 IPC
- ✅ 原生插件开发（N-API）

## 📚 阅读路径

```
操作系统 → libuv → V8 → C++ Bindings → JS 核心模块 → 用户代码
```

| 篇章 | 主题 | 文章数 |
|------|------|--------|
| **00 总览** | 架构全景、源码结构、启动流程 | 3/3 ✅ |
| **01 操作系统层** | fd、线程、系统调用、非阻塞 I/O | 4/4 ✅ |
| **02 libuv** | 事件循环六阶段、线程池、定时器 | 7/7 ✅ |
| **03 V8 引擎** | JIT、GC、Isolate、Embedding API | 6/6 ✅ |
| **04 C++ 绑定** | Environment、AsyncWrap、N-API | 6/6 ✅ |
| **05 JS 核心模块** | CJS/ESM、EventEmitter、Stream、HTTP、fs、cluster | 14/14 ✅ |
| **06 事件循环专题** | 微/宏任务、setImmediate 时序、阶段走读 | 4/4 ✅ |
| **07 内存与性能** | V8 堆、GC、泄漏排查、perf_hooks | 4/4 ✅ |
| **08 Electron 集成** | 双进程、IPC、preload 安全 | 5/5 ✅ |
| **09 跨平台** | libuv 抽象、child_process、原生插件 | 3/3 ✅ |
| **10 实战篇** | 源码编译、GDB 调试、写原生插件 | 4/4 ✅ |
| **附录** | 术语表、参考、源码索引 | 3/3 ✅ |

**全部 63 篇已完成！**

## 🚀 快速开始

### 本地启动
```bash
npm start          # 零依赖，启动后访问 http://localhost:4000
# 或自定义端口
PORT=8080 npm start
```

### 阅读在线文档
访问 [GitHub Pages](https://jlnvv-tom.github.io/node-web/) 查看完整文档

### 运行代码示例
```bash
# 事件循环顺序
node src/02-libuv/event-loop-order.js

# GC 探针（需要 --expose-gc）
node --expose-gc src/03-v8-engine/gc-probe.js

# 集群多核
node src/05-js-core-modules/cluster-multi-core.js

# CJS/ESM 互操作
node src/05-js-core-modules/cjs-esm-interop.cjs
```

详见 [`src/README.md`](src/README.md) 获取全部示例

## 📁 目录结构

```
node-web/
├── docs/              # 全部文章 + 侧边栏/封面/PLAN（Docsify 内容根）
├── src/               # 可独立运行的代码示例（按章节组织）
├── vendor/            # 离线 Docsify 依赖（零外网依赖）
├── scripts/           # serve.js 本地服务器、init-git.sh 部署脚本
├── index.html         # 站点入口
├── _gen_sidebar.py    # 侧边栏自动生成脚本
├── .github/workflows/ # GitHub Pages 自动部署配置
├── package.json       # 项目元信息 + npm 脚本
└── LICENSE            # MIT 许可证
```

## 🛠️ 部署到 GitHub Pages

1. 在 GitHub 建立空仓库
2. 运行初始化脚本：
   ```bash
   bash scripts/init-git.sh <user>/<repo>
   ```
3. 进入仓库 Settings → Pages → Source 选择 **GitHub Actions**
4. push `main` 分支即自动部署

## 🔧 维护命令

```bash
# 自动生成侧边栏（修改 docs/ 后执行）
npm run gen:sidebar

# 启动本地开发服务器
npm start

# 安装依赖
npm install
```

## 📖 文章特色

每篇文章包含：
- 🎨 **架构图** — 模块关系与数据流
- 🔍 **源码走读** — Node.js/libuv/V8 源码位置与调用栈
- 💻 **带注释代码** — 可运行的完整示例
- 📋 **总结** — 核心概念回顾
- ❓ **思考题** — 加深理解

## 📚 参考资源

- [Node.js 源码](https://github.com/nodejs/node) — v18+ LTS
- [libuv 文档](https://docs.libuv.org)
- [V8 文档](https://v8.dev/docs)
- [Electron 架构](https://www.electronjs.org/docs/latest/)

## 💡 适合人群

- 🔧 想深入理解 Node.js 运行原理的开发者
- 📚 学习系统编程、事件驱动架构的学生
- 🎯 准备高级面试、技术分享的工程师
- 🔬 对 V8 引擎、libuv 感兴趣的研究者

## 📄 许可证

MIT License — 详见 [LICENSE](LICENSE)

---

**立即开始阅读：** [📖 查看文档](https://jlnvv-tom.github.io/node-web/) | **运行示例：** `npm start` | **贡献代码：** Pull Request Welcome
