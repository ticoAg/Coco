---
name: gh-release-dmg
description: Help prepare a tag-driven GitHub Release that publishes macOS DMG artifacts. Use when you need to compare commits since the previous vX.Y.Z tag, propose the next semver tag, draft a release commit message (subject + body), then create a lightweight tag and push. Optimized for workflows that build 3 DMGs (intel / apple silicon / universal) and do not require code signing.
---

# GitHub Release DMG

## 快速开始（只确认 tag + commit message）

1) 在 repo 根目录运行提案脚本（会先跑 Rust preflight；dirty 会 warning；版本号不一致会直接失败）：

```bash
scripts/release/propose_release.sh
```

（可选）跳过 preflight：`SKIP_RUST_PREFLIGHT=1 scripts/release/propose_release.sh`

2) 只向开发者确认两件事：

- 最终 tag（例如 `v0.1.0` / `v0.1.1`）
- release commit message（subject + body）

3) 开发者确认后，一次性执行（创建空的 release marker commit → 打轻量 tag → push）：

```bash
# 1) 创建 release marker commit（默认用空提交，避免误提交本地文件变更）
git commit --allow-empty \
  -m "release: vX.Y.Z" \
  -m "<PASTE BODY HERE>"

# 2) 打轻量 tag
git tag vX.Y.Z

# 3) push commit + tag
git push
git push origin vX.Y.Z
```

## 约束与默认行为

- **默认只让开发者确认一次**：脚本负责采集信息与生成提案；确认后直接 commit/tag/push。
- **工作区建议干净**：脚本在 dirty 时只会 warning（便于提前评估下一个 tag）；但在执行 commit/tag/push 前应确保工作区干净，避免把未完成变更带进 release。
- **版本号必须一致**：如果 repo 内存在 `scripts/check-version.mjs`，脚本会用它校验 proposed tag 对应的版本号；不一致就失败（因为 GitHub Release workflow 也会失败）。

## 版本号/下一个 tag 的评估逻辑（简化规则）

- 若 repo 当前版本号（AgentMesh 的 `apps/gui/src-tauri/tauri.conf.json` / `apps/gui/package.json` / `Cargo.toml`）已经升级且一致：**优先用当前版本号作为下一个 tag**。
- 若存在上一个 tag 且当前版本号仍等于上一个 tag：用 commit subject 的“Conventional Commit-ish”启发式建议 bump：
  - `BREAKING` 或 `!:` → `major`
  - `feat:` → `minor`
  - 其他 → `patch`

## 产物与 CI 对齐

- 该 skill 假设 Release workflow 会发布 3 个 `.dmg`：`intel only` / `apple silicon only` / `universal`。
- 默认不签名（no-sign）。

## 脚本

- `scripts/release/propose_release.sh`：先跑 Rust preflight，再调用提案脚本。
- `.codex/skills/gh-release-dmg/scripts/propose_release.py`：读取 git 历史（对比上一个 tag）、读取项目版本号、生成 proposed tag 与 release commit message 草稿。
