# 08-03 事件循环合并：libuv 与 Chromium MessagePump

> 本章目标：理解 Electron 如何将 Node.js 的 libuv 事件循环与 Chromium 的 MessagePump 合并为一个统一的任务调度系统。

## 导读

Node.js 和 Chromium 各有自己的事件循环：

| 引擎 | 事件循环 | 作用 |
|------|----------|------|
| Node.js | libuv (`uv_run`) | 定时器、I/O 回调、异步通知 |
| Chromium | `MessagePump` | UI 任务、IO 任务、定时任务 |

Electron 在同一个线程里跑两套事件循环——如果各跑各的，一套阻塞另一套就停了。所以必须**合并**。

## 两套事件循环对比

### libuv 事件循环

```
uv_run()
  ┌→ timers       ← setTimeout/setInterval
  │  pending      ← 上轮延迟的 I/O 回调
  │  idle/prepare
  │  poll         ← 等待 I/O 事件（可阻塞）
  │  check        ← setImmediate
  └← close        ← close 事件
```

libuv 在 `poll` 阶段会**阻塞**等待 I/O 事件，超时时间由最近一个 timer 决定。

### Chromium MessagePump

```
MessagePump::Run()
  ┌→ DoWork()           ← 处理待办任务
  │  DoDelayedWork()    ← 处理定时任务
  │  DoIdleWork()       ← 空闲时任务
  └← WaitForWork()      ← 等待（IOCP/epoll/kqueue）
```

Chromium 的 `WaitForWork` 也会阻塞等待。

## 合并策略：让 libuv 驱动 Chromium

Electron 的方案：**把 Chromium 的任务泵嵌入 libuv 事件循环**。

```
electron/shell/common/node_bindings.cc

┌── libuv 事件循环 ──────────────────┐
│  timers                             │
│  pending                            │
│  idle/prepare                       │
│  poll ← uv_prepare_t (Chromium)     │
│    ├─ MessagePump::DoWork()         │
│    ├─ MessagePump::DoDelayedWork()  │
│    └─ MessagePump::DoIdleWork()     │
│  check                              │
│  close                              │
└─────────────────────────────────────┘
```

### 核心实现

```cpp
// electron/shell/common/node_bindings.cc — 简化

void NodeBindings::Initialize() {
  // 创建 uv_prepare_t，在每轮事件循环的 prepare 阶段调用
  uv_prepare_init(uv_loop_, &embed_prepare_);
  uv_prepare_start(&embed_prepare_, EmbedCallback);
}

// 每轮事件循环 prepare 阶段触发
static void EmbedCallback(uv_prepare_t* handle) {
  NodeBindings* self = container_of(handle, NodeBindings, embed_prepare_);

  // 跑 Chromium MessagePump 的任务
  self->message_loop_->RunUntilIdle();

  // 跑 delayed work
  base::TimeTicks delayed_time;
  self->message_loop_->DoDelayedWork(&delayed_time);

  // 如果 Chromium 有 delayed work，设置 libuv 定时器
  if (!delayed_time.is_null()) {
    int64_t delay = (delayed_time - base::TimeTicks::Now()).InMilliseconds();
    uv_timer_start(&self->delayed_timer_, DelayedCallback, delay, 0);
  }
}
```

### 关键设计

1. **uv_prepare_t**：在 libuv 每轮事件循环的 `prepare` 阶段（poll 之前）执行 Chromium 的待办任务
2. **uv_timer_t**：Chromium 的 delayed work 转换为 libuv 定时器
3. **uv_async_t**：跨线程唤醒（Chromium 线程通知 Node.js 线程）
4. **不调 uv_run 阻塞**：Electron 使用 `uv_run(loop, UV_RUN_NOWAIT)` 非阻塞模式，让 Chromium 的消息泵也能跑

## 渲染进程的特殊处理

在渲染进程中，Chromium 的 `RendererMainThread` 已经有一个 MessagePump。Electron 需要把 libuv 嵌入这个 MessagePump：

```
方案 A（主进程）：libuv 驱动 Chromium
  uv_run → prepare → Chromium DoWork → poll

方案 B（渲染进程）：Chromium 驱动 libuv
  MessagePump::Run → DoWork + DoIdleWork → uv_run(NOWAIT)
```

两套方案在不同进程使用，确保不错位。

## idle work 与 libuv poll 超时

libuv 在 `poll` 阶段的阻塞超时由以下因素决定：

```cpp
// deps/uv/src/unix/core.c — uv__io_poll timeout 计算
int timeout = uv__next_timeout(loop);  // 最近 timer 的到期时间

if (loop->pending != NULL)         timeout = 0;  // 有 pending 回调，不阻塞
if (loop->idle_handles != NULL)    timeout = 0;  // 有 idle 句柄，不阻塞
if (loop->closing_handles != NULL) timeout = 0;  // 有关闭句柄，不阻塞

// 否则阻塞 timeout 毫秒（或 -1 表示无限等待）
uv__io_poll(loop, timeout);
```

Electron 注入了 Chromium 任务后，如果 Chromium 有待办任务，通过 `uv_idle_t` 让 libuv 不阻塞在 poll——确保 Chromium 的 UI 响应不受影响。

## 总结

| 要点 | 说明 |
|------|------|
| 两套事件循环 | libuv (Node.js) + MessagePump (Chromium) |
| 合并策略 | 主进程：libuv 驱动 Chromium；渲染进程：Chromium 驱动 libuv |
| uv_prepare_t | 在 prepare 阶段跑 Chromium 任务 |
| uv_timer_t | Chromium delayed work → libuv 定时器 |
| uv_idle_t | 有待办任务时阻止 poll 阻塞 |

## 思考题

1. 如果 libuv 在 poll 阶段阻塞了 100ms，Chromium 的 UI 会有 100ms 卡顿吗？Electron 是如何避免的？
2. `uv_run(loop, UV_RUN_NOWAIT)` 和 `uv_run(loop, UV_RUN_ONCE)` 有什么区别？Electron 选哪个？
3. 渲染进程为什么不用"libuv 驱动 Chromium"方案？