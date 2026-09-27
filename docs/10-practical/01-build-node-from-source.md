# 10-01 从源码编译 Node.js

> 本章目标：掌握从 Node.js 源码编译出可执行二进制的完整流程，理解构建系统各组件的作用。

## 导读

日常使用 `nvm install` 安装的 Node.js 是预编译二进制。但源码编译能让你：
- 修改 Node.js 内核代码并验证
- 开启/关闭特性（如 `--without-ssl`）
- 调试构建（`--debug` 带 DWARF 符号，可用 GDB/LLDB）
- 学习构建系统如何把 C++/JS/Python 组装成一个二进制

## 获取源码

```bash
git clone https://github.com/nodejs/node.git
cd node
git checkout v22.22.3  # 切到指定版本
```

## 构建系统概览

Node.js 的构建系统不是纯 make，而是一套多层工具：

```
configure (Python 脚本)
  → 读取 configure.py 选项
  → 检测系统工具（compiler、make、python）
  → 生成 config.gypi（构建变量）
  → 生成 Makefile

make
  → 执行 Makefile
  → 调用 gyp-generator 生成各子项目 .mk
  → 编译 C++ (src/ + deps/)
  → 打包 JS (lib/) 为 embed
  → 链接为 node 二进制
```

### 关键组件

| 组件 | 作用 |
|------|------|
| `configure.py` | 配置脚本，检测环境、处理选项 |
| `node.gyp` | 顶层 GYP 构建描述 |
| `tools/gyp_node.py` | 运行 GYP 生成 Makefile |
| `deps/v8/gypfiles/` | V8 的 GYP 配置 |
| `deps/uv/uv.gyp` | libuv 的 GYP 配置 |
| Makefile | 入口，调用 GYP 生成的子 makefile |

## 基本编译

```bash
# 1. 配置（检测依赖、生成构建文件）
./configure

# 2. 编译（-j 指定并行数）
make -j8

# 3. 验证
./node -v
# v22.22.3

# 4. 安装（可选，安装到 /usr/local）
sudo make install
```

## 常用配置选项

```bash
# 调试构建（带调试符号，体积大）
./configure --debug
make -j8
# → out/Debug/node

# Release 构建（默认）
./configure
make -j8
# → out/Release/node

# 不使用 OpenSSL
./configure --without-ssl

# 指定 ICU 数据（国际化）
./configure --with-intl=small-icu

# 链接系统 libuv（而非 bundled）
./configure --shared-libuv

# 链接系统 V8
./configure --shared-v8
```

## 编译产物

```
out/Release/
  ├── node              # 主二进制（链接了 V8 + libuv + 所有 C++ 模块）
  ├── node.dSYM         # macOS 调试符号（Release 不生成，Debug 生成）
  ├── obj.target/       # 中间产物
  │   ├── src/node.o
  │   ├── deps/v8/...
  │   └── deps/uv/...
  └── gen/              # 生成文件
      ├── node_javascript.cc    # 打包 lib/*.js 为 C++ 字节数组
      └── configure_htmldoc.cc
```

## JS 打包：node_javascript.cc

Node.js 不在运行时从磁盘读 `lib/*.js`。编译时这些 JS 被打包成 C++ 字节数组嵌入二进制：

```cpp
// 生成的 out/Release/obj/gen/node_javascript.cc — 简化
static const char fs_code[] = {
  47, 47, 32, 67, 111, 112, 121, 114, ...  // "// Copyright..."
};

void DefineJavaScript(v8::Local<v8::Object> target) {
 // 把 fs_code 注册为模块
}
```

这就是为什么 `require('fs')` 不需要网络和磁盘——内置模块已嵌入二进制。

## 编译调试版本

```bash
./configure --debug
make -j8
# → out/Debug/node

# 用 LLDB 调试
lldb out/Debug/node
(lldb) b node::Start
(lldb) run app.js
(lldb) bt
```

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `python: command not found` | macOS 只有 python3 | `ln -s $(which python3) /usr/local/bin/python` |
| `gyp: Undefined variable` | GYP 版本不匹配 | `git clean -xfd && ./configure` |
| 编译 OOM | 内存不足 | 减小 `-j` 参数 |
| `fatal error: 'openssl/sha.h'` | 缺 OpenSSL 头文件 | macOS: `brew install openssl@3` |

## 总结

| 步骤 | 命令 | 产物 |
|------|------|------|
| 配置 | `./configure` | config.gypi + Makefile |
| 编译 | `make -j8` | out/Release/node |
| 调试 | `./configure --debug && make -j8` | out/Debug/node |
| 安装 | `make install` | /usr/local/bin/node |

## 思考题

1. 为什么 Node.js 要把 `lib/*.js` 打包进二进制，而不是运行时从磁盘读？（提示：启动速度、安全、嵌入式场景）
2. `./configure --debug` 生成的二进制比 Release 大多少？大在哪里？
3. 如果修改了 `lib/fs.js`，需要重新 `./configure` 吗？还是只 `make` 就够了？