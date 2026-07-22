#!/usr/bin/env node
/**
 * migrate-worktrees.mjs — Worktree 路径迁移工具（替代 migrate-worktrees.mjs）
 *
 * 职责: 将旧格式 worktree 迁移到新规范 .worktrees/<branch>。
 *
 * 用法:
 *   node scripts/worktree/migrate-worktrees.mjs             # dry-run
 *   node scripts/worktree/migrate-worktrees.mjs --apply     # 执行迁移
 *
 * SSOT: docs/constitution/06-governance.md §6.0.5 / scripts/worktree/worktree-policy.mjs
 * 替代: scripts/worktree/migrate-worktrees.mjs (已迁移)
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, renameSync, rmdirSync, readdirSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import process from "process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const WT_BASE = resolve(ROOT, ".worktrees");
const APPLY = process.argv.includes("--apply");

const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m" };

function git(cmd) {
  return execSync(`git -C ${ROOT} ${cmd}`, { encoding: "utf8", stdio: "pipe" }).trim();
}

function getBranch(wtPath) {
  try { return execSync("git branch --show-current", { cwd: wtPath, encoding: "utf8", stdio: "pipe" }).trim(); }
  catch { return ""; }
}

console.log(`${C.cyan}╔══════════════════════════════════╗${C.reset}`);
console.log(`${C.cyan}║   Worktree 路径迁移              ║${C.reset}`);
console.log(`${C.cyan}║   → .worktrees/<branch>         ║${C.reset}`);
console.log(`${C.cyan}╚══════════════════════════════════╝${C.reset}\n`);

let migrated = 0;

// 1. workspaces/ 旧格式
const wsDir = resolve(WT_BASE, "workspaces");
if (existsSync(wsDir)) {
  console.log(`${C.yellow}发现旧 workspaces/ 目录: ${wsDir}${C.reset}\n`);
  for (const item of readdirSync(wsDir, { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const oldPath = resolve(wsDir, item.name);
    const branch = getBranch(oldPath);
    const newPath = resolve(WT_BASE, branch || item.name);

    if (APPLY) {
      mkdirSync(dirname(newPath), { recursive: true });
      renameSync(oldPath, newPath);
      console.log(`  ${C.green}✓ 迁移${C.reset}: ${oldPath} → ${newPath}`);
    } else {
      console.log(`  ${C.yellow}待迁移${C.reset}: ${oldPath}`);
      console.log(`           → ${newPath}`);
    }
    migrated++;
  }
  if (APPLY) {
    try { rmdirSync(wsDir); console.log(`  ${C.green}清理: 空目录已删除${C.reset}`); } catch {}
  }
} else {
  console.log(`  ${C.green}✓${C.reset} 无 workspaces/ 旧格式残留`);
}

// 2. 全局 ~/.worktrees/ 旧格式
const homeWt = resolve(homedir(), ".worktrees", basename(ROOT));
console.log("");
if (existsSync(homeWt)) {
  console.log(`${C.yellow}发现全局旧路径: ${homeWt}${C.reset}\n`);
  if (APPLY) {
    mkdirSync(WT_BASE, { recursive: true });
    for (const item of readdirSync(homeWt, { withFileTypes: true })) {
      if (!item.isDirectory()) continue;
      const oldPath = resolve(homeWt, item.name);
      const newPath = resolve(WT_BASE, item.name);
      renameSync(oldPath, newPath);
      console.log(`  ${C.green}✓ 迁移${C.reset}: ${oldPath} → ${newPath}`);
    }
  } else {
    console.log(`  ${C.yellow}手动迁移步骤:${C.reset}`);
    console.log(`    mkdir -p '${WT_BASE}'`);
    console.log(`    mv '${homeWt}'/* '${WT_BASE}/'`);
    console.log(`    rmdir '${homeWt}'`);
  }
} else {
  console.log(`  ${C.green}✓${C.reset} 无 ~/.worktrees/ 全局旧格式残留`);
}

// 3. 状态
console.log(`\n${C.cyan}─── 当前 Worktree 列表 ───${C.reset}`);
console.log(git("worktree list"));

if (!APPLY) {
  console.log(`\n${C.yellow}这是 dry-run 模式。执行迁移:${C.reset}`);
  console.log(`  ${C.cyan}node scripts/worktree/migrate-worktrees.mjs --apply${C.reset}`);
}
