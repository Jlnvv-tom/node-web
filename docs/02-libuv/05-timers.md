# 02-05 定时器：libuv 如何实现 setTimeout/setInterval

> 本章目标：理解 Node 的定时器**不依赖操作系统定时器**，而是 libuv 用最小堆自己管理的。拆解 `setTimeout`/`setInterval` 的底层数据结构与超时计算。

---

## 1. 关键认知：定时器是 libuv 自建的

很多人以为 `setTimeout` 用了内核定时器（如 `timerfd`/`setitimer`）。**不是**。libuv 用**最小堆（min-heap）** 存储所有定时器，按到期时间排序，并在 **poll 阶段计算阻塞时长**时顺便检查是否到期。

```
setTimeout(fn, 1000)
   → uv_timer_start(handle, cb, 1000, 0)
   → 插入 loop->timer_heap（按 timeout 排序）
   → 若是最早到期，更新 loop 的"最近到期时间"提示

uv_run 每轮：
   timers 阶段: 取出所有 timeout <= loop->time 的定时器执行
   poll 阶段:   timeout = 最近未到期定时器 - 当前时间（决定 epoll_wait 阻塞多久）
```

---

## 2. 数据结构：最小堆

```c
// deps/uv/src/timer.c
struct heap_node {
  struct heap_node* left;
  struct heap_node* right;
  struct heap_node* parent;
};
// loop 持有 timer_heap，堆顶 = 最早到期的 uv_timer_t
```

- 插入/删除：`O(log n)`。
- 取最小（最早到期）：`O(1)`（堆顶）。
- 比数组排序（O(n log n) 每次）高效得多。

Node 的 `setTimeout` 注册一个 `uv_timer_t`，`uv_timer_start` 把它插入堆。

---

## 3. 超时计算：poll 阶段如何决定阻塞时长

源码：`uv__backend_timeout`（在 `uv__io_poll` 前调用）：

```c
int uv_backend_timeout(const uv_loop_t* loop) {
  // 1) 没有活跃句柄且无可运行 idle → 不阻塞（返回 0）
  if (loop->stop_flag != 0) return 0;
  if (!uv__has_active_handles(loop) && !uv__has_active_reqs(loop)) return 0;
  // 2) 有待执行的 pending（微任务等）→ 不阻塞
  if (!QUEUE_EMPTY(&loop->pending_queue)) return 0;
  // 3) 关闭中的句柄 → 不阻塞
  if (loop->closing_handles) return 0;
  // 4) 有最早到期定时器 → 阻塞到它到期
  heap_node* min = heap_min(&loop->timer_heap);
  if (min != NULL) {
    uv_timer_t* timer = container_of(min, uv_timer_t, heap_node);
    return (int)(timer->timeout - loop->time);   // 阻塞剩余毫秒
  }
  // 5) 否则一直阻塞（直到 I/O 事件）
  return -1;   // UV_INFINITE
}
```

**核心逻辑**：poll 阻塞时长 = 最近定时器还有多久到期。这样既不错过定时器，又不浪费 CPU 空转。

---

## 4. `setTimeout(fn, 0)` 的真相

你写 `setTimeout(fn, 0)`，Node 实际**当成 1ms**（`UV_TIMER_MIN` 相关限制，且 `0` 会被抬高）。所以：

- 顶层 `setTimeout(fn, 0)` 几乎总是晚于同轮的 `setImmediate` 和微任务。
- 它并非"立刻"，而是"下一轮 timers 阶段，至少 1ms 后"（见 06-02）。

---

## 5. `setInterval` 的实现

`setInterval(fn, 1000)` 注册 `uv_timer_t`，`repeat = 1000`。在 `uv__run_timers` 执行后：

```c
static void uv__run_timers(uv_loop_t* loop) {
  while ((heap_node = heap_min(&loop->timer_heap)) != NULL) {
    handle = container_of(heap_node, uv_timer_t, heap_node);
    if (handle->timeout > loop->time) break;   // 未到期，停
    uv_timer_stop(handle);                       // 移除
    uv_timer_again(handle);                     // 若有 repeat，重新入堆（timeout += repeat）
    handle->timer_cb(handle);                   // 执行回调
  }
}
```

`uv_timer_again`：若 `repeat > 0`，把 `timeout` 设为 `loop->time + repeat`，重新插入堆。这样每轮（实际每 ~1000ms）重新触发。

---

## 6. 取消定时器：`clearTimeout` / `clearInterval`

底层都是 `uv_timer_stop(handle)`：从堆中移除该 `uv_timer_t`。若回调尚未执行，则不会再触发。Node 的 `clearTimeout(id)` 通过 id 找到对应 `Timeout` 对象并 `close` 其底层 timer。

---

## 7. 漂移与精度

- 定时器**不保证准时**：若 timers 阶段前某个回调执行很久，后续定时器会延迟（见 02-01）。
- `setInterval` 是"相对上次到期的 repeat"，若回调执行超长可能**吞掉中间几次触发**（不会排队积压，而是跳过）。
- 高精度定时不适合 Node；实时场景用 `setImmediate` 或专用定时器库。

---

## 8. 可运行验证

```js
const { performance } = require('perf_hooks');
const start = performance.now();
setTimeout(() => console.log('timeout fired @', (performance.now()-start).toFixed(1),'ms'), 0);
// 通常输出 ~1-2ms，而非 0
```

---

## 9. 本章总结

- 定时器由 libuv 用最小堆管理，**不依赖 OS 定时器**；最早到期者决定 poll 阻塞时长。
- `setTimeout(fn,0)` 实为 1ms 最小；`setInterval` 用 `repeat` 重新入堆。
- 定时器不保证精确：长回调会延迟后续；`setInterval` 可能跳过而非积压。
- `clearTimeout/Interval` 对应 `uv_timer_stop`。

---

## 10. 思考题

1. 为什么 libuv 不用 OS 定时器（如 timerfd）而自己维护最小堆？跨平台角度怎么想？
2. 如果一个 `setTimeout(fn, 100)` 的回调执行了 500ms，下一个 `setTimeout(fn, 100)` 会何时触发？中间会积压吗？
3. `uv_backend_timeout` 返回 -1（无限阻塞）的条件是什么？此时进程会一直卡住吗？
