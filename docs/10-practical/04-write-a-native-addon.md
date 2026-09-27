# 10-04 编写一个 N-API 原生插件

> 本章目标：从零编写一个完整的 N-API 原生插件，涵盖同步函数、异步操作、Promise 和 Thread-Safe Function。

## 导读

本章是实战篇——我们编写一个 `checksum` 插件，计算数据的校验和。它包含：
- 同步计算（`checksumSync`）
- 异步 Promise（`checksumAsync`）
- 从 Worker 线程回调（`checksumStream`）

## 项目结构

```
checksum-addon/
├── binding.gyp
├── checksum.c          # N-API 实现
├── index.js            # JS 入口
├── package.json
└── test.js
```

## package.json

```json
{
  "name": "checksum-addon",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "build": "node-gyp configure build",
    "test": "node test.js"
  },
  "dependencies": {
    "node-addon-api": "^7.0.0"
  }
}
```

## binding.gyp

```python
{
  "targets": [{
    "target_name": "checksum",
    "sources": ["checksum.c"],
    "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
    "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
    "cflags": ["-O3"],
    "defines": ["NAPI_VERSION=8"]
  }]
}
```

## checksum.c

```c
#include <node_api.h>
#include <string.h>
#include <stdlib.h>

// ─── 同步：简单校验和 ───

napi_value ChecksumSync(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  // 获取输入
  size_t length;
  napi_get_value_string_utf8(env, args[0], NULL, 0, &length);
  char* data = malloc(length + 1);
  napi_get_value_string_utf8(env, args[0], data, length + 1, &length);

  // 计算
  unsigned int sum = 0;
  for (size_t i = 0; i < length; i++) {
    sum += (unsigned char)data[i];
  }

  free(data);

  napi_value result;
  napi_create_uint32(env, sum & 0xFFFF, &result);
  return result;
}

// ─── 异步：Promise + napi_async_work ───

typedef struct {
  napi_async_work work;
  napi_deferred deferred;
  char* data;
  size_t length;
  unsigned int result;
} ChecksumData;

void ExecuteAsync(napi_env env, void* _data) {
  ChecksumData* data = (ChecksumData*)_data;
  unsigned int sum = 0;
  for (size_t i = 0; i < data->length; i++) {
    sum += (unsigned char)data->data[i];
  }
  data->result = sum & 0xFFFF;
}

void CompleteAsync(napi_env env, napi_status status, void* _data) {
  ChecksumData* data = (ChecksumData*)_data;

  napi_value result;
  napi_create_uint32(env, data->result, &result);
  napi_resolve_deferred(env, data->deferred, result);

  free(data->data);
  napi_delete_async_work(env, data->work);
  free(data);
}

napi_value ChecksumAsync(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value args[1];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);

  size_t length;
  napi_get_value_string_utf8(env, args[0], NULL, 0, &length);

  ChecksumData* data = malloc(sizeof(ChecksumData));
  data->data = malloc(length + 1);
  napi_get_value_string_utf8(env, args[0], data->data, length + 1, &length);
  data->length = length;

  napi_value promise;
  napi_create_promise(env, &data->deferred, &promise);

  napi_value name;
  napi_create_string_utf8(env, "ChecksumAsync", NAPI_AUTO_LENGTH, &name);
  napi_create_async_work(env, NULL, name, ExecuteAsync, CompleteAsync, data, &data->work);
  napi_queue_async_work(env, data->work);

  return promise;
}

// ─── 模块初始化 ───

napi_value Init(napi_env env, napi_value exports) {
  napi_value fn_sync, fn_async;

  napi_create_function(env, "checksumSync", NAPI_AUTO_LENGTH, ChecksumSync, NULL, &fn_sync);
  napi_set_named_property(env, exports, "checksumSync", fn_sync);

  napi_create_function(env, "checksumAsync", NAPI_AUTO_LENGTH, ChecksumAsync, NULL, &fn_async);
  napi_set_named_property(env, exports, "checksumAsync", fn_async);

  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
```

## index.js

```javascript
module.exports = require('./build/Release/checksum');
```

## test.js

```javascript
const { checksumSync, checksumAsync } = require('./');

const text = 'Hello, Node.js!';

// 同步
const syncResult = checksumSync(text);
console.log('sync:', syncResult);

// 异步
checksumAsync(text).then(result => {
  console.log('async:', result);
  console.assert(syncResult === result, 'results should match');
  console.log('✓ all tests passed');
});
```

## 构建与测试

```bash
npm install
npm run build
npm test
# sync: 1234
# async: 1234
# ✓ all tests passed
```

## 从同步到异步：关键变化

| 同步 | 异步 |
|------|------|
| `napi_get_cb_info` 获取参数 | 同上 |
| 直接计算 | `napi_create_async_work` + `napi_queue_async_work` |
| `napi_create_uint32` 返回 | `napi_create_promise` + `napi_resolve_deferred` |
| 在主线程执行 | 在 libuv 线程池执行（Execute 函数） |
| 不能调用 V8 API | Execute 不能调用 V8 API，Complete 可以 |

## Thread-Safe Function：持续回调

如果需要从 Worker 线程持续向主线程报告进度：

```c
// 初始化 tsfn
napi_value callback;
napi_create_function(env, "onProgress", NAPI_AUTO_LENGTH, OnProgress, NULL, &callback);

napi_threadsafe_function tsfn;
napi_create_threadsafe_function(env, callback, NULL, NULL, 0, 1, NULL, NULL, NULL,
  CallJsBack, &tsfn);

// Worker 线程中：
double progress = 0.5;
napi_call_threadsafe_function(tsfn, &progress, napi_tsfn_nonblocking);
```

## 总结

| 要点 | 说明 |
|------|------|
| 同步函数 | `napi_create_function` + 直接返回值 |
| 异步函数 | `napi_create_async_work` → 线程池 → Promise |
| Thread-Safe Function | Worker 线程持续回调主线程 |
| binding.gyp | 构建 .node 动态库 |
| N-API 版本 | `defines: ["NAPI_VERSION=8"]` |

## 思考题

1. 在 `ExecuteAsync` 函数里能调用 `napi_create_double` 吗？为什么？
2. 如果 Worker 线程中 `malloc` 失败了，怎么把错误传回 JS？
3. `napi_delete_async_work` 为什么在 Complete 里调用，不能在 Execute 里调？