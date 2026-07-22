# 五、质量门禁

| 门禁 | 级别 | 说明 | 工作流 / 命令 |
|------|------|------|---------------|
| `cargo fmt --check` | **强制** | 格式一致性 | `validation.yml` / `make fmt-check` |
| `cargo clippy -- -D warnings` | **强制** | 代码质量 | `quality.yml` / `make lint` |
| `cargo test` / `cargo nextest run` | **强制** | 功能正确性 | `ci-rust.yml` / `make test` |
| `cargo-deny check` | **强制** | 安全审计 | `security.yml` / `make deny` |
| 宪章合规性（全部） | **强制** | `scripts/quality-gates/check-constitution.mjs` | `constitution.yml` / `make check` |
| UTF-8 / 无 `U+FFFD`（§4.5） | **强制** | 编码完整性 | `constitution.yml`（已包含） |
| Git Main First（§6.0） | **强制** | 主干唯一、PR 收敛 | 分支保护 + 宪章脚本条款检查 |
| 语言政策（§4.5 + 组织 language.md） | **强制** | 人类可读文本中文；UTF-8 | 宪章脚本 + 审查 |
| 英文 STE（§4.6） | **可选** | 仅书面豁免的英文交付 | 审查清单 + `docs/governance/ASD-STE100.md` |
| 模块自验证（§5.2） | **强制** | 脚本 + 钩子语法与逻辑完整 | `self-test.yml` / `node scripts/self-test.mjs` |
| 覆盖率 >= 80% | **推荐** | 代码覆盖 | `ci-rust.yml` |
| `cargo-llvm-cov` | **推荐** | 覆盖率统计 | `ci-rust.yml` |

## 5.1 本地验证

提交 PR 前运行 `make ci` 模拟全部强制门禁：

```bash
make ci    # 等价于: make fmt-check lint test deny
make check # 等效: ./scripts/quality-gates/check-constitution.mjs
```

## 5.2 模块自验证

每个模块须通过 `scripts/self-test.mjs` 验证后才可提交 PR：

```bash
node scripts/self-test.mjs              # 全部模块 (scripts + hooks + crates)
node scripts/self-test.mjs --scripts    # 仅 scripts/
node scripts/self-test.mjs --hooks      # 仅 hooks/
node scripts/self-test.mjs --lint-only  # 仅 L0 语法检查
```

- **L0（强制）**：语法检查（`node --check`）+ shebang + import 完整性
- **L1（推荐）**：逻辑测试（配套 `*.test.mjs` 文件）
- CI 通过 `self-test.yml` 并行运行脚本和钩子自检

---

← [上一章：代码标准](./04-code-standards.md) · [索引](./README.md) · 下一章：[六、治理](./06-governance.md) →
