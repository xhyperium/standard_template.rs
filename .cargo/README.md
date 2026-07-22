# `.cargo/` 目录

| 条目 | 职责 |
|------|------|
| `config.toml` | Cargo 总配置：`[alias]`、`[build] target-dir` |
| `mutants.toml` | cargo-mutants：`output = ".cargo/cache/mutants"` |
| `target/` | 构建产物（gitignore） |
| `cache/` | 工具缓存根：`mutants/`、`sccache/`、`coverage/` 等 |

**规则**

- 不要使用仓库根 `./target/`；统一 `.cargo/target/` 或 `$CARGO_TARGET_DIR`
- 工具输出放在 `.cargo/cache/<tool>/`
- 工具链由 `rust-toolchain.toml` 声明；MSRV 见 workspace `rust-version`
