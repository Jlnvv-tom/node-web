// 文件：src/09-cross-platform/child-echo.js
// 配套 child-process-demo.js 的子进程：接收父进程消息并回显
process.on('message', msg => {
  console.log('子进程收到:', msg);
  if (msg.cmd === 'echo') {
    process.send({ reply: msg.text.toUpperCase() });
  }
});
process.send({ ready: true });
