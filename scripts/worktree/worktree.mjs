#!/usr/bin/env node
/**
 * worktree.mjs — Git Worktree 管理工具
 *
 * 职责: 创建/列出/删除/清理 Git Worktree；合并后落地清理。
 *
 * 用法:
 *   node scripts/worktree/worktree.mjs create <branch>
 *   node scripts/worktree/worktree.mjs go <branch>         # 输出路径供 cd 使用
 *   node scripts/worktree/worktree.mjs list
 *   node scripts/worktree/worktree.mjs remove <branch>
 *   node scripts/worktree/worktree.mjs prune
 *   node scripts/worktree/worktree.mjs current
 *   node scripts/worktree/worktree.mjs land [branch] [opts] # 自动修复 + 自动合并 + 清理
 *   node scripts/worktree/worktree.mjs cleanup [branch]    # 仅清理（要求已合并）
 *
 * land 选项:
 *   --dry-run         只打印计划，不执行
 *   --no-fix         跳过「落后 main 时自动 rebase」
 *   --no-merge        跳过合并（仅当 PR 已 MERGED 时清理）
 *   --timeout <sec>   等待合并完成的超时秒数（默认 1800）
 *   --delete-remote   合并后尝试删除远程分支（若仍存在）
 *
 * SSOT: docs/constitution/06-governance.md §6.0.5 / docs/governance/worktree-policy.md
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import process from "process";
import {
  resolveMainProjectRoot,
  canonicalWorktreePath,
  worktreeBasePath,
} from "./worktree-policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// 脚本可能从 worktree 内拷贝执行；始终解析到主仓根
const ROOT = resolveMainProjectRoot(resolve(__dirname, "../.."));
const WT_BASE = worktreeBasePath(ROOT);

function git(cmd, opts = {}) {
  const cwd = opts.cwd || ROOT;
  try {
    return execSync(`git -C '${cwd}' ${cmd}`, {
      encoding: "utf8",
      stdio: opts.silent ? "pipe" : "inherit",
    });
  } catch (e) {
    if (opts.allowFail) return "";
    throw e;
  }
}

function gitOut(cmd, opts = {}) {
  try {
    return git(cmd, { ...opts, silent: true }).trim();
  } catch (e) {
    if (opts.allowFail) return "";
    throw e;
  }
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      cwd: opts.cwd || ROOT,
      encoding: "utf8",
      stdio: opts.silent ? "pipe" : "inherit",
      ...opts,
    }).trim();
  } catch (e) {
    if (opts.allowFail) return "";
    throw e;
  }
}

function die(msg, code = 1) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

function info(msg) {
  console.log(`  → ${msg}`);
}

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

function warn(msg) {
  console.log(`  ⚠ ${msg}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function bareBranch(name) {
  return String(name || "").replace(/^refs\/heads\//, "").replace(/^heads\//, "");
}

function wtPathFor(branch) {
  return canonicalWorktreePath(ROOT, bareBranch(branch));
}

function branchExistsLocal(branch) {
  const b = bareBranch(branch);
  const out = gitOut(`branch --list --format='%(refname:short)' '${b}'`, {
    allowFail: true,
  });
  if (!out) return false;
  return out.split("\n").some((line) => line.trim() === b);
}

function resolveBranchFromCwd() {
  // 1) CWD 在 .worktrees/<branch>/... 下
  const cwd = process.cwd();
  const marker = "/.worktrees/";
  const idx = cwd.indexOf(marker);
  if (idx >= 0) {
    const rest = cwd.slice(idx + marker.length);
    // 分支路径 = 第一段到文件前的目录链；整条相对路径即 branch
    // 例: feat/foo/src → 需要 strip 非 branch 部分很难；用 git 更稳
  }
  // 2) 当前 git 分支（worktree 内有效）
  const cur = gitOut("rev-parse --abbrev-ref HEAD", {
    cwd: process.cwd(),
    allowFail: true,
  });
  if (cur && cur !== "HEAD" && cur !== "main" && cur !== "master") {
    return cur;
  }
  // 3) 从 CWD 相对 .worktrees 推断
  if (idx >= 0) {
    const rel = cwd.slice(idx + marker.length);
    // 取最长已存在 worktree 前缀
    const list = gitOut("worktree list --porcelain", { allowFail: true });
    const paths = [];
    for (const line of list.split("\n")) {
      if (line.startsWith("worktree ")) {
        paths.push(line.slice("worktree ".length).trim());
      }
    }
    const candidates = paths
      .filter((p) => p.startsWith(WT_BASE + "/") && (cwd === p || cwd.startsWith(p + "/")))
      .sort((a, b) => b.length - a.length);
    if (candidates[0]) {
      return candidates[0].slice((WT_BASE + "/").length);
    }
    // fallback: 整段相对路径的前两段（type/slug）
    const parts = rel.split("/").filter(Boolean);
    if (parts.length >= 2) return `${parts[0]}/${parts[1]}`;
    if (parts.length === 1) return parts[0];
  }
  return null;
}

function parseLandArgs(argv) {
  const opts = {
    branch: null,
    dryRun: false,
    noFix: false,
    noMerge: false,
    timeoutSec: 1800,
    deleteRemote: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--no-fix":
        opts.noFix = true;
        break;
      case "--no-merge":
        opts.noMerge = true;
        break;
      case "--delete-remote":
        opts.deleteRemote = true;
        break;
      case "--timeout": {
        const v = argv[++i];
        if (!v || Number.isNaN(Number(v))) die("--timeout 需要秒数");
        opts.timeoutSec = Number(v);
        break;
      }
      case "--help":
      case "-h":
        printLandHelp();
        process.exit(0);
        break;
      default:
        if (a.startsWith("-")) die(`未知选项: ${a}`);
        if (opts.branch) die(`多余参数: ${a}`);
        opts.branch = bareBranch(a);
        break;
    }
  }
  return opts;
}

function printLandHelp() {
  console.log(`worktree.mjs land — 自动修复 + 自动合并 + 合并后清理

用法:
  node scripts/worktree/worktree.mjs land [branch] [选项]
  node scripts/worktree/worktree.mjs cleanup [branch] [--dry-run]

选项:
  --dry-run         只打印计划
  --no-fix          跳过落后 main 时的自动 rebase
  --no-merge        不发起合并（PR 已 MERGED 时仅清理）
  --timeout <sec>   等待合并完成超时（默认 1800）
  --delete-remote   合并后删除仍存在的远程分支

流程:
  1. 自动修复 — fetch + 若落后 origin/main 则在 worktree 内 rebase 并 push
  2. 自动合并 — gh pr merge --squash（就绪则立即合；否则 --auto 排队）
  3. 等待 MERGED
  4. 清理 — remove worktree + 删除本地分支 + prune
`);
}

function printUsage() {
  console.log(
    "usage: worktree.mjs {create|go|list|remove|prune|current|land|cleanup} [branch] [opts]",
  );
}

function prJson(branch) {
  const raw = run(
    `gh pr view '${branch}' --json number,state,url,mergeable,mergeStateStatus,headRefName,baseRefName`,
    { silent: true, allowFail: true },
  );
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isMergedIntoMain(branch) {
  const b = bareBranch(branch);
  // 以 PR 状态为准。禁止用「tip 是 origin/main 祖先」推断：
  // 无独有提交的功能分支 tip 也是 main 祖先，误删风险极高。
  const pr = prJson(b);
  if (pr?.state === "MERGED") return true;
  return false;
}

/**
 * 自动修复：分支落后 origin/main 时，在 worktree 内 rebase 并 push。
 * 冲突则失败退出，不强制推送。
 */
function autoFix(branch, opts) {
  const b = bareBranch(branch);
  const wtPath = wtPathFor(b);

  info("fetch origin ...");
  if (!opts.dryRun) {
    run("git fetch origin", { silent: false });
  } else {
    info("[DRY-RUN] git fetch origin");
  }

  const behind = Number(
    gitOut(`rev-list --count '${b}..origin/main'`, { allowFail: true }) || "0",
  );
  const ahead = Number(
    gitOut(`rev-list --count 'origin/main..${b}'`, { allowFail: true }) || "0",
  );
  info(`相对 origin/main: ahead=${ahead} behind=${behind}`);

  if (behind === 0) {
    ok("已基于最新 origin/main，无需修复");
    return { fixed: false, rebased: false };
  }

  if (opts.noFix) {
    warn(`落后 ${behind} 个提交，但已指定 --no-fix，跳过 rebase`);
    return { fixed: false, rebased: false };
  }

  if (!existsSync(wtPath)) {
    die(`worktree 不存在，无法自动修复: ${wtPath}\n  请先: node scripts/worktree/worktree.mjs create ${b}`);
  }

  info(`落后 ${behind} 个提交，在 worktree 内 rebase origin/main ...`);
  if (opts.dryRun) {
    info(`[DRY-RUN] git -C ${wtPath} rebase origin/main`);
    info(`[DRY-RUN] git -C ${wtPath} push --force-with-lease`);
    return { fixed: true, rebased: true };
  }

  try {
    git("rebase origin/main", { cwd: wtPath, silent: false });
    ok("rebase 成功");
  } catch (e) {
    try {
      git("rebase --abort", { cwd: wtPath, silent: true, allowFail: true });
    } catch {
      /* ignore */
    }
    die(
      `自动修复失败：rebase 冲突。请手动解决后重试 land。\n  cd ${wtPath} && git rebase origin/main`,
    );
  }

  info("push --force-with-lease ...");
  try {
    git("push --force-with-lease", { cwd: wtPath, silent: false });
    ok("已推送修复后的分支");
  } catch (e) {
    die(`push 失败: ${String(e.stderr || e.message || e).slice(0, 300)}`);
  }

  return { fixed: true, rebased: true };
}

/**
 * 自动合并：就绪则 squash 立即合；否则启用 --auto 排队，并轮询到 MERGED。
 */
async function autoMerge(branch, opts) {
  const b = bareBranch(branch);
  const pr = prJson(b);

  if (opts.dryRun) {
    if (!pr) {
      warn(`[DRY-RUN] 未找到 PR（实际执行会失败）。请先: gh pr create --base main`);
    } else {
      info(`[DRY-RUN] PR #${pr.number} state=${pr.state} mergeable=${pr.mergeable}`);
    }
    if (opts.noMerge) {
      info("[DRY-RUN] --no-merge：跳过合并，仅在已 MERGED 时允许清理");
      return { merged: pr?.state === "MERGED", already: pr?.state === "MERGED", dryRun: true };
    }
    info("[DRY-RUN] gh pr merge --squash（或 --squash --auto）");
    info(`[DRY-RUN] 轮询至 MERGED（timeout=${opts.timeoutSec}s）`);
    return { merged: true, already: false, dryRun: true };
  }

  if (!pr) {
    die(`未找到分支 ${b} 的 PR。请先: gh pr create --base main`);
  }
  info(`PR #${pr.number} ${pr.url} state=${pr.state} mergeable=${pr.mergeable} status=${pr.mergeStateStatus}`);

  if (pr.state === "MERGED") {
    ok("PR 已合并");
    return { merged: true, already: true };
  }
  if (pr.state !== "OPEN") {
    die(`PR 状态为 ${pr.state}，无法合并`);
  }

  if (opts.noMerge) {
    die("PR 尚未合并且指定了 --no-merge；无法清理未合并分支");
  }

  // 尝试立即合并；失败则启用 auto-merge
  let queued = false;
  try {
    run(`gh pr merge ${pr.number} --squash --delete-branch`, { silent: false });
    ok("已 squash 合并");
  } catch {
    info("立即合并未就绪，启用 --auto 排队 ...");
    try {
      run(`gh pr merge ${pr.number} --squash --auto --delete-branch`, {
        silent: false,
      });
      ok("已启用 auto-merge 排队");
      queued = true;
    } catch (e) {
      const msg = String(e.stderr || e.message || e).slice(0, 400);
      die(`自动合并失败: ${msg}`);
    }
  }

  // 等待 MERGED
  const deadline = Date.now() + opts.timeoutSec * 1000;
  const interval = queued ? 15000 : 3000;
  while (Date.now() < deadline) {
    const cur = prJson(b);
    if (cur?.state === "MERGED") {
      ok(`PR #${pr.number} 已合并`);
      return { merged: true, already: false };
    }
    if (cur?.state && cur.state !== "OPEN") {
      die(`PR 状态异常: ${cur.state}`);
    }
    info(
      `等待合并完成 ... state=${cur?.state || "?"} mergeStateStatus=${cur?.mergeStateStatus || "?"}（剩余 ${Math.max(0, Math.floor((deadline - Date.now()) / 1000))}s）`,
    );
    await sleep(interval);
  }
  die(`等待合并超时（${opts.timeoutSec}s）。PR 可能仍在排队 auto-merge。`);
}

/**
 * 合并完成后清理 worktree + 本地分支。
 * 安全：默认要求 PR MERGED 或 tip 已是 origin/main 祖先。
 */
function cleanupAfterMerge(branch, opts = {}) {
  const b = bareBranch(branch);
  if (!b || b === "main" || b === "master") {
    die("禁止清理 main/master");
  }

  info(`清理目标分支: ${b}`);

  if (!opts.dryRun) {
    run("git fetch origin --prune", { silent: true, allowFail: true });
  }

  const merged = isMergedIntoMain(b);
  if (!merged && !opts.force) {
    die(
      `分支 ${b} 尚未确认 PR MERGED。拒绝清理。\n  可用: node scripts/worktree/worktree.mjs land ${b}`,
    );
  }
  if (merged) ok("已确认 PR MERGED");
  else if (opts.force) warn("跳过 PR 状态检查（land 已确认合并 / dry-run / force）");

  const wtPath = wtPathFor(b);

  // 若当前 shell 落在即将删除的 worktree 内，先 chdir 到主仓，避免删脚下目录
  const cwd = process.cwd();
  if (cwd === wtPath || cwd.startsWith(wtPath + "/")) {
    info(`当前目录位于目标 worktree，切换到主仓: ${ROOT}`);
    if (!opts.dryRun) {
      try {
        process.chdir(ROOT);
      } catch (e) {
        warn(`chdir 主仓失败: ${String(e.message || e).slice(0, 120)}`);
      }
    }
  }

  // 1) remove worktree
  if (existsSync(wtPath)) {
    info(`移除 worktree: ${wtPath}`);
    if (opts.dryRun) {
      info(`[DRY-RUN] git worktree remove '${wtPath}' --force`);
    } else {
      try {
        git(`worktree remove '${wtPath}' --force`, { silent: false });
        ok(`Worktree 已删除: ${b}`);
      } catch (e) {
        warn(`worktree remove 失败，尝试 prune: ${String(e.message || e).slice(0, 200)}`);
        git("worktree prune", { silent: true, allowFail: true });
      }
    }
  } else {
    info("worktree 目录不存在，跳过 remove");
  }

  // 2) delete local branch（从主仓执行；不可删当前检出分支）
  const headMain = gitOut("rev-parse --abbrev-ref HEAD", { allowFail: true });
  if (branchExistsLocal(b)) {
    if (headMain === b) {
      warn(`主仓当前仍在 ${b}，先切到 main 再删分支`);
      if (!opts.dryRun) {
        try {
          git("checkout main", { silent: false });
        } catch {
          die(`无法 checkout main 以删除分支 ${b}`);
        }
      } else {
        info("[DRY-RUN] git checkout main");
      }
    }
    info(`删除本地分支: ${b}`);
    if (opts.dryRun) {
      info(`[DRY-RUN] git branch -d '${b}'`);
    } else {
      try {
        git(`branch -d '${b}'`, { silent: false });
        ok(`本地分支已删除: ${b}`);
      } catch {
        // 已合并到 origin/main 但 git 本地未识别时用 -D
        try {
          git(`branch -D '${b}'`, { silent: false });
          ok(`本地分支已强制删除: ${b}`);
        } catch (e) {
          warn(`删除本地分支失败: ${String(e.message || e).slice(0, 200)}`);
        }
      }
    }
  } else {
    info("本地分支不存在，跳过");
  }

  // 3) optional remote
  if (opts.deleteRemote) {
    info(`删除远程分支 origin/${b} ...`);
    if (opts.dryRun) {
      info(`[DRY-RUN] git push origin --delete '${b}'`);
    } else {
      try {
        git(`push origin --delete '${b}'`, { silent: false });
        ok("远程分支已删除");
      } catch {
        warn("远程分支删除失败（可能已被 PR --delete-branch 删掉）");
      }
    }
  }

  // 4) prune
  if (opts.dryRun) {
    info("[DRY-RUN] git worktree prune && git fetch --prune");
  } else {
    git("worktree prune", { silent: true, allowFail: true });
    git("fetch origin --prune", { silent: true, allowFail: true });
    ok("已 prune worktree / 远程引用");
  }

  return true;
}

async function cmdLand(argv) {
  const opts = parseLandArgs(argv);
  let branch = opts.branch || resolveBranchFromCwd();
  if (!branch) {
    die("无法推断分支。用法: worktree.mjs land <branch>");
  }
  branch = bareBranch(branch);
  if (branch === "main" || branch === "master") {
    die("禁止对 main/master 执行 land");
  }

  console.log(`\n=== worktree land: ${branch} ===`);
  info(`主仓: ${ROOT}`);
  info(`worktree: ${wtPathFor(branch)}`);
  if (opts.dryRun) info("模式: DRY-RUN");

  // Phase 1: auto-fix
  console.log("\n--- 1/3 自动修复 ---");
  autoFix(branch, opts);

  // Phase 2: auto-merge
  console.log("\n--- 2/3 自动合并 ---");
  const mergeResult = await autoMerge(branch, opts);

  // Phase 3: cleanup（合并成功或 dry-run 演示时强制进入清理步骤）
  console.log("\n--- 3/3 清理 worktree + 本地分支 ---");
  const allowCleanup =
    !!mergeResult?.merged || !!mergeResult?.already || !!opts.dryRun;
  if (!allowCleanup) {
    die("合并未完成，跳过清理（worktree 与本地分支保留）");
  }
  cleanupAfterMerge(branch, {
    dryRun: opts.dryRun,
    deleteRemote: opts.deleteRemote,
    // land 刚确认 merged / dry-run 演示：允许清理，不再二次查 PR
    force: true,
  });

  console.log(`\n✓ land 完成: ${branch}\n`);
}

function cmdCleanup(argv) {
  const opts = parseLandArgs(argv);
  let branch = opts.branch || resolveBranchFromCwd();
  if (!branch) die("无法推断分支。用法: worktree.mjs cleanup <branch>");
  branch = bareBranch(branch);
  console.log(`\n=== worktree cleanup: ${branch} ===`);
  cleanupAfterMerge(branch, {
    dryRun: opts.dryRun,
    deleteRemote: opts.deleteRemote,
    force: false,
  });
  console.log(`\n✓ cleanup 完成: ${branch}\n`);
}

// ── CLI ───────────────────────────────────────────────────
const cmd = process.argv[2];
const arg = process.argv[3];

switch (cmd) {
  case "create": {
    if (!arg) die("usage: worktree.mjs create <branch>");
    const branch = bareBranch(arg);
    const wtPath = wtPathFor(branch);
    mkdirSync(WT_BASE, { recursive: true });
    // 嵌套目录（feat/x）需先建父目录
    mkdirSync(dirname(wtPath), { recursive: true });
    execSync("git fetch origin", { cwd: ROOT, stdio: "inherit" });
    git(`worktree add '${wtPath}' -b '${branch}' origin/main`);
    console.log(`Worktree 已创建`);
    console.log(`  cd ${wtPath}      # 或: wt ${branch}`);
    break;
  }

  case "go": {
    if (!arg) die("usage: worktree.mjs go <branch>");
    const wtPath = wtPathFor(arg);
    if (existsSync(wtPath)) {
      console.log(wtPath);
    } else {
      console.error(`ERROR: worktree 不存在: ${arg}`);
      git("worktree list", { silent: true });
      process.exit(1);
    }
    break;
  }

  case "list": {
    console.log("Worktrees:");
    const list = gitOut("worktree list");
    for (const line of list.split("\n")) {
      if (!line.trim()) continue;
      const [path] = line.split(/\s+/);
      if (path === ROOT) {
        console.log(`  [main]  ${path}`);
      } else {
        const short = path.startsWith(WT_BASE + "/")
          ? path.slice(WT_BASE.length + 1)
          : path;
        console.log(`  [${short}]  ${path}`);
      }
    }
    break;
  }

  case "remove": {
    if (!arg) die("usage: worktree.mjs remove <branch>");
    const branch = bareBranch(arg);
    const wtPath = wtPathFor(branch);
    if (existsSync(wtPath)) {
      git(`worktree remove '${wtPath}' --force`);
      console.log(`Worktree 已删除: ${branch}`);
    } else {
      console.error(`ERROR: worktree 不存在: ${branch}`);
      process.exit(1);
    }
    break;
  }

  case "prune": {
    git("worktree prune");
    console.log("已清理过期 worktree");
    break;
  }

  case "current": {
    git("worktree list", { silent: true });
    break;
  }

  case "land": {
    await cmdLand(process.argv.slice(3));
    break;
  }

  case "cleanup": {
    cmdCleanup(process.argv.slice(3));
    break;
  }

  default:
    printUsage();
    process.exit(1);
}
