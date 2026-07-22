# CI 工作流指引

本文件是 `macro_data.rs` CI/CD 工作流的操作指引。

---

## 工作流清单

| 工作流 | 触发条件 | 用途 |
|--------|---------|------|
| `validation.yml` | PR → main | 编码门禁、YAML/TOML/MD 检查、Harness 健康、版本对齐 |
| `quality.yml` | PR → main/develop（Rust 路径变更） | rustfmt / clippy / cargo doc |
| `self-test.yml` | PR → main（scripts/hooks 变更） | 脚本与钩子自验证 |
| `security.yml` | PR → main | 密钥泄露扫描 |
| `secrets-lint.yml` | PR → main | `.env` 文件检测 |
| `beads-test.yml` | PR → main | Beads 任务板测试 |
| `beads-e2e.yml` | PR → main | Beads 端到端测试 |
| `constitution.yml` | PR → main | 工程宪章合规检查 |
| `pr-template-check.yml` | PR → main | PR 模板完整性 |
| `ci-summary.yml` | workflow_run（completed） | CI 结果汇总 |
| `workflow-security.yml` | workflow_run（completed） | 工作流安全审查 |
| `ci-rust-org.yml` | workflow_dispatch | 组织级 Rust CI 检�� |
| `release.yml` | workflow_dispatch | 发布流程 |

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
| 二进制数据 | `*.bin` `*.dat` `*.db` `*.dbf` |

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
# 方式 1：脚本修复
node scripts/fix-encoding.mjs --fix

# 方式 2：从 GBK 原始版本恢复（如有）
python3 -c "
with open('文件','rb') as f: data = f.read()
text = data.decode('gbk')
with open('文件','w',encoding='utf-8') as f: f.write(text)
"
```

#### 不应检测的二进制文件被误报

如果合法的二进制文件被编码扫描误检，将该文件的扩展名添加到 `validation.yml` 的 `-not -name` 排除列表中，然后提交 PR。

### 本地预检

```bash
# 完整扫描（模拟 CI）
node scripts/fix-encoding.mjs --check

# 仅语法检查
node scripts/self-test.mjs --scripts --lint-only
node scripts/self-test.mjs --hooks --lint-only
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

## 更新 CI 工作流

1. 创建 worktree：`node scripts/worktree/worktree.mjs create ci/description`
2. 修改 `.github/workflows/` 中的 YAML 文件
3. 本地语法验证：`yamllint .github/workflows/xxx.yml`
4. 提交 PR 并等待 CI（修改工作流会触发 self-test.yml）
5. 合并后验证 CI 正常运行

### 添加新的搜索排除

如需为编码扫描添加新的排除规则，在 `validation.yml` 的 `utf8-encoding` 作业中添加 `-not -name` 行（步骤 1 和步骤 2 均需添加）。

---

## 常见 CI 失败与解决方案

| 症状 | 工作流 | 原因 | 解决 |
|------|--------|------|------|
| `❌ 非 UTF-8 文件` | validation | GBK 编码 | `iconv` 或 `fix-encoding.mjs` |
| `⚠️ U+FFFD 替换字符` | validation | 编码残留 | `fix-encoding.mjs --fix` |
| `cargo fmt` 失败 | quality | 格式不合规 | `cargo fmt --all` |
| `clippy -D warnings` 失败 | quality | 代码静态警告 | 修复 clippy 警告 |
| self-test 语法失败 | self-test | 脚本缺少 shebang/语法错误 | 修复脚本 |
| `All settings commands pass` 未出现 | validation | errors in settings | 检查 settings.json 格式 |

---

## 编码治理总表（四仓库）

| 仓库 | 编码修复 | 钩子 | CI 门禁 | 测试 | U+FFFD | 状态 |
|------|---------|------|---------|------|--------|------|
| `macro_data.rs` | ✅ | ✅ | ✅ | ✅ 154 | 0 | 完成 |
| `market_data.rs` | ✅ | ✅ | ✅ | ✅ | 7 | 完成 |
| `infra.rs` | ✅ | ✅ | ✅ | ✅ | 271 | 完成 |
| `standard_template.rs` | ✅ | ✅ | ✅ | ✅ | 0 | 完成 |

### 防护体系组成

| 层级 | 工具 | 时机 | 阻断 |
|------|------|------|------|
| Pre-Tool 钩子 | `encoding-check.mjs` | Write/Edit 前 | ✅ |
| Post-Tool 巡检 | `encoding-batch-check.mjs` | Write/Edit 后 | ❌ |
| CI 门禁（编码） | `validation.yml` L1 | PR 时 | ✅ |
| CI 门禁（U+FFFD） | `validation.yml` L2 | PR 时 | ❌ 警告 |
| 修复脚本 | `fix-encoding.mjs --fix` | 按需 | — |

### 新增仓库部署步骤

1. 复制文件：`scripts/fix-encoding.mjs` + `.claude/hooks/encoding-*` + `scripts/quality-gates/check-encoding-*`
2. 注册钩子：`.claude/settings.json` → PreToolUse + PostToolUse
3. 添加 CI 门禁：`.github/workflows/validation.yml` → `utf8-encoding` 作业
4. 修复编码：`python3` GBK 解码 + U+FFFD 移除
5. 验证：`node scripts/fix-encoding.mjs --check` + 5 个测试文件
