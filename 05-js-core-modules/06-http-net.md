# 05-06 http / net：网络栈从 C++ 到 JS

> 本章目标：把前面学的 C++ 绑定（04-04 TCPWrap）与 JS 流（05-05）串起来——理解 `net` 与 `http` 模块如何在 libuv 之上，用 `TCPWrap` + `StreamBase` + `EventEmitter` 构建出我们每天都在用的网络 API。

---

## 1. 分层结构

```
HTTP 层 (lib/_http_server.js / _http_client.js / _http_outgoing.js)
   │  解析请求行/头、组装响应、连接复用（keep-alive）
   ▼
net 层 (lib/net.js)
   │  Socket（继承 Duplex 流）、Server
   ▼
JS 绑定 (lib/internal/js_stream_socket.js + internalBinding('tcp'))
   │  调用 TCPWrap 的 connect/listen/accept/read/write
   ▼
C++ 绑定 (src/tcp_wrap.cc → uv_tcp_t)
   │  uv_*
   ▼
libuv (uv_run, poll 阶段)
   ▼
OS (epoll/kqueue → socket fd)
```

---

## 2. `net.Socket` = Duplex 流 + TCPWrap

（回顾 04-04、05-05）

```js
// lib/net.js 简化
const Socket = class Socket extends Duplex {
  constructor(options) {
    super(options);
    this._handle = new TCPWrap();         // C++ TCP handle
    // 通过 StreamBase 接口发起读写
  }
  connect(port, host, cb) {
    this._handle.connect(...);            // → uv_tcp_connect
  }
  _read(n) { this._handle.readStart(); }  // 流 API → 触发 epoll POLLIN
  _write(chunk, enc, cb) { this._handle.write(...); }
};
```

- `Socket` 是 `Duplex`，所以能 `pipe`（见 05-05）。
- `socket.on('data', ...)` 来自 `Readable` 的流动模式。
- 底层 `TCPWrap` 的 `OnRead` 回调 → 把字节喂给 JS 流 → `'data'` 事件。

---

## 3. `net.Server` 与连接接受

```js
// lib/net.js
const Server = class Server extends EventEmitter {
  listen(port, cb) {
    this._handle = new TCPWrap();
    this._handle.bind(host, port);
    this._handle.listen(backlog, onConnection);   // → uv_listen
  }
};
function onConnection(err) {
  const clientHandle = this._handle.accept();     // → uv_accept，得到新 uv_tcp_t
  const socket = new Socket({ handle: clientHandle });
  self.emit('connection', socket);                // → 用户 'connection' 回调
}
```

TCP 三次握手完成 → 内核把新连接放进 accept 队列 → poll 阶段 epoll 返回 → `uv__io_t->cb`（OnConnection）→ accept 取 fd → 包装成 `Socket` → 触发 JS `'connection'`（见 02-03）。

---

## 4. `http` 层：在 Socket 上做协议解析

`http.Server` 不做 socket 管理，它**复用 net.Server**，在 `connection` 事件里挂上 HTTP 解析器：

```js
// lib/_http_server.js
const server = new net.Server();
server.on('connection', (socket) => {
  const parser = new HTTPParser(HTTPParser.REQUEST);  // C++ 解析器（llhttp）
  parser[HTTPParser.kOnHeadersComplete] = (info) => {
    const req = new IncomingMessage(socket);
    // 解析出 method、url、headers
  };
  parser[HTTPParser.kOnBody] = (chunk) => req.push(chunk);   // 喂给流
  socket.on('data', (d) => parser.execute(d));    // 字节流喂给解析器
  server.emit('request', req, res);
});
server.listen(port);
```

关键：
- **HTTP 解析用 `llhttp`**（C 编写的高性能解析器，比旧 `http_parser` 快）。它跑在 C++ 层，但事件回调到 JS。
- 请求体通过 `IncomingMessage`（继承 `Readable`）暴露为流，可 `pipe` 到文件（见 05-05 大文件场景）。
- 响应 `res` 是 `OutgoingMessage`（继承 `Writable`），`res.write()` 最终经 `TCPWrap` 写 socket。

---

## 5. 客户端：`http.request`

```js
// lib/_http_client.js
http.request(options, cb) {
  const socket = net.connect(port, host);   // 建 TCP 连接
  const parser = new HTTPParser(HTTPParser.RESPONSE);   // 解析响应
  socket.on('connect', () => {
    socket.write(buildRequestHead(method, path, headers));   // 写请求行/头
  });
  parser[HTTPParser.kOnMessageComplete] = () => cb(res);
}
```

- `http.get(url)` 是 `request` 的便捷版（自动 `req.end()`）。
- 返回 `ClientRequest`（Writable），可 `write` body。
- keep-alive 时，socket 不清空，下次请求复用（连接池）。

---

## 6. 性能要点

- **`llhttp` 在 C++ 解析**，JS 不参与逐字节解析，性能高。
- **流 + pipe**：请求体/响应体都是流，可零拷贝中转（如代理、文件上传）。
- **keep-alive / 连接池**：减少 TCP 握手 + TLS 开销（`agent` 管理）。
- **`maxHeaderSize` / `maxHeaderPairs`**：防恶意头部耗尽内存。
- **`server.maxConnections` / `timeout`**：保护服务端。

---

## 7. 与事件循环的关系

整个网络栈最终都落回 `uv_run` 的 poll 阶段：
- 新连接 → epoll POLLIN → OnConnection
- 数据到达 → epoll POLLIN → OnRead → 'data' → HTTPParser → 'request'
- 可写 → epoll EPOLLOUT → AfterWrite → 'drain' / 'finish'

所有"异步"的本质，就是 epoll 把内核事件翻译成 libuv handle 回调，再翻译成 C++ 绑定，再翻译成 JS 事件（见 02-03、04-04）。

---

## 8. 可运行验证

```js
const http = require('http');
const server = http.createServer((req, res) => {
  res.end('hello');
});
server.listen(8124, () => {
  http.get('http://127.0.0.1:8124', (r) => {
    r.on('data', d => console.log(d.toString()));   // hello
    server.close();
  });
});
```

---

## 9. 本章总结

- `net.Socket` = Duplex 流 + `TCPWrap`；`net.Server` 在 `connection` 事件里用 `uv_accept` 取新连接。
- `http` 层在 Socket 上挂 `llhttp` 解析器（C++），解析请求/响应，事件回调到 JS。
- 请求体/响应体是 `Readable`/`Writable` 流，可 `pipe` 中转。
- 全栈最终都回到 libuv poll 阶段：epoll → handle 回调 → C++ 绑定 → JS 事件。
- keep-alive/连接池 + llhttp 解析是性能关键。

---

## 10. 思考题

1. 为什么 Node 的 HTTP 解析用 `llhttp`（C++ 编写）而非纯 JS？若改用 JS 解析会有什么性能影响？
2. `http.createServer` 实际返回的是 `net.Server` 的包装——这对"连接管理"和"协议解析"的职责划分意味着什么？
3. 用 `http.request` 上传一个大文件（1GB）给服务器，Node 的内存曲线会怎样？靠哪个机制保证不爆内存？
