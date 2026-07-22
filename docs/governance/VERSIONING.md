# VERSIONING.md — 统一版本管理规则

> 本文件定义 `standard_template.rs` 项目全部可交付物的版本策略。
> SSOT 源：本文件。冲突时以此为准。

---

## 版本体系

```text
项目版本 (Project)          CONSTITUTION 版本 (Governance)
├── Cargo.toml              ├── docs/constitution/（正文 SSOT）
├── CHANGELOG.md            ├── CONSTITUTION.md（根索引）
└── （编排/发布元数据）       └── .agents/ssot/SSOT.md

Crate 版本 (Independent)    工具版本 (Tools, 建议对齐)
├── crates/**/Cargo.toml    ├── tools/*/Cargo.toml
└── 每个 package 独立 SemVer └── 建议独立，不强制跟随项目
```

| 版本类型   | 载体                         | 格式              | 示例     | 更新时机                          |
| ---------- | ---------------------------- | ----------------- | -------- | --------------------------------- |
| 项目版本   | 根 `Cargo.toml` `[workspace.package]` / `CHANGELOG.md` | SemVer | `0.1.0` | 工作区级 release / 编排变更       |
| 宪章版本   | `docs/constitution/08-amendments.md` | vX.Y.Z   | `v1.8.0` | 每次宪章修订                      |
| **Crate 版本** | `crates/**/Cargo.toml`   | **独立 SemVer**   | `0.1.2`  | **该 crate 每次交付更新 → PATCH +1** |
| 工具版本   | `tools/*/Cargo.toml`         | 独立 SemVer       | `0.2.0`  | 该工具变更时（建议同 crate 规则） |
| 依赖锁定   | `Cargo.lock`                 | 锁定图            | —        | `cargo update`                    |
| 文档附版   | `docs/**/*.md`               | 参考宪章版本      | —        | 宪章修订时同步                    |

---

## Crate 独立版本（强制）

### R-C1: 每个 `crates/` 子模块必须独立版本

1. `crates/` 下每个 workspace member **必须**在自身 `Cargo.toml` 的 `[package]` 中写明显式版本：

   ```toml
   [package]
   name = "example"
   version = "0.1.0"   # 强制：显式独立版本
   ```

2. **禁止**在 `crates/**/Cargo.toml` 使用 `version.workspace = true` 继承项目/workspace 版本。
3. 允许继续继承非版本元数据：`edition.workspace`、`license.workspace`、`repository.workspace`、`rust-version.workspace`。
4. 新增 crate 的初始版本默认从 `0.1.0` 起；从既有有效版本迁移时，**保留当时已生效的版本号**（例如原 workspace 继承 `0.3.0` 则落盘为 `0.3.0`），不得无故回退。
5. `tools/` 建议同样独立版本；本规则对 `crates/` **强制**，对 `tools/` **强烈建议**。

### R-C2: 统一更新规则 — 每更新一次 `x.y.z` 的 PATCH +1

对**发生交付性变更**的 crate，版本号按下述规则递增（`x.y.z` → `x.y.(z+1)`）：

| 触发（该 crate 范围内） | 默认动作 | 说明 |
| ----------------------- | -------- | ---- |
| 源码 / 公开 API / 行为变更 | **PATCH +1**（`z += 1`） | **统一默认规则** |
| 仅注释、文档、格式化、测试措辞且无行为变化 | **可不 bump** | 无交付面变化 |
| 故意破坏性 API（1.0.0 后） | MAJOR +1，`y=0`，`z=0` | 须在 PR 标 `BREAKING` |
| 故意向后兼容的大功能 | 可用 MINOR +1，`z=0` | 可选；未声明时仍默认 PATCH +1 |

**硬性要求：**

1. **只 bump 实际变更的 crate**；禁止「改了一个就全 workspace 齐涨」。
2. 一次 PR 中某 crate 有交付性变更 → 该 crate 至少 **PATCH +1**。
3. 同一 PR 对同一 crate 只 bump **一次**（不要重复 +1）。
4. 路径依赖必须带 `version`（满足 cargo-deny wildcards 策略），且 **version 必须与被依赖 crate 的 `[package].version` 一致**：

   ```toml
   # 在 A 的 Cargo.toml 中
   kernel = { path = "../kernel", version = "0.3.1" }  # 与 crates/kernel 的 version 对齐
   ```

5. 下游 crate 若仅因上游 version 字符串对齐而改 `Cargo.toml`、无自身逻辑变更，**可不**因此强制 bump 自身版本；若同时改了自身逻辑，仍须按 R-C2 bump。

### R-C3: 与项目版本的关系

| 项 | 规则 |
|----|------|
| 根 `[workspace.package].version` | 表示**项目/工作区编排版本**，**不**再作为 crate 版本源 |
| `CHANGELOG.md` | 记录项目级发布；可汇总多 crate 变更，但不替代各 crate 独立版本 |
| crate 间版本 | 互不绑定；不同 crate 版本可共存 |
| 发布 tag | 项目级可用 `v{project}`；单 crate 发布（若未来 publish）用该 crate 自身 SemVer |

### R-C4: 操作清单（改 crate 时）

```text
1. 修改 crates/<name>/ 源码或公开契约
2. 将该 crate 的 version 执行 z += 1（默认）
3. 同步所有 path 依赖中对该 crate 的 version = "…"
4. 如有 crates/<name>/releases/，追加发布说明（若项目要求）
5. PR 描述写明：哪些 package 从 x.y.z → x.y.(z+1)
```

辅助脚本（若已落地）：

```bash
# 对单个 crate 执行 PATCH +1，并尝试同步 path 依赖中的 version 字符串
node scripts/version/crate-bump.mjs <package-name-or-path>
node scripts/version/crate-bump.mjs kernel --dry-run
```

---

## 项目 / 宪章版本同步规则

### R-V1: SemVer 语义

- **MAJOR** (X): 破坏性变更
- **MINOR** (Y): 向后兼容的新功能
- **PATCH** (Z): 向后兼容的修复

Crate 默认只走 R-C2 的 PATCH +1；MAJOR/MINOR 仅在显式声明时使用。

### R-V2: 项目 / 宪章发布触发

| 事件                         | 项目版本 | 宪章版本   |
| ---------------------------- | -------- | ---------- |
| 工作区级破坏性变更 / 大版本  | MAJOR    | 不变       |
| 工作区级新功能、宪章新章节   | MINOR    | MINOR      |
| 工作区级修复、文档更新       | PATCH    | PATCH      |
| 宪章仅修订                   | 不变     | 视修订级别 |
| **单个 crate 更新**          | **不变**（除非同时发项目 release） | 不变 |

### R-V3: 版本一致性检查

CI / 本地门禁验证：

1. 根 `Cargo.toml` 项目版本与 `CHANGELOG.md` 最新版本可对照（项目级）
2. `docs/constitution/08-amendments.md`（§8.3）最新版本号可追溯
3. **`crates/**` 禁止 `version.workspace = true`**（R-C1）
4. 每个 `crates/**` member 具备显式 `version = "X.Y.Z"`
5. path 依赖中的 `version` 与目标 package 的 `[package].version` 一致（R-C2）

脚本：`node scripts/quality-gates/check-crate-versions.mjs`

### R-V4: 版本记录

- `CHANGELOG.md`：项目发布版本（SemVer）
- 各 crate：`Cargo.toml` 的 `[package].version` 为权威；可选 `crates/<name>/releases/`
- `docs/constitution/08-amendments.md` §8.3：宪章版本历史表
- 其他文档：文件底部版本表（格式：`| vX.Y.Z | YYYY-MM-DD | 修订 |`）

---

## 当前版本快照 (2026-07-22)

| 载体 | 版本 | 备注 |
|------|------|------|
| 根 `Cargo.toml` `[workspace.package]`（项目） | `0.1.0` | 编排版本，非 crate 源 |
| `CHANGELOG.md`（最新） | `0.1.0` | 项目级 |
| 宪章（`docs/constitution/`） | 见 §8.3 | 独立 |
| `crates/*` | **各 package 独立** | 禁止 workspace 继承 version |

> 以各 `Cargo.toml` 为准；本表仅作导航。查询：  
> `cargo metadata --no-deps --format-version 1 | jq -r '.packages[] | select(.id|test("path\\+file")) | "\(.name) \(.version)"'`

---

## 版本号自治原则

| 域                      | 自治度     | 说明 |
| ----------------------- | ---------- | ---- |
| 项目版本 (workspace.package) | 完全控制 | 工作区编排 / CHANGELOG；**不驱动** crate 版本 |
| 宪章版本 (CONSTITUTION) | 完全控制 | 独立于项目与 crate |
| **Crate 版本**          | **完全独立** | 显式 `version = "x.y.z"`；每次交付更新默认 **z+1** |
| 文档附版                | 跟随宪章 | 同宪章版本号 |
| 依赖锁定 (Cargo.lock)   | Cargo 管理 | 入库，CI 验证 |

---

## 禁止清单

```text
❌ crates/** 使用 version.workspace = true
❌ 改了 crate A 却去 bump 无关 crate B
❌ 交付性变更不 bump 对应 crate 版本
❌ path 依赖 version 与目标 package.version 不一致
❌ 用根 workspace.package.version 冒充所有 crate 版本
```

## 必须做

```text
✅ crates 每个子模块独立 version
✅ 交付更新默认 PATCH +1（x.y.z → x.y.z+1）
✅ 同步 path 依赖 version 字符串
✅ CI 跑 check-crate-versions.mjs
✅ PR 写明 bumped packages 列表
```
