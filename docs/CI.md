# CI 工作流指引

本文件是 `standard_template.rs` CI/CD 工作流的操作指引。

---

## 工作流清单

| 工作流 | 触发条件 | 用途 |
|--------|---------|------|
| `ci-rust.yml` | PR → main / push → main | 完整 CI：build / test / lint / msrv / coverage / summary |
| `ci-rust-org.yml` | workflow_dispatch | 组织级可复用 CI 模板 |
| `quality.yml` | PR → main（Rust 路径变更） | rustfmt / clippy / cargo doc |
| `security.yml` | PR → main / schedule（周一） | cargo-deny 依赖策略 + cargo-audit 漏洞扫描 |
| `coverage.yml` | workflow_dispatch | workspace 级 LCOV 覆盖率 |
| `constitution.yml` | PR → main | 工程宪章合规检查 |
| `pr-template-check.yml` | PR → main | PR 描述模板完整性 |
| `validation.yml` | PR → main | UTF-8 编码门禁 |

---

## 编码门禁（utf8-encoding）

### 检测内容

`validation.yml` 中的 `utf8-encoding` 作业分两步检测：

**步骤 1：非 UTF-8 编码扫描（阻断）**

```
检测工具：file -b --mime-encoding
通过标准：utf-8 / ascii / us-ascii / binary
失败行为：❌ PR 阻塞
```

**步骤 2：U+FFFD 替换字符扫描（警告）**

```
检测工具：grep -P '\xef\xbf\xbd'
通过标准：无匹配
失败行为：⚠️ 仅警告，不阻断
```

### 排除规则

编码扫描自动排除以下文件：

| 类型 | 模式 |
|------|------|
| 版本控制 | `.git/` |
| 依赖/构建 | `node_modules/` `.cargo/` `target/` |
| 图片 | `*.png` `*.jpg` `*.ico` `*.svg` |
| 字体 | `*.woff*` |
| 锁文件 | `*.lock` |

### 故障排除

#### CI 报 `❌ 文件 → iso-8859-1`

**原因**：文件以 GBK 编码保存。

**修复**：
```bash
# 方式 1：自动修复
node scripts/fix-encoding.mjs --fix

# 方式 2：手动转换
iconv -f gbk -t utf-8 文件路径 > /tmp/fixed && mv /tmp/fixed 文件路径
```

#### CI 报 `⚠️ 含 U+FFFD 替换字符`

**原因**：文件曾在 GBK→UTF-8 转换中部分损坏。

**修复**：
```bash
node scripts/fix-encoding.mjs --fix
```

### 本地预检

```bash
# 完整扫描（模拟 CI）
node scripts/fix-encoding.mjs --check
```

---

## 防护层级

编码防护体系由三层组成：

| 层级 | 工具 | 时机 | 阻断 |
|------|------|------|------|
| Pre-Tool | `encoding-check.mjs` | Write/Edit 操作前 | ✅ 阻断 |
| Post-Tool | `encoding-batch-check.mjs` | Write/Edit 操作后 | ❌ 安静警告 |
| CI 门禁 | `validation.yml` utf8-encoding | PR 提交时 | ✅ 阻断（编码）/⚠️ 警告（U+FFFD） |

---

## 常见 CI 失败与解决方案

| 症状 | 工作流 | 原因 | 解决 |
|------|--------|------|------|
| `❌ 非 UTF-8 文件` | validation | GBK 编码 | `iconv` 或 `fix-encoding.mjs` |
| `⚠️ U+FFFD 替换字符` | validation | 编码残留 | `fix-encoding.mjs --fix` |
| `cargo fmt` 失败 | quality | 格式不合规 | `cargo fmt --all` |
| `clippy -D warnings` 失败 | quality | 代码静态警告 | 修复 clippy 警告 |
| `cargo test` 失败 | ci-rust | 测试未通过 | 修复测试用例 |
| `cargo-deny check` 失败 | security | 许可/安全策略不合规 | 检查 deny.toml |
