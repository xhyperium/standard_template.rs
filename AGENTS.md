# AGENTS.md — AI Agent Governance for standard_template.rs

本仓库是**独立的 Rust 基础设施工作区**。所有 AI 编码助手（Claude Code、Codex、Copilot 等）共享本文件中的治理约定。

## Rust 编码规范（强��）

- **上位全局标准**：《[Rust 编码规范（完整版）v2.1.1](https://github.com/xhyperium/.github/blob/main/rulesets/rust/RULES.md)》——组织 SSOT：[`xhyperium/.github`](https://github.com/xhyperium/.github) → `rulesets/rust/`
- **Agent 加载**：`~/.claude/rules/rust.md`、`language.md`（`setup-global-rules.sh`）；专项见同目录 `security` / `async-runtime` 等
- **本仓关系**：宪章 [§4.0](./docs/constitution/04-code-standards.md#40-rust-全局编码规范强制上位) 采纳上位标准；项目细则可**加严**、**不可削弱** 组织 P0
- 提交前：`cargo fmt` + `clippy -D warnings` + `test`（与完整版 / §5 门禁一致）

## 依赖集中管理（强制）

- 所有第三方依赖统一在根 `Cargo.toml` 的 `[workspace.dependencies]` 声明；成员 crate 的 `[dependencies]` / `[dev-dependencies]` / `[build-dependencies]` 中第三方依赖必须 `{ workspace = true }` 引用，禁止内联 `version`。
- 新增第三方依赖：先在根 `[workspace.dependencies]` 加一项，再在 crate 用 `{ workspace = true }`。
- 参考上位标准《Rust 编码规范》依赖管理条款。

## 语言与编码（强制）

- **组织上位**：[language.md](https://github.com/xhyperium/.github/blob/main/rulesets/language.md) — **人类可读文本强制简体中文**
- **字符编码**：全部文本文件使用 **UTF-8（无 BOM）**，换行 **LF**
- **注释 / 治理文档 / Agent 输出 / 用户可见错误**：**中文**
- **提交说明**：`<type>(<scope>): 中文说明`
- **标识符**：英文（Rust 惯例）；技术术语可保留英文本体
- **LICENSE**：保留英文许可证原文
- **英文技术正文**：非默认；须书面豁免后可参考 STE（宪章 §4.6 可选）
- 细则：[§4.5 / §4.6](./docs/constitution/04-code-standards.md)、[编码与语言约定.md](./docs/governance/编码与语言约定.md)

## 项目身份

- **类型**：Rust Cargo workspace
- **MSRV**：见 `Cargo.toml` 的 `rust-version` 字段
- **许可证**：MIT OR Apache-2.0
- **非目标**：不是其他产品的元仓库镜像；本地即为源码与约定的 SSOT

## 仓库结构

```text
standard_template.rs/
├── crates/           # Rust workspace members（按需添加）
├── examples/         # 示例
├── tests/            # 集成测试
├── docs/             # 文档（constitution/governance/standards/report）
├── scripts/          # 辅助脚本
├── .cargo/           # Cargo 配置、target-dir、工具缓存约定
├── .claude/          # Claude Code：skills / hooks / settings
├── .codex/           # Codex：agents / hooks
├── .github/          # CI/CD 与协作模板
├── CONSTITUTION.md   # 项目宪章（治理 SSOT）
├── AGENTS.md         # 本文件
├── CODEBUDDY.md      # CodeBuddy 专属工作指令
├── Cargo.toml        # Workspace 根
└── README.md
```

## 代理角色

| 系统 | 角色 | 技能来源 |
| ------ | ------ | ---------- |
| **Claude Code** | 主执行代理：编码、审查、交付 | `.claude/skills/` |
| **Codex** | 多模型编排与派工 | `.claude/skills/`（可投影到 `.agents/skills/`） |
| **Copilot** | 补充建议 | 自行管理 |

**SSOT**：技能定义以 `.claude/skills/` 为准；禁止在投影目录手工分叉维护。

**CodeBuddy**：专项工作指令见 [CODEBUDDY.md](./CODEBUDDY.md)。

## 构建与质量

```bash
cargo build --workspace
cargo test --workspace
cargo fmt --all --check
cargo clippy --workspace --all-features --all-targets -- -D warnings
cargo deny check
```

## Git Worktree（强制）

完整细则见 [docs/governance/worktree-policy.md](./docs/governance/worktree-policy.md) 与 [docs/constitution/06-governance.md §6.0.5](./docs/constitution/06-governance.md#605-git-worktree-强制)。

- **所有活跃开发**在 `.worktrees/<branch-name>` 内进行
- `pre-tool-check` 硬拦截主仓 Write/Edit 与主仓功能分支切换
- 禁止 Agent 使用 `WORKTREE_BYPASS=1`

## Git 规范（Main First）

完整条款见 [docs/constitution/06-governance.md §6.0](./docs/constitution/06-governance.md#60-git-main-first强制)。摘要：

- **`main` 唯一主干**：工作必须收敛到 `main`，禁止长期并行主线
- **禁止在 `main` 上直接开发 / 推送**；路径：`分支 → PR → 审查 → CI → 合并 main`
- 从最新 `origin/main` 建支；合并默认 squash；合并后清理分支
- 禁止对 `main` force push；禁止 `--no-verify` 绕过钩子
- Conventional Commits（模板：`git config commit.template .gitmessage`）

## 安全

- 不提交 `.claude/*.local.json`、证书、密钥、`.env`
- 不在日志/对话中回显完整 Token
- CI 使用 GitHub Secrets

## 提交信息模板

提交信息遵循 Conventional Commits 格式：

```
<type>(<scope>): <中文简述>

<正文（可选）>
```

使用 `.gitmessage` 作为 commit 模板：`git config commit.template .gitmessage`

## 任务处理流程

### 生命周期

```text
接收 → 分析 → 分解 → 执行 → 验证 → 交付
  │      │      │      │       │       │
  │      │      │      │       │       └─ 提交 / PR
  │      │      │      │       └─ cargo test + clippy + fmt
  │      │      │      └─ 逐个实现子任务
  │      │      └─ 复杂任务拆分为子项
  │      └─ 判读范围：代码 / 配置 / 文档 / CI
  └─ 用户输入
```

### 优先级规则

| 优先级 | 触发条件 | 示例 |
|--------|---------|------|
| P0 | 阻塞性安全/构建/CI 修复 | CVE 修复、CI 红改绿 |
| P1 | 用户显式请求 | 新功能、审查、重构 |
| P2 | 依赖 P1 的 follow-up | 子任务、文档补充 |
| P3 | 代码质量改进 | clippy 警告、dead code 清理 |

### 执行检查清单

每项任务完成前：

- [ ] `cargo fmt --all --check` 通过
- [ ] `cargo clippy --workspace -- -D warnings` 通过
- [ ] `cargo test --workspace` 通过
- [ ] 文档已更新（API doc / CHANGELOG）
- [ ] 提交信息遵循 Conventional Commits（模板：`git config commit.template .gitmessage`）

### 委派与接手

- **人工审批**：AI 不可 self-approve（§7.1），需 `@xhyperium/maintainers`
- **失败处理**：3 次尝试后仍失败 → 记录原因 → 创建 follow-up → 移交给人类
