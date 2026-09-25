# 04-06 N-API：稳定的原生插件接口

> 本章目标：理解 N-API（Node-API）是什么、为什么需要它，以及如何用它写一个跨 Node 版本的原生插件。这是"在 Node 里调用 C/C++ 代码"的官方稳定通道。

---

## 1. 问题背景：原生插件的 ABI 噩梦

早期 Node 原生插件用 **NAN（Native Abstractions for Node）** 或 **V8 原生 API** 直接编写。但 V8 和 Node 的内部 API **变动频繁**，每次 Node 大版本升级，插件就得重新编译，否则 ABI 不兼容直接崩溃。

N-API 的出现就是为了解决这个问题：**提供一套与 V8 版本、Node 版本解耦的稳定 C ABI**。插件用 N-API 编写后，只要 N-API 版本号兼容，就**无需重新编译**即可跨 Node 版本运行。

---

## 2. N-API 是什么

N-API 是一组 C 函数（`node_api.h` / `js_native_api.h`），提供对 JS 值的抽象操作，但**隐藏了底层 V8 细节**：

- 不暴露 `v8::*` 类型，而是用不透明句柄 `napi_value`（代表任意 JS 值）。
- 所有函数返回 `napi_status`（错误码），而非抛异常或依赖 V8 类型。
- 由 Node 在内部把 N-API 调用翻译成当前 V8 版本的操作。

```c
// 传统 V8 API（易随版本断裂）
v8::Local<v8::String> s = v8::String::NewFromUtf8(isolate, "hi");

// N-API（稳定）
napi_value result;
napi_create_string_utf8(env, "hi", NAPI_AUTO_LENGTH, &result);
```

`env` 是 `napi_env`（等价于当前的 `v8::Isolate` + `Context` 封装），由 Node 传入，插件无需自己管理 Isolate。

---

## 3. 最小插件示例

**addon.c**
```c
#include <node_api.h>

static napi_value Add(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  double a, b;
  napi_get_value_double(env, args[0], &a);
  napi_get_value_double(env, args[1], &b);

  napi_value sum;
  napi_create_double(env, a + b, &sum);
  return sum;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, NULL, 0, Add, NULL, &fn);
  napi_set_named_property(env, exports, "add", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
```

**binding.gyp**
```python
{
  "targets": [{
    "target_name": "addon",
    "sources": ["addon.c"]
  }]
}
```

**构建与使用**
```bash
npm install -g node-gyp
node-gyp configure build
```
```js
const addon = require('./build/Release/addon.node');
console.log(addon.add(1, 2));   // 3
```

---

## 4. 关键 API 分类

| 类别 | 示例函数 |
|------|---------|
| 值创建 | `napi_create_double` / `napi_create_string_utf8` / `napi_create_object` |
| 值读取 | `napi_get_value_double` / `napi_get_value_string_utf8` |
| 对象操作 | `napi_set_named_property` / `napi_get_named_property` |
| 函数 | `napi_create_function` / `napi_call_function` |
| 引用管理 | `napi_create_reference` / `napi_delete_reference`（持久引用，防 GC） |
| 异步 | `napi_create_async_work` / `napi_queue_async_work`（封装 libuv 线程池，见 02-02） |
| 线程安全 | `napi_threadsafe_function`（跨线程回调 JS） |
| 缓冲 | `napi_create_buffer` / `napi_create_external_buffer` |

---

## 5. 异步工作（AsyncWorker）

想在插件里做耗时 C 计算而不阻塞事件循环？用 `napi_create_async_work`——它底层就是 `uv_queue_work`（见 02-02）：

```c
napi_async_work work;
napi_create_async_work(env, NULL, resource_name,
  Execute,    // 在工作线程执行（禁止碰 JS）
  Complete,   // 回主线程执行（回调 JS）
  data, &work);
napi_queue_async_work(env, work);
```

`Execute` 跑在线程池，`Complete` 在主线程事件循环里把结果传回 JS。这与 `fs` 的 C++ 绑定走的是同一套 libuv 线程池机制。

---

## 6. 与 Node C++ 内部绑定的区别

| 维度 | Node 内部绑定（src/*.cc） | N-API 插件 |
|------|--------------------------|-----------|
| 稳定性 | 随 Node 版本变（内部 API） | 稳定 ABI，跨版本免重编 |
| 用途 | Node 核心模块实现 | 第三方原生扩展 |
| 依赖 | 直接依赖 V8 / libuv 内部 | 仅依赖 N-API 头 |
| 示例 | `TCPWrap` / `src/node_file.cc` | `sharp`（图像处理）/ `bcrypt` / `sqlite3` |

Node 核心模块**不用** N-API（它们直接操作 V8，因为随 Node 一起编译）；N-API 是给外部插件用的稳定边界。

---

## 7. 可运行验证

> 完整可编译的最小 N-API 插件（addon.c + binding.gyp）已抽取到仓库
> `src/04-cpp-bindings/napi-addon/`，按其头部注释执行 `node-gyp configure build` 即可生成 addon.node。

```bash
# 用 node-addon-api（C++ 包装，更易用）快速建插件
npm init -y
npm install node-addon-api
# 写 .cpp + binding.gyp，node-gyp build，require 使用
node -e "console.log(require('./build/Release/addon').add(1,2))"
```

---

## 8. 本章总结

- N-API 是稳定的 C ABI，解耦插件与 V8/Node 版本，实现跨版本免重编。
- 用不透明 `napi_value` 与 `napi_status`，隐藏 V8 细节。
- 提供值操作、对象/函数、引用管理、异步工作、线程安全函数等完整 API。
- 异步工作底层是 libuv 线程池；Node 核心绑定不用 N-API（直接 V8），N-API 专供外部插件。

---

## 9. 思考题

1. 为什么 Node 核心模块（如 `TCPWrap`）不用 N-API，而外部插件要用？二者对"稳定性"的要求有何不同？
2. N-API 的 `napi_value` 为什么设计成"不透明句柄"而非直接暴露 `v8::Value*`？
3. 如果你用 N-API 写了一个耗时加密函数，应该如何避免阻塞主线程事件循环？底层走的是什么机制？
