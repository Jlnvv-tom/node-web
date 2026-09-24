# 05-08 crypto 模块：同步、异步与线程池

> 本章目标：理解 `crypto` 模块的两类执行路径——纯计算的同步/异步 API，以及为何部分 crypto 操作（pbkdf2、scrypt、randomBytes）会走 libuv 线程池（回顾 02-02）。

---

## 1. crypto 的两种实现来源

Node 的 `crypto` 模块底层依赖 **OpenSSL**（在 `deps/openssl`，见 PLAN 顶层结构）。提供两类能力：

1. **哈希 / HMAC / 对称加解密 / 签名**：通常很快，可直接在主线程同步或异步执行。
2. **密钥派生（pbkdf2 / scrypt）、安全随机（randomBytes）、部分异步签名/验证**：计算密集或涉及阻塞系统调用，**走 libuv 线程池**以避免阻塞事件循环。

---

## 2. 同步 vs 异步 API

```js
const crypto = require('crypto');

// 同步（阻塞主线程，适合小数据/启动期）
const hash = crypto.createHash('sha256').update('data').digest('hex');

// 异步回调（不阻塞，用于 I/O 路径）
crypto.pbkdf2('password', 'salt', 100000, 64, 'sha512', (err, key) => {
  console.log(key.toString('hex'));
});

// Promise 版（util.promisify 或现代 API）
const { pbkdf2 } = require('util');
await pbkdf2('password', 'salt', 100000, 64, 'sha512');
```

---

## 3. 为什么 pbkdf2 / scrypt / randomBytes 走线程池

（回顾 02-02、01-03）

- **`pbkdf2` / `scrypt`**：需要迭代数万次哈希，是 CPU 密集计算。若在主线程同步跑，会**阻塞事件循环**数秒（取决于迭代次数），让所有 I/O 暂停。因此 Node 把它们放进 **libuv 线程池**异步执行，完成后经 `uv_async_send` 唤醒主线程回调（见 02-07）。
- **`crypto.randomBytes`**：需要读取系统熵源（`/dev/urandom`），这是一个可能阻塞的读取（尤其在熵池未初始化时）。历史实现也走线程池以避免阻塞主线程。现代 `crypto.randomBytes` 多数情况快，但大量请求时仍可能用线程池。
- **异步签名/验证**（`sign.async` / `verify.async`）：大块数据签名计算可在工作线程做，避免阻塞。

```js
// 这些会走 libuv 线程池（默认 4 线程，见 02-02）
crypto.pbkdf2(...)
crypto.scrypt(...)
crypto.randomBytes(...)
crypto.generateKeyPair('rsa', { modulusLength: 4096 }, cb)   // 大密钥生成也重
```

---

## 4. 线程池耗尽风险

如果你同时发起**大量** `pbkdf2` 请求（如暴力破解防护、批量密钥派生），而默认线程池只有 4 个，请求会**排队**，吞吐量受限：

```js
// 危险：1 万个并发 pbkdf2 全压在 4 线程池上
for (let i = 0; i < 10000; i++) {
  crypto.pbkdf2('p', 's', 100000, 64, 'sha512', () => {});
}
// 4 线程串行处理，后到的要等很久
```

缓解方案：
- 调大 `UV_THREADPOOL_SIZE`（在首次使用前，见 02-02）。
- 用 worker_threads 做隔离（05-07），避免阻塞主进程。
- 用 `scrypt` 的 `maxmem` 参数限制资源。

---

## 5. Web Crypto API（浏览器兼容层）

Node 14+ 提供 `globalThis.crypto`（Web Crypto 标准），接口与浏览器一致：

```js
const { subtle } = globalThis.crypto;
const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
const enc = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
```

Web Crypto 的 `subtle` 方法**全部返回 Promise**（异步），且多数实现不走 libuv 线程池（而是用 OpenSSL 在当前线程或内部调度）。它适合需要跨浏览器/Node 一致性的场景。

---

## 6. 与 Buffer 的关系

crypto 输出多为 `Buffer`（`ArrayBuffer` 后备，见 07-01）。注意大密钥/大密文是 C++ 堆内存，不计入 V8 堆，但会影响进程 RSS。

---

## 7. 可运行验证

```js
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const t = performance.now();
crypto.pbkdf2('pw', 'salt', 100000, 64, 'sha512', () => {
  console.log('pbkdf2 done @', (performance.now()-t).toFixed(0), 'ms');
});
setImmediate(() => console.log('event loop NOT blocked'));   // 先打印，证明异步
```

---

## 8. 本章总结

- `crypto` 底层是 OpenSSL；分"快操作（哈希/加解密）"与"重操作（pbkdf2/scrypt/randomBytes）"。
- 重操作走 **libuv 线程池**异步执行，避免阻塞事件循环（经 async handle 唤醒主线程）。
- 大量并发 pbkdf2 会压满线程池→排队；可调 `UV_THREADPOOL_SIZE` 或用工件线程隔离。
- Web Crypto（`globalThis.crypto.subtle`）为浏览器兼容标准，全异步 Promise API。

---

## 9. 思考题

1. 为什么 `crypto.pbkdf2` 必须异步（走线程池），而 `crypto.createHash` 可以同步？二者的计算量本质差异是什么？
2. 如果你在一个高并发登录接口里对每个请求都跑 `pbkdf2(password, 100000)` 校验，可能遇到什么瓶颈？如何缓解？
3. Web Crypto 的 `subtle` 方法和传统 `crypto.pbkdf2` 在异步机制上有何不同？各适合什么场景？
