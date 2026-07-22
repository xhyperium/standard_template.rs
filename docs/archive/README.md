# docs/archive/ — P2 治理文件归档

本目录存放从 infra.rs 复制的 P2（锦上添花）治理文件。这些文件已完整适配但为非核心项，保留在此作为模板参考。

## 归档内容

| 文件 | 说明 |
|------|------|
| `package.json` | Node.js 包声明（scripts 依赖管理） |
| `starship.toml` | Starship shell 提示配置（含 worktree 模块） |
| `scripts/self-test.*` | 脚本自测试框架 |
| `scripts/shell/` | Starship worktree 状态模块 |
| `scripts/version/` | Crate 版本升级工具 |
| `scripts/worktree/` | Git Worktree 策略管理脚本 |

## 使用方式

如需启用归档文件，将其移回对应位置即可：

```bash
mv docs/archive/package.json .
mv docs/archive/starship.toml .
mv docs/archive/scripts/* scripts/
```
