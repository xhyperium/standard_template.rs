# constitution/ — 工程宪章

本目录是 **工程宪章正文 SSOT**。所有参与者（人、AI、自动化）均受此宪章约束。

仓库根 [`CONSTITUTION.md`](../../CONSTITUTION.md) 为**兼容索引**（指向本目录）；修订宪章时改本目录分章文件，并同步根索引与本 README。

**当前版本**：v1.8.0（见 [八、修订](./08-amendments.md#83-版本)）

## 章节索引

| 章节 | 文件 | 主题 |
|------|------|------|
| 一 | [01-mission.md](./01-mission.md) | 使命 |
| 二 | [02-values.md](./02-values.md) | 核心价值观（安全 / 可观测 / 可验证 / 自动化 / 简单） |
| 三 | [03-architecture.md](./03-architecture.md) | 架构原则（模块边界 / 接口 / 类型驱动 / 错误处理） |
| 四 | [04-code-standards.md](./04-code-standards.md) | 代码标准（§4.0 组织 Rust v2.1.1 / 中文强制 / STE 可选 / ESM） |
| 五 | [05-quality-gates.md](./05-quality-gates.md) | 质量门禁 |
| 六 | [06-governance.md](./06-governance.md) | 治理（Git Main First / 变更流程 / 版本 / 所有权） |
| 七 | [07-ai-agents.md](./07-ai-agents.md) | AI 代理章程 |
| 八 | [08-amendments.md](./08-amendments.md) | 修订与版本历史 |

### 常用条款速查

| 条款 | 链接 |
|------|------|
| §4.0 Rust 全局编码规范 | [04-code-standards.md §4.0](./04-code-standards.md#40-rust-全局编码规范强制上位) |
| §4.5 语言与编码（强制中文） | [04-code-standards.md §4.5](./04-code-standards.md#45-语言与编码强制) |
| §4.6 英文 / STE（可选） | [04-code-standards.md §4.6](./04-code-standards.md#46-英文技术文档与-asd-ste100可选加严) |
| §4.8 ESM 脚本 | [04-code-standards.md §4.8](./04-code-standards.md#48-脚本语言ecmascript-module强制) |
| §5 质量门禁 | [05-quality-gates.md](./05-quality-gates.md) |
| §6.0 Git Main First | [06-governance.md §6.0](./06-governance.md#60-git-main-first强制) |
| §6.0.5 Worktree | [06-governance.md §6.0.5](./06-governance.md#605-git-worktree-强制) |
| §7 AI 代理 | [07-ai-agents.md](./07-ai-agents.md) |

## 收录标准

**应放入本目录：**

- 宪章分章正文
- 宪章条款导航 / 章节索引
- 宪章版本历史（§8.3）
- 仅解释宪章本身（不展开落地细则）的材料

**不应放入本目录：**

- 宪章条款的**实施细则** → [`docs/governance/`](../governance/)
- SSOT 对齐矩阵 / 同步报告 → [`docs/ssot/`](../ssot/)
- CI 状态、配置快照 → [`docs/status/`](../status/)
- 架构决策（DDR）→ [`docs/decisions/`](../decisions/)

## 落地细则（不在本目录）

| 细则 | 宪章锚点 |
|------|----------|
| [VERSIONING.md](../governance/VERSIONING.md) | §6.2 / 版本策略 |
| [worktree-policy.md](../governance/worktree-policy.md) | §6.0.5 |
| [编码与语言约定.md](../governance/编码与语言约定.md) | §4.5 |
| [ASD-STE100.md](../governance/ASD-STE100.md) | §4.6（英文可选加严） |
| [quant-dev-spec.md](../governance/quant-dev-spec.md) | 领域扩展（§3.3） |
| 组织 [language.md 强制中文](https://github.com/xhyperium/.github/blob/main/rulesets/language.md) | §4.5 上位语言政策 |
| 组织 [Rust 编码规范完整版 v2.1.1](https://github.com/xhyperium/.github/blob/main/rulesets/rust/RULES.md) | §4.0 上位全局标准 |

上级索引：[docs/README.md](../README.md)。
