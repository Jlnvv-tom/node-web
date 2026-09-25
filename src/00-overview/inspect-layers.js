// 文件：src/00-overview/inspect-layers.js
// 对应文章：00-01 分层架构 / 00-02 源码结构 / 00-03 启动流程
// 运行：node src/00-overview/inspect-layers.js
//
// 直观印证 Node 的分层：V8 负责 JS、libuv 负责事件循环、C++ 绑定层在中间。
// 这里打印出各层暴露给 JS 的"探针"。

const v8 = require('v8');

console.log('== 分层架构探针 ==');
console.log('V8 版本      :', process.versions.v8);
console.log('Node 版本    :', process.versions.node);
console.log('libuv 版本   :', process.versions.uv);
console.log('OpenSSL 版本 :', process.versions.openssl);
console.log('架构/平台    :', process.arch, '/', process.platform);

console.log('\n== 启动期已加载的内建模块(部分) ==');
console.log('v8 堆统计(字节):', v8.getHeapStatistics().total_available_size);

console.log('\n== C++ 绑定层入口(已废弃 process.binding，改用 internalBinding) ==');
try {
  // 现代 Node 用 internalBinding 暴露内部绑定
  const { getInternalBinding } = require('internal/test/binding');
  console.log('internalBinding 可用');
} catch (e) {
  // 不同版本路径不同，仅演示"绑定层存在"这一事实
  console.log('(internalBinding 为内部 API，受版本保护，正常)');
}
