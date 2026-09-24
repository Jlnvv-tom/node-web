# 04-05 fs 模块的 C++ 绑定

> 本章目标：看清 `fs.readFile` 如何从 JS 一路掉到线程池里的 POSIX `read()`，并理解同步/异步两条路径在 C++ 层是如何分流的。

---

## 1. 调用全链路

```
JS:    fs.readFile('a.txt', cb)
  ▼
lib/fs.js
  │  const req = new FSReqCallback()
  │  req.oncomplete = cb
  │  binding.read(req, fd, buffer, 0, len, 0, undefined)
  ▼
C++:   src/node_file.cc :: Read()
  │  uv_fs_t req; uv_fs_read(loop, &req, fd, buf, len, off, nullptr)
  ▼
libuv: deps/uv/src/unix/fs.c :: uv_fs_read()
  │  uv__work_submit(loop, &req->work_req, ..., uv__fs_work, uv__fs_done)
  ▼
线程池: uv__fs_work() → 实际 POSIX read()/pread()
  │  完成 → uv_async_send → 主线程 poll 触发
  ▼
C++:   uv__fs_done() → FSReqCallback::OnComplete()
  │   req_wrap->MakeCallback("oncomplete", [err, bytes])
  ▼
JS:    cb(err, data)
```

---

## 2. JS 层：`lib/fs.js`

`fs.readFile` 内部封装：分配 Buffer、构造 `FSReqCallback`、调用 C++ binding。

```js
// lib/fs.js （简化）
const { FileHandle } = require('internal/fs/promises');
const { read } = internalBinding('fs');   // C++ 暴露的 read

function readFile(path, options, callback) {
  // 打开文件 → 读 → 关闭 三个异步步骤
  open(path, flags, mode, (err, fd) => {
    if (err) return callback(err);
    const buffer = Buffer.allocUnsafe(size);
    const req = new FSReqCallback();
    req.oncomplete = (er, bytes) => {
      close(fd, () => callback(er, buffer.slice(0, bytes)));
    };
    read(req, fd, buffer, 0, size, 0, undefined);  // → C++
  });
}
```

`FSReqCallback`（`lib/internal/fs/refs.js`）是一个继承 `AsyncWrap` 的 JS 类，负责把 C++ 回调桥接回用户 `cb`，并携带 asyncId。

---

## 3. C++ 绑定层：`src/node_file.cc`

```cpp
// src/node_file.cc （简化）
void Read(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  // 取参数：req 包装、fd、buffer、offset、length、position
  FSReqCallback* req_wrap =
      FSReqCallback::New(env, args[0], args[6]);   // AsyncWrap 子类
  uv_fs_t* req = req_wrap->req();

  int fd = args[1].As<Number>()->Value();
  char* data = buffer_data(args[2]);               // 直接写进 JS Buffer 内存
  int64_t len = args[3].As<Number>()->Value();
  int64_t pos = args[5].As<Number>()->Value();

  // 提交给 libuv 线程池
  int err = uv_fs_read(env->event_loop(), req, fd,
                       uv_buf_init(data, len), 1, pos, nullptr);
  req_wrap->Dispatched();
  args.GetReturnValue().Set(err);
}
```

关键点：
- `FSReqCallback` 继承 `AsyncWrap`，所以每次 `readFile` 都有 asyncId，可被 async_hooks 追踪。
- `uv_buf_init(data, len)` 直接把 JS Buffer 的内存地址传给 libuv——**零拷贝**，工作线程直接往这片内存写，省去中间复制。
- `uv_fs_read` 立即返回（不阻塞），真正 I/O 在线程池。

---

## 4. libuv 层：`deps/uv/src/unix/fs.c`

```c
int uv_fs_read(uv_loop_t* loop, uv_fs_t* req,
               uv_file fd, const uv_buf_t bufs[],
               unsigned int nbufs, int64_t offset, uv_fs_cb cb) {
  uv_fs_req_init(loop, req, UV_FS_READ, cb);
  req->fs_fd = fd;
  req->bufs = bufs;
  req->off = offset;
  // 提交到线程池（工作函数 uv__fs_work，完成函数 uv__fs_done）
  uv__work_submit(loop, &req->work_req, UV__WORK_SLOW_IO,
                  uv__fs_work, uv__fs_done);
  return 0;
}
```

`uv__work_submit` → 线程池（见 02-02）。工作线程执行：

```c
static void uv__fs_work(uv__work_t* w) {
  uv_fs_t* req = container_of(w, uv_fs_t, work_req);
  switch (req->fs_type) {
    case UV_FS_READ:
      // 若指定 offset 用 pread，否则 read
      req->result = req->off < 0
        ? read(req->fs_fd, req->bufs[0].base, req->bufs[0].len)
        : pread(req->fs_fd, req->bufs[0].base, req->bufs[0].len, req->off);
    // ... 其他类型分派
  }
}
```

完成：`uv__fs_done` → `uv_async_send` → 主线程 poll → `FSReqCallback::OnComplete` → MakeCallback → JS cb。

---

## 5. 同步路径：`readFileSync`

```cpp
void Read(const FunctionCallbackInfo<Value>& args) {
  // 同步版本
  int result = uv_fs_read(nullptr, &req, fd, bufs, 1, pos, nullptr);
  // 注意第一个参数是 nullptr 的 loop → 走同步分支
  // uv_fs_read 检测到 loop==nullptr 时直接 uv__fs_work 同步执行
  if (result < 0) return env->ThrowUVException(...);
  // 直接返回结果，无回调
}
```

同步 API 在 C++ 层就是"用 nullptr loop 调 uv_fs_read"，libuv 判断无 loop 则**当前线程直接阻塞执行** `uv__fs_work`，返回结果。这正是同步 API 冻结事件循环的原因。

---

## 6. 零拷贝要点

`uv_buf_init(data, len)` 中 `data` 是 JS Buffer 的底层 `ArrayBuffer` 内存。工作线程直接 `pread` 写入这片内存，回调时 JS 直接读——**没有 C++ 侧再复制一次**。这是 `fs.readFile` 性能的关键。

但注意：Buffer 大小若超过 `fs.read` 单次返回，`readFile` 会循环多次读取直到 EOF（JS 层处理），每次都复用/扩展 Buffer。

---

## 7. 与 TCPWrap 的对照

| 维度 | fs (TCPWrap 对比) | TCPWrap |
|------|------------------|---------|
| 底层 libuv 类型 | `uv_fs_t` | `uv_tcp_t` |
| 是否走线程池 | **是** | 否 |
| C++ 类 | `FSReqCallback`（AsyncWrap） | `TCPWrap`（BaseObject+AsyncWrap） |
| 数据缓冲 | 直接写入 JS Buffer 内存 | alloc_cb 分配 Buffer |
| 完成通知 | 线程池完成 → async → poll | epoll 就绪 → poll |

两者都继承 AsyncWrap（有 asyncId），但 fs 因阻塞性质必然走线程池，TCP 因非阻塞走主线程事件循环。

---

## 8. 可运行验证

```js
const fs = require('fs');
const { performance } = require('perf_hooks');

// 异步：事件循环不冻结
const t0 = performance.now();
fs.readFile(__filename, () => {
  console.log('async done:', (performance.now() - t0).toFixed(1), 'ms');
});
setTimeout(() => console.log('timer still alive'), 0);

// 同步：这一行之后的所有代码都要等它
const t1 = performance.now();
fs.readFileSync(__filename);
console.log('sync done:', (performance.now() - t1).toFixed(1), 'ms (blocked event loop)');
```

---

## 9. 本章总结

- `fs.readFile` → `lib/fs.js` → `src/node_file.cc::Read` → `uv_fs_read` → 线程池 `read()` → 主线程回调。
- `FSReqCallback` 继承 `AsyncWrap`，每次读取都有 asyncId。
- 数据**零拷贝**直接写入 JS Buffer 内存。
- 同步 API 用 `nullptr` loop 触发 libuv 同步执行分支，阻塞主线程。
- 与 TCPWrap 同属 AsyncWrap 家族，但 fs 因阻塞性质必走线程池。

---

## 10. 思考题

1. 为什么 `fs.readFile` 传 Buffer 给 C++ 后，工作线程写进去的数据 JS 能直接看到？这依赖什么机制？
2. `readFileSync` 和 `readFile` 在 C++ 层只差一个 loop 参数，这个参数的有无如何决定同步/异步？
3. 大量并发 `fs.readFile` 会拖慢网络请求吗？为什么？
