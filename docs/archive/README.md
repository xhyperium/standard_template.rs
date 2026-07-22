# docs/archive/ — P2 治理文件归档

本目录存放从 infra.rs 复制的 P2（锦上添花）治理文件中未激活的部分。

## 归档内容

| 文件 | 说明 |
|------|------|
| `package.json` | Node.js 包声明（scripts 依赖管理） |

## 已激活的工具

以下工具已从归档中恢复到活跃位置：

| 工具 | 位置 | 用途 |
|------|------|------|
| `starship-wt` | `scripts/shell/` + `starship.toml` | Starship worktree 状态提示 |
| `crate-bump` | `scripts/version/` | Crate 版本升级 |
| `self-test` | `scripts/self-test.*` | 脚本自测试 |
| `worktree` | `scripts/worktree/` | Worktree 策略管理 |

初始化命令：

```bash
# Worktree shell 集成
eval "$(node scripts/worktree/worktree-activate.mjs)"

# Starship 配置
export STARSHIP_CONFIG=$(pwd)/starship.toml
```
