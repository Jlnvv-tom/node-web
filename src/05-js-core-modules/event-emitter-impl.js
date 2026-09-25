// 文件：src/05-js-core-modules/event-emitter-impl.js
// 对应文章：05-04 EventEmitter 源码解读
// 运行：node src/05-js-core-modules/event-emitter-impl.js
//
// 不依赖 Node 内建，手写一个最小 EventEmitter，理解其核心数据结构
// (events 对象: { type: [listener, ...] }) 与 emit/on/once/removeListener。

class MiniEmitter {
  constructor() { this._events = Object.create(null); }

  on(type, fn) {
    (this._events[type] || (this._events[type] = [])).push(fn);
    return this;
  }

  once(type, fn) {
    const wrap = (...args) => { this.off(type, wrap); fn(...args); };
    wrap._orig = fn;
    return this.on(type, wrap);
  }

  off(type, fn) {
    const list = this._events[type];
    if (!list) return this;
    this._events[type] = list.filter(l => l !== fn && l._orig !== fn);
    return this;
  }

  emit(type, ...args) {
    const list = this._events[type];
    if (!list) return false;
    // 复制一份，避免回调里 on/off 影响本次遍历
    list.slice().forEach(fn => fn(...args));
    return true;
  }
}

// 演示
const e = new MiniEmitter();
e.on('data', x => console.log('on data:', x));
e.once('data', x => console.log('once data:', x));
e.emit('data', 1);   // on + once 都触发
e.emit('data', 2);   // 仅 on 触发（once 已移除）
console.log('listeners after twice emit:', e._events.data.length);
