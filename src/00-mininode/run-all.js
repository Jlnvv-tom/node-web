#!/usr/bin/env node
'use strict';
// 一键运行 mini-node 的全部 JS 层（Layer 0 → 1 → 1.5 → 3）
// C 层（Layer 2）需手动编译，见 README.md

const { execSync } = require('child_process');
const path = require('path');
const dir = __dirname;

function run(label, file) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${label}`);
  console.log('='.repeat(60) + '\n');
  execSync(`node ${path.join(dir, file)}`, { stdio: 'inherit' });
}

// Layer 0
run('Layer 0 — 纯 JS（零依赖）', 'layer0-bare-js.js');

// Layer 1
run('Layer 1 — vm 嵌入 V8', 'layer1-vm-embed.js');

// Layer 1.5
run('Layer 1.5 — 手写 CommonJS 加载器', 'layer1-cjs-loader.js');

// Layer 3（需要先编译）
try {
  require(path.join(dir, 'build/Release/mini_node_addon.node'));
} catch (e) {
  console.log('\n[info] Layer 3 原生模块未编译，尝试构建...');
  execSync('npx node-gyp configure build', { cwd: dir, stdio: 'inherit' });
}
try {
  run('Layer 3 — N-API 原生模块', 'layer3-use-addon.js');
} catch (e2) {
  console.log('[skip] Layer 3 构建失败（需要 node-gyp），跳过');
}

// Layer 2（C，需 libuv）
console.log('\n' + '='.repeat(60));
console.log('  Layer 2 — C + libuv（需手动编译）');
console.log('='.repeat(60));
try {
  execSync(`cc -o layer2-uv-loop layer2-uv-loop.c $(pkg-config --libs --cflags libuv)`, { cwd: dir, stdio: 'inherit' });
  execSync('./layer2-uv-loop', { cwd: dir, stdio: 'inherit' });
} catch (e) {
  console.log('  cc -o layer2-uv-loop layer2-uv-loop.c $(pkg-config --libs --cflags libuv)');
  console.log('  ./layer2-uv-loop');
}
console.log();