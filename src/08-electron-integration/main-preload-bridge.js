// 文件：src/08-electron-integration/main-preload-bridge.js
// 对应文章：08-01 Electron 架构：Node.js 嵌入 Chromium
// 运行：本文件为"概念样例"，不能直接 node 运行（需 Electron 运行时）。
//       这里展示 Electron 主进程 ↔ 渲染进程 通过 preload + contextBridge 的安全桥接范式。
//
// 主进程 (main.js 摘录)：
//   const { app, BrowserWindow, ipcMain } = require('electron');
//   ipcMain.handle('ping', async () => 'pong from main');
//   const win = new BrowserWindow({
//     webPreferences: { preload: path.join(__dirname, 'preload.js') }
//   });
//
// preload.js (隔离环境，拥有 Node 能力但只暴露白名单)：
//   const { contextBridge, ipcRenderer } = require('electron');
//   contextBridge.exposeInMainWorld('api', {
//     ping: () => ipcRenderer.invoke('ping')
//   });
//
// 渲染进程 (浏览器 JS)：window.api.ping().then(console.log)  // 得到 'pong from main'
//
// 要点：Node 的事件循环与 Chromium 渲染进程合并，preload 是安全边界。

console.log('Electron 主进程/渲染进程桥接范式见上方注释（需 Electron 运行时）');
console.log('核心：主进程跑完整 Node，渲染进程经 preload 的 contextBridge 受控访问 Node 能力');
