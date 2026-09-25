// 文件：src/05-js-core-modules/buffer-encoding-demo.js
// 对应文章：05-12 Buffer：二进制数据与内存边界
// 运行：node src/05-js-core-modules/buffer-encoding-demo.js
//
// 展示 Buffer 与字符串编码的关系、内存视图(latin1 边界)、与 TypedArray 共享内存。

const buf = Buffer.from('你好Node', 'utf8');
console.log('utf8 字节:', buf, '=>', [...buf]);      // 中文每字 3 字节
console.log('长度(字节):', buf.length);

// Buffer 是 Uint8Array 的子类，共享同一段内存视图
const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
console.log('作为 Uint8Array:', [...u8].length === buf.length);

// latin1：每个字节直接映射为 0-255，常用于与 C/网络层对接
const latin = Buffer.from([0xff, 0x80, 0x41]);
console.log('latin1 解码:', latin.toString('latin1'));   // 含非打印字符

// base64 编解码
const b64 = buf.toString('base64');
console.log('base64:', b64, '=> 还原:', Buffer.from(b64, 'base64').toString('utf8'));
