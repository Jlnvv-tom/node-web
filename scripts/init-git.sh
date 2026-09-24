#!/usr/bin/env bash
# 在 GitHub 创建好【空仓库】后，执行本脚本完成首次推送，触发 Pages 部署。
# 用法： bash scripts/init-git.sh <你的GitHub用户名>/<仓库名>
set -e
REMOTE="$1"
if [ -z "$REMOTE" ]; then
  echo "用法: bash scripts/init-git.sh <user>/<repo>"
  exit 1
fi

cd "$(dirname "$0")/.."
git init -q
git add -A
git commit -q -m "docs: init Node.js source-reading tutorial (Docsify, offline vendor)"
git branch -M main
git remote add origin "https://github.com/${REMOTE}.git"
git push -u origin main
echo "已推送 main。请在仓库 Settings → Pages → Source 选择 'GitHub Actions' 即可自动部署。"
