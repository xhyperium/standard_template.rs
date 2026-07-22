# CONTRIBUTING.md — 贡献指南（standard_template.rs）

本文件面向贡献者，汇总提交前必读的依赖管理强制规则与自检清单。
AI 编码助手的治理约定另见 [`AGENTS.md`](./AGENTS.md)。

## 开发流程

- 所有活跃开发在 git worktree 内进行：

  ```bash
  node scripts/worktree/worktree.mjs create <type>/<id>-<slug>
  ```

- 路径：`分支 → PR → 审查（@xhyperium/maintainers 审批）→ CI → 合并 main`；
  禁止在 `main` 上直接开发/推送。
- 提交遵循 Conventional Commits（模板：`git config commit.template .gitmessage`）。

## 依赖集中管理（强制）

所有第三方依赖统一在根 `Cargo.toml` 的 `[workspace.dependencies]` 声明；成员 crate 的
`[dependencies]` / `[dev-dependencies]` / `[build-dependencies]` 及 `target.*.dependencies`
中第三方依赖**必须** `{ workspace = true }` 引用，**禁止**内联 `version`。

- intra-workspace（path）依赖保持 `{ path = "../x", version = "..." }`（允许内联 version）。
- 新增第三方依赖：先在根 `[workspace.dependencies]` 加一项，再在 crate 用 `{ workspace = true }`。
- 严格执行：CI 门禁
  `node scripts/quality-gates/check-workspace-deps.mjs`
  自动拦截内联版本（错误码 `R-DEP-001`）与未定义 workspace 引用（错误码 `R-DEP-002`）。
- 重命名依赖 `foo = { package = "bar", workspace = true }` 按 `bar` 解析，不受 `R-DEP-002` 误伤。

## 提交前自检清单

- [ ] `cargo fmt --all --check` 通过
- [ ] `cargo clippy --workspace -- -D warnings` 通过
- [ ] `cargo test --workspace` 通过
- [ ] `cargo deny check` 通过
- [ ] `node scripts/quality-gates/check.mjs` 通过（含"依赖集中管理门禁"项）
- [ ] `node scripts/quality-gates/check-workspace-deps.mjs` 通过（依赖集中管理门禁）
- [ ] 第三方依赖均经 `{ workspace = true }` 引用，无内联 `version`
- [ ] 无新增不必要的第三方依赖、无 `unsafe`、无外部网络调用
- [ ] PR 模板已填（类型 / 变更摘要 / 宪章合规性 / 验证方式 / 审查聚焦）

## 维护者审查

各 PR 评论区附 **Maintainer Review Checklist**；合并需 `@xhyperium/maintainers` 审批
（AI 不可 self-merge，见 `AGENTS.md` §7.1）。
