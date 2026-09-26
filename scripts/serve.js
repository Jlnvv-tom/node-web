#!/usr/bin/env node
'use strict';
// 零依赖本地静态服务器（替代 docsify-cli，避免启动失败）
// 用法：npm start   然后浏览器打开 http://localhost:4000
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 4000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  // Docsify 客户端路由：把 / 映射到 index.html；其余按文件服务
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // 防目录穿越
  const safePath = path.normalize(path.join(ROOT, urlPath));
  if (!safePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  const ext = path.extname(safePath).toLowerCase();

  fs.stat(safePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // 对 .md 文件返回 404，而非 SPA fallback
      // （Docsify 收到 HTML 当 markdown 解析会卡在"加载中"）
      if (ext === '.md') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 Not Found: ' + urlPath);
      }
      // SPA 回退：未知非 .md 路径返回 index.html，交给 Docsify 客户端路由
      const fallback = path.join(ROOT, 'index.html');
      fs.readFile(fallback, (e2, data) => {
        if (e2) {
          res.writeHead(404);
          return res.end('Not Found');
        }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(data);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(safePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`\n  Node.js 源码解读文档站已启动`);
  console.log(`  ➜  http://localhost:${PORT}\n`);
  console.log(`  文章目录: docs/   示例代码: src/   离线依赖: vendor/`);
  console.log(`  按 Ctrl+C 停止\n`);
});