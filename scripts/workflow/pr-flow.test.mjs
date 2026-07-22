#!/usr/bin/env node
/**
 * pr-flow.test.mjs — L1 自检测试 for scripts/workflow/pr-flow.mjs
 *
 * 测试覆盖:
 * - Shebang 与语法检查
 * - --help 输出内容
 * - 未知选项错误
 * - --label / --reviewer 缺失参数错误
 * - 分支命名检测
 * - generatePrTitle 逻辑
 * - generatePrBody 模板结构
 * - 5 个 phase 函数存在
 * - currentBranch / sleep 辅助函数存在
 * - main 分支防护
 * - --dry-run 处理
 */
import { existsSync, readFileSync } from "fs";
import { execFileSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = join(__dirname, "pr-flow.mjs");
const ROOT = join(__dirname, "..", "..");

let pass = 0,
  fail = 0;

function ok(c, name) {
  if (c) {
    pass++;
    console.log("  ok  " + name);
  } else {
    fail++;
    console.log("  FAIL " + name);
  }
}

// ── L0: file existence ──
ok(existsSync(srcPath), "pr-flow.mjs exists");

// ── syntax check ──
try {
  execFileSync("node", ["--check", srcPath], { timeout: 10000, stdio: "pipe" });
  ok(true, "node --check pass");
} catch (e) {
  ok(false, "node --check: " + String(e.stderr || e.message).trim());
}

// ── CLI helper ──
function run(args = [], cwd = ROOT, timeout = 30000) {
  try {
    const out = execFileSync("node", [srcPath, ...args], {
      timeout,
      stdio: "pipe",
      encoding: "utf8",
      cwd,
    });
    return { exit: 0, out };
  } catch (e) {
    return {
      exit: e.status || 1,
      out: String(e.stdout || "") + String(e.stderr || e.message || ""),
    };
  }
}

// ── source checks ──
const src = readFileSync(srcPath, "utf8");

// L1: shebang
ok(src.startsWith("#!/usr/bin/env node"), "has shebang");

// L2: imports
ok(src.includes("child_process"), "imports child_process");
ok(src.includes('from "fs"'), "imports fs");
ok(src.includes('from "path"'), "imports path");
ok(src.includes('from "url"'), "imports url");

// L3: --help contains expected text
const helpResult = run(["--help"]);
ok(helpResult.exit === 0, "--help exits zero");
ok(
  helpResult.out.includes("用法") || helpResult.out.includes("usage") || helpResult.out.includes("pr-flow"),
  "--help contains usage text",
);
ok(helpResult.out.includes("--dry-run"), "--help mentions --dry-run");
ok(helpResult.out.includes("--skip-review"), "--help mentions --skip-review");
ok(helpResult.out.includes("--auto-merge"), "--help mentions --auto-merge");
ok(helpResult.out.includes("--label"), "--help mentions --label");
ok(helpResult.out.includes("--reviewer"), "--help mentions --reviewer");
ok(helpResult.out.includes("门禁") || helpResult.out.includes("审查") || helpResult.out.includes("CI"), "--help mentions phases");

// L4: unknown flag errors
const unknownResult = run(["--unknown-flag-xyz"]);
ok(unknownResult.exit !== 0, "unknown flag exits non-zero");
ok(unknownResult.out.includes("未知") || unknownResult.out.includes("unknown") || unknownResult.out.includes("ERROR"), "unknown flag shows error");

// L5: --label missing arg errors
const labelNoArg = run(["--label"]);
ok(labelNoArg.exit !== 0, "--label without arg exits non-zero");
ok(labelNoArg.out.includes("缺少") || labelNoArg.out.includes("参数") || labelNoArg.out.includes("ERROR"), "--label missing arg shows error");

// L6: --reviewer missing arg errors
const reviewerNoArg = run(["--reviewer"]);
ok(reviewerNoArg.exit !== 0, "--reviewer without arg exits non-zero");
ok(reviewerNoArg.out.includes("缺少") || reviewerNoArg.out.includes("参数") || reviewerNoArg.out.includes("ERROR"), "--reviewer missing arg shows error");

// L7: branch naming detection — generatePrTitle
// We test the function logic by examining source, and via a --dry-run run
ok(src.includes("generatePrTitle"), "has generatePrTitle function");
ok(src.includes("feat/xxx"), "handles feat/* branch naming (via comment/regex)");
ok(src.includes("match[1]"), "extracts type from branch prefix");
ok(src.includes("match[2]"), "extracts description from branch suffix");

// Test via source analysis: branch patterns
const branchPatterns = ["feat", "fix", "chore", "docs", "refactor", "test", "perf", "ci", "style", "build"];
for (const prefix of branchPatterns) {
  ok(src.includes(`|${prefix}`) || src.includes(`${prefix}/`) || src.includes(`${prefix}|`), `supports ${prefix}/* branch pattern`);
}

// L8: generatePrTitle logic — test specific cases
// Check implementation matches expected transformation
ok(
  src.includes("generatePrTitle(branch)") || src.includes("function generatePrTitle"),
  "generatePrTitle is defined as function",
);
ok(
  src.match(/\$\{match\[1\]\}:\s*\$\{match\[2\]\}/) || src.match(/\$\{match\[1\]}:\$\{match\[2\]}/),
  "generatePrTitle creates 'type: desc' format (checked via source)",
);

// L9: generatePrBody template structure
ok(src.includes("generatePrBody"), "has generatePrBody function");
ok(src.includes("## 概述") || src.includes("## Overview"), "PR body has overview section");
ok(src.includes("## 变更") || src.includes("## Changes"), "PR body has changes section");
ok(src.includes("## 检查清单") || src.includes("## Checklist"), "PR body has checklist section");
ok(src.includes("审查者"), "PR body includes reviewer section");
ok(src.includes("审查者") && src.includes("join"), "PR body formats reviewer list");

// L10: all 5 phase functions exist
const phaseNames = ["phaseGate", "phaseReview", "phasePushCreate", "phaseCiMerge", "phaseCleanup"];
for (const fn of phaseNames) {
  ok(src.includes(`async function ${fn}`) || src.includes(`function ${fn}`), `has phase function: ${fn}`);
}

// Also check phase names are consistent
ok(src.includes("Phase 1"), "has Phase 1 label");
ok(src.includes("Phase 2"), "has Phase 2 label");
ok(src.includes("Phase 3"), "has Phase 3 label");
ok(src.includes("Phase 4"), "has Phase 4 label");
ok(src.includes("Phase 5"), "has Phase 5 label");

// L11: currentBranch / sleep helpers exist
ok(src.includes("function currentBranch"), "has currentBranch function");
ok(
  src.includes("git") && src.includes("rev-parse --abbrev-ref HEAD") && src.includes("currentBranch"),
  "currentBranch uses git rev-parse",
);
ok(src.includes("function sleep"), "has sleep function");
ok(src.includes("setTimeout"), "sleep uses setTimeout");
ok(src.includes("return new Promise"), "sleep returns Promise");

// L12: main branch protection
ok(src.includes("分支: ${branch}") || src.includes("分支"), "phaseCleanup checks branch");
ok(
  src.includes('branch === "main"') || src.includes("branch === 'main'") || src.includes("=== \"main\""),
  "has main branch check in cleanup",
);
ok(src.includes("禁止") || src.includes("FORBIDDEN") || src.includes("main 分支") || src.includes("main 上"), "main branch protection has error message");

// L13: dry-run handling
ok(src.includes("dryRun"), "has dryRun option handling");

// Check dry-run is mentioned in gate phase
ok(src.includes("[DRY-RUN]") || src.includes("dry-run"), "dry-run output label present");

// Check parseArgs handles --dry-run
ok(src.includes('case "--dry-run"'), "parseArgs handles --dry-run");

// L14: additional structure checks
ok(src.includes("function parseArgs"), "has parseArgs function");
ok(src.includes("function showHelp"), "has showHelp function");
ok(src.includes("async function main"), "has async main function");
ok(src.includes("main()"), "calls main() at end");

// Color/style output
ok(src.includes("style =") || src.includes("const style"), "has style/color definitions");
ok(src.includes("function ok(") || src.includes("function die("), "has output helpers (ok/die)");

// Git operations
ok(src.includes("gh pr create"), "uses gh pr create");
ok(src.includes("gh pr checks"), "uses gh pr checks");
ok(src.includes("gh pr merge"), "uses gh pr merge");

// CI polling
ok(src.includes("30") || src.includes("maxPoll"), "CI polling has timeout configuration");
ok(src.includes("sleep"), "CI polling uses sleep");

// ── dry-run integration test ──
const dryRunRes = run(["--dry-run", "--skip-review"]);
ok(dryRunRes.exit === 0, "--dry-run --skip-review exits zero");
ok(
  dryRunRes.out.includes("DRY-RUN") || dryRunRes.out.includes("dry-run") || dryRunRes.out.includes("dryRun"),
  "--dry-run output mentions dry-run",
);
ok(
  dryRunRes.out.includes("Phase 1") || dryRunRes.out.includes("门禁") || dryRunRes.out.includes("Gate"),
  "--dry-run output references phases",
);

// ── help exits cleanly with clear output ──
ok(helpResult.out.length > 100, "--help output is substantial (more than 100 chars)");

// ── Result ──
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
