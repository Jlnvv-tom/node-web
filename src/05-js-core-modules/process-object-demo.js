// 文件：src/05-js-core-modules/process-object-demo.js
// 对应文章：05-14 process 对象：运行时访问入口
// 运行：node src/05-js-core-modules/process-object-demo.js
//
// 演示 process 作为"JS ↔ 运行时/OS"桥梁的关键能力：
// argv / env / nextTick / exitCode / uncaughtException 保护。

console.log('argv       :', process.argv.slice(2));
console.log('platform   :', process.platform, process.arch);
console.log('pid        :', process.pid);
console.log('uptime(s)  :', process.uptime().toFixed(2));

// nextTick：本事件循环当前阶段结束后、下一阶段前执行
process.nextTick(() => console.log('nextTick 在 I/O 回调前执行'));

// 未捕获异常处理（不让进程直接崩）
process.on('uncaughtException', err => {
  console.error('捕获未处理异常:', err.message);
  process.exitCode = 1;
});

// 主动设置退出码
setTimeout(() => {
  console.log('即将退出，exitCode =', process.exitCode || 0);
  process.exit(process.exitCode || 0);
}, 100);
