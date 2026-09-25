// 文件：src/04-cpp-bindings/napi-addon/addon.c
// 对应文章：04-cpp-bindings/06-napi.md
// 构建：在 src/04-cpp-bindings/napi-addon/ 下执行
//        npm init -y && npm install node-gyp && npx node-gyp configure build
// 使用：node -e "console.log(require('./build/Release/addon.node').add(1,2))"
//
// 最小 N-API 原生插件：导出 add(a, b)

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
