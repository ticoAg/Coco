## 1. Implementation
- [x] 在 `apps/gui/package.json` 增加 `lucide-react` 依赖并确保 build 通过
- [x] 将输入区上方工具条移动为底部 Footer Status Bar（保留 `+`、`Auto context`、`对话设置`）
- [x] 监听 `thread/tokenUsage/updated`，维护 thread 级 token usage 状态并在右下角显示：`上下文 {percent}% · {used}/{window}`
- [x] 保留 user bubble；将 assistant 渲染调整为 log block（更接近 IDE 输出样式）
- [x] 在 Footer 左侧补齐 “Local / Custom / Model / Reasoning” 等指示器（初期可从 config + 当前选择推导，缺省用占位符）
- [x] Footer 各配置项（model/approval_policy/model_reasoning_effort）使用独立下拉菜单，不聚合到同一抽屉；展示值保持英文

## 2. Validation
- [x] `npm -C apps/gui run build`
- [x] `cargo check -p agentmesh-app`

## 3. Docs (Optional)
- [ ] 若新增状态栏字段含义需要说明：在 `docs/` 增补 GUI 使用说明并更新 `docs/README.md`
