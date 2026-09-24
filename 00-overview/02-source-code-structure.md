# 00-02 Node.js 源码目录结构与构建系统

> 本章目标：拿到 Node.js 源码后，知道每个目录是干什么的，能快速定位"某功能大概在哪个文件夹"，并理解它是怎么从 C++/JS 源码编译成 `node` 可执行文件的。

---

## 1. 获取源码

```bash
git clone https://github.com/nodejs/node.git
cd node
git checkout v22.x   # 或任意你关注的发行线
```

仓库根目录（节选）：

```
node/
├── lib/            # JS 核心模块（用户 require 的绝大多数内置模块来源）
├── src/            # C++ 核心代码（绑定、启动、Environment/Realm 等）
├── deps/           # 第三方依赖（v8、uv、openssl、zlib、cares、http_parser...）
├── test/           # 测试（parallel / sequential / pseudo-tty / addons ...）
├── doc/            # API 文档（doc/api/*.md 是官方文档源）
├── tools/          # 构建与维护脚本（snapshot、icu、lint...）
├── benchmark/      # 性能基准
├── configure      # Python 配置脚本（生成 Makefile / vcbuild）
├── configure.py    # 实际由 configure 调用（历史遗留命名）
├── node.gyp        # GYP 构建描述（Chromium 的构建系统）
├── BUILDING.md     # 编译指南
└── README.md
```

---

## 2. 核心目录逐一拆解

### 2.1 `lib/` — JavaScript 核心模块层

这是**最该先读**的目录，因为内容是人能直接读懂的 JS。

- `lib/fs.js`、`lib/net.js`、`lib/http.js`、`lib/events.js`、`lib/stream.js`、`lib/timers.js`、`lib/crypto.js`、`lib/worker_threads.js` …… 对应你日常 `require('fs')` 取到的模块。
- `lib/internal/**` 是**内部实现**，不通过 `require` 直接暴露给用户，例如：
  - `lib/internal/bootstrap/`：启动阶段注入到全局的引导脚本（`realm.js`、`node.js`、`sw\_*/` 等）。
  - `lib/internal/modules/cjs/loader.js`：CommonJS 加载器（第 5 章重点）。
  - `lib/internal/modules/esm/`：ESM 加载器。
  - `lib/internal/streams/`：Stream 实现。
  - `lib/internal/process/`：process 对象构造。
- `lib/internal/bootstrap/` 通过 `internalBinding('...')` 访问 C++ 侧暴露的能力——这是 JS 层与 C++ 层的接线点。

> 阅读技巧：从 `lib/fs.js` 顶部 `const { ... } = internalBinding('fs');` 入手，可以顺藤摸瓜找到 `src/node_file.cc`。

### 2.2 `src/` — C++ 核心代码（绑定层）

Node 真正的"引擎外壳"，全部 C++。

| 文件/目录 | 职责 |
|-----------|------|
| `src/node_main.cc` | 程序入口 `main()` |
| `src/node.cc` | `node::Start()`，进程初始化与启动主流程 |
| `src/env.h` / `env.cc` | `Environment`：进程/线程级状态（libuv loop、inspector、options、exit handlers） |
| `src/node_realm.h` / `node_realm.cc` | `Realm`：一个 JS 执行上下文（principal / shadow / worker realm） |
| `src/base_object.h` | `BaseObject`：有 JS 包装的 C++ 对象基类 |
| `src/async_wrap.*` | `AsyncWrap`：异步资源生命周期追踪（`async_hooks` 底层） |
| `src/handle_wrap.*` / `stream_base.h` | `HandleWrap` / `StreamBase`：libuv handle/stream 的 C++ 包装 |
| `src/tcp_wrap.cc` | `net.Socket` 底层 TCP 实现 |
| `src/node_file.cc` | `fs` 模块 C++ 绑定 |
| `src/node_crypto.cc` | `crypto` 与 OpenSSL 集成 |
| `src/node_api.cc` / `js_native_api*` | N-API 实现 |
| `src/node_worker.cc` | `worker_threads` 原生实现 |

`src/` 下还有大量 `.h` 定义数据结构，先抓 `env`、`realm`、`base_object`、`async_wrap` 四个核心即可。

### 2.3 `deps/` — 第三方依赖

Node 把关键底层库直接 vendoring 进仓库，保证版本锁定与跨平台一致。

| 子目录 | 库 | 作用 |
|--------|-----|------|
| `deps/v8` | V8 引擎 | JS 编译执行 + GC |
| `deps/uv` | libuv | 事件循环、异步 I/O、线程池、DNS |
| `deps/openssl` | OpenSSL | TLS / crypto |
| `deps/zlib` | zlib | 压缩（gzip/deflate） |
| `deps/cares` | c-ares | 异步 DNS 解析（`dns.lookup` 之外） |
| `deps/http_parser` / `llhttp` | HTTP 解析器 | 解析 HTTP 报文 |
| `deps/icu-small` | ICU | 国际化（字符串、时区、编码） |
| `deps/uvwasi` | WASI | 用于 `--experimental-wasi-unstable-preview1` |
| `deps/gtest` | GoogleTest | 测试框架 |

> 想读事件循环源码，正确入口是 `deps/uv/src/unix/core.c`（Linux/macOS）或 `deps/uv/src/win/core.c`（Windows），不是 `src/`。

### 2.4 `test/` — 测试

- `test/parallel`：可并行跑的测试（绝大多数）。
- `test/sequential`：需串行（共享端口/全局状态）。
- `test/addons`、`test/addons-napi`：原生插件测试。
- `test/integration`：端到端。

测试用例是理解"某个 API 预期行为"的最佳样本，比文档更精确。

### 2.5 `doc/api/` — 官方文档源

`doc/api/fs.md`、`doc/api/http.md` 等就是 nodejs.org 文档的源头，用 Markdown + 自定义标记写成，构建时转成 HTML。改文档也在此处。

### 2.6 `tools/` — 构建与维护

- `tools/snapshot/`：构建期生成 V8 启动快照（`SnapshotBuilder::Generate()`），加速冷启动。
- `tools/icu/`：ICU 数据生成。
- `tools/code_cache/`：代码缓存。
- `tools/eslint-rules/`：Node 自定义 lint 规则。

### 2.7 `benchmark/` — 性能基准

`benchmark/fs/`、`benchmark/http/` 等，用于回归监控。

---

## 3. 构建系统：从源码到 `node`

Node 使用 **GYP**（Generate Your Projects，源自 Chromium）描述构建，再由 `make` / `ninja` / MSBuild 实际编译。

### 3.1 配置流程

```bash
# 1) 配置（生成 Makefile / vcbuild.bat）
./configure --prefix=$HOME/node-build \
            --debug \
            --with-intl=small-icu

# 2) 编译（开多线程）
make -j$(nproc)

# 3) 安装
make install

# 或 Windows:
./vcbuild.bat nosign debug
```

关键配置项：
- `--debug`：带调试符号，配合 GDB/LLDB。
- `--without-intl` / `--with-intl=small-icu|full-icu`：国际化体积控制。
- `--enable-lto`：链接期优化。
- `--shared-*`：使用系统已装库（如 `--shared-openssl`）而非 vendored。

### 3.2 `node.gyp` 的角色

`node.gyp` 定义了 `node` 可执行目标，列出所有 `src/*.cc` 与 `deps/*` 的编译依赖、链接库、宏定义（如 `NODE_ARCH`、`HAVE_OPENSSL`）。它把"数百个 C++ 文件 + 多个第三方库"编排成一次构建。

### 3.3 启动快照（V8 Snapshot）

构建期，`tools/snapshot/` 会运行一个特殊构建的 Node，把 `lib/internal/bootstrap/*.js` 预编译进一个二进制 blob。运行时 `node` 直接 `mksnapshot` 反序列化，跳过重复解析——这就是 `node` 冷启动快的原因之一。关闭它可用 `--no-node-snapshot`（走慢路径从头解析）。

---

## 4. 源码阅读导航表（速查）

| 你想读懂 | 先看 | 再看 |
|---------|------|------|
| 模块怎么加载 | `lib/internal/modules/cjs/loader.js` | `src/module_wrap` 相关 |
| 事件循环 | `deps/uv/src/unix/core.c` (`uv_run`) | 第 2 章 |
| TCP 连接 | `lib/net.js` | `src/tcp_wrap.cc` → `deps/uv/src/unix/tcp.c` |
| fs 读写 | `lib/fs.js` | `src/node_file.cc` → `deps/uv/src/unix/fs.c` |
| 启动流程 | `src/node_main.cc` | `src/node.cc` → `lib/internal/bootstrap/realm.js` |
| 进程对象 | `lib/internal/process/` | `src/env.cc` |

---

## 5. 本章总结

- `lib/` 是 JS 标准库，`src/` 是 C++ 绑定与启动，`deps/` 是第三方底座（V8/libuv/OpenSSL…）。
- 想读某能力：先在 `lib/` 看 JS 入口，顺着 `internalBinding('x')` 跳到 `src/*_wrap.cc`，再下钻 `deps/uv` 或 `deps/v8`。
- 构建靠 GYP + make，启动快照是冷启动加速的关键。

---

## 6. 思考题

1. 为什么 Node 要把 V8、libuv 等直接 vendoring 进 `deps/`，而不是让用户自己装？
2. 如果你想给 `fs` 加一个新同步方法，需要改哪几个目录的文件？
3. `--no-node-snapshot` 会怎样影响启动？什么场景下你会用它？
