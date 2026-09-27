# 09-03 原生插件开发与 ABI 兼容

> 本章目标：理解 Node.js 原生插件（Native Addon）的开发模式、ABI 兼容性问题、以及 N-API 如何解决版本耦合。

## 导读

原生插件是用 C/C++ 编写的动态链接库（`.node` 文件），可以被 Node.js `require()` 加载。它们用于：
- 调用系统 API（如 GPU、摄像头、硬件）
- 封装高性能 C/C++ 库（如图像处理、加解密）
- 绕过 V8 的性能限制

## 三代插件 API

| 代 | API | ABI 稳定性 | 绑定对象 |
|----|-----|-----------|---------|
| 1 | NAN (Native Abstractions for Node.js) | ❌ 每个 Node 版本需重编译 | V8 API |
| 2 | N-API (node_api.h) | ✅ ABI 稳定 | C 抽象层 |
| 3 | Node-API (N-API 正式名) | ✅ 同上 | C 抽象层 |

### NAN：V8 直接绑定

```cpp
#include <nan.h>

NAN_METHOD(Add) {
  double a = Nan::To<double>(info[0]).FromJust();
  double b = Nan::To<double>(info[1]).FromJust();
  info.GetReturnValue().Set(a + b);
}

NAN_MODULE_INIT(Init) {
  Nan::Set(target, Nan::New("add").ToLocalChecked(),
           Nan::GetFunction(Nan::New<FunctionTemplate>(Add)).ToLocalChecked());
}

NODE_MODULE(addon, Init)
```

**问题**：NAN 直接使用 V8 C++ API。V8 每个版本都可能改 API（如 `v8::Local` → `v8::MaybeLocal`），导致插件每次 Node 升级都要改代码 + 重编译。

### N-API：稳定的 C ABI

```c
#include <node_api.h>

napi_value Add(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  double a, b;
  napi_get_value_double(env, args[0], &a);
  napi_get_value_double(env, args[1], &b);

  napi_value result;
  napi_create_double(env, a + b, &result);
  return result;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "add", NAPI_AUTO_LENGTH, Add, NULL, &fn);
  napi_set_named_property(env, exports, "add", fn);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
```

**优势**：N-API 是 C 接口（不是 C++），ABI 稳定。一次编译，所有 Node 版本通用（Node 12+）。

## N-API 的设计哲学

```
V8 API (C++, 每版变)         NAN (C++ 包装, 每版适配)
     ↓                             ↓
N-API (C 接口, ABI 稳定) ←── Node.js 维护适配层
     ↓
插件代码 (C/C++)
```

N-API 在 V8 和插件之间放了一层 C 接口。这层的 ABI 是稳定的——Node.js 团队承诺不破坏 N-API 的 ABI。当 V8 改 API 时，只有 Node.js 内部的 `src/node_api.cc` 需要适配，插件无感知。

## node-gyp 构建

```python
# binding.gyp
{
  "targets": [{
    "target_name": "addon",
    "sources": ["addon.c"],
    "includes": ["<(node_root_dir)/include/node"],
    "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"]
  }]
}
```

```bash
# 构建
npx node-gyp configure build
# → build/Release/addon.node
```

```javascript
// 使用
const addon = require('./build/Release/addon');
console.log(addon.add(2, 3));  // 5
```

> 可运行示例见 `src/00-mininode/layer3-napi-addon.c` + `binding.gyp` + `layer3-use-addon.js`

## 异步操作：napi_create_async_work

```c
void ExecuteWork(napi_env env, void* data) {
  // 在 libuv 线程池执行（不阻塞事件循环）
  MyData* d = (MyData*)data;
  d->result = heavy_compute(d->input);
}

void CompleteWork(napi_env env, napi_status status, void* data) {
  // 回到主线程
  MyData* d = (MyData*)data;
  napi_value result;
  napi_create_double(env, d->result, &result);
  napi_resolve_deferred(env, d->deferred, result);
  free(d);
}

napi_value ComputeAsync(napi_env env, napi_callback_info info) {
  napi_deferred deferred;
  napi_value promise;
  napi_create_promise(env, &deferred, &promise);

  MyData* data = malloc(sizeof(MyData));
  data->deferred = deferred;

  napi_async_work work;
  napi_value name;
  napi_create_string_utf8(env, "ComputeAsync", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, NULL, name, ExecuteWork, CompleteWork, data, &work);

  napi_queue_async_work(env, work);  // → uv_queue_work
  return promise;
}
```

## Thread-Safe Function

从 Worker 线程回调主线程：

```c
napi_threadsafe_function tsfn;

void CallJsBack(napi_env env, napi_value js_cb, void* context, void* data) {
  // 在主线程执行
  napi_value undefined, argv;
  napi_get_undefined(env, &undefined);
  napi_create_double(env, *(double*)data, &argv);
  napi_call_function(env, undefined, js_cb, 1, &argv, NULL);
}

// Worker 线程中调用
napi_call_threadsafe_function(tsfn, &result, napi_tsfn_blocking);
```

## 版本兼容表

| N-API 版本 | 最低 Node 版本 | 新增能力 |
|------------|---------------|---------|
| 1 | 8.0 | 基础 API |
| 3 | 10.0 | napi_create_async_work |
| 5 | 10.16 | Thread-Safe Function |
| 6 | 12.0 | napi_add_finalizer |
| 8 | 14.0 | 性能标记 |
| 9 | 15.0 | Date 增强 |

## 总结

| 要点 | 说明 |
|------|------|
| NAN 直接绑定 V8 API | 不稳定，每版需重编译 |
| N-API 提供稳定 C ABI | 一次编译，多版本通用 |
| node-gyp 构建 | 生成 .node 动态库 |
| 异步操作 | napi_create_async_work → uv_queue_work |
| 跨线程回调 | Thread-Safe Function |

## 思考题

1. 为什么 N-API 用 C 接口而不是 C++？（提示：C ABI 跨编译器稳定，C++ ABI 不稳定）
2. 一个用 N-API v1 编译的 `.node` 文件，能在 Node 22 上跑吗？为什么？
3. `napi_create_async_work` 底层调用的是 `uv_queue_work`。线程池大小由什么控制？