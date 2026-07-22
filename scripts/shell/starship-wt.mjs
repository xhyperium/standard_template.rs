#!/usr/bin/env node
/**
 * starship-wt.mjs — Starship Worktree 模块
 *
 * 职责: 输出当前 worktree 状态供 Starship 自定义模块使用。
 *
 * 用法: 在 starship.toml 中:
 *   [custom.wt]
 *   command = "node scripts/shell/starship-wt.mjs"
 *
 * 输出:
 *   main       — 在 standard_template 主工作区
 *   feat/xxx   — 在 worktree 中
 *   (无输出)    — 不在 standard_template 仓库中
 *
 * SSOT: starship.toml
 */

import { execSync } from "child_process";
import { dirname, resolve, basename } from "path";
import { fileURLToPath } from "url";
import process from "process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();

let toplevel, gitCommonDir;
try {
  toplevel = execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  gitCommonDir = execSync("git rev-parse --git-common-dir", { cwd, encoding: "utf8", stdio: "pipe" }).trim();
} catch {
  process.exit(0);
}

// 主仓库根（通过 --git-common-dir 推导，worktree 中同样有效）
const mainRepoRoot = resolve(gitCommonDir, "..");

// 仅在 standard_template 仓库内
if (!mainRepoRoot.endsWith("standard_template.rs")) process.exit(0);

// 在 worktree 中（toplevel 包含 .worktrees/ 或不在主仓库根）
if (toplevel !== mainRepoRoot && toplevel.includes(".worktrees")) {
  console.log(basename(toplevel));
  process.exit(0);
}

// 在 main 工作区
console.log("main");
