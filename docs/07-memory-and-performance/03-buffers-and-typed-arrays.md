# 07-03 Buffer 与 TypedArray：Node.js 的二进制数据模型

> 本章目标：理解 Buffer 的内存模型、它与 V8 堆的关系、TypedArray 体系，以及为什么 Buffer 设计为"堆外内存"。

## 导读

Node.js 的 Buffer 是处理二进制数据的核心。当我们说 `Buffer.from('hello')` 时，底层发生了什么？为什么 Buffer 不像普通 JS 对象那样被 V8 GC 管理？

## Buffer 的核心设计

Buffer **不把数据存在 V8 堆里**。它使用 V8 堆外的内存（通过 `ArrayBuffer` 的 backing store），V8 只持有一个引用对象。

```
V8 Heap                           External Memory
┌──────────────────────┐         ┌──────────────────────┐
│  Buffer 对象 (JS)     │         │                      │
│  ┌──────────────────┐ │         │  实际字节数据          │
│  │  _fastBuffer     │─┼────────→│  [h][e][l][l][o][\0] │
│  │  (Uint8Array)    │ │         │                      │
│  │    ↓             │ │         │                      │
│  │  ArrayBuffer     │─┼────────→│  (backing store)     │
│  └──────────────────┘ │         │                      │
└──────────────────────┘         └──────────────────────┘
```

## 继承体系

```
TypedArray (V8 内置)
  └── Uint8Array (V8 内置)
        └── Buffer (Node.js 扩展)
              └── FastBuffer (lib/internal/buffer.js)
```

Buffer 是 Uint8Array 的子类。`new Uint8Array()` 的数据存在 ArrayBuffer 中，而 ArrayBuffer 的 backing store 可以在 V8 堆外。

## Buffer.alloc vs Buffer.allocUnsafe

```javascript
const safe = Buffer.alloc(100);      // 清零，安全
const unsafe = Buffer.allocUnsafe(100); // 不清零，可能含旧数据
console.log(safe.equals(Buffer.alloc(100)));    // true（全零）
console.log(unsafe.equals(Buffer.alloc(100))); // false（可能有残留）
```

**为什么 `allocUnsafe` 不清零？** 性能。分配 8KB 内存 + 清零需要遍历每个字节；`allocUnsafe` 直接返回空闲块。

**安全风险**：`allocUnsafe` 返回的内存可能含有上一个用户的数据（旧密钥、临时密码）。**永远不要把 `allocUnsafe` 的结果暴露给用户**，必须先填充数据再使用。

## Buffer 池（8KB 预分配）

```javascript
// lib/internal/buffer.js — 简化

const poolSize = 8 * 1024;  // 8KB

function createPool() {
  poolBuf = Buffer.allocUnsafe(poolSize);
  poolOffset = 0;
}

function allocUnsafe(size) {
  if (size <= poolSize - poolOffset) {
    // 从池中切一小块（共享 backing store）
    const buf = poolBuf.subarray(poolOffset, poolOffset + size);
    poolOffset += size;
    return buf;
  }
  // 超过池剩余空间，直接分配
  return createUnsafeBuffer(size);
}
```

**关键**：小于 4KB 的 Buffer 共享同一个 8KB ArrayBuffer。这是为什么多个小 Buffer 可能有相同的 `buf.buffer`（底层 ArrayBuffer）。

```javascript
const a = Buffer.allocUnsafe(100);
const b = Buffer.allocUnsafe(100);
console.log(a.buffer === b.buffer); // true（同一个池）
```

## 从 C++ 层看 Buffer 创建

```cpp
// src/node_buffer.cc — 简化

void New(const v8::FunctionCallbackInfo<v8::Value>& args) {
  // 创建 ArrayBuffer（外部内存）
  char* data = static_cast<char*>(malloc(size));
  v8::Local<v8::ArrayBuffer> ab =
      v8::ArrayBuffer::New(isolate, data, size,
                            v8::ArrayBufferCreationMode::kInternalized);

  // 创建 Uint8Array 视图
  v8::Local<v8::Uint8Array> ui =
      v8::Uint8Array::New(ab, 0, size);

  // 设置为 Buffer 子类
  ui->SetPrototype(context, buffer_template).Check();

  args.GetReturnValue().Set(ui);
}
```

## 内存统计

```javascript
const before = process.memoryUsage();
const buf = Buffer.allocUnsafe(10 * 1024 * 1024); // 10MB
const after = process.memoryUsage();

console.log('heapUsed:', before.heapUsed, '→', after.heapUsed);
// heapUsed 几乎不变（Buffer 不在 V8 堆里）

console.log('external:', before.external, '→', after.external);
// external 增加约 10MB（堆外内存）
```

`process.memoryUsage().external` 就是 V8 管理的外部内存总量——包括所有 Buffer 的 backing store。

## TypedArray 体系一览

| 类型 | 元素大小 | 范围 | 用途 |
|------|----------|------|------|
| `Int8Array` | 1 byte | -128~127 | 有符号字节 |
| `Uint8Array` | 1 byte | 0~255 | 无符号字节（Buffer 基类）|
| `Uint8ClampedArray` | 1 byte | 0~255（钳制）| Canvas 像素 |
| `Int16Array` | 2 bytes | -32768~32767 | 16位有符号整数 |
| `Uint16Array` | 2 bytes | 0~65535 | 16位无符号 |
| `Int32Array` | 4 bytes | -2^31~2^31-1 | 32位有符号 |
| `Uint32Array` | 4 bytes | 0~2^32-1 | 32位无符号 |
| `Float32Array` | 4 bytes | IEEE 754 | 32位浮点 |
| `Float64Array` | 8 bytes | IEEE 754 | 64位浮点（=JS Number）|
| `BigInt64Array` | 8 bytes | -2^63~2^63-1 | 64位大整数 |

## Buffer 编码

```javascript
// 编码
Buffer.from('hello', 'utf8');   // <Buffer 68 65 6c 6c 6f>
Buffer.from('hello', 'base64');  // <Buffer 85 e9 65>
Buffer.from('hello', 'hex');     // <Buffer 68 65 6c 6c 6f>（同 utf8，因为是 ASCII）

// 解码
buf.toString('utf8');
buf.toString('base64');
buf.toString('hex');
```

| 编码 | 每字节表示 | 特点 |
|------|-----------|------|
| utf8 | 1-4 bytes/char | 默认编码，兼容 ASCII |
| utf16le | 2 bytes/char | 小端 UTF-16 |
| latin1 | 1 byte/char | ISO-8859-1 |
| base64 | 3 bytes→4 chars | 编码后变长 |
| hex | 2 chars/byte | 十六进制字符串 |

## 总结

| 要点 | 说明 |
|------|------|
| Buffer = Uint8Array 子类 | 不是普通 JS 对象 |
| 数据在 V8 堆外 | 通过 ArrayBuffer backing store |
| 8KB 池预分配 | 小 Buffer 共享底层 ArrayBuffer |
| `allocUnsafe` 性能高但不安全 | 必须填充后再使用 |
| `memoryUsage().external` | 跟踪堆外内存 |

## 思考题

1. 为什么 `Buffer.from('hello')` 比 `Buffer.alloc(5).write('hello')` 快？（提示：池分配 vs 直接分配）
2. `buf.subarray(0, 3)` 和 `buf.slice(0, 3)` 有什么区别？哪个是零拷贝？
3. Worker Thread 里能直接访问主线程的 Buffer 吗？为什么？