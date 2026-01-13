# Release（macOS DMG）

本项目采用 **tag 驱动的 GitHub Release**：当你 push 一个形如 `vX.Y.Z` 的 tag 时，GitHub Actions 会构建并发布 3 个 `.dmg` 产物：

- `intel only`：`x86_64-apple-darwin`
- `apple silicon only`：`aarch64-apple-darwin`
- `universal-apple-darwin`：同时兼容 Intel + Apple Silicon

> 目前 **不做签名/公证（no-sign）**，用户打开时可能会遇到 Gatekeeper 提示，这是预期行为。

## CI（push/PR 后自动跑）

- Rust：`fmt-check / check / clippy / test`（CI 上会排除 Tauri app crate `agentmesh-app`，避免 Linux runner 的系统依赖问题）
- GUI 前端：`npm ci && npm run build`
- macOS：跑一次 `tauri build` 生成 `.app`（不签名），用于尽早发现打包链路问题（CI 不会保存产物）

触发条件：

- CI：`push` 到 `main` 或任意 `pull_request`
- Release：`push` 形如 `vX.Y.Z` 的 tag 或手动触发（`workflow_dispatch`）

## 本地预检（推荐）

- 安装 pre-push hook：`scripts/hooks/install.sh`
- 跳过 pre-push：`SKIP_RUST_PREFLIGHT=1 git push`
- 手动预检：`scripts/release/preflight.sh`
- 如需跳过：`SKIP_RUST_PREFLIGHT=1 scripts/release/preflight.sh`

## 发版流程（推荐）

### 1) 统一版本号

Release workflow 会校验 tag 版本与以下文件一致（不一致会直接失败）：

- `apps/gui/src-tauri/tauri.conf.json`（`version`）
- `apps/gui/package.json`（`version`）
- `apps/gui/src-tauri/Cargo.toml`（`[package].version`）
- `crates/*/Cargo.toml`（`[package].version`）

本地可先跑一遍校验：

```bash
node scripts/check-version.mjs --expected 1.0.2
```

### 2) 生成 release 提案（推荐）

```bash
scripts/release/propose_release.sh
```

（可选）跳过本地预检：`SKIP_RUST_PREFLIGHT=1 scripts/release/propose_release.sh`

### 3) 提交并 push

```bash
git add -A
git commit -m "release: vX.Y.Z"
git push
```

（可选）本地先跑 `just ci` 做完整检查。

### 4) 打 tag 并推送

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

### 5) 等待 GitHub Actions 发布

GitHub Actions 的 `Release (DMG)` workflow 会：

1. 解析 tag 得到版本号（`vX.Y.Z` → `X.Y.Z`）
2. 校验版本一致性
3. 依次构建 3 个 DMG（intel / apple silicon / universal）
4. 将 `.dmg` 上传到对应的 GitHub Release

## 本地构建 DMG（排查用）

在 macOS 上：

```bash
cd apps/gui
npm ci

# intel only
npm run tauri:build -- --target x86_64-apple-darwin --bundles dmg --no-sign --ci

# apple silicon only
npm run tauri:build -- --target aarch64-apple-darwin --bundles dmg --no-sign --ci

# universal
npm run tauri:build -- --target universal-apple-darwin --bundles dmg --no-sign --ci
```

产物目录通常在：

`apps/gui/src-tauri/target/**/bundle/dmg/*.dmg`
