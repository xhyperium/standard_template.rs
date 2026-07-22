# standard_template.rs — CodeBuddy Work Instructions

## 项目身份

- **名称**：standard_template
- **类型**：Rust Cargo workspace（独立基础设施项目）
- **MSRV**：见 `Cargo.toml` 的 `rust-version` 字段
- **许可证**：MIT OR Apache-2.0
- **治理 SSOT**：[CONSTITUTION.md](./CONSTITUTION.md) — 项目宪章，所有规则的上位文档
- **Agent 治理**：[AGENTS.md](./AGENTS.md) — 多 Agent 共享的治理约定
- **本文件**：CodeBuddy 专属工作指令，补充 AGENTS.md 的 CodeBuddy 特定规则

## Rust Workspace 依赖管理规范

所有依赖版本必须在根 `Cargo.toml` 的 `[workspace.dependencies]` 中集中声明，workspace 中的各个 crate（包括根 crate 自身）通过 `workspace = true` 引用，禁止在各 crate 中内联版本号。

### 新增依赖的操作流程（必须遵守）

当需要添加新依赖时，按以下顺序操作：

1. **先在根 Cargo.toml 的 `[workspace.dependencies]` 中声明该依赖及其版本**
2. **再在目标 crate 的 `[dependencies]` / `[dev-dependencies]` 中用 `workspace = true` 引用**

**反例（禁止）：** 直接在 crate 的 Cargo.toml 中写 `foo = "1.0"` 而不先加到 workspace.dependencies。

### 规则

1. **集中声明版本**：所有依赖的版本号（以及 `features`、`default-features` 等配置）写在根 `Cargo.toml` 的 `[workspace.dependencies]` 下。
2. **统一引用**：workspace 成员 crate 的 `[dependencies]` 中只写 `crate_name = { workspace = true }`，不写版本号。
3. **范围**：适用于 `[dependencies]`、`[build-dependencies]` 和 `[dev-dependencies]`。
4. **特例**：仅单个 crate 使用的 `[dev-dependencies]`（如测试专用工具）可在该 crate 中内联，但仍推荐走 workspace 以保持风格一致。

### 示例

**根 Cargo.toml：**
```toml
[workspace]
members = ["."]

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
tokio = "1"

[dependencies]
serde = { workspace = true }
tokio = { workspace = true }
```

**子 crate（crates/my-lib/Cargo.toml）：**
```toml
[dependencies]
serde = { workspace = true }
tokio = { workspace = true, features = ["rt-multi-thread"] }
```

### 理由

- 避免同一依赖在多个 crate 中出现版本不一致
- 方便统一升级依赖版本
- 便于在 workspace 层面审计所有外部依赖

## 语言与编码（强制）

- **中文优先**：代码注释、治理文档、用户可见错误信息使用简体中文
- **提交说明**：`<type>(<scope>): 中文说明`
- **标识符**：英文（Rust 惯例）；技术术语可保留英文
- **字符编码**：所有文本文件 UTF-8（无 BOM），换行 LF
- **LICENSE**：保留英文许可证原文
- 上位约定见 [CONSTITUTION.md §4.5](./docs/constitution/04-code-standards.md)

## 代码质量（强制）

提交前必须通过以下门禁：

```bash
cargo fmt --all --check      # 代码格式化检查
cargo clippy --workspace --all-features --all-targets -- -D warnings  # 无 clippy 警告
cargo test --workspace        # 全部测试通过
```

- 禁止无上下文的 `unwrap()`；库代码优先 `thiserror`，应用侧可用 `anyhow`
- 日志用 `tracing`，不用 `println!`（示例/bin 除外）
- 完整质量门禁见 [CONSTITUTION.md §5](./docs/constitution/05-quality-gates.md)

## Git 工作流（强制）

### Main First

- **`main` 唯一主干**：所有工作必须收敛到 `main`
- **禁止在 `main` 上直接开发**：路径为 `分支 → PR → 审查 → CI → 合并 main`
- 从最新 `origin/main` 建支；合并默认 squash
- 禁止对 `main` force push；禁止 `--no-verify` 绕过钩子

### 提交信息格式

使用 Conventional Commits 格式，模板见 `.gitmessage`：

```
<type>(<scope>): <中文简述>

<正文（可选）>
```

设置模板：`git config commit.template .gitmessage`

### Worktree（强制）

- 所有活跃开发在 `.worktrees/<branch-name>` 内进行
- 禁止在主仓 `main` 工作区直接改代码
- 完整细则见 [CONSTITUTION.md §6.0.5](./docs/constitution/06-governance.md#605-git-worktree-强制)

## 安全红线

- 不提交 `.claude/*.local.json`、证书、密钥、`.env`
- 不在对话中回显完整 API Token
- 不削弱 `.gitignore` 对敏感路径的排除
- 不执行 `git push --force`、`git push --no-verify`（除非用户明确要求��已确认风险）
- CI 使用 GitHub Secrets

## 治理体系

本项目的完整治理体系由以下文件组成：

| 文件 | 用途 |
|------|------|
| [CONSTITUTION.md](./CONSTITUTION.md) | 项目宪章（治理 SSOT，不可削弱） |
| [AGENTS.md](./AGENTS.md) | 多 Agent 共享的治理约定 |
| [CODEBUDDY.md](./CODEBUDDY.md) | 本文件 — CodeBuddy 专属工作指令 |
