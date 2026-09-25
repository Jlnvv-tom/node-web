# Node.js 核心源码解读教程

自顶向下、源码级的 Node.js 内核解读：**操作系统 → libuv → V8 → C++ 绑定 → JS 核心模块**。
配套 Docsify 文档站，离线可用（依赖已内置于 `vendor/`）。

## 目录结构
```
node-web/
├── docs/          # 全部文章 + 侧边栏/封面/PLAN（Docsify 内容根）
├── src/           # 可独立运行的代码示例（按章节组织，见 src/README.md）
├── vendor/        # 离线 Docsify 依赖（docsify / 主题 / 插件 / 语法高亮）
├── scripts/       # serve.js 本地服务器、init-git.sh 首次推送脚本
├── index.html     # 站点入口（basePath=docs）
├── _gen_sidebar.py# 侧边栏自动生成（扫 docs/）
├── .github/workflows/deploy.yml  # GitHub Pages 自动部署
├── package.json   # 项目元信息 + npm start 等脚本
└── LICENSE
```

## 本地启动
```bash
npm start          # 零依赖，启动后访问 http://localhost:4000
# 或自定义端口： PORT=8080 npm start
```
（之前 docsify-cli 在本机起不来，故用 `scripts/serve.js` 零依赖静态服务器替代。）

## 章节导航（详见 docs/README.md）
- 00 总览 · 01 操作系统层 · 02 libuv · 03 V8 · 04 C++ 绑定
- 05 JS 核心模块 · 06 事件循环专题 · 07 内存与性能 · 08 Electron · 09 跨平台

## 代码示例
见 [`src/README.md`](src/README.md)，含事件循环顺序、集群多核、CJS/ESM 互操作、N-API 插件等可跑示例。

## 部署到 GitHub Pages
1. 在 GitHub 建空仓库
2. `bash scripts/init-git.sh <user>/<repo>`
3. 仓库 Settings → Pages → Source 选 **GitHub Actions**，push `main` 即自动部署

## 生成侧边栏
```bash
npm run gen:sidebar   # 改写 docs/_sidebar.md
```
