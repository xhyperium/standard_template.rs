# `.agents/ssot/` — Agent 操作说明

> 本目录是 **standard_template 本仓域规格 SSOT**。
> 实现代码在 `src/`；对齐文档在 `docs/`。

## 1. 何时读这里

| 场景 | 读什么 |
|------|--------|
| 新增功能模块 | 对应域 `spec/` + `design/` |
| 判断是否可宣称 ship | `docs/ssot/` 对齐矩阵 + CI 门禁 |
| 新增域 | 先更新本文件与根 `SSOT.md` 清单 |

## 2. 标准层级（域叶节点）

```text
goal/ spec/ design/ plan/ tasks/ prompt/ test/ review/ release/ retrospective/
gate/ evidence/   + README.md
```

- **Code 不在本树**：实现路径写在 `README` 或对齐文档中
- 禁止在 SSOT 写实现副本（`src/`、`Cargo.toml`、`*.rs`）

## 3. 变更规则

1. **worktree + PR** 修改本树（禁止 main 直接改）
2. 改规格后同步 `docs/` 中对齐文档
3. 路径统一使用 `.agents/ssot/`

## 4. 规格文档 ≠ 实现

- SSOT 内状态描述仅记录规格或历史战役状态
- 本仓是否落地以 `Cargo.toml` workspace members + 本仓测试为准
