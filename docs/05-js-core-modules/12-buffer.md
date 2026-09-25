# 05-12 Buffer：二进制数据与内存边界

> 本章目标：理解 Node 的 `Buffer`——它为何特殊（C++ 堆内存、不在 V8 堆上限内），以及它如何成为网络/文件 I/O 的字节载体。这是贯通"JS 与 OS 之间二进制数据"的关键。

---

## 1. 为什么需要 Buffer

JS 原生只有 `String`（UTF-16）和 `TypedArray`，没有"直接操作字节序列"的类型。而网络包、文件、加密输出都是**原始字节**。Node 用 `Buffer`（继承 `Uint8Array`）填补这一空缺。

```js
const buf = Buffer.from('hello', 'utf8');   // 字符串 → 字节
console.log(buf);                            // <Buffer 68 65 6c 6c 6f>
console.log(buf.length);                     // 5
```

---

## 2. Buffer 的内存来源（关键！）

（回顾 07-01）

- 现代 Node 的 `Buffer` 是 `Uint8Array` 的子类，底层是 **`ArrayBuffer`**。
- 但**大 Buffer 的后备存储来自 Node 的 C++ 堆（通过 `ArrayBuffer::Allocator`）**，**不计入 V8 堆上限 `max-old-space-size`**。
- 因此 `process.memoryUsage().external` 会统计这部分内存，而 `heapUsed` 不统计。

```js
const { rss, heapUsed, external } = process.memoryUsage();
// 创建 1GB Buffer 后，external 暴涨，heapUsed 几乎不变
const big = Buffer.alloc(1024 * 1024 * 1024);
console.log(process.memoryUsage().external);   // 包含这 1GB
```

这意味着：**"V8 堆没满但进程内存很大"通常是 Buffer/ArrayBuffer 占用**（07-01 提到的陷阱）。

---

## 3. 创建方式与零拷贝

| 方法 | 行为 | 注意 |
|------|------|------|
| `Buffer.alloc(n)` | 分配并**清零** | 安全，慢一点 |
| `Buffer.allocUnsafe(n)` | 分配但**不清零**（脏数据） | 快，但可能含旧内存泄露敏感信息 |
| `Buffer.from(str)` | 字符串 → 字节 | 编码默认 utf8 |
| `Buffer.from(array/typedarray)` | 拷贝创建 | 新内存 |
| `Buffer.from(buffer)` | **浅拷贝引用** | 共享底层 ArrayBuffer |
| `buf.subarray()` | **视图（零拷贝）** | 共享内存，不复制 |

```js
const a = Buffer.from('abcdef');
const view = a.subarray(2, 4);   // 视图，零拷贝，指向 a 的内存
view[0] = 90;                     // 修改会影响 a！（共享后备 ArrayBuffer）
console.log(a);                   // <Buffer 61 62 5a 64 65 66>
```

零拷贝视图是性能关键：解析大 Buffer 时切片不复制，避免内存翻倍。

---

## 4. Buffer 与流 / 网络的关系

（回顾 05-05、05-06）

- `net.Socket` 的 `data` 事件回调收到的是 `Buffer`。
- `fs.createReadStream` 默认按 Buffer 读（可设 `encoding` 转字符串）。
- `TCPWrap::OnRead` 把内核读到的字节填入 Buffer，经 `MakeCallback` 传给 JS（04-04）。
- 写入：`socket.write(buf)` 把 Buffer 交给 libuv `uv_write`，内核发送。

```js
socket.on('data', (chunk) => {
  // chunk 是 Buffer，来自内核 socket 缓冲
  processBuffer(chunk.subarray(0, 10));   // 零拷贝切片处理
});
```

---

## 5. `Buffer.concat` 与编码

```js
const parts = [Buffer.from('a'), Buffer.from('b')];
const all = Buffer.concat(parts);   // 复制合并成一个新 Buffer

Buffer.from('中', 'utf8').toString('hex');   // e4b8ad（UTF-8 三字节）
```

编码速查：`utf8`（默认）、`latin1`（单字节，旧称 binary）、`base64`、`hex`、`ascii`。注意 `'latin1'` 是每个字节 0-255，常用于二进制协议（非文本）。

---

## 6. 安全与陷阱

1. **`allocUnsafe` 泄露风险**：返回的 Buffer 可能含上一次使用的内存（如密钥、密码）。处理敏感数据用 `alloc` 或立即填充。
2. **超大 Buffer**：1GB+ Buffer 不计入 V8 上限，可能 OOM 但不在 heap 统计里，难排查。监控用 `external`。
3. **视图共享**：`subarray`/`slice` 共享内存，一处修改影响多处——需要独立副本时用 `.copy()` 或 `Buffer.from(view)`。
4. **`Buffer` 已弃用 `new Buffer()`**：必须用 `Buffer.from`/`alloc`/`allocUnsafe`（`new Buffer` 有安全隐患，已移除）。

---

## 7. 与 TypedArray / DataView 的关系

`Buffer` 是 `Uint8Array` 子类，因此能与 Web API 互操作：
```js
const u8 = new Uint8Array(buf);          // 视图，共享
const dv = new DataView(buf.buffer);     // 按类型读取（int32/float64 等）
console.log(dv.getInt32(0, true));       // little-endian 读 4 字节为 int32
```

---

## 8. 可运行验证

```js
const b = Buffer.allocUnsafe(8);
console.log(b);   // 可能含随机脏数据
b.fill(0);
console.log(b);   // <Buffer 00 00 00 00 00 00 00 00>

const s = Buffer.from('hello');
const view = s.subarray(1, 3);
view[0] = 90;
console.log(s.toString());   // "hZllo"（共享内存被改）
```

---

## 9. 本章总结

- `Buffer` 是 `Uint8Array` 子类，是字节序列的载体；大 Buffer 的后备存于 C++ 堆，不计入 V8 堆上限（在 `external`）。
- 创建：`alloc`（清零安全）、`allocUnsafe`（脏数据快）、`from`（拷贝/引用）、`subarray`（零拷贝视图）。
- 网络/文件 I/O 的字节都以 Buffer 流转；`TCPWrap::OnRead` 填 Buffer 回 JS。
- 陷阱：allocUnsafe 敏感数据泄露、超大 Buffer 不在 heap 统计、视图共享副作用。

---

## 10. 思考题

1. 为什么"V8 堆没满但进程 RSS 很大"常常是 Buffer 造成的？你该看哪个指标确认？
2. `Buffer.subarray` 与 `Buffer.from(buf)` 在内存上的本质区别是什么？什么场景必须用后者？
3. 为什么处理密码/密钥时不要用 `Buffer.allocUnsafe`？Node 的 `crypto` 输出是否规避了这一点？
