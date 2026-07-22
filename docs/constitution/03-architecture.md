# 三、架构原则

## 3.1 模块边界

```text
crates/
├── kernel/              # L0 语义信任根（clock / lifecycle）
├── testkit/             # 测试支持（仅 dev-dependency）
└── types/
    ├── decimal/         # 十进制数值 / Money
    └── canonical/       # 跨层共享纯 DTO
```

- 每个 crate 有单一明确的职责
- 依赖方向：上层依赖下层，禁止循环引用（`canonical` → `decimalx` → `kernel`）
- L0 / types 层不得依赖外部运行时或平台特定代码

## 3.2 接口设计

- 公共 API 必须有文档注释（`///`）
- 文档注释中的代码示例必须可编译（doc-test）
- 破坏性变更必须经过 deprecation 周期

## 3.3 类型驱动设计

- **让非法状态不可表示**：用类型系统在编译期阻止错误
- 关键领域值（价格、数量、时间戳）必须创建 newtype 并在构造时校验
- 优先使用枚举替代字符串或哨兵值
- 量化领域专项见 [docs/governance/quant-dev-spec.md](../governance/quant-dev-spec.md)

## 3.4 错误处理

- 使用 `thiserror` 定义明确错误类型
- 错误链（`source()`）不可断裂
- `unwrap()` / `expect()` 仅在不可恢复或已证明不可能出错的场景使用

---

← [上一章：核心价值观](./02-values.md) · [索引](./README.md) · 下一章：[四、代码标准](./04-code-standards.md) →
