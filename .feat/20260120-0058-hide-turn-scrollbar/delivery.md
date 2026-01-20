---
summary: "Delivery summary, verification, and impact notes"
doc_type: delivery
slug: "hide-turn-scrollbar"
notes_dir: ".feat/20260120-0058-hide-turn-scrollbar"
created_at_utc: "2026-01-20T00:58:58Z"
---
# Delivery Notes

交付时的详细说明（最终会随 squash merge 合回 base 分支）。

## Changes
- 调整 `am-row-scroll` 的 WebKit 滚动条样式，将高度/宽度设为 0 并透明化 thumb，隐藏横向滚动条但保留滚动能力。

## Expected outcome
- Chrome/Edge 中所有 `am-row-scroll` 横向滚动条不可见且不占空间，仍可左右滚动。

## How to verify
- Commands: N/A
- Manual steps:
  - 在 Chrome/Edge 打开含 turn block 或文件变更条目的页面，确认横向滚动条不可见且仍可左右滑动。

## Impact / risks
- 仅影响 Chromium 浏览器的滚动条呈现；Firefox 维持现有细滚动条样式。

## References (path:line)
- apps/gui/src/index.css:208
