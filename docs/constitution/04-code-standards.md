# 四、代码标准

## 4.0 Rust 全局编码规范（强制上位）

本仓库 **Rust 编码**以上位组织标准为基线，本分章及项目细则可**加严**，**不可削弱**其 P0 条款。

| 项 | 说明 |
|----|------|
| **标准名** | 《Rust 编码规范（完整版）》**v2.1.1** |
| **组织 SSOT（xhyperium）** | [`xhyperium/.github`](https://github.com/xhyperium/.github) → [`rulesets/rust/RULES.md`](https://github.com/xhyperium/.github/blob/main/rulesets/rust/RULES.md) |
| **组织语言政策** | [`rulesets/language.md`](https://github.com/xhyperium/.github/blob/main/rulesets/language.md)（**人类可读文本强制中文**） |
| **历史上游副本** | `bytechainx/.github` 等仅作参考；**本 org 以 xhyperium 为准** |
| **专项文档** | 同目录：`security` / `async-runtime` / `api-design` / `testing` / `observability` / `release` / `clippy` / `ci` / `cheatsheet` |
| **可复用 CI** | `xhyperium/.github` → `workflows/ci-rust-standard.yml` / `ci-rust-foundation.yml`（checks：`rust-fmt` / `rust-clippy` / `rust-test`） |
| **Agent 本机加载** | `~/.claude/rules/rust.md` + `language.md`；分发：`curl -sSL https://raw.githubusercontent.com/xhyperium/.github/main/scripts/setup-global-rules.sh \| bash` |
| **本仓关系** | 本章 §4.1–§4.8 与 [质量门禁](./05-quality-gates.md) 为**项目加严与落地**；冲突时：**不可削弱组织 P0（含 language.md），可以加严** |

### 4.0.1 必须遵守的完整版 P0 摘要

Agent 与人类编写本仓 Rust 代码时，至少遵守：

- 提交前：`fmt` + `clippy -D warnings` + `test`（证据在当前会话）
- 库：类型化错误（`thiserror`）+ `source` 链；禁止裸 `unwrap`；默认禁止无文档的 `expect`/`panic`
- 应用启动 fail-fast：`expect`/`panic` 仅允许且须 `// PANIC:` 注释
- `unsafe` 紧邻 `// SAFETY:`；生产路径禁止 `println!`/`eprintln!`/`dbg!`，使用 `tracing`
- 异步统一 `tokio`；禁止持锁跨 `.await`；通道/缓存有界；外部调用有 timeout
- 敏感信息禁止硬编码与日志明文；默认 TLS 校验

完整条款与规则 ID 以组织 `rulesets/rust/` 为准；本仓领域加严见 [quant-dev-spec.md](../governance/quant-dev-spec.md) 等。

### 4.0.2 本仓加严示例（不削弱上位）

| 上位基线 | 本仓加严 |
|----------|----------|
| 命名 / 模块惯例 | §4.3 crate `*x` 后缀、适配器路径 |
| 语言 | 组织 `language.md` 强制中文；§4.5 为本仓落地；§4.6 STE 仅英文可选层 |
| 脚本 | §4.8 仅 ESM `.mjs` |
| 门禁 | [§5](./05-quality-gates.md) `cargo deny`、宪章校验脚本等 |

落地索引：[docs/governance/README.md](../governance/README.md)。

## 4.1 格式

- 统一使用 `rustfmt`，配置见 `rustfmt.toml`
- CI 中 `cargo fmt --check` 必须通过
- 不讨论格式风格，工具即标准

## 4.2 Lint

- 启用 `clippy`，`-D warnings`
- 禁止 `#[allow(...)]` 无注释说明
- `unsafe` 代码须标注原因并附带 safety proof 注释
- 库代码对齐完整版：`unwrap_used` deny；`expect_used` 默认 deny（启动路径见 §4.0.1）

## 4.3 命名

### 4.3.1 Rust 标识符

- crate 名：`kebab-case`，Cargo 包名与目录名一致
- 类型/枚举：`UpperCamelCase`（`BinanceAdapter`, `OrderSide`）
- 函数/方法/变量：`snake_case`（`fetch_ticker`, `base_url`）
- 常量/静态变量：`SCREAMING_SNAKE_CASE`（`MAX_POSITION_SIZE`）
- 测试函数：`snake_case`，描述行为而非实现（`test_connect_disconnect`）

### 4.3.2 Crate 命名

| 类型 | 包名 (Cargo.toml) | 目录 | 示例 |
|------|-------------------|------|------|
| 核心 crate | `<domain>` 或 `<domain>x` | `crates/<domain>/` | `kernel`, `configx` |
| 适配器 | `<provider>x` | `crates/adapters/<kind>/<provider>/` | `binancex`, `redisx` |

**规则**：

- **`x` 后缀**：推荐新 crate 以 `x` 结尾（xhyper extension）
- **无前缀**：包名不含 `xhyper-` 前缀
- **目录与包名一致**：`crates/configx/` → 包名 `configx`
- **适配器**：统一 `{provider}x` 模式，目录保持 `crates/adapters/{kind}/{provider}/`

### 4.3.3 分支与标签

- **分支**：`{type}/{description}`，type ∈ `feat | fix | chore | docs | test | refactor`
  - 例：`feat/order-balance`, `fix/miri-isolation`, `chore/update-deps`
- **标签**：`v{MAJOR}.{MINOR}.{PATCH}`（[SemVer](https://semver.org/)）
  - 例：`v0.3.0`, `v1.0.0`
- **commit**：[Conventional Commits](https://www.conventionalcommits.org/)
  - 例：`feat(binancex): 增加订单管理脚手架`
  - **模板**：仓库提供 `.gitmessage` 提交信息模板，首次克隆后执行 `git config commit.template .gitmessage` 激活；之后每次 `git commit`（不带 `-m`）自动在编辑器中加载模板
  - **说明语言**：Conventional Commits 的 type/scope 可英文；**说明部分须中文**（对齐组织 `language.md`）

### 4.3.4 文件与目录

- **脚本**：`.mjs`（ESM），禁止 `.sh`（[§4.8](#48-脚本语言ecmascript-module强制)）
- **配置**：`.toml` 优先，避免 `.yaml` / `.json` 碎片化
- **Markdown**：仓库根级标志文件可用 `SCREAMING_SNAKE_CASE.md`（`CHANGELOG.md`）；宪章正文分章见本目录
- **Rust 模块**：`snake_case.rs`
- **Cargo 包目录**：与包名一致（`crates/configx/` → 包名 `configx`）

## 4.4 测试

- 单元测试与源码同文件，置于 `#[cfg(test)] mod tests`
- 集成测试置于 `tests/` 目录
- 测试命名描述行为，而非实现细节
- 优先使用 `cargo-nextest` 作为测试运行器

## 4.5 语言与编码（强制）

本仓库对**文本语言与字符编码**作出强制约定。

| 上位 | 说明 |
|------|------|
| 组织语言政策 | [`xhyperium/.github` → `rulesets/language.md`](https://github.com/xhyperium/.github/blob/main/rulesets/language.md)（**P0，不可削弱**） |
| 本仓细则 | [docs/governance/编码与语言约定.md](../governance/编码与语言约定.md) |

冲突时：**组织 language.md > 本宪章 §4.5 > 细则文档**。

### 4.5.1 字符编码

- 全部文本源文件必须为 **UTF-8（无 BOM）**
- 换行符统一为 **LF**（Unix）
- 禁止提交 GBK / GB2312 / UTF-16 等其他编码
- 禁止出现替换字符 `U+FFFD`（表示编码损坏）
- 编辑器配置以 `.editorconfig` 的 `charset = utf-8` 为准

### 4.5.2 语言（强制中文）

**凡人类可读的自然语言，默认且强制使用简体中文。**

| 类别 | 要求 |
|------|------|
| 代码注释（`//`、`///`、`//!`） | **中文** |
| 项目治理 / 协作文档（宪章、AGENTS、PR/Issue、设计规格） | **中文** |
| 用户可见错误信息（`Display` / 业务文案） | **中文** |
| Agent 对用户输出 / 审查 / handoff | **中文** |
| 提交说明 | Conventional Commits：`type(scope): 中文说明` |
| 标识符（类型、函数、模块、字段名） | 英文（Rust 惯例） |
| 技术术语 | 中文叙述 + 可保留 API / CI / crate 等英文本体 |
| `LICENSE` 等法律文本 | 英文原文 |
| 第三方 skills / 上游文档 | 可保留原文；**本组织新增内容默认中文** |

**禁止**：无书面豁免的大段英文文档或英文 Agent 汇报作为默认交付（见组织 `language.md`）。

### 4.5.3 技术术语

- 可保留英文术语本体：API、CI、PR、crate、workspace、Docker 等
- 中文叙述中的解释性语句使用中文
- 禁止对已是 UTF-8 的中文再次错误转码（避免双重 UTF-8 / 乱码）

### 4.5.4 合规检查

- 本地 / CI 应能检测：非 UTF-8、`U+FFFD`、明显双重编码痕迹
- 宪章校验脚本：`./scripts/quality-gates/check-constitution.mjs` 包含 §4.5 检查

## 4.6 英文技术文档与 ASD-STE100（可选加严）

> **定位变更（v1.8.0）**：组织默认 **中文**。本节**不再**把 STE 作为全局强制交付语言。  
> 仅当项目**书面决定**产出英文技术交付物时，英文正文建议采用 STE 风格。

**ASD-STE100**（Simplified Technical English）是受控英语写作规范。  
落地指南：[docs/governance/ASD-STE100.md](../governance/ASD-STE100.md)（不复制官方词表）。

### 4.6.1 何时适用

| 情况 | 要求 |
|------|------|
| 默认（中文文档 / 中文注释 / 中文错误文案） | 仅 §4.5；**不适用** STE |
| 存在**书面豁免**的对外英文手册 / 英文 API 说明 / 英文 runbook | 英文正文**建议** STE（或兼容子集）；PR 注明豁免范围与期限 |
| 无豁免却新增大段英文技术正文 | **不合规**（应先中文，或走豁免） |

### 4.6.2 若启用英文交付的写作原则（摘要）

1. 一词一义；术语全文一致  
2. 短句；一句一个主题  
3. 描述用主动语态 + 简单现在时；步骤用祈使语气  
4. 编号步骤；一步一动作；警告在操作之前  
5. 避免俚语、双关与不必要缩写堆叠  

### 4.6.3 与中文的关系

- **母语与默认交付：中文**（组织 `language.md` + §4.5）  
- 英文层为**可选加严**，不得压过中文义务  
- 中英并存时术语与步骤顺序一致  

### 4.6.4 AI 与审查

- AI **默认**用中文写文档与说明  
- 仅在豁免范围内写英文时，按本节与 `ASD-STE100.md` 自检  
- 审查以中文合规为先；英文层再抽查 STE 风格  

### 4.6.5 合规检查

- 须保留 `docs/governance/ASD-STE100.md` 作为可选指南  
- STE 词表级自动化非强制；无豁免的英文大段正文可在审查中拦截  

## 4.8 脚本语言：ECMAScript Module（强制）

**`scripts/` 下的自动化脚本统一使用 `.mjs`（ECMAScript Module）。**

- 禁止新增 `.sh` / `.bash` 脚本
- 现有 `.sh` 脚本须逐步迁移至 `.mjs`
- **例外**（须 shell 集成）：
  - `worktree-activate.mjs` — 需 `source` 注入函数与补全
  - `starship-wt.mjs` — Starship 调用（子进程，轻量）
  - `worktree.mjs` — 需 `cd` 改变 shell 状态

理由：跨平台兼容、统一依赖（Node.js ≥ 18）、类型安全潜力。

---

← [上一章：架构原则](./03-architecture.md) · [索引](./README.md) · 下一章：[五、质量门禁](./05-quality-gates.md) →
