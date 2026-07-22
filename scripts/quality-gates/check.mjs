#!/usr/bin/env node
/**
 * check.mjs — Harness 健康检查
 *
 * 职责: 验证开发环境就绪状态 (hooks / skills / beads / worktree-policy)。
 *
 * 用法:
 *   node scripts/quality-gates/check.mjs
 *
 * SSOT: .claude/hooks/ / .agents/ssot/SSOT.md
 */
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, dirname, isAbsolute, resolve } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import {
  describePrePushHookFailure,
  inspectPrePushHook,
} from "../docs/git-hook-policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

const checks = [];

const ok = (name, pass, hint = "") => {
  checks.push({ name, ok: Boolean(pass), hint: pass ? "" : hint });
};

const exists = (rel) => existsSync(join(root, rel));
const read = (rel) => {
  try {
    return readFileSync(join(root, rel), "utf8");
  } catch {
    return "";
  }
};

const run = (cmd, timeoutMs = 8000) => {
  try {
    return execSync(cmd, {
      cwd: root,
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    return String(error.stderr || error.message || "").trim();
  }
};

// ── 核心文档 ──────────────────────────────────────────────
ok("CLAUDE.md 存在", exists("CLAUDE.md"), "缺少 CLAUDE.md");
ok("AGENTS.md 存在", exists("AGENTS.md"), "缺少 AGENTS.md");
ok("README.md 存在", exists("README.md"), "缺少 README.md");
ok(".gitignore 排除 .claude/*.local.json", read(".gitignore").includes(".claude/*.local.json"), "敏感配置未被 gitignore");
ok(".gitignore 排除 .beads/", read(".gitignore").includes(".beads/"), "Beads 数据目录应被忽略");

// ── Hooks ─────────────────────────────────────────────────
const requiredHooks = [
  "pre-tool-check.mjs",
  "post-tool-check.mjs",
  "pre-compact.mjs",
  "session-context.mjs",
  "session-review.mjs",
  "edit-guard.mjs",
  "count-guard.mjs",
  "branch-protect.mjs",
  "version-guard.mjs",
];
const hooksDir = join(root, ".claude/hooks");
const hooksPresent = existsSync(hooksDir)
  ? new Set(readdirSync(hooksDir).filter((f) => f.endsWith(".mjs") || f.endsWith(".cjs")))
  : new Set();
for (const h of requiredHooks) {
  ok(`Hook 文件: ${h}`, hooksPresent.has(h), `缺失 .claude/hooks/${h}`);
}

// 活动 Git pre-push 可能来自全局 core.hooksPath。只在 hook 含 Beads managed
// block 时检查组合可达性；CI 没有本地 hook 时保持可复现。
const configuredHooksPath = run("git config --path core.hooksPath 2>/dev/null");
const gitCommonDir = run("git rev-parse --git-common-dir 2>/dev/null");
const hooksBase = configuredHooksPath
  ? isAbsolute(configuredHooksPath)
    ? configuredHooksPath
    : resolve(root, configuredHooksPath)
  : gitCommonDir
    ? resolve(root, gitCommonDir, "hooks")
    : "";
const activePrePushPath = hooksBase ? join(hooksBase, "pre-push") : "";
if (activePrePushPath && existsSync(activePrePushPath)) {
  const activePrePush = readFileSync(activePrePushPath, "utf8");
  const result = inspectPrePushHook(activePrePush);
  if (result.hasBeadsIntegration) {
    ok("活动 pre-push hook 组合健康", result.ok, describePrePushHookFailure(result));
  } else {
    ok("活动 pre-push hook 无 Beads managed block（跳过组合检查）", true);
  }
} else {
  ok("未配置活动 pre-push hook（跳过组合检查）", true);
}

const settings = read(".claude/settings.json");
let settingsJson = null;
try {
  settingsJson = JSON.parse(settings);
} catch {
  settingsJson = null;
}
ok(".claude/settings.json 可解析", Boolean(settingsJson), "settings.json JSON 无效");
const hookEvents = settingsJson?.hooks || {};
for (const event of ["PreToolUse", "PostToolUse", "SessionStart", "Stop", "PreCompact"]) {
  ok(`settings 注册 ${event}`, Array.isArray(hookEvents[event]) && hookEvents[event].length > 0, `未注册 ${event}`);
}

// ── Scripts 依赖 ──────────────────────────────────────────
ok("scripts/worktree/worktree-policy.mjs", exists("scripts/worktree/worktree-policy.mjs"), "hooks 依赖 worktree-policy");
ok("scripts/harness/gc-scan.mjs", exists("scripts/harness/gc-scan.mjs"), "session-review / RSI 依赖 gc-scan");
ok("scripts/quality-gates/check.mjs", exists("scripts/quality-gates/check.mjs"), "自身");
ok(
  "scripts/quality-gates/check-settings-hooks.mjs",
  exists("scripts/quality-gates/check-settings-hooks.mjs"),
  "settings hook 格式门禁缺失",
);
ok(
  "scripts/quality-gates/check-crate-versions.mjs",
  exists("scripts/quality-gates/check-crate-versions.mjs"),
  "crates 独立版本门禁脚本缺失",
);
ok("scripts/quality-gates/check-workspace-deps.mjs", exists("scripts/quality-gates/check-workspace-deps.mjs"), "依赖集中管理门禁脚本缺失");

// crates/ 独立版本 + path version 对齐（VERSIONING.md R-C1/R-C2）
const crateVersionsCheck = run(
  "node scripts/quality-gates/check-crate-versions.mjs 2>&1",
  120000,
);
ok(
  "crates 独立版本门禁",
  /\bPASS\b/.test(crateVersionsCheck) && !/\bFAIL\b/.test(crateVersionsCheck),
  crateVersionsCheck.slice(0, 400) || "node scripts/quality-gates/check-crate-versions.mjs 失败",
);

// 依赖集中管理门禁（禁止内联第三方 version；与 validation.yml workspace-deps job 同源）
const wsDepsCheck = run("node scripts/quality-gates/check-workspace-deps.mjs 2>&1", 60000);
ok(
  "依赖集中管理门禁",
  wsDepsCheck.includes("PASS") && !wsDepsCheck.includes("FAIL"),
  wsDepsCheck.slice(0, 400) || "node scripts/quality-gates/check-workspace-deps.mjs 失败",
);

// settings.json nice/timeout/fail-closed 门禁（与 validation.yml settings-hooks job 同源）
const settingsHooksCheck = run("node scripts/quality-gates/check-settings-hooks.mjs 2>&1", 15000);
ok(
  "settings hooks nice/timeout 门禁",
  settingsHooksCheck.includes("All settings commands pass") && !/\bFAIL\b/.test(settingsHooksCheck),
  settingsHooksCheck.slice(0, 240) || "node scripts/quality-gates/check-settings-hooks.mjs 失败",
);

// worktree-policy 可导入 + 单元自检 + 硬门禁源码存在
let worktreeImportOk = false;
try {
  await import(join(root, "scripts/worktree/worktree-policy.mjs"));
  worktreeImportOk = true;
} catch (error) {
  worktreeImportOk = false;
  ok("worktree-policy 可导入", false, String(error.message || error));
}
if (worktreeImportOk) ok("worktree-policy 可导入", true);

const preToolSrc = read(".claude/hooks/pre-tool-check.mjs");
ok(
  "pre-tool-check 含 worktree 硬门禁",
  preToolSrc.includes("evaluateEditPath") && preToolSrc.includes("worktree 硬门禁"),
  "pre-tool-check.mjs 缺少 evaluateEditPath / 硬门禁文案",
);
ok(
  "session-context 指引 worktree.mjs create",
  read(".claude/hooks/session-context.mjs").includes("worktree.mjs create"),
  "session-context 应引导 node scripts/worktree/worktree.mjs create",
);

const policyTest = run("node scripts/worktree/worktree-policy.test.mjs 2>&1");
ok(
  "worktree-policy 单元自检",
  /all passed/.test(policyTest) && !/FAIL/.test(policyTest),
  policyTest.slice(0, 400) || "node scripts/worktree/worktree-policy.test.mjs 失败",
);

// ── Harness 状态 ──────────────────────────────────────────
const harnessStatePath = ".claude/.harness-state";
if (exists(harnessStatePath)) {
  try {
    const state = JSON.parse(read(harnessStatePath));
    ok("harness-state 字段完整", Boolean(state.phase && state.mode), "需要 phase 与 mode");
  } catch {
    ok("harness-state 可解析", false, "JSON 无效");
  }
} else {
  ok("harness-state 存在", false, "缺少 .claude/.harness-state，将在首次 SessionStart 时创建或需手动初始化");
}

// ── Beads ─────────────────────────────────────────────────
const bdWhere = run("bd where 2>&1");
ok("Beads 已初始化", !/no beads database found/i.test(bdWhere) && bdWhere.length > 0, "运行 bd init");
const bdVersion = run("bd version 2>&1");
ok("bd CLI 可用", /bd version|version/i.test(bdVersion) || bdVersion.length > 0, "安装 beads CLI");

// ── Skills / Cargo SSOT ───────────────────────────────────
ok(".claude/skills/ 存在", exists(".claude/skills"), "技能 SSOT 缺失");
const skillCount = exists(".claude/skills")
  ? readdirSync(join(root, ".claude/skills"), { withFileTypes: true }).filter((d) => d.isDirectory()).length
  : 0;
ok(`技能数量 ≥ 10（当前 ${skillCount}）`, skillCount >= 10, "技能库异常稀疏");
ok(".cargo/config.toml 存在", exists(".cargo/config.toml"), "下游 Cargo SSOT 缺失");

// ── Git 分支护栏提示 ──────────────────────────────────────
const branch = run("git rev-parse --abbrev-ref HEAD 2>/dev/null") || "unknown";
ok("不在 detached HEAD", branch !== "HEAD", "当前 detached HEAD");
// main 仅提示，不 fail（初始化 root commit 合法落在 main）
if (branch === "main") {
  checks.push({
    name: "当前在 main（提示）",
    ok: true,
    hint: "日常开发请切 feature 分支；main 受保护",
  });
} else {
  ok(`当前分支: ${branch}`, true);
}

// ── docs/status 自动生成矩阵 ──────────────────────────────
// 扫描/生成脚本可能 >8s（冷盘/CI）；status 类检查单独放宽
const statusCheck = run("node scripts/docs/gen-docs-status.mjs --check 2>&1", 20000);
ok(
  "docs status matrix 新鲜",
  !statusCheck.includes("FAIL") && (statusCheck.includes("OK") || statusCheck.includes("up to date")),
  statusCheck.slice(0, 240) || "node scripts/docs/gen-docs-status.mjs --check 失败",
);

// ── crates 进度看板 STATUS.md ─────────────────────────────
const crateStatusCheck = run("node scripts/docs/gen-crate-status.mjs --check 2>&1", 30000);
ok(
  "STATUS.md crates 看板新鲜",
  !crateStatusCheck.includes("FAIL") &&
    (crateStatusCheck.includes("OK") || crateStatusCheck.includes("up to date")),
  crateStatusCheck.slice(0, 240) || "node scripts/docs/gen-crate-status.mjs --check 失败",
);

// ── 输出 ──────────────────────────────────────────────────
const failed = checks.filter((c) => !c.ok);
const passed = checks.filter((c) => c.ok);

console.log("\n=== infra.rs Harness Health Check ===");
console.log(`分支: ${branch}`);
console.log(`通过: ${passed.length}/${checks.length}\n`);

for (const c of checks) {
  const mark = c.ok ? "PASS" : "FAIL";
  console.log(`${mark}: ${c.name}${c.hint ? ` — ${c.hint}` : ""}`);
}

if (failed.length > 0) {
  console.log(`\n结果: FAIL (${failed.length} 项失败)`);
  process.exit(1);
}

console.log("\n结果: PASS");
process.exit(0);
