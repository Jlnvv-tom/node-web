# 06-03 逐阶段源码走读（Phase Source Walkthrough）

> 本章目标：把 02-01 讲的六阶段落到具体源码行，跟着 `uv_run` 走一遍，标注每段对应的阶段与回调来源。

---

## 1. 起点：`uv_run`

文件：`deps/uv/src/unix/core.c`

```c
int uv_run(uv_loop_t* loop, uv_run_mode mode) {
  int timeout;
  int r;
  int ran_pending;

  r = uv__loop_alive(loop);
  if (!r)
    uv__update_time(loop);          // 初始化时间基准

  while (r != 0 && loop->stop_flag == 0) {
    /* (B) 更新当前时间，供 timers 比较 */
    uv__update_time(loop);
    /* (C) 阶段1: timers */
    uv__run_timers(loop);
    /* (D) 阶段2: pending */
    ran_pending = uv__run_pending(loop);
    /* (E) 阶段3: idle + prepare */
    uv__run_idle(loop);
    uv__run_prepare(loop);

    timeout = 0;
    if ((mode == UV_RUN_ONCE) && !ran_pending)
      timeout = uv__backend_timeout(loop);   // 计算 poll 阻塞时长

    /* (F) 阶段4: poll —— 阻塞等 I/O */
    uv__io_poll(loop, timeout);

    /* (G) 阶段5: check */
    uv__run_check(loop);
    /* (H) 阶段6: close */
    uv__run_closing_handles(loop);

    if (mode == UV_RUN_ONCE) {
      uv__update_time(loop);
      uv__run_timers(loop);
    }

    r = uv__loop_alive(loop);
  }

  return r;
}
```

记住这个 `while` 体，下面逐段拆。

---

## 2. 阶段1 — `uv__run_timers`

```c
static void uv__run_timers(uv_loop_t* loop) {
  struct heap_node* heap_node;
  uv_timer_t* handle;

  for (;;) {
    heap_node = heap_min(&loop->timer_heap);   // 最小堆顶 = 最早到期
    if (heap_node == NULL)
      break;

    handle = container_of(heap_node, uv_timer_t, heap_node);
    if (handle->timeout > loop->time)            // 还没到期 → 停止
      break;

    uv_timer_stop(handle);                       // 从堆移除
    uv_timer_again(handle);                      // 处理 repeat（setInterval）
    handle->timer_cb(handle);                    // ★ 执行 setTimeout/setInterval 回调
  }
}
```

- `timer_heap` 是**最小堆**，堆顶永远是最近到期的定时器。
- 循环取出所有 `timeout <= loop->time` 的定时器执行。
- `setInterval` 通过 `uv_timer_again` 重新入堆。

---

## 3. 阶段2 — `uv__run_pending`

```c
static int uv__run_pending(uv_loop_t* loop) {
  QUEUE* q;
  QUEUE* q_head;
  uv__io_t* w;

  if (QUEUE_EMPTY(&loop->pending_queue))
    return 0;

  /* 把 pending_queue 移到局部，避免回调里再入队导致死循环 */
  q_head = &loop->pending_queue;
  QUEUE_INIT(q_head);

  while (!QUEUE_EMPTY(q_head)) {
    q = QUEUE_HEAD(q_head);
    QUEUE_REMOVE(q);
    QUEUE_INIT(q);
    w = QUEUE_DATA(q, uv__io_t, pending_queue);
    w->cb(loop, w, POLLOUT);          // ★ 执行推迟的 I/O 回调
  }
  return 1;
}
```

- 存放**上一轮 poll 中无法立即处理的 I/O 回调**（如连接错误）。
- 移到局部队列后统一执行，防止递归污染。

---

## 4. 阶段3 — idle / prepare

```c
static void uv__run_idle(uv_loop_t* loop)   { /* 遍历 idle 句柄 */ }
static void uv__run_prepare(uv_loop_t* loop){ /* 遍历 prepare 句柄 */ }
```

- 由 `uv_idle_t` / `uv_prepare_t` 注册，内部维护使用，普通用户几乎不碰。
- 给 libuv 在 poll 前后做内部准备/清理的钩子。

---

## 5. 阶段4 — `uv__io_poll`（核心）

```c
void uv__io_poll(uv_loop_t* loop, int timeout) {
  /* 1) 调用 epoll_wait / kevent，阻塞最多 timeout 毫秒 */
  /* 2) 对每个就绪的 fd，执行其 watcher 的 cb */
  /* 3) 处理新到来的事件，触发 I/O 回调（如 'data' / connect） */
}
```

- `timeout` 来自 `uv__backend_timeout`，逻辑：
  - 有最早到期的 timer → `timeout = timer到期 - now`（保证 timer 准时）。
  - 没有活跃句柄/I/O → `timeout = 0`（不阻塞）。
  - 否则取一合适正值（但不超过最近 timer）。
- 内部细节见 02-07 poll 深度解析。

---

## 6. 阶段5 — `uv__run_check`

```c
static void uv__run_check(uv_loop_t* loop) {
  uv__run_check_prepare_idle(loop, &loop->check_handles);  // 遍历 check 句柄
}
```

- `setImmediate` 底层就是往 `check_handles` 链表注册一个 check 句柄。
- poll 一结束立刻执行，所以"本轮 I/O 之后立即跑"。

---

## 7. 阶段6 — `uv__run_closing_handles`

```c
static void uv__run_closing_handles(uv_loop_t* loop) {
  uv_handle_t* p;
  uv_handle_t* q;
  p = loop->closing_handles;
  loop->closing_handles = NULL;
  while (p) {
    q = p->next_closing;
    uv__finish_close(p);          // ★ 执行 close 回调
    p = q;
  }
}
```

- 执行所有被 `uv_close()` 关闭的句柄的回调（如 `socket.on('close')`）。
- `uv__finish_close` 最终调用 handle 的 `close_cb`。

---

## 8. 阶段之间的微任务清空

注意：上面六段是 C 层宏任务。但 JS 回调每次从 C++ 回到 JS 边界时，Node 的 `InternalCallbackScope` 会先清空 `nextTick` 队列，再清空 V8 microtask 队列（详见 06-01）。所以"阶段之间"的真实顺序是：

```
uv__run_timers
   → [InternalCallbackScope] 清空 nextTick + microtask
uv__run_pending
   → [同上]
... 每个阶段后都经历一次微任务清空 ...
```

---

## 9. 一张完整的走查表

| 阶段 | 源码函数 | 回调来源 | 队列/结构 |
|------|---------|---------|----------|
| 1 timers | `uv__run_timers` | `setTimeout`/`setInterval` | `timer_heap` 最小堆 |
| 2 pending | `uv__run_pending` | 推迟的 I/O 错误回调 | `pending_queue` |
| 3 idle/prepare | `uv__run_idle/prepare` | libuv 内部 | `idle_handles`/`prepare_handles` |
| 4 poll | `uv__io_poll` | 网络 I/O 事件、线程池完成 | epoll/kqueue |
| 5 check | `uv__run_check` | `setImmediate` | `check_handles` |
| 6 close | `uv__run_closing_handles` | `uv_close` 回调 | `closing_handles` |
| (间) 微任务 | `InternalCallbackScope` | `nextTick`/`Promise` | 各自队列 |

---

## 10. 本章总结

- `uv_run` 的 `while` 体就是事件循环的骨架，六阶段一一对应具体函数。
- timers 用最小堆取最早到期；poll 是真正阻塞等 I/O 的地方；check 紧接 poll 执行 setImmediate。
- 每个 C 层阶段之后，Node 都会清空 nextTick 与 microtask 队列，再进入下一阶段。
- 记住函数名与队列结构，读源码时能快速定位。

---

## 11. 思考题

1. `uv__run_timers` 用最小堆而不是数组，为什么？如果改成数组排序会怎样？
2. `uv__run_pending` 为什么要先把 `pending_queue` 移到局部变量再遍历？
3. 在 `uv__io_poll` 内部，如果 `epoll_wait` 返回了 100 个就绪 fd，这些回调是全部执行完才进入 check 阶段，还是可能穿插？为什么？
