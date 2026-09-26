/*
 * ============================================================
 * Layer 3 — 最小 N-API 原生模块（C → V8 → JS 的桥梁）
 * 对应文章：04-06 N-API / 04-01 C++ 绑定层核心抽象
 *
 * 这就是"Node 内建模块"的最简形态：
 *   C 代码 → N-API 宏注册 → JS 可 require 加载
 *
 * 真正的 fs/net/http 模块底层都是这个模式，只是更复杂。
 *
 * 编译：cd src/00-mininode && npx node-gyp configure build
 * 使用：node -e "var m=require('./build/Release/mini_node_addon'); m.run()"
 * ============================================================
 */

#include <node_api.h>
#include <stdio.h>
#include <stdlib.h>

/* JS 可调用：返回运行时信息 */
static napi_value GetRuntimeInfo(napi_env env, napi_callback_info info) {
    napi_value obj;
    napi_create_object(env, &obj);

    /* 对应 Node 的 process.versions */
    napi_value v8_ver, node_ver;
    napi_create_string_utf8(env, "embedded-v8", NAPI_AUTO_LENGTH, &v8_ver);
    napi_create_string_utf8(env, "mini-node-addon", NAPI_AUTO_LENGTH, &node_ver);
    napi_set_named_property(env, obj, "v8", v8_ver);
    napi_set_named_property(env, obj, "name", node_ver);

    return obj;
}

/* JS 可调用：打印一行（模拟 console.log 的 C 层实现） */
static napi_value PrintLine(napi_env env, napi_callback_info info) {
    size_t argc = 1;
    napi_value arg;
    napi_get_cb_info(env, info, &argc, &arg, NULL, NULL);

    size_t len;
    napi_get_value_string_utf8(env, arg, NULL, 0, &len);
    char *buf = (char *)malloc(len + 1);
    napi_get_value_string_utf8(env, arg, buf, len + 1, &len);
    printf("[mini-addon] %s\n", buf);
    free(buf);

    napi_value undefined;
    napi_get_undefined(env, &undefined);
    return undefined;
}

/* 初始化：把 C 函数注册为 JS 可见的属性（= 模块导出） */
static napi_value Init(napi_env env, napi_value exports) {
    napi_value fn1, fn2;

    napi_create_function(env, "getRuntimeInfo", NAPI_AUTO_LENGTH,
                         GetRuntimeInfo, NULL, &fn1);
    napi_set_named_property(env, exports, "getRuntimeInfo", fn1);

    napi_create_function(env, "print", NAPI_AUTO_LENGTH,
                         PrintLine, NULL, &fn2);
    napi_set_named_property(env, exports, "print", fn2);

    return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)