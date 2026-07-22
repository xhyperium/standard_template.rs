# 七、AI 代理章程

## 7.1 权限边界

- AI **不可** approve 或 merge PR
- AI **不可** 直接推送 `main` 分支（§6.0 Git Main First）
- AI **不可** 在 `main` 上直接开发或提交（§6.0.2）
- AI **不可** 修改 `.github/CODEOWNERS`
- AI **不可** 绕过任何强制门禁

## 7.2 职责范围

- AI 可执行：编码、测试编写、代码审查建议、文档生成、issue 分类
- AI 不可执行：审批、合并、发布、权限变更、CI 配置修改（需人工审查）

## 7.3 输出标准

- AI 生成的代码须与手工代码同等质量
- AI 须明确标注不确定的部分
- AI 修改后须运行 `cargo test` + `cargo fmt --check` + `cargo clippy`（或本仓 `make ci` 等价门禁）
- AI 对用户与仓库的**自然语言输出强制中文**（§4.5 + 组织 [`language.md`](https://github.com/xhyperium/.github/blob/main/rulesets/language.md)）：
  - 对话、审查、handoff、PR/Issue 描述
  - 注释、中文文档、用户可见错误信息
- **禁止**无故用英文长文回复或新增无豁免的英文技术正文
- 仅在 §4.6 **书面豁免**范围内撰写英文技术文档时，可参考 STE 风格（见 `docs/governance/ASD-STE100.md`）
- AI 写入的文本文件须为 **UTF-8 无 BOM**；不得引入乱码或 `U+FFFD`

## 7.4 与组织 Agent 规则

组织级纪律与路由（本仓不可削弱其 P0）：

- [`rulesets/agent-teams-constitution.md`](https://github.com/xhyperium/.github/blob/main/rulesets/agent-teams-constitution.md)
- [`rulesets/agent-workflow.md`](https://github.com/xhyperium/.github/blob/main/rulesets/agent-workflow.md)
- [`rulesets/agent-quality-gates.md`](https://github.com/xhyperium/.github/blob/main/rulesets/agent-quality-gates.md)

本仓加严：worktree 强制（§6.0.5）、宪章脚本、`*x` 命名等。

---

← [上一章：治理](./06-governance.md) · [索引](./README.md) · 下一章：[八、修订](./08-amendments.md) →
