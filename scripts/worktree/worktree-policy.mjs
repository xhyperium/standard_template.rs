#!/usr/bin/env node
/**
 * worktree-policy.mjs — Git Worktree 路径策略与审计
 *
 * 职责: 定义 worktree 路径规范、提供合规判定和旧格式审计。
 *
 * 规范: .worktrees/<branch> (分支 / 保留为目录分隔符)
 *   - 与 worktree.mjs / worktree-activate.mjs 约定一致
 *
 * 审计: 检测 workspaces/ 子目录和 ~/.worktrees/ 全局旧格式残留
 *
 * 使用者: .claude/hooks/pre-tool-check.mjs / session-context.mjs
 *
 * SSOT: docs/constitution/06-governance.md §6.0.5 / docs/governance/worktree-policy.md
 */

import { resolve, basename, relative } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import { execFileSync } from "child_process";

// ── 常量 ────────────────────────────────────

/** 人读规则说明 */
export const WORKTREE_PATH_RULE = ".worktrees/<branch-name>";

/**
 * 紧急绕过环境变量（仅人工 maintainer）。
 * 设为 `1` 时 pre-tool-check 跳过 worktree 硬门禁。
 */
export const WORKTREE_BYPASS_ENV = "STANDARD_TEMPLATE_WORKTREE_BYPASS";

/** 旧路径模式关键词（审计时匹配） */
const LEGACY_WORKSPACES_SEGMENT = "workspaces";

// ── 路径工具 ────────────────────────────────

/**
 * 剥离 refs/heads/ 前缀，保留原始分支名含 `/`。
 */
export function bareBranch(branchName) {
  return String(branchName || "")
    .replace(/^refs\/heads\//, "")
    .trim();
}

/**
 * 返回规范 worktree 根目录（`.worktrees`）。
 */
export function worktreeBasePath(projectRoot) {
  return resolve(projectRoot, ".worktrees");
}

/**
 * 从任意路径（含 worktree 内路径）解析主仓根目录。
 * - 路径含 `/.worktrees/` → 取其前缀为主仓
 * - 否则返回规范化后的 fromPath（调用方应传入 hooks 推导的 toplevel）
 *
 * 例:
 *   .../infra.rs/.worktrees/feat/x/.claude/hooks → .../infra.rs
 *   .../infra.rs/.claude/hooks → 调用方应先 join 到 .../infra.rs 再传入
 */
export function resolveMainProjectRoot(fromPath) {
  const abs = resolve(fromPath || ".");
  const needle = "/.worktrees/";
  const idx = abs.indexOf(needle);
  if (idx >= 0) return abs.slice(0, idx);
  return abs;
}

/**
 * 返回规范 worktree 绝对路径。
 */
export function canonicalWorktreePath(projectRoot, branchName) {
  return resolve(projectRoot, ".worktrees", bareBranch(branchName));
}

/**
 * child 是否位于 parent 之下（含等于 parent）。
 */
export function isPathInside(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  return c === p || c.startsWith(p + "/");
}

/**
 * 从 CWD 推断当前所在的 worktree 名称（含 `/`），
 * 若不在任何 worktree 下则返回 null。
 */
export function detectWorktreeFromCwd({ projectRoot, cwd }) {
  const wtBase = worktreeBasePath(projectRoot);
  const resolvedCwd = resolve(cwd ?? process.cwd());
  if (!isPathInside(resolvedCwd, wtBase) || resolvedCwd === resolve(wtBase)) return null;
  return resolvedCwd.slice(wtBase.length + 1); // e.g. "feat/login"
}

/**
 * 当前 git 顶层是否为主仓（main 工作区），而非 `.worktrees/*`。
 */
export function isMainWorkspaceTopLevel(projectRoot, topLevel) {
  if (!topLevel) return false;
  return resolve(topLevel) === resolve(projectRoot);
}

/**
 * 判断路径是否被 git ignore（含目录规则与否定规则）。
 * 使用 `git check-ignore`；无法判定时返回 false（偏保守，走 worktree 门禁）。
 */
export function isGitIgnored(projectRoot, filePath) {
  if (!projectRoot || !filePath) return false;
  const root = resolve(projectRoot);
  const abs = resolve(root, filePath);
  if (!isPathInside(abs, root)) return false;

  // 相对路径对 check-ignore 更稳定；保留 `.` 表示根
  let rel = relative(root, abs);
  if (!rel || rel.startsWith("..")) return false;
  // git 在 Windows 上也能吃 `/`；统一正斜杠
  rel = rel.split("\\").join("/");

  try {
    execFileSync("git", ["-C", root, "check-ignore", "-q", "--", rel], {
      stdio: "ignore",
      timeout: 3000,
    });
    return true; // exit 0 = ignored
  } catch {
    return false; // exit 1 或命令失败 = 不视为 ignored
  }
}

/**
 * Write/Edit 目标路径是否允许。
 *
 * 放行：
 * - 紧急 bypass
 * - 仓外路径
 * - `.worktrees/<branch>/...` 内路径
 * - **被 .gitignore 匹配的路径**（本地配置 / 构建产物 / beads 等）
 *
 * 拒绝：主仓内被跟踪（或未被 ignore）的源码与文档。
 *
 * @param {{ projectRoot: string, filePath?: string, bypass?: boolean, isIgnored?: (fullPath: string) => boolean }} opts
 * @returns {{ allowed: boolean, fullPath: string, reason?: string, fixHint?: string }}
 */
export function evaluateEditPath({ projectRoot, filePath, bypass = false, isIgnored }) {
  const fullPath = filePath ? resolve(projectRoot, filePath) : "";
  if (bypass) {
    return { allowed: true, fullPath, reason: "bypass" };
  }
  if (!filePath) {
    return { allowed: true, fullPath };
  }

  const root = resolve(projectRoot);
  const wtBase = worktreeBasePath(projectRoot);

  // 仓外路径不归本策略管
  if (!isPathInside(fullPath, root)) {
    return { allowed: true, fullPath };
  }

  // 必须落在 .worktrees/<branch>/... 下（活跃开发）
  if (isPathInside(fullPath, wtBase) && fullPath !== wtBase) {
    return { allowed: true, fullPath };
  }

  // .gitignore 覆盖的路径为例外（本地状态、缓存、密钥类本地文件等）
  // 注：.env 等仍可由 pre-tool-check 的 PROTECTED_FILES 单独拦截
  const ignored =
    typeof isIgnored === "function" ? Boolean(isIgnored(fullPath)) : isGitIgnored(root, fullPath);
  if (ignored) {
    return { allowed: true, fullPath, reason: "gitignored" };
  }

  return {
    allowed: false,
    fullPath,
    reason: "edit-outside-worktree",
    fixHint:
      "node scripts/worktree/worktree.mjs create <type>/<id>-<slug> && cd .worktrees/<type>/<id>-<slug>",
  };
}

/**
 * 主工作区内禁止的 git 分支操作（创建/切换功能分支）。
 * 允许：worktree add、checkout/switch main|master、文件还原等。
 *
 * @returns {{ blocked: boolean, kind?: string, message?: string }}
 */
export function evaluateMainWorkspaceGitCommand(command) {
  const cmd = String(command || "");
  if (!cmd.trim()) return { blocked: false };

  // 允许 git worktree *
  if (/\bgit\s+worktree\b/.test(cmd)) {
    return { blocked: false };
  }

  // 禁止在主仓创建功能分支
  if (/\bgit\s+checkout\s+-b\b/.test(cmd) || /\bgit\s+switch\s+-c\b/.test(cmd)) {
    return {
      blocked: true,
      kind: "branch-create-on-main-workspace",
      message:
        "禁止在 main 工作区创建功能分支。请使用：node scripts/worktree/worktree.mjs create <type>/<slug>",
    };
  }

  // 禁止在主仓 switch/checkout 到非 main 分支（保留文件还原语法）
  // git switch <branch>  /  git checkout <branch>
  // 不匹配：git checkout -- file, git checkout -p, git switch - , git checkout HEAD -- file
  const switchMatch = cmd.match(/\bgit\s+switch\s+(?:--detach\s+)?([^\s-]\S*)/);
  if (switchMatch) {
    const ref = switchMatch[1];
    if (ref !== "main" && ref !== "master" && ref !== "-") {
      return {
        blocked: true,
        kind: "branch-switch-on-main-workspace",
        message: `禁止在 main 工作区切换到分支 \`${ref}\`。请：node scripts/worktree/worktree.mjs create ${ref} 或 cd 已有 .worktrees/${ref}`,
      };
    }
  }

  // git checkout <branch> — 排除 -b/-B/-- / -p / --ours 等选项形式与路径还原
  const checkoutMatch = cmd.match(
    /\bgit\s+checkout\s+(?!-b\b|-B\b|--\b|-p\b)([^\s-][^\s]*)/,
  );
  if (checkoutMatch) {
    const ref = checkoutMatch[1];
    // 跳过明显是路径或 rev 文件操作：含 / 且像路径、或以 . 开头
    const looksLikePath =
      ref.startsWith("./") || ref.startsWith("../") || /\.[a-zA-Z0-9]+$/.test(ref);
    if (
      !looksLikePath &&
      ref !== "main" &&
      ref !== "master" &&
      ref !== "HEAD" &&
      ref !== "-"
    ) {
      return {
        blocked: true,
        kind: "branch-checkout-on-main-workspace",
        message: `禁止在 main 工作区 checkout 分支 \`${ref}\`。请使用 worktree：node scripts/worktree/worktree.mjs create ${ref}`,
      };
    }
  }

  return { blocked: false };
}

/**
 * 是否禁止在 main/master 上 commit。
 */
export function evaluateCommitOnMain(branchName, command) {
  const br = bareBranch(branchName);
  const cmd = String(command || "");
  if ((br === "main" || br === "master") && /\bgit\s+commit\b/.test(cmd)) {
    return {
      blocked: true,
      kind: "commit-on-main",
      message:
        "禁止在 main 上直接 commit。请先 node scripts/worktree/worktree.mjs create <type>/<slug> 再提交。",
    };
  }
  return { blocked: false };
}

/**
 * 环境变量是否请求绕过硬门禁。
 */
export function isWorktreeBypassEnabled(env = process.env) {
  return String(env?.[WORKTREE_BYPASS_ENV] || "") === "1";
}

// ── 合规判定 ────────────────────────────────

/**
 * 判断某分支检出路径是否符合规范。
 */
export function describeBranchWorktreePath({ root, branchName, actualPath }) {
  const expectedPath = canonicalWorktreePath(root, branchName);
  const resolvedRoot = resolve(root);
  const resolvedActual = actualPath ? resolve(actualPath) : "";
  const isRootCheckout = Boolean(resolvedActual) && resolvedActual === resolvedRoot;
  const compliant =
    Boolean(resolvedActual) && resolve(resolvedActual) === resolve(expectedPath);
  return { expectedPath, isRootCheckout, compliant };
}

// ── porcelain 解析 ──────────────────────────

export function parseWorktreePorcelain(text) {
  const registered = new Set();
  const branchToPath = new Map();
  const pathToBranch = new Map();
  const detachedPaths = [];
  const lockedPaths = new Set();

  let currentPath = null;
  let currentBranch = null;
  let isDetached = false;
  let isLocked = false;

  const flush = () => {
    if (!currentPath) return;
    registered.add(currentPath);
    if (isDetached) {
      detachedPaths.push(currentPath);
    } else if (currentBranch) {
      const br = currentBranch.replace(/^refs\/heads\//, "");
      branchToPath.set(br, currentPath);
      pathToBranch.set(currentPath, br);
    }
    if (isLocked) lockedPaths.add(currentPath);
    currentPath = null;
    currentBranch = null;
    isDetached = false;
    isLocked = false;
  };

  for (const raw of String(text || "").split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("worktree ")) {
      flush();
      currentPath = line.slice("worktree ".length).trim();
      continue;
    }
    if (line.startsWith("branch ")) {
      currentBranch = line.slice("branch ".length).trim();
      continue;
    }
    if (line === "detached") { isDetached = true; continue; }
    if (line === "locked" || line.startsWith("locked ")) { isLocked = true; continue; }
    if (line === "") flush();
  }
  flush();

  return { registered, branchToPath, pathToBranch, detachedPaths, lockedPaths };
}

// ── 审计 ────────────────────────────────────

/**
 * 全表审计已登记 worktree，找出路径偏离规范 v2 的项，
 * 并检测旧约定残留（`workspaces/` 子目录模式及全局 `~/.worktrees/`）。
 */
export function auditWorktreePaths({ root, worktreeState, homeDir }) {
  const nonCompliant = [];
  const legacyPaths = [];

  // 1. 分支路径不符合新规范 .worktrees/<branch>
  for (const [branch, path] of worktreeState.branchToPath || []) {
    const { expectedPath, isRootCheckout, compliant } = describeBranchWorktreePath({
      root,
      branchName: branch,
      actualPath: path,
    });
    if (!isRootCheckout && !compliant) {
      nonCompliant.push({ branch, path, expectedPath });
    }
  }

  // 2. workspaces/ 子目录旧模式残留
  const wtRoot = resolve(root, ".worktrees");
  const wsSubdir = resolve(wtRoot, LEGACY_WORKSPACES_SEGMENT);
  if (existsSync(wsSubdir)) {
    legacyPaths.push({
      path: wsSubdir,
      reason: "workspaces 子目录约定已废弃",
      migrate: `  mv '${wsSubdir}'/* '${wtRoot}/' && rmdir '${wsSubdir}'`,
    });
  }

  // 3. 全局旧路径 ~/.worktrees/<project>/
  const home = homeDir ?? homedir();
  if (home) {
    const projectName = basename(resolve(root));
    const globalLegacy = resolve(home, ".worktrees", projectName);
    if (existsSync(globalLegacy)) {
      legacyPaths.push({
        path: globalLegacy,
        reason: "全局 ~/.worktrees/ 约定已废弃",
        migrate: `  git worktree move "${globalLegacy}"-* 到 ${wtRoot}/<branch>`,
      });
    }
  }

  return { nonCompliant, legacyPaths };
}

// ── 格式化输出 ──────────────────────────────

/**
 * 审计结果 → 人读警告行。
 */
export function formatAuditWarning(audit) {
  if (!audit) return [];
  const lines = [];

  for (const { branch, path, expectedPath } of audit.nonCompliant || []) {
    lines.push(`   • 分支 ${branch} 工作区路径偏离规范 v2：`);
    lines.push(`      当前: ${path}`);
    lines.push(`      规范: ${expectedPath}`);
    lines.push(`      迁移: git worktree move '${path}' '${expectedPath}'`);
  }

  for (const { path, reason, migrate } of audit.legacyPaths || []) {
    lines.push(`   • 旧规范残留: ${path}`);
    lines.push(`     ${reason}`);
    lines.push(`     ${migrate}`);
  }

  return lines;
}
