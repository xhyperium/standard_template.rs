#!/usr/bin/env node
/**
 * starship-wt.mjs — Starship Worktree 模块（替代 starship-wt.mjs）
 *
 * 职责: 输出当前 worktree 状态供 Starship 自定义模块使用。
 *
 * 用法: 在 starship.toml 中:
 *   [custom.wt]
 *   command = "node scripts/shell/starship-wt.mjs"
 *
 * 输出:
 *   main       — 在 infra.rs 主工作区
 *   feat/xxx   — 在 worktree 中
 *   (无输出)    — 不在 infra.rs 仓库中
 *
 * SSOT: starship.toml
 * 替代: scripts/shell/starship-wt.mjs (已迁移)
 */

import { execSync } from "child_process";
import { dirname } from "path";
import { fileURLToPath } from "url";
import process from "process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();

// 查找仓库根
let repoRoot;
try {
  repoRoot = execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf8", stdio: "pipe" }).trim();
} catch {
  process.exit(0);
}

// 仅在 infra.rs 仓库内
if (!repoRoot.endsWith("infra.rs")) process.exit(0);

// 在 worktree 中
const wtPrefix = repoRoot + "/.worktrees/";
if (cwd.startsWith(wtPrefix)) {
  console.log(cwd.slice(wtPrefix.length).split("/")[0]);
  process.exit(0);
}

// 在 main 工作区
console.log("main");
