// 文件：src/02-libuv/event-loop-order.js
// 对应文章：02-libuv/01-event-loop-phases.md、06-event-loop-deep-dive/01-microtask-vs-macrotask.md
// 运行：node src/02-libuv/event-loop-order.js
//
// 验证事件循环中"微任务 vs 宏任务"的优先级：
//   process.nextTick > Promise.then > setImmediate > setTimeout(0)

console.log('1. 同步代码开始');

setTimeout(() => console.log('4. setTimeout(0)  —— timers 阶段'), 0);
setImmediate(() => console.log('3. setImmediate  —— check 阶段'));

Promise.resolve().then(() => console.log('2b. Promise.then —— 微任务'));
process.nextTick(() => console.log('2a. process.nextTick —— 最高优先级微任务'));

console.log('1b. 同步代码结束');

// 预期输出顺序：
// 1. 同步代码开始
// 1b. 同步代码结束
// 2a. process.nextTick
// 2b. Promise.then
// 3. setImmediate
// 4. setTimeout(0)
