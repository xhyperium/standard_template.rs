# SSOT 规则 — 单一事实源

> `.agents/ssot/` — 本仓库代理层与域规格的**本仓单一事实源**。
> 本文件是 SSOT 本身的 SSOT：域目录结构、落地判定与变更规则以此为准。

---

## 定义

**SSOT (Single Source of Truth)**：整个项目中，任何一个事实（数据、配置、规则、技能、域规格）有且仅有一个权威来源。其他位置必须是派生投影，不得分叉维护。

---

## SSOT 层级

```
源层（可编辑）
├── CONSTITUTION.md         ← 工程宪章
├── CODEBUDDY.md            ← 开发规则与代理配置
├── .agents/ssot/           ← 域规格 SSOT 根（本仓）
├── .github/                ← CI/CD
├── docs/                   ← 项目文档
└── Cargo.toml              ← workspace 依赖统一管理

投影层（只读派生）
└── .agents/skills/         ← 从 .claude/skills/ 投影
```

---

## 规则

### R1: 源优先

- 任何变更必须先修改源层文件
- 禁止在投影层手工编辑

### R2: 投影同步

- 投影层由自动化脚本/钩子从源层生成
- 同步失败必须显式报错，不得静默

### R3: 新增 SSOT

- 新增源文件前先声明在本文档中
- 同时创建对应的投影规则或对齐文档

### R4: 废除与迁移

- SSOT 源位置变更时，旧位置保留重定向说明
- 投影层与对齐文档必须同步更新

### R5: 本仓域规格树

- `.agents/ssot/` 是本仓的域规格 SSOT
- 禁止在 SSOT 树内写入 `src/`、`Cargo.toml`、`*.rs` 实现副本
- 路径一律使用 `.agents/ssot/`

### R6: 规格文档 ≠ 本仓实现

- SSOT 内状态描述仅记录规格或历史战役状态
- 本仓是否落地以 `Cargo.toml` workspace members + 本仓测试为准

---

## 当前 SSOT 清单

| 事实域 | SSOT 位置 | 说明 |
|--------|----------|------|
| 工作区依赖 | `Cargo.toml` → `[workspace.dependencies]` | 集中版本管理 |
| 开发规则 | `CODEBUDDY.md` | 代理行为与代码规范 |
| CI/CD | `.github/workflows/` | CI 门禁 |
| 项目文档 | `docs/` | 宪章、标准、决策记录 |
| SSOT 规则 | `.agents/ssot/SSOT.md` | 自引 |
