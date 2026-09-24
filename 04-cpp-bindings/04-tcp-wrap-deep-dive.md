# 04-04 TCPWrap 源码精读：从 `net.Socket` 到 `uv_tcp_t`

> 本章目标：完整追踪一次 TCP 操作从 JS 掉到内核的全过程——以 `new net.Socket()` 连接服务器为例，串起 JS 层、C++ 绑定层、libuv、操作系统四层。

---

## 1. 全链路总览

```
JS:    const socket = new net.Socket();
       socket.connect(8124, 'localhost', onConnect);
         │
         ▼
lib/net.js  (JS 核心模块)
   │  new TCP()  // 来自 internalBinding('tcp')
   ▼
C++:   TCPWrap  (extends BaseObject, AsyncWrap)
   │   TCPWrap::Connect(req, addr) → uv_tcp_connect()
   ▼
libuv: uv_tcp_t  (src/unix/tcp.c)
   │   socket() + connect() 非阻塞 → 注册 EPOLLOUT 到 epoll
   ▼
OS:    内核 socket fd（epoll/kqueue 监听可写）
         │
[连接握手完成 → fd 可写 → poll 阶段触发]
         │
         ▼
libuv: uv__stream_io() 检测到连接完成 → 调用 on_connect
   ▼
C++:   TCPWrap::AfterConnect → MakeCallback("onconnect")
   ▼
JS:    socket.emit('connect') → onConnect()
```

---

## 2. JS 层：`lib/net.js`

`net.Socket` 内部持有一个 `_handle`，它是 C++ 的 `TCPWrap` 实例：

```js
// lib/net.js （简化）
const { TCP, TCPConnectWrap } = internalBinding('tcp');

function Socket(options) {
  this._handle = new TCP();          // 创建 C++ TCPWrap
  // ...
}

Socket.prototype.connect = function(...args) {
  const req = new TCPConnectWrap();  // 连接请求对象
  req.oncomplete = onConnect;        // JS 回调
  this._handle.connect(req, address, port);  // 下钻 C++
};
```

`internalBinding('tcp')` 返回的 `TCP` 类，就是 C++ 侧通过 `NODE_BUILTIN_MODULE` 注册、再经 V8 暴露的构造函数。

---

## 3. C++ 绑定层：`src/tcp_wrap.cc`

```cpp
// src/tcp_wrap.cc （简化）

// TCP 类注册到 internalBinding
void TCPWrap::Initialize(Environment* env, Local<Object> target) {
  Local<FunctionTemplate> t = env->NewFunctionTemplate(New);
  t->InstanceTemplate()->SetInternalFieldCount(1);
  t->SetClassName(FIXED_ONE_BYTE_STRING(... "TCP"));
  // 原型方法
  env->SetProtoMethod(t, "connect", Connect);
  env->SetProtoMethod(t, "bind", Bind);
  // ...
  target->Set(... t->GetFunction());   // 挂到 internalBinding('tcp').TCP
}

// 构造：创建 uv_tcp_t 并包进 TCPWrap
void TCPWrap::New(const FunctionCallbackInfo<Args>& args) {
  TCPWrap* wrap = new TCPWrap(env, args.This());
  // 内部：uv_tcp_init(env->event_loop(), &wrap->handle_)
}

// connect：转交 libuv
void TCPWrap::Connect(const FunctionCallbackInfo<Args>& args) {
  TCPConnectWrap* req_wrap = Unwrap<TCPConnectWrap>(args[0]);
  sockaddr_in addr;  // 解析 address:port
  int err = uv_tcp_connect(&req_wrap->req_, &wrap->handle_,
                           reinterpret_cast<sockaddr*>(&addr),
                           AfterConnect);   // 完成回调
  req_wrap->Dispatched();
  args.GetReturnValue().Set(err);
}
```

要点：
- `TCPWrap` 继承 `BaseObject`，持有 `uv_tcp_t handle_`。
- `Connect` 方法只是把 JS 调用翻译成 `uv_tcp_connect`，传入 C++ 回调 `AfterConnect`。
- `req_wrap`（`TCPConnectWrap`）也继承 `AsyncWrap`，所以有 asyncId，会被 async_hooks 追踪。

---

## 4. libuv 层：`deps/uv/src/unix/tcp.c`

```c
int uv_tcp_connect(uv_connect_t* req,
                   uv_tcp_t* handle,
                   const struct sockaddr* addr,
                   uv_connect_cb cb) {
  // 1) 若尚未创建 socket，先 socket()
  // 2) 设为非阻塞 O_NONBLOCK
  // 3) connect() —— 非阻塞下通常返回 EINPROGRESS
  // 4) uv__io_start(handle->loop, &handle->io_watcher, POLLOUT)
  //    ↑ 向 epoll 注册"可写"事件，连接完成/失败时触发
  req->cb = cb;
  return 0;
}
```

连接不会阻塞。内核在三次握手完成时把 fd 标记为可写，epoll 在下一轮 poll 阶段返回该事件。

---

## 5. 完成回调：从 libuv 回 JS

```
[内核连接完成]
   │
   ▼
poll 阶段: epoll_wait 返回该 fd 的 POLLOUT
   │
   ▼
libuv: uv__stream_io() → 检测到 connect 完成 → 调用 req->cb
   │
   ▼
C++: TCPWrap::AfterConnect(uv_connect_t* req, int status)
   │   req_wrap->MakeCallback("oncomplete", ...)
   ▼
JS: req.oncomplete 即 onConnect → socket.emit('connect')
```

`MakeCallback` 是 Node C++ 侧把控制权交还 JS 的标准方式。它还会：
- 进入 `InternalCallbackScope`，触发 `before`/`after` async_hooks 钩子。
- 清空 nextTick + microtask 队列。
- 最后才执行 JS 回调。

---

## 6. 数据接收路径（补充）

连接建立后，服务端 `write` 的数据如何到达客户端 JS？

```
内核收到 TCP 段 → fd 可读 → poll 阶段 epoll POLLIN
   │
   ▼
libuv: uv__read() 循环 read() 直到 EAGAIN
   │   每次读到数据 → stream->alloc_cb 分配 Buffer
   ▼
C++: TCPWrap::OnRead(stream, nread, buf, ...)
   │   MakeCallback("onread", [data])
   ▼
JS: socket.emit('data', data)
```

`alloc_cb` 负责分配接收缓冲（涉及 `Buffer` 池，见 07-03）；`OnRead` 把字节流转交 JS 的 `data` 事件。

---

## 7. 类继承小结

```
BaseObject
  └─ AsyncWrap
       └─ TCPWrap              (src/tcp_wrap.cc)
            └─ 持有 uv_tcp_t   (libuv handle)
                 └─ 内核 socket fd
```

`net.Socket`（JS） ↔ `TCPWrap`（C++）通过 `BaseObject::object_` 双向引用；`TCPWrap` ↔ `uv_tcp_t` 是组合关系；`uv_tcp_t` ↔ 内核 fd 是 1:1 映射。

---

## 8. 可运行验证

```js
const net = require('net');
const client = net.createConnection(8124, 'localhost', () => {
  console.log('connected (JS onConnect fired)');
  client.write('hello');
});
client.on('data', (d) => console.log('got:', d.toString()));
client.on('connect', () => console.log('connect event'));
```

用 `strace -f -e trace=network,connect node client.js` 可以看到底层 `socket()` / `connect()` / `read()` / `write()` 系统调用，印证本文的全链路。

---

## 9. 本章总结

- `net.Socket` 的 `_handle` 是 C++ `TCPWrap`；`connect()` 经 `uv_tcp_connect` 落到非阻塞 `connect()` + epoll POLLOUT 注册。
- 连接完成在 poll 阶段被 epoll 捕获，回调经 `AfterConnect` → `MakeCallback` → JS `connect` 事件。
- 数据接收走 `uv__read` 循环 + `OnRead` → `data` 事件；Buffer 由 alloc_cb 分配。
- 继承链：`BaseObject → AsyncWrap → TCPWrap → uv_tcp_t → fd`。一次 `connect` 串起全部四层。

---

## 10. 思考题

1. 为什么 `uv_tcp_connect` 用非阻塞 `connect()` 后还要注册 EPOLLOUT，而不是直接等结果？
2. `TCPConnectWrap` 为什么也继承 `AsyncWrap`？不继承会丢失什么能力？
3. 如果 `MakeCallback` 里抛异常，会影响事件循环的其他部分吗？Node 如何隔离？
