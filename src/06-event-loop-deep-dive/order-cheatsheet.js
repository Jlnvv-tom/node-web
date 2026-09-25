// 文件：src/06-event-loop-deep-dive/order-cheatsheet.js
// 对应文章：06-01 微任务 vs 宏任务 / 06-02 setImmediate vs setTimeout
// 运行：node src/06-event-loop-deep-dive/order-cheatsheet.js
//
// 综合记忆卡：一次事件循环迭代内的执行顺序实测。
// 顺序：同步 → process.nextTick → Promise.then → (timers:setTimeout)
//        → (poll) → (check:setImmediate)

console.log('A 同步');

setTimeout(() => console.log('B setTimeout(0)'), 0);
setImmediate(() => console.log('C setImmediate'));

queueMicrotask(() => console.log('D queueMicrotask'));
Promise.resolve().then(() => console.log('E Promise.then'));

process.nextTick(() => console.log('F nextTick#1'));
process.nextTick(() => console.log('G nextTick#2'));

console.log('H 同步尾');

// 典型输出:
// A 同步 / H 同步尾 / F nextTick#1 / G nextTick#2 / D queueMicrotask / E Promise.then
// 之后进入 check 阶段: C setImmediate，再下次循环 timers: B setTimeout(0)
