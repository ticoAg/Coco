# Release Notes

本目录用于存放 **自定义 GitHub Release Notes**（可选）。

## 用法

在发版前创建并提交与 tag 对应的文件：

- `docs/release-notes/vX.Y.Z.md`

例如：

- `docs/release-notes/v1.2.2.md`

当你 push `vX.Y.Z` tag 触发 GitHub Actions 发版时，release workflow 会：

1. 读取该文件内容作为 release notes 的前置正文
2. 再追加 GitHub 自动生成的变更列表（如果 workflow 开启了自动 notes）

如果没有找到该文件，则 workflow 只使用 GitHub 自动生成的 notes。

## 模板

建议结构：

- Highlights
- 性能优化
- 交互与 UI
- 可靠性 / 工程化

