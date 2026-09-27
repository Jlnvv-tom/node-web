# 10-03 用 GDB/LLDB 调试 Node.js

> 本章目标：掌握用 GDB（Linux）或 LLDB（macOS）调试 Node.js 二进制的方法，包括断点、查看 V8 对象、追踪函数调用。

## 导读

当 `console.log` 不够用时——比如调试 C++ 层的段错误、追踪启动流程、观察 V8 内部状态——就需要 GDB/LLDB。

## 准备调试构建

```bash
cd node  # Node.js 源码目录
./configure --debug
make -j8
# → out/Debug/node（带 DWARF 调试符号）
```

## LLDB 基本操作（macOS）

```bash
lldb out/Debug/node
(lldb) b node::Start                          # 在 Node::Start 打断点
(lldb) run app.js                             # 运行
(lldb) bt                                     # 查看调用栈
(lldb) frame select 2                         # 切到第 2 帧
(lldb) frame variable                         # 查看局部变量
(lldb) next                                   # 单步（不进入函数）
(lldb) step                                   # 单步（进入函数）
(lldb) continue                               # 继续执行
(lldb) quit
```

## GDB 基本操作（Linux）

```bash
gdb out/Debug/node
(gdb) break node::Start
(gdb) run app.js
(gdb) backtrace
(gdb) frame 2
(gdb) info locals
(gdb) next
(gdb) step
(gdb) continue
(gdb) quit
```

## 关键断点位置

| 断点 | 位置 | 用途 |
|------|------|------|
| `node::Start` | `src/node.cc` | Node.js 初始化入口 |
| `node::LoadEnvironment` | `src/node.cc` | 环境创建 |
| `Realm::BootstrapRealm` | `src/node_realm.cc` | JS bootstrap |
| `node::LoadEnvironment` | `src/node.cc` | 模块系统初始化 |
| `SetupProcessObject` | `src/node_process_object.cc` | process 对象创建 |
| `uv_run` | `deps/uv/src/unix/core.c` | 事件循环 |

## 查看 V8 对象

V8 对象在 C++ 中是 `v8::Local<v8::Object>`，直接 `print` 只显示指针。需要用 V8 的调试辅助函数：

```bash
(lldb) b v8_inspector::V8DebuggerAgentImpl::pause
# 然后在 JS 里用 debugger; 语句触发

# 或者用 --inspect-brk
./out/Debug/node --inspect-brk app.js
# 然后用 Chrome DevTools 查看 V8 对象
```

## 追踪系统调用

```bash
# macOS: dtrace
sudo dtrace -n 'syscall::read:entry /pid == $target/ { @count = count(); }' \
  -c "out/Debug/node app.js"

# Linux: strace
strace -f -e trace=read,write,epoll_wait out/Debug/node app.js
```

## 实操：追踪 `node app.js` 的启动

```bash
lldb out/Debug/node

(lldb) b node::Start
Breakpoint 1: address = 0x...
(lldb) run app.js
Process ... stopped
* thread #1, stop reason = breakpoint 1.1
(lldb) bt
* frame #0: 0x... node`node::Start(...)
  frame #1: 0x... node`node::NodeMainInstance::Run(...)
  frame #2: 0x... node`main(...)
(lldb) frame variable
(v8::Isolate*) isolate = 0x...
(node::Environment*) env = 0x...
(lldb) continue
```

## 实操：调试 fs.readFileSync

```bash
(lldb) b node::fs::Read
Breakpoint 1: address = 0x...
(lldb) run -e "require('fs').readFileSync('/etc/hostname')"
Process ... stopped at Read
(lldb) bt
* frame #0: node::fs::Read(...)
  frame #1: v8::Function::Call(...)
  ...
(lldb) frame variable
(const v8::FunctionCallbackInfo<v8::Value>&) args = ...
```

## 总结

| 工具 | 平台 | 用途 |
|------|------|------|
| LLDB | macOS | 断点/单步/查看变量 |
| GDB | Linux | 同上 |
| dtrace | macOS | 系统调用追踪 |
| strace | Linux | 系统调用追踪 |
| --inspect-brk | 全平台 | Chrome DevTools 调试 V8 对象 |

## 思考题

1. Release 构建的 node 能用 LLDB 调试吗？和 Debug 构建有什么区别？
2. `backtrace` 显示的函数名是 `node::Start` 而不是 `Start`，`node::` 是什么意思？
3. 如果 V8 的函数是 `v8::internal::Heap::CollectGarbage`，你怎么找到源码位置？