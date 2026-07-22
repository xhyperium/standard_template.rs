# Git Worktree 强制开发策略

> 本文档为 [`docs/constitution/06-governance.md` §6.0.5](../constitution/06-governance.md#605-git-worktree-强制) 的实施细则。
> 工具脚本：`scripts/worktree/worktree.mjs`、`scripts/worktree/worktree-policy.mjs`
> 硬门禁：`.claude/hooks/pre-tool-check.mjs`（BLOCK）+ `session-context.mjs`（指引）

---

## 原则

**所有活跃开发必须在独立的 Git Worktree 中进行。**  
禁止在 `main` 主工作区直接创建或切换功能分支，禁止在主仓 Write/Edit 仓库文件。

---

## 理由

- **隔离**：每个 branch 有独立的工作目录，避免文件交叉污染
- **并行**：可同时开发多个特性，无需 stash / checkout 切换
- **稳定**：`main` 工作区始终保持干净，可直接用于 review / 构建
- **安全**：不会因忘记切换分支而误改 main

---

## 强制规则

### 1. 创建 Worktree（唯一合法开工路径）

```bash
# 方式 A: 使用脚本（推荐）
node scripts/worktree/worktree.mjs create feat/<id>-<slug>
cd .worktrees/feat/<id>-<slug>

# 方式 B: 手动（路径必须规范）
git worktree add .worktrees/feat/<id>-<slug> -b feat/<id>-<slug> origin/main
cd .worktrees/feat/<id>-<slug>
```

分支命名：`{type}/{module-or-id}-{描述}`  
合法 type 前缀：`docs` / `feat` / `feature` / `fix` / `test` / `refactor` / `chore` / `governance` / `benchmark`

### 2. 目录约定

```text
standard_template.rs/           # 主工作区 (main) — 只读：review / build / test
└── .worktrees/                 # Worktree 根（已 gitignore）
    ├── feat/                  # 功能分支
    │   └── <id>-<slug>/
    ├── fix/                   # 修复分支
    │   └── <id>-<slug>/
    └── chore/                 # 杂项分支
        └── <id>-<slug>/
```

规范路径公式：

```text
.worktrees/<branch-name>
# 分支名中的 / 保留为目录分隔符
# 例: feat/template-2gg-worktree-hard-gate → .worktrees/feat/template-2gg-worktree-hard-gate
```

**已废弃（禁止新建）**：

- `.worktrees/workspaces/`
- 单数根 `.worktree/`
- 全局 `~/.worktrees/<project>/`

### 3. 硬门禁（机器强制 BLOCK）

| 触发 | 行为 | 实现 |
|------|------|------|
| `Write` / `Edit` 目标在主仓**已跟踪**路径（非 `.worktrees/**`） | **BLOCK** | `pre-tool-check.mjs` |
| `Write` / `Edit` 目标被 `.gitignore` 匹配 | **放行（例外）** | `git check-ignore` |
| 主工作区 `git checkout -b` / `git switch -c` | **BLOCK** | `pre-tool-check.mjs` |
| 主工作区 `git checkout`/`switch` 到非 main 功能分支 | **BLOCK** | `pre-tool-check.mjs` |
| 在 `main`/`master` 分支上 `git commit` | **BLOCK** | `pre-tool-check.mjs` |
| `git worktree add` 路径 ≠ `.worktrees/<branch>` | **BLOCK** | `pre-tool-check.mjs` |
| 分支名缺少 type 前缀 | **BLOCK** | `pre-tool-check.mjs` |
| SessionStart 在主仓 | **WARN + 开工指引** | `session-context.mjs` |

主工作区**允许**：

- `git status` / `fetch` / `pull` / `log` / `diff`
- `cargo test`/`build`（只读验证）
- `node scripts/worktree/worktree.mjs create`、`git worktree list/remove`
- **编辑 `.gitignore` 覆盖的路径**（如 `.beads/`、`.claude/*.local.json`、`.claude/reviews/`、`target/`、`.cargo/cache/` 等本地/生成物）

> 安全叠加：`.env` / `.env.local` 仍由 `pre-tool-check` 的 `PROTECTED_FILES` 单独拦截，不受 gitignore 例外放行。

### 4. 禁止行为

- 禁止在 main 工作区 `git checkout -b <feature>`
- 禁止在 main 工作区 `git switch <feature>`
- 禁止在 main 工作区对仓库文件 Write/Edit（Agent 与脚本钩子均拦截）
- 禁止在 `main` 分支上直接 `git commit` / push
- Worktree 仅用于开发，不得用于 `cargo publish` 等发布操作

### 5. 清理

#### 推荐：合并后一键落地（自动修复 + 自动合并 + 清理）

```bash
# 在 worktree 内或主仓执行均可
node scripts/worktree/worktree.mjs land feat/<id>-<slug>

# 仅预览
node scripts/worktree/worktree.mjs land feat/<id>-<slug> --dry-run
```

`land` 流程：

1. **自动修复** — `git fetch`；若分支落后 `origin/main`，在 worktree 内 `rebase origin/main` 并 `push --force-with-lease`（冲突则停止，需人工处理）
2. **自动合并** — `gh pr merge --squash`（就绪立即合；否则 `--auto` 排队），轮询至 PR `MERGED`
3. **自动清理** — `git worktree remove` + 删除本地分支 + `worktree prune` / `fetch --prune`

选项：

| 选项 | 含义 |
|------|------|
| `--dry-run` | 只打印计划 |
| `--no-fix` | 跳过落后 main 时的 rebase |
| `--no-merge` | 不发起合并（PR 已 MERGED 时配合 `cleanup`） |
| `--timeout <sec>` | 等待合并完成超时（默认 1800） |
| `--delete-remote` | 合并后若远程分支仍在则删除 |

仅清理（要求已确认合并）：

```bash
node scripts/worktree/worktree.mjs cleanup feat/<id>-<slug>
```

#### 手动清理

```bash
node scripts/worktree/worktree.mjs remove feat/<id>-<slug>
node scripts/worktree/worktree.mjs prune    # 清理残留
git branch -d feat/<id>-<slug>             # 删除本地分支
```

`pr-flow.mjs --auto-merge` 在 CI 通过后会委托 `worktree.mjs land` 完成合并与清理。

---

## 紧急绕过（人工 only）

仅 maintainer 在生产事故等场景可临时设置：

```bash
export STANDARD_TEMPLATE_WORKTREE_BYPASS=1
```

- **AI Agent 不得**自行设置此变量绕过门禁
- 使用后须在 PR / incident 记录原���，并在 72h 内补齐 worktree 流程与证据

---

## 例外

| 场景 | 是否允许主仓写 | 条件 |
|------|----------------|------|
| **`.gitignore` 匹配的路径** | **是** | `git check-ignore` 判定为 ignored；含本地配置、缓存、构建产物、beads 状态等 |
| 紧急热修复（跟踪文件） | 仅人工 + `STANDARD_TEMPLATE_WORKTREE_BYPASS=1` | 事后补 PR 与原因 |
| 单次 typo（maintainer） | 仅人工本地，**不经 Agent 钩子** | 尽量仍走 PR |
| Agent 改跟踪源码/文档 | **否** | 必须 worktree |

---

## 开工检查清单（Agent）

1. `git rev-parse --show-toplevel` 确认是否主仓
2. `node scripts/worktree/worktree.mjs create <type>/<id>-<slug>`
3. `cd .worktrees/<type>/<id>-<slug>`
4. 在 worktree 内编码 / 测试 / 提交
5. `gh pr create --base main`
6. 合并 + 清理：`node scripts/worktree/worktree.mjs land <branch>`  
   （或 `pr-flow.mjs --auto-merge`；勿只 remove 而留下未合并分支）

---

## 相关文件

| 文件 | 职责 |
|------|------|
| `scripts/worktree/worktree.mjs` | create / list / remove / prune / **land** / **cleanup** |
| `scripts/worktree/worktree-policy.mjs` | 路径规范、门禁判定、审计 |
| `scripts/workflow/pr-flow.mjs` | PR 全流程；`--auto-merge` 委托 land |
| `.claude/hooks/pre-tool-check.mjs` | PreToolUse 硬拦截 |
| `.claude/hooks/session-context.mjs` | SessionStart 指引与审计 |
| `docs/constitution/06-governance.md` §6.0.5 | 宪章条款 |
