// 文件：src/09-cross-platform/child-process-demo.cjs
// 对应文章：09-02 child_process：进程创建与 IPC
// 运行：node src/09-cross-platform/child-process-demo.cjs
//
// 演示 child_process.fork 创建子进程并通过 IPC 通道收发消息(走 libuv 的IPC pipe，
// 对应文章所说的“跨平台进程抽象”)。子进程通过 process.send 回传。

const { fork } = require('child_process');
const path = require('path');

// 子进程代码（同目录 child-echo.js，用 .cjs 确保 CJS 解析）
const child = fork(path.join(__dirname, 'child-echo.js'));

child.on('message', msg => {
  console.log('父进程收到子进程消息:', msg);
  child.send({ cmd: 'echo', text: '你好 from parent' });
});

child.on('exit', code => console.log('子进程退出,code =', code));

// 3 秒后关闭
setTimeout(() => { child.kill(); }, 3000);
