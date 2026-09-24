#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""扫描 node-web/ 下的 .md，生成 Docsify 的 _sidebar.md（按目录分组，用 H1 作链接名）。"""
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))

# 目录 -> 侧边栏分组标题
DIR_TITLES = {
    "00-overview": "00 · 总览篇",
    "01-os-layer": "01 · 操作系统层",
    "02-libuv": "02 · libuv 层",
    "03-v8-engine": "03 · V8 引擎层",
    "04-cpp-bindings": "04 · C++ 绑定层",
    "05-js-core-modules": "05 · JS 核心模块",
    "06-event-loop-deep-dive": "06 · 事件循环专题",
    "07-memory-and-performance": "07 · 内存与性能",
    "08-electron-integration": "08 · Electron 集成",
    "09-cross-platform": "09 · 跨平台实现",
}

H1_RE = re.compile(r"^#\s+(.*?)\s*$", re.MULTILINE)

def get_h1(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            first = f.read(4000)
        m = H1_RE.search(first)
        if m:
            t = m.group(1)
            # 去掉可能的末尾 markdown 链接残留
            return t.strip()
    except Exception:
        pass
    return os.path.splitext(os.path.basename(path))[0]

def collect():
    groups = {}
    top_files = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        # 跳过隐藏目录与生成脚本
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for fn in filenames:
            if not fn.endswith(".md"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT)
            parts = rel.split(os.sep)
            if len(parts) == 1:
                if fn in ("README.md", "PLAN.md"):
                    top_files.append((fn, rel))
                continue
            grp = parts[0]
            if grp not in DIR_TITLES:
                continue
            groups.setdefault(grp, []).append((fn, rel))
    return groups, top_files

def main():
    groups, top_files = collect()
    lines = ["* [首页](/)", ""]
    # 顶层文件
    for fn, rel in top_files:
        title = "计划文档 PLAN" if fn == "PLAN.md" else "首页"
        lines.append(f"* [{title}]({rel})")
    lines.append("")
    # 目录分组
    for grp in sorted(groups.keys()):
        lines.append(f"* **{DIR_TITLES[grp]}**")
        items = sorted(groups[grp], key=lambda x: x[0])  # 按文件名排序
        for fn, rel in items:
            h1 = get_h1(os.path.join(ROOT, rel))
            lines.append(f"  * [{h1}]({rel})")
        lines.append("")
    out = "\n".join(lines).rstrip() + "\n"
    with open(os.path.join(ROOT, "_sidebar.md"), "w", encoding="utf-8") as f:
        f.write(out)
    print("written _sidebar.md with", sum(len(v) for v in groups.values()) + len(top_files), "entries")

if __name__ == "__main__":
    main()
