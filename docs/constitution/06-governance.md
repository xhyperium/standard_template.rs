# 六、治理

## 6.0 Git Main First（强制）

**Main First**：`main` 是唯一长期真实主干与集成分支。一切有价值的工作必须周期性收敛至 `main`，禁止长期并行「第二真相」。

### 6.0.1 主干唯一

- 默认分支名为 **`main`**
- 禁止维护与 `main` 长期分叉、互不合并的并行主线
- 功能分支、修复分支均为**短期**；合并后应及时删除远程与本地分支
- **「长期」定义**：超过 **30 天**未向 `main` 合并的功能分支视为违规并行（release 维护分支须在文档中显式声明生命周期）

### 6.0.2 禁止在 main 上直接开发

- **禁止**在 `main` 上直接编码、提交、推送
- 合法路径唯一：`feature / fix / chore 分支 → PR → 审查 → CI 通过 → 合并入 main`
- 紧急热修复也须走 PR；可缩短审查窗口，但**不可**跳过门禁与合并路径

### 6.0.3 分支与同步

- 新分支须从**最新** `origin/main` 创建（先 `git fetch` + 基于最新 main 建支）
- 开发中定期与 `main` 同步；首选 **rebase** 保持线性历史，冲突过大时可用 merge 并在 PR 中说明
- PR 合并前须相对 `main` 可合并（无未解决冲突）
- 默认 **squash merge** 进 `main`，保持主干历史清晰

### 6.0.4 推送与保护

- `main` 受分支保护：禁止 force push、禁止绕过 CI 的直推
- 禁止 `git push --force` / `git push --force-with-lease` 到 `main`
- 禁止 `git push --no-verify` 绕过钩子向共享分支推送
- 历史重写（orphan / force push 覆盖远程）仅在**维护者明确授权**且团队知情时执行

### 6.0.5 Git Worktree 强制

**所有活跃开发必须在独立的 Git Worktree 中进行。** 细则见 [docs/governance/worktree-policy.md](../governance/worktree-policy.md)。

```bash
node scripts/worktree/worktree.mjs create feat/my-feature
cd .worktrees/feat/my-feature
```

- 禁止在 main 工作区创建/切换功能分支
- main 工作区仅用于 review、构建、测试（只读操作）
- Worktree 规范路径：`.worktrees/<branch-name>`（分支名中的 `/` 保留为目录分隔符；已 gitignore）
- **已废弃**：`.worktrees/workspaces/`、单数 `.worktree/`、全局 `~/.worktrees/`
- 实质性任务必须使用独立分支 + worktree 隔离
- 禁止多任务混用同一 worktree / 分支
- **机器强制（BLOCK）**：`pre-tool-check.mjs` 拦截主仓**已跟踪**文件 Write/Edit、主仓 `checkout -b`/`switch` 功能分支、`main` 上 commit；`.gitignore` 匹配路径为例外（见 `docs/governance/worktree-policy.md`）；`session-context.mjs` 在主仓给出开工指引

### 6.0.6 与 AI 协作

- AI **不得**在 `main` 检出上直接改代码并提交
- AI 开工前必须：`node scripts/worktree/worktree.mjs create …` 并 `cd` 进入 `.worktrees/…`
- Session 钩子提供硬门禁与告警；**即使钩子未启用，本条款仍有效**——Agent 须自觉遵守
- 紧急绕过仅限人工 maintainer 设置 `INFRA_WORKTREE_BYPASS=1`，并事后记录

### 6.0.7 一句话

> **先对齐 main，再开分支；先 PR 进 main，再谈完成。**

### 6.0.8 分支保护验证

分支保护已启用 `enforce_admins` 测试，并记录于本宪章：

- **开启 `enforce_admins: true`** 时：管理员直接推送 `main` 被拒绝，验证规则正确性
- **生产环境**：保持 `enforce_admins: false`，允许管理员应急绕过（如紧急热修复跳过 CI 等待），但需在 PR 中注明绕过原因
- 验证结果（2026-07-21）：

  ```text
  remote: error: GH006: Protected branch update failed for refs/heads/main.
  remote: - Changes must be made through a pull request.
  remote: - 2 of 2 required status checks are expected.
  ! [remote rejected] main -> main (protected branch hook declined)
  ```

## 6.1 变更流程

1. **从 main 同步** — `fetch` 最新主干并建分支（§6.0）
2. **Issue** — 描述问题或提案（可追溯）
3. **PR** — 包含变更、测试、文档
4. **审查** — 至少一人 approve（或项目规定的 maintainer 规则）
5. **CI** — 所有强制门禁通过
6. **合并** — squash merge 到 `main`
7. **清理** — 删除已合并分支；必要时同步本地 main

## 6.2 版本策略

- 遵循语义化版本 [SemVer](https://semver.org/)
- `0.x.y` 期间不保证向后兼容
- `1.0.0` 后严格 SemVer
- **`crates/` 每个子模块独立版本**（禁止 `version.workspace = true`）
- **统一更新规则**：某 crate 每次交付性更新，默认 **PATCH +1**（`x.y.z` → `x.y.(z+1)`）；仅 bump 实际变更的 package
- 统一版本管理细则见 [docs/governance/VERSIONING.md](../governance/VERSIONING.md)

## 6.3 所有权

- 代码所有权由 `.github/CODEOWNERS` 定义
- 架构决策记录于 `docs/decisions/`（ADR 格式）

---

← [上一章：质量门禁](./05-quality-gates.md) · [索引](./README.md) · 下一章：[七、AI 代理章程](./07-ai-agents.md) →
