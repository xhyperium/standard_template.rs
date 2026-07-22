# standard_template.rs 架构文档

## 概述

**standard_template.rs** 是 [xhyper.rs](https://github.com/xhyperium/xhyper.rs) Rust HTTP 框架的模板工作区仓库，
承载所有 AI 编码助手的共享配置、CI/CD 流水线与工程约定。

### 项目身份

| 属性 | 值 |
|------|-----|
| 类型 | Rust Cargo workspace |
| 版本 | 0.1.0 |
| MSRV | 1.85 |
| 许可证 | MIT + Apache-2.0 |
| 仓库 | https://github.com/xhyperium/standard_template.rs |

### 非目标

- 不承载具体业务 crate 实现
- 以基础配置、治理文档与 CI 工具链为主
- 作为新 workspace 项目的起点，可按需扩展为多 crate 工作区

---

## 仓库结构

```
standard_template.rs/
├── Cargo.toml                 # Workspace 根清单（含 [workspace.dependencies]）
├── Cargo.lock                 # 锁文件（v4）
├── clippy.toml                # Clippy 行为阈值配置
├── deny.toml                  # cargo-deny 安全审计规则
├── rustfmt.toml               # Rustfmt 格式化规则
├── rust-toolchain.toml        # Rust 工具链声明
├── .editorconfig              # 编辑器通用配置
├── Makefile                   # 快捷命令入口
├── LICENSE-MIT                # MIT 许可证
├── LICENSE-APACHE             # Apache-2.0 许可证
├── src/                       # 根 crate 源码（当前仅 workspace 骨架）
├── .cargo/                    # Cargo 全局配置
│   └── config.toml            # Cargo SSOT 配置
├── .github/                   # GitHub 配置
│   └── workflows/             # CI/CD 工作流（8 个）
├── .claude/                   # Claude Code 配置
│   ├── settings.json          # 生命周期钩子注册
│   ├── hooks/                 # 钩子脚本
│   └── skills/                # 技能定义（SSOT）
├── .agents/                   # AI 代理共享治理
│   └── ssot/                  # SSOT 对齐矩阵
├── docs/                      # 项目文档（严格分类）
│   ├── governance/            # 治理与约定（版本/语言/worktree）
│   ├── constitution/          # 宪章正文
│   ├── decisions/             # 架构决策记录
│   └── status/                # CI/配置状态记录
├── scripts/                   # Harness 脚本
│   ├── quality-gates/         # 质量门禁
│   ├── docs/                  # 文档生成
│   ├── standards/             # 标准检查
│   └── workflow/              # 工作流自动化
└── CODEBUDDY.md               # 项目开发规则
```

---

## Crate 架构

### 当前状态

本项目当前为**单一 crate 工作区**，根 `Cargo.toml` 既是 workspace 清单也是包清单。
设计上预留 `crates/` 子目录用于未来的多 crate 扩展。

### 依赖管理

- 所有第三方依赖版本在根 `[workspace.dependencies]` 中集中声明
- 成员 crate 通过 `{ workspace = true }` 引用，禁止内联 `version`
- 由 `scripts/quality-gates/check-workspace-deps.mjs` 在 CI 中强制执行

---

## CI/CD 架构

### 工作流一览（8 个）

| 工作流 | 职责 |
|--------|------|
| `ci-rust.yml` | Rust 编译、测试、MSRV 检查 |
| `ci-rust-org.yml` | 组织级 Rust CI 入口 |
| `quality.yml` | rustfmt / clippy / cargo doc |
| `coverage.yml` | 代码覆盖率 |
| `validation.yml` | yamllint / taplo / markdownlint / codespell / lychee / harness |
| `security.yml` | cargo-deny 安全审计 |
| `constitution.yml` | 宪章合规性验证 |
| `pr-template-check.yml` | PR 模板完整性检查 |

### 触发策略

| 工作流 | 触发条件 | 定时 |
|--------|---------|------|
| CI (Rust) | Cargo / crate / rust-toolchain 变更 | — |
| 质量 | .rs / rustfmt.toml / clippy.toml 变更 | — |
| 校验 | 全部 push / PR | — |
| 安全 | Cargo / deny.toml 变更 | 每周一 02:00 |
| Constitution | Rust / config / CONSTITUTION.md / docs/constitution/** 变更 | — |

### 构建缓存

- `Swatinem/rust-cache@v2` 在所有 Rust 编译 Job 中使用
- 构建产物统一输出到 `.cargo/target/`（gitignored）

---

## 治理系统

### 宪章（[docs/constitution/](docs/constitution/)，根索引 [CONSTITUTION.md](CONSTITUTION.md)）

五大核心价值观决定所有技术决策：

| 价值 | 约束 |
|------|------|
| 安全优先 | 变更不得降低安全标准；依赖须通过 cargo-deny 审计 |
| 可观测 | 关键路径有追踪；错误可追溯 |
| 可验证 | `check` / `test` / `fmt --check` 为门禁底线；覆盖率 ≥ 80% |
| 自动化优先 | CI 是唯一仲裁者；机器保证的不依赖人工 |
| 简单优于灵活 | YAGNI；每加一层间接必须有可论证收益 |

### AI 代理治理

- `AGENTS.md`：共享治理（SSOT）
- `.claude/skills/`：技能 SSOT 源
- 钩子生命周期：SessionStart → PreToolUse → PostToolUse → PreCompact → Stop
- 禁止 AI self-merge

---

## 工程约定

### 语言与编码

| 范围 | 语言 | 编码 |
|------|------|------|
| 代码注释 / 文档 | 中文（技术术语保留英文） | UTF-8 无 BOM |
| 用户可见错误 | 中文 | UTF-8 无 BOM |
| 标识符 | 英文（Rust 惯例） | ASCII |
| 许可证 | 英文原文 | UTF-8 |
| 换行符 | — | LF |

### Git 规范

- `main` 唯一主干，受保护
- 开发走 feature 分支 + PR，合并 squash
- Conventional Commits
- 禁止 force push / `--no-verify`

### 本地开发

```bash
make build     # 编译
make test      # 测试
make fmt-check # 格式化检查
make lint      # Clippy
make deny      # 安全审计
make ci        # 完整 CI 模拟（fmt + lint + test + deny）
```
