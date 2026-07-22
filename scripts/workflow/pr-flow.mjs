#!/usr/bin/env node
/**
 * pr-flow.mjs — PR 全生命周期自动化
 *
 * 职责: 从门禁、审查、推送、CI 到清理的全流程 PR 自动化。
 *
 * 用法:
 *   node scripts/workflow/pr-flow.mjs [选项]
 *
 * 选项:
 *   --dry-run        仅输出计划，不执行实际操作
 *   --skip-review    跳过代码审查阶段
 *   --auto-merge     审查通过后自动合并
 *   --label <label>  为 PR 添加标签（可重复）
 *   --reviewer <user> 指定审查者（可重复）
 *   --help           显示帮助信息
 *
 * SSOT: docs/constitution/06-governance.md §6.0 / docs/governance/worktree-policy.md
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const REVIEWS_DIR = join(ROOT, ".claude", "reviews");

// ── 参数解析 ──────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    dryRun: false,
    skipReview: false,
    autoMerge: false,
    labels: [],
    reviewers: [],
    help: false,
  };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--skip-review":
        opts.skipReview = true;
        break;
      case "--auto-merge":
        opts.autoMerge = true;
        break;
      case "--label":
        if (i + 1 >= argv.length) die("--label 缺少参数");
        opts.labels.push(argv[++i]);
        break;
      case "--reviewer":
        if (i + 1 >= argv.length) die("--reviewer 缺少参数");
        opts.reviewers.push(argv[++i]);
        break;
      case "--help":
        opts.help = true;
        break;
      default:
        if (arg.startsWith("-")) die(`未知选项: ${arg}`);
        break;
    }
    i++;
  }
  return opts;
}

// ── 颜色输出 ──────────────────────────────────────────────
const style = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function color(c, text) {
  return `${c}${text}${style.reset}`;
}

function header(text) {
  console.log(`\n${color(style.bold + style.cyan, "=== " + text + " ===")}`);
}

function ok(msg) {
  console.log(`  ${color(style.green, "✓")} ${msg}`);
}

function warn(msg) {
  console.log(`  ${color(style.yellow, "⚠")} ${msg}`);
}

function err(msg) {
  console.log(`  ${color(style.red, "✗")} ${msg}`);
}

function info(msg) {
  console.log(`  ${color(style.dim, "→")} ${msg}`);
}

function die(msg, code = 1) {
  console.error(color(style.red, "ERROR: ") + msg);
  process.exit(code);
}

// ── 辅助函数 ──────────────────────────────────────────────
function git(cmd, opts = {}) {
  try {
    return execSync(`git -C ${ROOT} ${cmd}`, {
      encoding: "utf8",
      stdio: opts.silent ? "pipe" : "inherit",
      ...opts,
    }).trim();
  } catch (e) {
    if (opts.allowFail) return "";
    throw e;
  }
}

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: opts.silent ? "pipe" : "inherit",
      ...opts,
    }).trim();
  } catch (e) {
    if (opts.allowFail) return "";
    throw e;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentBranch() {
  return git("rev-parse --abbrev-ref HEAD", { silent: true });
}

function generatePrTitle(branch) {
  // feat/xxx → feat: xxx
  // fix/xxx → fix: xxx
  // chore/xxx → chore: xxx
  // docs/xxx → docs: xxx
  // refactor/xxx → refactor: xxx
  // test/xxx → test: xxx
  const match = branch.match(/^(feat|fix|chore|docs|refactor|test|perf|ci|style|build)\/(.+)/);
  if (match) {
    return `${match[1]}: ${match[2]}`;
  }
  // 其他格式: 原样使用
  return branch;
}

function generatePrBody(branch, opts = {}) {
  const title = generatePrTitle(branch);
  const commits = git(`log origin/main...HEAD --oneline --no-merges`, { silent: true, allowFail: true }) || "";
  const commitList = commits
    .split("\n")
    .filter(Boolean)
    .map((c) => `- ${c}`)
    .join("\n");

  const reviewerSection = opts.reviewers && opts.reviewers.length > 0
    ? `\n\n审查者: ${opts.reviewers.join(", ")}`
    : "";

  const dryRunNote = opts.dryRun ? "\n\n> ⚠️ 此 PR 由 --dry-run 生成，尚未推送。" : "";

  return [
    `## 概述`,
    ``,
    `${title}`,
    ``,
    `## 变更`,
    ``,
    commitList || `_无提交记录_`,
    ``,
    `## 检查清单`,
    ``,
    `- [ ] cargo fmt --check 通过`,
    `- [ ] cargo clippy 通过`,
    `- [ ] cargo test 通过`,
    `- [ ] cargo doc 通过`,
    `- [ ] harness check 通过`,
    reviewerSection,
    dryRunNote,
  ].join("\n");
}

// ── Phase 1: 门禁 ─────────────────────────────────────────
async function phaseGate(opts) {
  header("Phase 1: 门禁检查");
  if (opts.dryRun) {
    info("[DRY-RUN] 将运行: cargo fmt --check, clippy, test, doc, harness check");
    return true;
  }

  const steps = [
    { name: "cargo fmt --check", cmd: "cargo fmt --all --check", error: "格式化检查失败" },
    { name: "cargo clippy", cmd: "cargo clippy --workspace --all-features --all-targets -- -D warnings", error: "Clippy 检查失败" },
    { name: "cargo test", cmd: "cargo test --workspace", error: "测试失败" },
    { name: "cargo doc", cmd: "cargo doc --workspace --no-deps --document-private-items", error: "文档生成失败" },
    { name: "harness check", cmd: "node scripts/quality-gates/check.mjs", error: "Harness 检查失败" },
  ];

  for (const step of steps) {
    info(step.name + " ...");
    try {
      run(step.cmd, { silent: true });
      ok(step.name + " 通过");
    } catch (e) {
      err(step.name + " 失败");
      const stderr = String(e.stderr || e.message || "").slice(0, 500);
      console.error(stderr);
      die(step.error);
    }
  }
  return true;
}

// ── Phase 2: 审查 ─────────────────────────────────────────
async function phaseReview(opts) {
  header("Phase 2: 代码审查");
  if (opts.dryRun) {
    info("[DRY-RUN] 将检查 diff 中的调试残留并生成审查报告");
    return true;
  }

  const branch = currentBranch();
  info(`当前分支: ${branch}`);

  // Diff
  const diff = git(`diff origin/main...HEAD`, { silent: true, allowFail: true });
  if (!diff) {
    warn("无 diff（可能已同步到 main）");
  }

  // 调试残留检测
  info("检查调试残留 ...");
  const residuePatterns = [
    { pattern: /dbg!\(/g, name: "dbg!()" },
    { pattern: /eprintln!\(/g, name: "eprintln!()" },
    { pattern: /console\.log\(/g, name: "console.log()" },
    { pattern: /debugger\b/g, name: "debugger" },
    { pattern: /\bTODO\b/g, name: "TODO" },
    { pattern: /\bFIXME\b/g, name: "FIXME" },
  ];

  const residues = [];
  for (const rp of residuePatterns) {
    const matches = diff.match(rp.pattern);
    if (matches) {
      residues.push({ name: rp.name, count: matches.length });
    }
  }

  // 生成审查报告
  mkdirSync(REVIEWS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = join(REVIEWS_DIR, `review-${branch.replace(/\//g, "-")}-${timestamp}.md`);

  const reportLines = [
    `# PR 审查报告`,
    ``,
    `**分支**: ${branch}`,
    `**时间**: ${new Date().toISOString()}`,
    `**标题**: ${generatePrTitle(branch)}`,
    ``,
    `## 调试残留`,
    ``,
  ];

  if (residues.length > 0) {
    reportLines.push(`发现 ${residues.length} 类调试残留:`);
    for (const r of residues) {
      reportLines.push(`- **${r.name}**: ${r.count} 处`);
      warn(`${r.name}: ${r.count} 处`);
    }
  } else {
    reportLines.push(`未检测到调试残留。`);
    ok("未检测到调试残留");
  }

  reportLines.push(``);
  reportLines.push(`## Diff 统计`);
  reportLines.push(``);

  const diffStat = git(`diff origin/main...HEAD --stat`, { silent: true, allowFail: true }) || "（无变更）";
  reportLines.push("```");
  reportLines.push(diffStat);
  reportLines.push("```");

  const content = reportLines.join("\n");
  writeFileSync(reportPath, content, "utf8");
  ok(`审查报告已写入: ${reportPath}`);

  return true;
}

// ── Phase 3: 推送 + 创建 PR ───────────────────────────────
async function phasePushCreate(opts) {
  header("Phase 3: 推送并创建 PR");
  const branch = currentBranch();
  const title = generatePrTitle(branch);
  const body = generatePrBody(branch, opts);

  info(`分支: ${branch}`);
  info(`PR 标题: ${title}`);

  if (opts.dryRun) {
    info("[DRY-RUN] 将执行:");
    info(`  git push -u origin ${branch}`);
    info(`  gh pr create --title '${title}' --body '...' --base main`);
    if (opts.labels.length > 0) info(`  Labels: ${opts.labels.join(", ")}`);
    if (opts.reviewers.length > 0) info(`  Reviewers: ${opts.reviewers.join(", ")}`);
    return true;
  }

  // Push
  info("推送分支 ...");
  try {
    git(`push -u origin ${branch}`);
    ok("推送成功");
  } catch (e) {
    const stderr = String(e.stderr || e.message || "").slice(0, 300);
    die(`推送失败: ${stderr}`);
  }

  // Create PR
  info("创建 PR ...");
  const labelArgs = opts.labels.length > 0 ? `--label '${opts.labels.join(",")}'` : "";
  const reviewerArgs = opts.reviewers.length > 0 ? `--reviewer '${opts.reviewers.join(" ")}'` : "";
  const prCmd = `gh pr create --title "${title}" --body "${body.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" --base main ${labelArgs} ${reviewerArgs}`;
  try {
    const prUrl = run(prCmd, { silent: true });
    ok(`PR 已创建: ${prUrl}`);
    return prUrl;
  } catch (e) {
    const stderr = String(e.stderr || e.message || "").slice(0, 500);
    die(`PR 创建失败: ${stderr}`);
  }
}

// ── Phase 4: CI + 合并 ────────────────────────────────────
// 返回 { merged: boolean } — 仅在真正 MERGED 后为 true
async function phaseCiMerge(opts) {
  header("Phase 4: CI 等待 + 合并");
  if (opts.dryRun) {
    info("[DRY-RUN] 将轮询 gh pr checks 并自动合并");
    if (opts.autoMerge) {
      info("[DRY-RUN] 将调用: node scripts/worktree/worktree.mjs land <branch>");
      info("[DRY-RUN] land = 自动修复 + 自动合并 + 清理 worktree/本地分支");
      return { merged: true, cleaned: true, dryRun: true };
    }
    return { merged: false, dryRun: true };
  }

  const branch = currentBranch();
  info(`等待 CI 检查通过 (分支: ${branch}) ...`);

  // 轮询 CI
  const maxPollSeconds = 30 * 60; // 30 min
  const pollInterval = 30; // 30s
  let elapsed = 0;

  while (elapsed < maxPollSeconds) {
    try {
      const result = run(`gh pr checks`, { silent: true, allowFail: true }) || "";
      if (result.includes("pass") && !result.includes("fail") && !result.includes("pending") && !result.includes("in_progress")) {
        ok("CI 检查全部通过");
        break;
      }
    } catch {
      // gh pr checks exits non-zero when checks fail
    }

    info(`等待中 ... (${elapsed}s / ${maxPollSeconds}s)`);
    await sleep(pollInterval * 1000);
    elapsed += pollInterval;
  }

  if (elapsed >= maxPollSeconds) {
    die(`CI 检查超时 (${maxPollSeconds}s)`);
  }

  // 尝试自动审批
  info("尝试自动审批 ...");
  const approvePath = join(__dirname, "approve.mjs");
  if (existsSync(approvePath)) {
    try {
      run(`node '${approvePath}'`, { silent: true });
      ok("自动审批已调用");
    } catch {
      warn("自动审批失败（非致命）");
    }
  } else {
    warn("approve.mjs 不存在，跳过自动审批");
  }

  // 合并
  if (!opts.autoMerge) {
    warn("未启用 --auto-merge，跳过自动合并与清理");
    return { merged: false };
  }

  info("自动合并（委托 worktree land）...");
  // land：自动修复落后 main + squash/auto 合并 + 等待 MERGED + 清理 worktree/本地分支
  // 使用 --timeout 与本 phase 对齐；不在此再做 cleanup 以免重复
  try {
    run(
      `node scripts/worktree/worktree.mjs land '${branch}' --timeout ${maxPollSeconds}`,
      { silent: false },
    );
    ok("land 完成（已合并并清理）");
    return { merged: true, cleaned: true };
  } catch (e) {
    const stderr = String(e.stderr || e.message || "").slice(0, 400);
    die(`自动合并/清理失败: ${stderr}`);
  }
}

// ── Phase 5: 清理 ─────────────────────────────────────────
// 若 phaseCiMerge 已通过 land 清理，则跳过；否则仅在已合并时 cleanup
async function phaseCleanup(opts, mergeResult = {}) {
  header("Phase 5: 清理");
  const branch = currentBranch();

  if (mergeResult.cleaned) {
    ok("已在 land 阶段完成 worktree / 本地分支清理");
    return true;
  }

  if (!opts.autoMerge && !mergeResult.merged) {
    warn("未合并，跳过清理（保留 worktree 与本地分支）");
    return true;
  }

  if (opts.dryRun) {
    info(`[DRY-RUN] 将执行:`);
    info(`  node scripts/worktree/worktree.mjs cleanup ${branch}`);
    return true;
  }

  // 安全护栏：不在 main 上执行清理
  if (branch === "main") {
    die("禁止在 main 分支上执行清理操作");
  }

  info("委托 worktree cleanup（确认已合并后删 worktree + 本地分支）...");
  try {
    run(`node scripts/worktree/worktree.mjs cleanup '${branch}'`, { silent: false });
    ok("Worktree 与本地分支已清理");
  } catch (e) {
    const msg = String(e.stderr || e.message || e).slice(0, 300);
    die(`清理失败: ${msg}`);
  }

  return true;
}

// ── help ──────────────────────────────────────────────────
function showHelp() {
  console.log(`pr-flow.mjs — PR 全生命周期自动化

用法:
  node scripts/workflow/pr-flow.mjs [选项]

选项:
  --dry-run          仅输出计划，不执行实际操作
  --skip-review      跳过代码审查阶段
  --auto-merge       审查通过后自动合并
  --label <label>    为 PR 添加标签（可重复）
  --reviewer <user>  指定审查者（可重复）
  --help             显示帮助信息

阶段:
  1. 门禁 — cargo fmt / clippy / test / doc / harness check
  2. 审查 — diff 检查 + 调试残留检测 + 审查报告
  3. 推送 + 创建 PR — git push + gh pr create
  4. CI + 合并 — 轮询 CI + 自动审批 + worktree land（修复/合并/清理）
  5. 清理 — 若 land 未清理则调用 worktree cleanup

合并后清理（worktree.mjs land / cleanup）:
  - 自动修复：落后 origin/main 时 rebase + push
  - 自动合并：gh pr merge --squash / --auto，等待 MERGED
  - 清理：remove worktree + 删除本地分支 + prune

示例:
  node scripts/workflow/pr-flow.mjs --dry-run
  node scripts/workflow/pr-flow.mjs --auto-merge --reviewer alice --label enhancement
  node scripts/workflow/pr-flow.mjs --skip-review --dry-run
  node scripts/worktree/worktree.mjs land feat/my-branch
`);
}

// ── 主入口 ────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    showHelp();
    process.exit(0);
  }

  const branch = currentBranch();
  info(`PR Flow 启动 — 分支: ${branch}`);

  try {
    // Phase 1: Gate
    if (!(await phaseGate(opts))) {
      die("门禁检查失败");
    }

    // Phase 2: Review
    if (!opts.skipReview) {
      if (!(await phaseReview(opts))) {
        die("代码审查失败");
      }
    } else {
      header("Phase 2: 代码审查 (已跳过)");
    }

    // Phase 3: Push + Create PR
    if (!(await phasePushCreate(opts))) {
      die("推送 / PR 创建失败");
    }

    // Phase 4: CI + Merge（--auto-merge 时委托 worktree land）
    const mergeResult = await phaseCiMerge(opts);
    if (!mergeResult) {
      die("CI / 合并失败");
    }

    // Phase 5: Cleanup（land 已清理则跳过）
    if (!(await phaseCleanup(opts, mergeResult))) {
      die("清理失败");
    }

    console.log(color(style.green, `\n✓ PR Flow 完成 — ${branch}`));
  } catch (e) {
    err(`PR Flow 中断: ${e.message || e}`);
    process.exit(1);
  }
}

// Run
main().catch((e) => {
  err(`未捕获错误: ${e.message || e}`);
  process.exit(1);
});
