import { execFileSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  WORKTREE_PATH_RULE,
  WORKTREE_BYPASS_ENV,
  canonicalWorktreePath,
  evaluateEditPath,
  evaluateMainWorkspaceGitCommand,
  evaluateCommitOnMain,
  isMainWorkspaceTopLevel,
  isWorktreeBypassEnabled,
  resolveMainProjectRoot,
} from "../../scripts/worktree/worktree-policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// hooks 可能从主仓或 .worktrees/<branch>/ 内加载；统一解析为主仓根
const projectRoot = resolveMainProjectRoot(join(__dirname, "../.."));

// 读取 Harness 状态
let harnessState = { phase: "build", mode: "full" };
const statePath = join(projectRoot, ".claude/.harness-state");
if (existsSync(statePath)) {
  try {
    harnessState = { ...harnessState, ...JSON.parse(readFileSync(statePath, "utf-8")) };
  } catch {}
}
const isTweak = harnessState.mode === "tweak";
const isDesign = harnessState.phase === "design";

const input = readFileSync(0, "utf-8").trim();
if (!input) process.exit(0);

let call;
try {
  call = JSON.parse(input);
} catch {
  process.exit(0);
}

const tool = call.tool || "";
const args = call.input || {};
const filePath = args.file_path || args.path || "";
const worktreeBypass = isWorktreeBypassEnabled(process.env);

const block = (reason) => {
  process.stdout.write(JSON.stringify({ block: true, reason }));
  process.exit(0);
};

const gitQuiet = (gitArgs, cwd = process.cwd()) => {
  try {
    return execFileSync("git", gitArgs, {
      encoding: "utf-8",
      timeout: 3000,
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const tokenizeShellCommand = (command) => {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const ch of command) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
};

const isBranchLikeRef = (ref) => {
  if (!ref) return false;
  try {
    execFileSync("git", ["check-ref-format", "--branch", ref], { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
};

const parseWorktreeAdd = (command) => {
  const tokens = tokenizeShellCommand(command);
  const gitIndex = tokens.indexOf("git");
  if (gitIndex < 0 || tokens[gitIndex + 1] !== "worktree" || tokens[gitIndex + 2] !== "add") {
    return null;
  }

  const wtArgs = tokens.slice(gitIndex + 3);
  const positional = [];
  let branch = null;
  let passthrough = false;

  for (let i = 0; i < wtArgs.length; i += 1) {
    const token = wtArgs[i];
    if (!passthrough && token === "--") {
      passthrough = true;
      continue;
    }
    if (!passthrough && (token === "-b" || token === "-B" || token === "--branch")) {
      branch = wtArgs[i + 1] || "";
      i += 1;
      continue;
    }
    if (!passthrough && token.startsWith("--branch=")) {
      branch = token.slice("--branch=".length);
      continue;
    }
    if (!passthrough && /^-[bB].+/.test(token)) {
      branch = token.slice(2);
      continue;
    }
    if (!passthrough && token.startsWith("-")) continue;
    positional.push(token);
  }

  return {
    path: positional[0] || "",
    commitish: positional[1] || "",
    branch,
  };
};

// 硬拦截：禁止 AI 直接修改 .env 文件（所有模式均生效）
const PROTECTED_FILES = [/(^|\/|\\)\.env$/, /(^|\/|\\)\.env\.local$/];

if (tool === "Write" || tool === "Edit") {
  // 相对路径按 process.cwd() 解析（worktree 内会话才能落到 .worktrees/**）
  const resolvedTarget = filePath
    ? filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath)
      ? resolve(filePath)
      : resolve(process.cwd(), filePath)
    : "";
  const isProtected = PROTECTED_FILES.some((p) => p.test(resolvedTarget));

  if (isProtected) {
    block(`🔒 安全拦截：禁止直接修改 ${filePath}。请手动编辑此文件。`);
  }

  // ── Worktree 硬门禁（CONSTITUTION §6.0.5）──
  // 主仓路径 Write/Edit 一律拦截；必须在 .worktrees/<branch>/ 内改文件。
  // 紧急绕过：STANDARD_TEMPLATE_WORKTREE_BYPASS=1（仅人工 maintainer）
  const editGate = evaluateEditPath({
    projectRoot,
    filePath: resolvedTarget || filePath,
    bypass: worktreeBypass,
  });
  if (!editGate.allowed) {
    block(
      `🧱 worktree 硬门禁：禁止在主工作区编辑仓库文件（CONSTITUTION §6.0.5 / docs/governance/worktree-policy.md）。\n` +
        `   目标: ${editGate.fullPath || filePath}\n` +
        `   规则: 所有活跃开发必须在 \`${WORKTREE_PATH_RULE}\` 内进行\n` +
        `   → 正确开工：\n` +
        `      node scripts/worktree.mjs create feat/<id>-<slug>\n` +
        `      cd .worktrees/feat/<id>-<slug>\n` +
        `   → 然后在该目录下编辑（文件路径须落在 worktree 内）\n` +
        `   → 紧急人工绕过（不推荐）：${WORKTREE_BYPASS_ENV}=1`,
    );
  }
}

// ISC-5: 分支命名 lint（不受 tweak/design 模式豁免，放在危险命令拦截块之外）
// CONSTITUTION §0.2.2 要求 {type}/{module}-{描述}；违规 block:true 并给改名建议
if (tool === "Bash" || tool === "PowerShell") {
  const cmd = args.command || "";
  let branchName = null;
  const c1 = cmd.match(/\bgit\s+(?:checkout\s+-b|switch\s+-c)\s+(\S+)/);
  if (c1) branchName = c1[1];
  if (!branchName) {
    const worktreeAdd = parseWorktreeAdd(cmd);
    if (worktreeAdd && worktreeAdd.branch) branchName = worktreeAdd.branch;
  }
  if (branchName) {
    const ALLOWED_BRANCH = /^(docs|feat|feature|fix|test|refactor|chore|governance|benchmark)\//;
    if (!ALLOWED_BRANCH.test(branchName)) {
      block(
        `🏷️ 分支命名违规：\`${branchName}\` 缺少 type/ 前缀（CONSTITUTION §0.2.2 要求 {type}/{module}-{描述}）。\n` +
          `   → 建议改名：feat/${branchName}\n` +
          `   → 合法前缀：docs/feat/feature/fix/test/refactor/chore/governance/benchmark\n` +
          `   → 正确创建：node scripts/worktree.mjs create feat/${branchName}`,
      );
    }
  }

  const worktreeAdd = parseWorktreeAdd(cmd);
  const attachedBranch =
    worktreeAdd &&
    (worktreeAdd.branch ||
      (isBranchLikeRef(worktreeAdd.commitish) ? worktreeAdd.commitish : null));
  if (worktreeAdd && attachedBranch && worktreeAdd.path) {
    const actualPath = resolve(projectRoot, worktreeAdd.path);
    const expectedPath = canonicalWorktreePath(projectRoot, attachedBranch);
    if (actualPath !== expectedPath) {
      block(
        `🧱 worktree 路径违规：\`git worktree add\` 创建分支附着工作区时，路径必须遵守 ${WORKTREE_PATH_RULE}。\n` +
          `   分支: ${attachedBranch}\n` +
          `   实际: ${actualPath}\n` +
          `   期望: ${expectedPath}\n` +
          `   → 请改为：git worktree add ${expectedPath} ${worktreeAdd.branch ? `-b ${attachedBranch}` : attachedBranch}\n` +
          `   → 或：node scripts/worktree.mjs create ${attachedBranch}`,
      );
    }
  }

  // ── 主工作区 git 操作硬门禁 ──
  // 禁止在 main 工作区 checkout -b / switch 功能分支；禁止 main 检出上 commit。
  // 注意：从主仓发起但命令内 cd/.worktrees 或 git -C .worktrees 的操作放行。
  if (!worktreeBypass) {
    const topLevel = gitQuiet(["rev-parse", "--show-toplevel"]);
    const headBranch = gitQuiet(["rev-parse", "--abbrev-ref", "HEAD"]);
    const onMainWorkspace = isMainWorkspaceTopLevel(projectRoot, topLevel);
    const cmdTargetsWorktree =
      /\.worktrees\//.test(cmd) || /\bgit\s+-C\s+['"]?[^'"\s]*\.worktrees\//.test(cmd);

    if (onMainWorkspace && !cmdTargetsWorktree) {
      const branchOp = evaluateMainWorkspaceGitCommand(cmd);
      if (branchOp.blocked) {
        block(
          `🧱 worktree 硬门禁：${branchOp.message}\n` +
            `   当前工作区: ${topLevel}（主仓）\n` +
            `   → node scripts/worktree.mjs create <type>/<slug>\n` +
            `   → cd .worktrees/<type>/<slug>`,
        );
      }

      const commitOp = evaluateCommitOnMain(headBranch, cmd);
      if (commitOp.blocked) {
        block(`🧱 ${commitOp.message}`);
      }
    }

    // 已在 worktree 内但 HEAD 仍为 main（异常状态）时也禁止 commit
    if (!onMainWorkspace) {
      const commitOp = evaluateCommitOnMain(headBranch, cmd);
      if (commitOp.blocked) {
        block(`🧱 ${commitOp.message}`);
      }
    }
  }

  // === stash pop/apply 跨基线告警（#5）===
  // 不阻塞（信息护栏，与 branch-protect.mjs 同策略）：检测 git stash pop|apply，
  // 若当前分支不在 stash 来源分支的祖先链上（基线偏离），stderr 告警可能冲突。
  const stashMatch = cmd.match(/\bgit\s+stash\s+(pop|apply)(?:\s+stash@\{(\d+)\})?/);
  if (stashMatch) {
    const stashIdx = stashMatch[2] || "0";
    try {
      const stashLine = execFileSync("git", ["stash", "list"], { encoding: "utf-8", timeout: 3000 });
      const target = stashLine.split("\n").find((l) => l.startsWith(`stash@{${stashIdx}}:`)) || "";
      const onMatch = target.match(/(?:On|WIP on) ([^:]+):/);
      const srcBranch = onMatch ? onMatch[1].trim() : "";
      const curBranch = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], {
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      if (srcBranch && curBranch && srcBranch !== curBranch) {
        let baseDiverged = true;
        try {
          execFileSync("git", ["merge-base", "--is-ancestor", curBranch, srcBranch], {
            stdio: "ignore",
            timeout: 3000,
          });
          baseDiverged = false;
        } catch {}
        if (baseDiverged) {
          console.error(
            `\n══════════════════════════════════════════════════════\n[StashGuard] ⚠️ stash 跨基线 pop 可能冲突\n\n  stash 来源分支: ${srcBranch}\n  当前分支: ${curBranch}\n  基线偏离：当前分支不在 ${srcBranch} 的祖先链上，pop 可能产生冲突。\n\n  ✅ 建议：\n    - 先切到 ${srcBranch} 再 pop，或\n    - 用 \`git stash branch stash@{${stashIdx}}\` 从 stash 创建新分支\n══════════════════════════════════════════════════════\n`,
          );
        }
      }
    } catch {}
  }
}

// 危险命令拦截（tweak/design 模式下放行，含 .worktree/ 安全路径例外）
if (!isTweak && !isDesign) {
  const DANGEROUS_COMMANDS = [
    { pattern: /rm -rf/, label: "rm -rf", alt: "使用 trash <file> 或 git rm <file>" },
    { pattern: /git push --force/, label: "git push --force", alt: "使用 git push --force-with-lease" },
  ];
  if (tool === "Bash" || tool === "PowerShell") {
    const matched = DANGEROUS_COMMANDS.find((d) => d.pattern.test(args.command || ""));
    if (matched) {
      const cmd = args.command || "";
      const isSafeRm =
        matched.label === "rm -rf" &&
        (/\.worktree\/deploy\b/.test(cmd) ||
          /\.worktree\/workspaces\b/.test(cmd) ||
          /\.worktree\/omx-team\b/.test(cmd) ||
          /\.worktrees\//.test(cmd) ||
          /\/tmp\//.test(cmd));
      if (!isSafeRm) {
        block(
          `⚠️ 安全拦截：${matched.label} 被禁用\n` +
            `   → 替代方案：${matched.alt}\n` +
            `   → 如需强制执行，请在终端手动输入命令\n` +
            `   → 当前模式=${harnessState.mode}，切换为 tweak 模式可放行\n` +
            `   → 安全路径例外：.worktrees/ .worktree/deploy/ /tmp/`,
        );
      }
    }
  }
}

process.exit(0);
