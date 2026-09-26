/*
 * ============================================================
 * Layer 2 — 纯 C + libuv：最小事件循环（不含 V8）
 * 对应文章：02-01 libuv 事件循环六阶段 / 00-03 启动流程
 *
 * 这是 Node 的 C 层骨架——没有 JS 引擎，只有 libuv 事件循环。
 * 展示：
 *   1. uv_loop_init()  — 对应 Node 的 Environment::Create()
 *   2. uv_timer_t      — 对应 setTimeout()
 *   3. uv_async_t       — 对应 process.nextTick()（简化）
 *   4. uv_run()         — 对应 Node 最后的 uv_run(default)
 *
 * 编译：cc -o layer2-uv-loop layer2-uv-loop.c $(pkg-config --libs --cflags libuv)
 * 运行：./layer2-uv-loop
 * ============================================================
 */

#include <stdio.h>
#include <uv.h>

/* 定时器回调（对应 setTimeout 回调） */
static void timer_cb(uv_timer_t *handle) {
    printf("[Layer 2] uv_timer fired (≈ setTimeout) tick=%llu\n",
           uv_now(handle->loop));
    /* 不再 start，定时器自动 close → 循环在无 handle 时退出 */
}

/* async 回调（对应 process.nextTick 的通知机制） */
static void async_cb(uv_async_t *handle) {
    printf("[Layer 2] uv_async received (≈ nextTick 通知)\n");
    uv_close((uv_handle_t *)handle, NULL);
}

int main(void) {
    uv_loop_t *loop = uv_default_loop();

    printf("[Layer 2] libuv loop 初始化，版本=%u.%u.%u\n",
           UV_VERSION_MAJOR, UV_VERSION_MINOR, UV_VERSION_PATCH);

    /* 1. 启动定时器（= setTimeout(cb, 100)） */
    uv_timer_t timer;
    uv_timer_init(loop, &timer);
    uv_timer_start(&timer, timer_cb, 100, 0);  /* 100ms，不重复 */
    printf("[Layer 2] uv_timer_start 100ms\n");

    /* 2. 发 async 通知（= nextTick） */
    uv_async_t async;
    uv_async_init(loop, &async, async_cb);
    uv_async_send(&async);
    printf("[Layer 2] uv_async_send\n");

    /* 3. 进入事件循环（= Node 的 uv_run(UV_RUN_DEFAULT)） */
    printf("[Layer 2] uv_run 开始...\n");
    int result = uv_run(loop, UV_RUN_DEFAULT);

    printf("[Layer 2] uv_run 结束，result=%d\n", result);
    uv_loop_close(loop);

    return 0;
}