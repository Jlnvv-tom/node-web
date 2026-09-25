# 04-03 HandleWrap 与 StreamBase：libuv handle 的 C++ 包装

> 本章目标：理解 Node 如何把 libuv 的"句柄"（handle，如 TCP/UDP/pipe）和"流"（stream）包装成可被 JS 持有、能感知生命周期的 C++ 对象。这是网络 I/O 在 C++ 层的另一半骨架。

---

## 1. 回顾继承链

（见 04-01、04-04）
```
BaseObject
  └─ AsyncWrap
       └─ HandleWrap           (src/handle_wrap.h)
            └─ TCPWrap / UDPWrap / PipeWrap ...
```
`HandleWrap` 是"持有 libuv handle 的对象"的通用基类；`StreamBase` 是"可作为字节流读写"的接口基类（TCP/UDP/pipe 都实现它）。

---

## 2. `HandleWrap`：libuv handle 的封装

```cpp
// src/handle_wrap.h （简化）
class HandleWrap : public AsyncWrap {
 public:
  uv_handle_t* GetHandle() const { return handle_; }
  void MarkAsInitialized();                       // 标记已初始化，关闭时回调 JS
  void Close(v8::Local<v8::Function> cb);        // 调用 uv_close
 protected:
  uv_handle_t* const handle_;                     // 持有的 libuv handle（如 uv_tcp_t）
};
```

职责：
- 持有 `uv_handle_t*`（libuv 句柄的通用指针）。
- 管理句柄生命周期：`uv_close(handle_, OnClose)` 关闭时触发 JS 的 `close` 事件（见 02-01 阶段6）。
- 继承 `AsyncWrap`，所以每个 handle 都有 asyncId，能被 async_hooks 追踪。

`TCPWrap` 把 `handle_` 具体化成 `uv_tcp_t*`；`UDPWrap` 是 `uv_udp_t*`；`PipeWrap` 是 `uv_pipe_t*`。它们共用的"注册到 epoll / 关闭 / 错误"逻辑都在 `HandleWrap`。

---

## 3. 注册 I/O 监视：回到 `uv__io_t`

`HandleWrap` 的 `handle_` 内部含一个 `uv__io_t io_watcher`（见 02-07）。当 Node 调用 `TCPWrap::Listen` 时：

```cpp
// src/tcp_wrap.cc
int err = uv_listen(&wrap->handle_, backlog, OnConnection);
// 内部：uv__io_start(loop, &handle->io_watcher, POLLIN)
//      → 把 fd 注册到 epoll，关注可读（新连接）
```

连接到达 → poll 阶段 epoll 返回 → `uv__io_t->cb` → `OnConnection` → JS `'connection'` 事件。

这正是 02-03、04-04 讲的网络 I/O 在 C++ 层的落地：`HandleWrap` 负责"持有句柄 + 注册 epoll + 关闭回调"，具体协议由子类（TCPWrap 等）补充。

---

## 4. `StreamBase`：字节流接口

```cpp
// src/stream_base.h （简化）
class StreamBase : public HandleWrap {
 public:
  // 子类实现：读、写、关闭、暂停/恢复
  virtual int ReadStart() = 0;                    // 开始监听可读
  virtual int ReadStop() = 0;
  virtual int DoWrite(WriteWrap* w, uv_buf_t* bufs, size_t count,
                      uv_stream_t* send_handle) = 0;
  // JS 通过 stream.on('data') 触发 ReadStart；write() 触发 DoWrite
};
```

`StreamBase` 把"字节流"的通用行为抽象出来，使 `net.Socket`、`http` 连接、管道等共享同一套读写语义。

JS 层 `lib/net.js` 的 `Socket` 内部通过 `StreamBase` 的 C++ 方法发起读/写（见 04-04、05-06）：

```js
// lib/net.js （简化）
Socket.prototype.readStart = function() { this._handle.readStart(); };
Socket.prototype.write = function(chunk) { this._handle.write(...); };
```

---

## 5. `WriteWrap`：写请求对象

每次 `write()` 产生一个 `WriteWrap`（继承 `AsyncWrap`），代表"一次写操作"：

```cpp
// 写流程
uv_buf_t buf = uv_buf_init(data, len);
req_wrap->Dispatched();
uv_write(&req_wrap->req_, stream, &buf, 1, AfterWrite);
// 内核缓冲满（EAGAIN）→ 注册 EPOLLOUT；可写时继续写
// 全部完成 → AfterWrite → MakeCallback("oncomplete") → JS 'finish'/'drain'
```

`WriteWrap` 也继承 `AsyncWrap`，所以每次网络写都有 asyncId（便于追踪"这个写是谁发起的"）。

---

## 6. 与 JS 层的对接

```
JS:        socket.write('hi')
   ▼
lib/net.js: Socket.prototype.write → this._handle.write(req, buffer)
   ▼
C++:       TCPWrap::Write(req, ...) → uv_write
   ▼
libuv:     uv_write → epoll EPOLLOUT（若需）→ 内核发送
   ▼
完成:      AfterWrite → MakeCallback → JS 'finish' / cb
```

读同理（`ReadStart` → epoll POLLIN → `OnRead` → `data` 事件）。

---

## 7. 本章总结

- `HandleWrap`（继承 AsyncWrap）封装 libuv handle，管理生命周期与 epoll 注册。
- `StreamBase` 抽象字节流读/写/暂停/恢复，被 TCP/UDP/pipe 共用。
- `WriteWrap`/`TCPConnectWrap` 等请求对象也继承 AsyncWrap，使每次 I/O 有 asyncId。
- JS `net.Socket` 通过 `StreamBase` 的 C++ 方法发起读写，回调经 `MakeCallback` 回 JS。

---

## 8. 思考题

1. 为什么 `TCPWrap` 既要继承 `HandleWrap`（管生命周期）又要实现 `StreamBase`（管字节流）？这两类职责能合并吗？
2. `uv_close` 触发 JS 的 `close` 事件，这个回调是在事件循环的哪个阶段执行的（提示：02-01 阶段6）？
3. 为什么每次 `write()` 都要新建一个 `WriteWrap` 而不是复用？这给 async_hooks 带来了什么好处？
