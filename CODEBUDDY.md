# Development Rules

## Rust Workspace 依赖管理规范

所有依赖版本必须在根 `Cargo.toml` 的 `[workspace.dependencies]` 中集中声明，workspace 中的各个 crate��包括根 crate 自身）通过 `workspace = true` 引用，禁止在各 crate 中内联版本号。

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
