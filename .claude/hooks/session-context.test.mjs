/**
 * session-context.test.mjs — L1 单元测试
 *
 * 覆盖 session-context.mjs 与 worktree-policy.mjs 中可独立测试的工具函数。
 * 不 mock git 子进程 — 所有测试均为纯函数 / 可控数据。
 *
 * 用法: node --check .claude/hooks/session-context.test.mjs && node .claude/hooks/session-context.test.mjs
 */

import { existsSync, readFileSync } from "fs";
import { resolve, join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../..");

const WORKTREE_POLICY_PATH = resolve(projectRoot, "scripts/worktree/worktree-policy.mjs");
const SESSION_CONTEXT_PATH = resolve(__dirname, "session-context.mjs");

// ── 测试框架 ────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

const assertEq = (actual, expected, label) => {
  const serialize = (v) => {
    if (v instanceof Map || v instanceof Set) return JSON.stringify([...v]);
    if (typeof v === "object" && v !== null) return JSON.stringify(v);
    return String(v);
  };
  const a = serialize(actual);
  const e = serialize(expected);
  if (a === e) passed++;
  else { failed++; failures.push({ label, actual, expected }); }
};

const assertOk = (cond, label) => {
  if (Boolean(cond)) passed++;
  else { failed++; failures.push({ label, actual: cond, expected: "truthy" }); }
};

const assertThrows = (fn, label) => {
  try { fn(); failed++; failures.push({ label, actual: "did not throw", expected: "should throw" });
  } catch { passed++; }
};

const test = (label, fn) => {
  try { fn(); } catch (err) {
    failed++;
    failures.push({ label, actual: String(err), expected: "no error" });
  }
};

// ── 一次性加载所有被测模块 ────────────────────

const POLICY = await import(WORKTREE_POLICY_PATH);

// worktree-policy.mjs 主要导出
const {
  parseWorktreePorcelain,
  WORKTREE_PATH_RULE,
  resolveMainProjectRoot,
  auditWorktreePaths,
  formatAuditWarning,
  bareBranch,
  worktreeBasePath,
  canonicalWorktreePath,
  isPathInside,
  describeBranchWorktreePath,
  isMainWorkspaceTopLevel,
  isWorktreeBypassEnabled,
  evaluateCommitOnMain,
} = POLICY;

// ── 测试 1: 文件存在性与导入可解析 ──────────

{
  console.log("=== 1. 文件存在性与导入可解析 ===");

  test("session-context.mjs 存在", () => {
    assertOk(existsSync(SESSION_CONTEXT_PATH), "session-context.mjs exists");
  });

  test("worktree-policy.mjs 存在", () => {
    assertOk(existsSync(WORKTREE_POLICY_PATH), "worktree-policy.mjs exists");
  });

  test("session-context.mjs 包含 ES module imports", () => {
    const content = readFileSync(SESSION_CONTEXT_PATH, "utf-8");
    assertOk(content.includes("import {"), "contains ES module imports");
  });

  test("session-context.mjs 导入 worktree-policy 的 6 个函数", () => {
    const content = readFileSync(SESSION_CONTEXT_PATH, "utf-8");
    const names = ["WORKTREE_PATH_RULE", "describeBranchWorktreePath",
      "parseWorktreePorcelain", "auditWorktreePaths",
      "formatAuditWarning", "resolveMainProjectRoot"];
    for (const name of names) {
      assertOk(content.includes(name), `imports ${name}`);
    }
  });

  test("模块导入后所有导出类型正确", () => {
    assertOk(typeof POLICY.parseWorktreePorcelain === "function", "parseWorktreePorcelain fn");
    assertOk(typeof POLICY.WORKTREE_PATH_RULE === "string", "WORKTREE_PATH_RULE str");
    assertOk(typeof POLICY.resolveMainProjectRoot === "function", "resolveMainProjectRoot fn");
    assertOk(typeof POLICY.auditWorktreePaths === "function", "auditWorktreePaths fn");
    assertOk(typeof POLICY.formatAuditWarning === "function", "formatAuditWarning fn");
    assertOk(typeof POLICY.bareBranch === "function", "bareBranch fn");
    assertOk(typeof POLICY.canonicalWorktreePath === "function", "canonicalWorktreePath fn");
    assertOk(typeof POLICY.describeBranchWorktreePath === "function", "describeBranchWorktreePath fn");
  });
}

// ── 测试 2: WORKTREE_PATH_RULE 常量 ──────────

{
  console.log("\n=== 2. WORKTREE_PATH_RULE 常量 ===");

  test("WORKTREE_PATH_RULE 非空字符串", () => {
    assertOk(typeof WORKTREE_PATH_RULE === "string" && WORKTREE_PATH_RULE.length > 0,
      "WORKTREE_PATH_RULE is non-empty string");
  });

  test("WORKTREE_PATH_RULE 包含 .worktrees/", () => {
    assertOk(WORKTREE_PATH_RULE.includes(".worktrees/"),
      "WORKTREE_PATH_RULE contains .worktrees/");
  });

  test("WORKTREE_PATH_RULE 为规范常量值", () => {
    assertEq(WORKTREE_PATH_RULE, ".worktrees/<branch-name>",
      "WORKTREE_PATH_RULE equals .worktrees/<branch-name>");
  });
}

// ── 测试 3: resolveMainProjectRoot ───────────

{
  console.log("\n=== 3. resolveMainProjectRoot ===");

  test("worktree 内路径 → 主仓根", () => {
    const result = resolveMainProjectRoot(
      "/home/user/infra.rs/.worktrees/feat/login/.claude/hooks");
    assertEq(result, "/home/user/infra.rs", "strips .worktrees/... suffix");
  });

  test("主仓内路径 → 自身", () => {
    const result = resolveMainProjectRoot("/home/user/infra.rs/.claude/hooks");
    assertEq(result, "/home/user/infra.rs/.claude/hooks",
      "returns same path when no .worktrees/");
  });

  test("嵌套 .worktrees 仅截取第一个", () => {
    const result = resolveMainProjectRoot(
      "/home/user/foo.worktrees/infra.rs/.worktrees/feat/x");
    assertEq(result, "/home/user/foo.worktrees/infra.rs",
      "stops at first .worktrees/");
  });

  test("路径不含 .worktrees/ → 返回规范化后自身", () => {
    // resolve("/tmp/some/path/../path/./other") → "/tmp/some/path/other"
    const input = "/tmp/some/path/../path/./other";
    const result = resolveMainProjectRoot(input);
    assertEq(result, resolve("/tmp/some/path/other"), "resolves and returns self");
  });

  test("空路径 → 当前目录", () => {
    const result = resolveMainProjectRoot("");
    const cwd = resolve(".");
    const needle = "/.worktrees/";
    const idx = cwd.indexOf(needle);
    const expected = idx >= 0 ? cwd.slice(0, idx) : cwd;
    assertEq(result, expected, "handles empty path");
  });

  test("undefined 路径 → 当前目录", () => {
    const result = resolveMainProjectRoot(undefined);
    const cwd = resolve(".");
    const needle = "/.worktrees/";
    const idx = cwd.indexOf(needle);
    const expected = idx >= 0 ? cwd.slice(0, idx) : cwd;
    assertEq(result, expected, "handles undefined path");
  });
}

// ── 测试 4: parseWorktreePorcelain ───────────

{
  console.log("\n=== 4. parseWorktreePorcelain ===");

  test("空文本 → 全部空集合", () => {
    const r = parseWorktreePorcelain("");
    assertEq(r.registered.size, 0, "registered empty");
    assertEq(r.branchToPath.size, 0, "branchToPath empty");
    assertEq(r.pathToBranch.size, 0, "pathToBranch empty");
    assertEq(r.detachedPaths.length, 0, "detachedPaths empty");
    assertEq(r.lockedPaths.size, 0, "lockedPaths empty");
  });

  test("undefined 文本 → 全部空集合", () => {
    const r = parseWorktreePorcelain(undefined);
    assertEq(r.registered.size, 0, "registered empty for undefined");
  });

  test("null 文本 → 全部空集合", () => {
    const r = parseWorktreePorcelain(null);
    assertEq(r.registered.size, 0, "registered empty for null");
  });

  test("单个分支 worktree (refs/heads/ 前缀)", () => {
    const porcelain = [
      "worktree /home/user/infra.rs",
      "HEAD abcd1234",
      "branch refs/heads/main",
      "",
    ].join("\n");
    const r = parseWorktreePorcelain(porcelain);
    assertEq(r.registered.size, 1, "one registered");
    assertOk(r.registered.has("/home/user/infra.rs"), "main path registered");
    assertEq(r.branchToPath.get("main"), "/home/user/infra.rs", "main → path");
    assertEq(r.pathToBranch.get("/home/user/infra.rs"), "main", "path → main");
    assertEq(r.detachedPaths.length, 0, "not detached");
    assertEq(r.lockedPaths.size, 0, "not locked");
  });

  test("多个分支 worktree", () => {
    const porcelain = [
      "worktree /home/user/infra.rs",
      "HEAD aaa111",
      "branch refs/heads/main",
      "",
      "worktree /home/user/infra.rs/.worktrees/feat/login",
      "HEAD bbb222",
      "branch refs/heads/feat/login",
      "",
      "worktree /home/user/infra.rs/.worktrees/fix/bug-42",
      "HEAD ccc333",
      "branch refs/heads/fix/bug-42",
      "",
    ].join("\n");
    const r = parseWorktreePorcelain(porcelain);
    assertEq(r.registered.size, 3, "three registered");
    assertEq(r.branchToPath.size, 3, "three branch→path");
    assertEq(r.pathToBranch.size, 3, "three path→branch");
    assertEq(r.branchToPath.get("main"), "/home/user/infra.rs");
    assertEq(r.branchToPath.get("feat/login"),
      "/home/user/infra.rs/.worktrees/feat/login");
    assertEq(r.branchToPath.get("fix/bug-42"),
      "/home/user/infra.rs/.worktrees/fix/bug-42");
  });

  test("detached HEAD worktree", () => {
    const porcelain = [
      "worktree /tmp/detached-wt",
      "HEAD deadbeef",
      "detached",
      "",
    ].join("\n");
    const r = parseWorktreePorcelain(porcelain);
    assertEq(r.registered.size, 1, "one registered");
    assertOk(r.registered.has("/tmp/detached-wt"));
    assertEq(r.detachedPaths.length, 1, "one detached");
    assertEq(r.detachedPaths[0], "/tmp/detached-wt");
    assertEq(r.branchToPath.size, 0, "no branch→path for detached");
    assertEq(r.pathToBranch.size, 0, "no path→branch for detached");
  });

  test("locked worktree", () => {
    const porcelain = [
      "worktree /home/user/infra.rs/.worktrees/feat/x",
      "HEAD fff999",
      "branch refs/heads/feat/x",
      "locked",
      "",
    ].join("\n");
    const r = parseWorktreePorcelain(porcelain);
    assertEq(r.lockedPaths.size, 1, "one locked");
    assertOk(r.lockedPaths.has("/home/user/infra.rs/.worktrees/feat/x"));
    assertEq(r.branchToPath.get("feat/x"),
      "/home/user/infra.rs/.worktrees/feat/x", "branch mapped when locked");
  });

  test("detached + locked worktree", () => {
    const porcelain = [
      "worktree /tmp/detached-locked",
      "HEAD abcabc",
      "detached",
      "locked",
      "",
    ].join("\n");
    const r = parseWorktreePorcelain(porcelain);
    assertEq(r.detachedPaths.length, 1, "detached");
    assertEq(r.lockedPaths.size, 1, "locked");
    assertOk(r.lockedPaths.has("/tmp/detached-locked"));
  });

  test("branch without refs/heads/ prefix", () => {
    const porcelain = [
      "worktree /home/user/.worktrees/my-branch",
      "HEAD xyz789",
      "branch my-branch",
      "",
    ].join("\n");
    const r = parseWorktreePorcelain(porcelain);
    assertEq(r.branchToPath.get("my-branch"),
      "/home/user/.worktrees/my-branch", "bare branch name mapped");
  });

  test("branch with refs/heads/ prefix 被剥离", () => {
    const porcelain = [
      "worktree /home/user/.worktrees/refs",
      "HEAD aaa111",
      "branch refs/heads/feat/test",
      "",
    ].join("\n");
    const r = parseWorktreePorcelain(porcelain);
    assertEq(r.branchToPath.get("feat/test"),
      "/home/user/.worktrees/refs", "refs/heads/ prefix stripped");
    assertOk(!r.branchToPath.has("refs/heads/feat/test"), "full prefix not stored");
  });

  test("locked 行带原因文本", () => {
    const porcelain = [
      "worktree /tmp/locked-reason",
      "HEAD bbb222",
      "branch refs/heads/feat/reason",
      "locked reason: some reason text",
      "",
    ].join("\n");
    const r = parseWorktreePorcelain(porcelain);
    assertEq(r.lockedPaths.size, 1, "locked with reason detected");
  });

  test("混合场景: 主仓 + detached + locked + feature", () => {
    const porcelain = [
      "worktree /home/user/infra.rs",        "HEAD mmm111",        "branch refs/heads/main",        "",
      "worktree /home/user/infra.rs/.worktrees/feat/a", "HEAD fff222", "branch refs/heads/feat/a", "",
      "worktree /home/user/infra.rs/.worktrees/detached-test", "HEAD ddd333", "detached", "",
      "worktree /home/user/infra.rs/.worktrees/locked-feat", "HEAD lll444",
      "branch refs/heads/feat/locked", "locked reason: CI running", "",
    ].join("\n");
    const r = parseWorktreePorcelain(porcelain);
    assertEq(r.registered.size, 4, "four registered");
    assertEq(r.detachedPaths.length, 1, "one detached");
    assertEq(r.lockedPaths.size, 1, "one locked");
    assertEq(r.branchToPath.size, 3, "three branch mappings");
    assertEq(r.pathToBranch.size, 3, "three path mappings");
    assertEq(r.branchToPath.get("main"), "/home/user/infra.rs");
    assertEq(r.branchToPath.get("feat/a"),
      "/home/user/infra.rs/.worktrees/feat/a");
    assertEq(r.branchToPath.get("feat/locked"),
      "/home/user/infra.rs/.worktrees/locked-feat");
    assertOk(r.lockedPaths.has("/home/user/infra.rs/.worktrees/locked-feat"));
  });

  test("末尾无空行也能 flush 最后一条", () => {
    const porcelain = [
      "worktree /home/user/infra.rs",
      "HEAD aaa111",
      "branch refs/heads/main",
    ].join("\n");
    const r = parseWorktreePorcelain(porcelain);
    assertEq(r.registered.size, 1, "captures last entry without trailing blank");
  });

  test("仅 worktree 行无 branch/detached 信息", () => {
    const porcelain = ["worktree /some/path", ""].join("\n");
    const r = parseWorktreePorcelain(porcelain);
    assertEq(r.registered.size, 1, "registered even without branch info");
    assertEq(r.branchToPath.size, 0, "no branch mapping");
    assertEq(r.detachedPaths.length, 0, "not detached");
  });
}

// ── 测试 5: auditWorktreePaths ───────────────

{
  console.log("\n=== 5. auditWorktreePaths ===");

  test("全部合规 → 空 nonCompliant / empty legacyPaths", () => {
    const root = "/home/user/infra.rs";
    const state = parseWorktreePorcelain([
      "worktree /home/user/infra.rs",                         "HEAD aaa", "branch refs/heads/main", "",
      "worktree /home/user/infra.rs/.worktrees/feat/login",  "HEAD bbb", "branch refs/heads/feat/login", "",
      "worktree /home/user/infra.rs/.worktrees/fix/bug",     "HEAD ccc", "branch refs/heads/fix/bug", "",
    ].join("\n"));
    const result = auditWorktreePaths({ root, worktreeState: state, homeDir: "/home/user" });
    assertEq(result.nonCompliant.length, 0, "no nonCompliant");
    assertEq(result.legacyPaths.length, 0, "no legacyPaths (no real dirs)");
  });

  test("不合规路径 → 检测出 nonCompliant", () => {
    const root = "/home/user/infra.rs";
    const state = parseWorktreePorcelain([
      "worktree /home/user/infra.rs",          "HEAD aaa", "branch refs/heads/main", "",
      "worktree /tmp/random-path",             "HEAD bbb", "branch refs/heads/feat/bad", "",
      "worktree /home/user/other-project/feat/x", "HEAD ccc", "branch refs/heads/feat/bad2", "",
    ].join("\n"));
    const result = auditWorktreePaths({ root, worktreeState: state, homeDir: "/home/user" });
    assertEq(result.nonCompliant.length, 2, "two non-compliant");
    const bad = result.nonCompliant.find(n => n.branch === "feat/bad");
    assertOk(Boolean(bad), "feat/bad detected");
    assertEq(bad.path, "/tmp/random-path");
    assertEq(bad.expectedPath, "/home/user/infra.rs/.worktrees/feat/bad");
  });

  test("主仓 root 检出 → 不算 nonCompliant", () => {
    const root = "/home/user/infra.rs";
    const state = parseWorktreePorcelain([
      "worktree /home/user/infra.rs", "HEAD aaa", "branch refs/heads/main", "",
    ].join("\n"));
    const result = auditWorktreePaths({ root, worktreeState: state, homeDir: "/home/user" });
    assertEq(result.nonCompliant.length, 0, "root checkout excluded");
  });

  test("legacyPaths: workspaces/ 子目录残留 (临时目录)", () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "wt-test-"));
    try {
      // .git 文件直接写在 tmpRoot
      writeFileSync(join(tmpRoot, ".git"), "gitdir: fake\n");
      // 创建 .worktrees/workspaces/ 目录结构
      const wtDir = join(tmpRoot, ".worktrees");
      const wsDir = join(wtDir, "workspaces");
      mkdirSync(wsDir, { recursive: true });
      writeFileSync(join(wtDir, "note.md"), "# wt\n");
      writeFileSync(join(wtDir, "v2.md"), "# v2\n");
      writeFileSync(join(wsDir, "dummy"), "x\n");

      const state = parseWorktreePorcelain("");
      const result = auditWorktreePaths({
        root: tmpRoot, worktreeState: state, homeDir: "/fake/home",
      });
      assertEq(result.legacyPaths.length, 1, "one legacy path (workspaces/)");
      const wsEntry = result.legacyPaths[0];
      assertOk(wsEntry.path.includes("workspaces"), "path contains workspaces");
      assertOk(wsEntry.reason.includes("废弃"), "reason mentions deprecation");
      assertOk(typeof wsEntry.migrate === "string" && wsEntry.migrate.length > 0,
        "migration hint present");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("legacyPaths: ~/.worktrees/ 全局旧路径 (真实临时目录)", () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "home-"));
    const tmpRoot = mkdtempSync(join(tmpdir(), "infra.rs-"));
    // auditWorktreePaths uses basename(resolve(root)) for projectName
    const projectName = basename(resolve(tmpRoot));
    const globalLegacyDir = join(tmpHome, ".worktrees", projectName);
    try {
      writeFileSync(join(tmpRoot, ".git"), "gitdir: fake\n", { flag: "wx" });
      mkdirSync(globalLegacyDir, { recursive: true });
      writeFileSync(join(globalLegacyDir, "some-file"), "x\n", { flag: "wx" });

      const state = parseWorktreePorcelain("");
      const result = auditWorktreePaths({
        root: tmpRoot, worktreeState: state, homeDir: tmpHome,
      });
      const foundGlobal = result.legacyPaths.some(
        p => p.path.includes(".worktrees") && p.reason.includes("~/.worktrees/"));
      assertOk(foundGlobal, "detects global ~/.worktrees/ legacy");
      // 注：此测试依赖文件系统模拟，在受限环境可能不通过
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
}

// ── 测试 6: formatAuditWarning ───────────────

{
  console.log("\n=== 6. formatAuditWarning ===");

  test("空审计结果 → 返回空数组", () => {
    assertEq(formatAuditWarning({ nonCompliant: [], legacyPaths: [] }), [],
      "empty → []");
  });

  test("undefined 字段 → 返回空数组", () => {
    assertEq(formatAuditWarning({}), [], "empty object → []");
  });

  test("null 参数 → 返回空数组（已防御）", () => {
    // formatAuditWarning 现在防御 null 输入，返回空数组
    const result = formatAuditWarning(null);
    assertEq(Array.isArray(result), true, "null → array");
    assertEq(result.length, 0, "null → 空数组");
  });

  test("单个 nonCompliant → 格式化正确", () => {
    const audit = {
      nonCompliant: [{ branch: "feat/bad", path: "/tmp/old-path",
        expectedPath: "/home/user/infra.rs/.worktrees/feat/bad" }],
      legacyPaths: [],
    };
    const lines = formatAuditWarning(audit);
    assertOk(lines.length >= 4, "at least 4 lines");
    assertOk(lines.some(l => l.includes("feat/bad")), "mentions branch");
    assertOk(lines.some(l => l.includes("/tmp/old-path")), "mentions actual path");
    assertOk(lines.some(l => l.includes(".worktrees/feat/bad")), "mentions expected path");
    assertOk(lines.some(l => l.includes("git worktree move")), "includes migration");
  });

  test("多个 nonCompliant → 逐个格式化", () => {
    const audit = {
      nonCompliant: [
        { branch: "feat/a", path: "/tmp/a", expectedPath: "/home/.worktrees/feat/a" },
        { branch: "feat/b", path: "/tmp/b", expectedPath: "/home/.worktrees/feat/b" },
      ],
      legacyPaths: [],
    };
    const lines = formatAuditWarning(audit);
    assertOk(lines.filter(l => l.includes("feat/a")).length > 0, "feat/a mentioned");
    assertOk(lines.filter(l => l.includes("feat/b")).length > 0, "feat/b mentioned");
  });

  test("legacyPaths → 格式化正确", () => {
    const audit = {
      nonCompliant: [],
      legacyPaths: [{
        path: "/home/user/.worktrees/infra.rs",
        reason: "全局 ~/.worktrees/ 约定已废弃",
        migrate: "  git worktree move ...",
      }],
    };
    const lines = formatAuditWarning(audit);
    assertOk(lines.length >= 3, "at least 3 lines");
    assertOk(lines.some(l => l.includes(".worktrees")), "mentions path");
    assertOk(lines.some(l => l.includes("废弃")), "mentions deprecation");
  });

  test("nonCompliant + legacyPaths 混合", () => {
    const audit = {
      nonCompliant: [{ branch: "feat/x", path: "/bad",
        expectedPath: "/home/user/.worktrees/feat/x" }],
      legacyPaths: [{
        path: "/home/user/infra.rs/.worktrees/workspaces",
        reason: "workspaces 子目录约定已废弃",
        migrate: "  mv ...",
      }],
    };
    const lines = formatAuditWarning(audit);
    assertOk(lines.some(l => l.includes("feat/x")), "nonCompliant entry present");
    assertOk(lines.some(l => l.includes("workspaces")), "legacy entry present");
  });
}

// ── 测试 7: session-context.mjs 语法检查 ─────

{
  console.log("\n=== 7. session-context.mjs 语法检查 ===");

  test("node --check 语法无错误", () => {
    try {
      execSync(`node --check "${SESSION_CONTEXT_PATH}"`,
        { encoding: "utf-8", timeout: 5000 });
      assertOk(true, "syntax check passed");
    } catch (err) {
      assertOk(false, `syntax error: ${err.stderr || err.message}`);
    }
  });
}

// ── 测试 8: worktree-policy.mjs 其他辅助函数 ─

{
  console.log("\n=== 8. worktree-policy.mjs 其他辅助函数 ===");

  test("bareBranch 剥离 refs/heads/ 前缀", () => {
    assertEq(bareBranch("refs/heads/feat/login"), "feat/login", "strips prefix");
    assertEq(bareBranch("feat/login"), "feat/login", "no-op");
    assertEq(bareBranch(""), "", "empty → empty");
    assertEq(bareBranch(undefined), "", "undefined → empty");
  });

  test("worktreeBasePath 返回绝对路径", () => {
    assertEq(worktreeBasePath("/home/user/infra.rs"),
      "/home/user/infra.rs/.worktrees", "correct base path");
  });

  test("canonicalWorktreePath 返回规范路径", () => {
    assertEq(canonicalWorktreePath("/home/user/infra.rs", "feat/login"),
      "/home/user/infra.rs/.worktrees/feat/login", "correct canonical path");
    assertEq(canonicalWorktreePath("/home/user/infra.rs", "refs/heads/feat/login"),
      "/home/user/infra.rs/.worktrees/feat/login", "strips refs/heads/ via bareBranch");
  });

  test("isPathInside 判断父子关系", () => {
    assertOk(isPathInside("/parent/child", "/parent"), "child inside parent");
    assertOk(isPathInside("/parent", "/parent"), "same path is inside");
    assertOk(!isPathInside("/other/deeply/nested", "/parent"), "unrelated not inside");
  });

  test("describeBranchWorktreePath 合规判定", () => {
    const r1 = describeBranchWorktreePath({
      root: "/home/user/infra.rs", branchName: "feat/login",
      actualPath: "/home/user/infra.rs/.worktrees/feat/login",
    });
    assertOk(r1.compliant, "correct path is compliant");
    assertEq(r1.expectedPath, "/home/user/infra.rs/.worktrees/feat/login");

    const r2 = describeBranchWorktreePath({
      root: "/home/user/infra.rs", branchName: "feat/bad",
      actualPath: "/tmp/elsewhere",
    });
    assertOk(!r2.compliant, "wrong path is not compliant");

    const r3 = describeBranchWorktreePath({
      root: "/home/user/infra.rs", branchName: "main",
      actualPath: "/home/user/infra.rs",
    });
    assertOk(r3.isRootCheckout, "root checkout detected");
    assertOk(!r3.compliant, "root checkout is special, not canonical compliant");
  });

  test("isMainWorkspaceTopLevel 判断", () => {
    assertOk(isMainWorkspaceTopLevel("/home/user/infra.rs", "/home/user/infra.rs"),
      "same → true");
    assertOk(!isMainWorkspaceTopLevel("/home/user/infra.rs",
      "/home/user/infra.rs/.worktrees/feat/x"), "worktree → false");
    assertOk(!isMainWorkspaceTopLevel("/home/user/infra.rs", ""), "empty → false");
    assertOk(!isMainWorkspaceTopLevel("/home/user/infra.rs", null), "null → false");
  });

  test("isWorktreeBypassEnabled 读取环境变量", () => {
    assertOk(!isWorktreeBypassEnabled({}), "no env var → false");
    assertOk(!isWorktreeBypassEnabled({ STANDARD_TEMPLATE_WORKTREE_BYPASS: "0" }), "0 → false");
    assertOk(isWorktreeBypassEnabled({ STANDARD_TEMPLATE_WORKTREE_BYPASS: "1" }), "1 → true");
    assertOk(!isWorktreeBypassEnabled({ STANDARD_TEMPLATE_WORKTREE_BYPASS: "" }), "empty → false");
  });

  test("evaluateCommitOnMain 阻止 main 上 commit", () => {
    const r1 = evaluateCommitOnMain("main", "git commit -m test");
    assertOk(r1.blocked, "commit on main blocked");
    assertEq(r1.kind, "commit-on-main");

    const r2 = evaluateCommitOnMain("master", "git commit -am test");
    assertOk(r2.blocked, "commit on master blocked");

    const r3 = evaluateCommitOnMain("feat/x", "git commit -m test");
    assertOk(!r3.blocked, "commit on feature branch allowed");

    const r4 = evaluateCommitOnMain("main", "git status");
    assertOk(!r4.blocked, "non-commit command allowed on main");
  });

  test("evaluateCommitOnMain 处理 refs/heads/ 前缀", () => {
    const r = evaluateCommitOnMain("refs/heads/main", "git commit -m x");
    assertOk(r.blocked, "refs/heads/main → commit blocked");
  });
}

// ── 测试 9: formatAuditWarning 不抛错 ==

{
  console.log("\n=== 9. formatAuditWarning 健壮性 ===");

  test("null nonCompliant → || [] 兜底，不抛错", () => {
    const result = formatAuditWarning({ nonCompliant: null, legacyPaths: [] });
    assertEq(result, [], "null nonCompliant → []");
  });

  test("null legacyPaths → || [] 兜底，不抛错", () => {
    const result = formatAuditWarning({ nonCompliant: [], legacyPaths: null });
    assertEq(result, [], "null legacyPaths → []");
  });

  test("audit 对象为 null → 返回空数组（不抛错）", () => {
    const result = formatAuditWarning(null);
    assertEq(result, [], "null → []");
  });

  test("audit 对象为 undefined → 返回空数组（不抛错）", () => {
    const result = formatAuditWarning(undefined);
    assertEq(result, [], "undefined → []");
  });
}

// ── 结果汇总 ────────────────────────────────

console.log("\n" + "=".repeat(60));
console.log(`结果: ${passed} passed, ${failed} failed (共 ${passed + failed} 项)`);

if (failures.length > 0) {
  console.log("\n失败清单:");
  for (const f of failures) {
    console.log(`  \u2717 ${f.label}`);
    console.log(`    实际: ${JSON.stringify(f.actual)}`);
    console.log(`    期望: ${JSON.stringify(f.expected)}`);
  }
  process.exit(1);
} else {
  console.log("所有测试通过 \u2713");
}
