import { execSync, execFileSync } from "child_process";
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join, dirname, relative, basename } from "path";
import { fileURLToPath } from "url";
import {
  WORKTREE_PATH_RULE,
  describeBranchWorktreePath,
  parseWorktreePorcelain,
  auditWorktreePaths,
  formatAuditWarning,
  resolveMainProjectRoot,
} from "../../scripts/worktree/worktree-policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// hooks 可能从主仓或 worktree 内加载；统一解析为主仓根
const projectRoot = resolveMainProjectRoot(join(__dirname, "../.."));
const loopsDir = join(projectRoot, ".claude/loops");
const NO_OPTIONAL_LOCKS_GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };

// `GIT_OPTIONAL_LOCKS=0` prevents observational Git commands such as status
// from refreshing the index stat-cache. It is not a general read-only security
// boundary, so all command call sites remain fixed and non-destructive.
const execGit = (args, options = {}) => execFileSync("git", args, {
  ...options,
  env: NO_OPTIONAL_LOCKS_GIT_ENV,
});

const run = (cmd) => {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout: 3000,
      env: NO_OPTIONAL_LOCKS_GIT_ENV,
    }).trim();
  } catch {
    return "";
  }
};

// ISC-3c: 分支名来自 git 输出（可能含特殊字符），用 execFileSync 传单参数数组防 shell 注入
const isAncestor = (br) => {
  try {
    execGit(["merge-base", "--is-ancestor", br, "main"], { stdio: "ignore", timeout: 3000 });
    return true; // exit 0 = br 是 main 的祖先（已合入）
  } catch {
    return false;
  }
};

const branch = run("git rev-parse --abbrev-ref HEAD 2>/dev/null") || "（非 git 目录）";
const status = run("git status --short 2>/dev/null") || "";
const log = run("git log --oneline -10 2>/dev/null") || "";
const currentTopLevel = run("git rev-parse --show-toplevel 2>/dev/null") || projectRoot;

const worktreePorcelain = run("git worktree list --porcelain 2>/dev/null");
const worktreeState = parseWorktreePorcelain(worktreePorcelain);

const lines = ["--- SessionStart Hook ---", "分支: " + branch];

// === Branch / worktree discipline guard ===
// Write/Edit 硬门禁由 pre-tool-check.mjs 执行；此处给出开工指引（不阻断 SessionStart）。
const onMainWorkspace = currentTopLevel === projectRoot;

if (branch === "main" || onMainWorkspace) {
  lines.push("---", "🚫 当前在主工作区（main 检出）。活跃开发必须使用 Git Worktree。");
  lines.push("   pre-tool-check 将硬拦截：主仓 Write/Edit、主仓 checkout -b/switch 功能分支、main 上 commit。");
  lines.push("   正确开工：");
  lines.push("   node scripts/worktree.mjs create feat/<id>-<slug>");
  lines.push("   cd .worktrees/feat/<id>-<slug>");
  lines.push("   细则: docs/governance/worktree-policy.md / CONSTITUTION §6.0.5");
}

if (branch !== "main" && branch !== "HEAD" && branch !== "（非 git 目录）") {
  const actualPath = worktreeState.branchToPath.get(branch) || currentTopLevel;
  const { expectedPath, compliant } = describeBranchWorktreePath({
    root: projectRoot,
    branchName: branch,
    actualPath,
  });
  if (actualPath && !compliant) {
    lines.push("---", "🚫 分支路径不符合 worktree 规则（应迁入规范路径）：");
    lines.push("   当前: " + actualPath);
    lines.push("   期望: " + expectedPath);
    lines.push("   规则: " + WORKTREE_PATH_RULE);
    lines.push("   → git worktree move '" + actualPath + "' '" + expectedPath + "'");
    lines.push("   → 或重建：node scripts/worktree.mjs create " + branch);
  }
}

// === Worktree 路径全表审计（机器检测，WARN 不阻塞 SessionStart）===
// 扫描所有已登记 worktree 找偏离规范者 + 检测旧路径 ~/.worktrees/ 残留。
// 编辑硬拦截在 pre-tool-check；此处仅报告迁移线索。
const audit = auditWorktreePaths({
  root: projectRoot,
  worktreeState,
  homeDir: process.env.HOME,
});
if ((audit.nonCompliant || []).length || (audit.legacyPaths || []).length) {
  lines.push("---", "⚠️ worktree 路径偏离规范（机器检测）：");
  lines.push(...formatAuditWarning(audit));
  lines.push("   规则: " + WORKTREE_PATH_RULE + "（~/.worktrees/ 已于 2026-05-12 废弃）");
}

// === 主 worktree 落后 main 告警（#9）===
// 防止"hook 改进合并了但主 worktree 落后 main 导致跑旧 hook 从未生效"。
// 仅当当前 worktree 是主 worktree（currentTopLevel === projectRoot）且分支非 main 时，
// 检查 HEAD..origin/main，若非空（落后 main）输出醒目告警。信息护栏，不阻塞。
if (currentTopLevel === projectRoot && branch !== "main" && branch !== "HEAD" && branch !== "（非 git 目录）") {
  const behindLog = run("git log HEAD..origin/main --oneline 2>/dev/null") || "";
  if (behindLog) {
    const behindCount = behindLog.split("\n").filter(Boolean).length;
    lines.push("---");
    lines.push("⚠️⚠️ 主 worktree 在 " + branch + " 落后 main " + behindCount + " commit — hook/脚本改进未生效（跑的是旧版本）！");
    lines.push("   → 建议先 git push -u origin HEAD 保命当前分支，再 git checkout main && git pull origin main 同步");
    lines.push("   落后的 commit（main 独有）：");
    lines.push(...behindLog.split("\n").filter(Boolean).slice(0, 5).map(l => "     " + l));
    if (behindCount > 5) lines.push("     ... 还有 " + (behindCount - 5) + " 个");
  }
}

// === Stale working tree guard ===
const originDiff = run("git diff origin/main --stat 2>/dev/null") || "";
if (originDiff) {
  lines.push("---", "⚠️ 工作区与 origin/main 存在差异 — 可能使用了过时的文件版本。运行 git pull origin main 同步后重新开始：");
  const diffLines = originDiff.split("\n").filter(Boolean);
  lines.push(...diffLines.slice(0, 5).map(l => "   " + l));
  if (diffLines.length > 5) lines.push("   ... 还有 " + (diffLines.length - 5) + " 个文件");
}

if (status) {
  lines.push("---", "变更:");
  lines.push(status);
} else {
  lines.push("---", "无未提交变更");
}

if (log) {
  lines.push("---", "最近 10 条提交:");
  lines.push(log);
}

// Harness 状态感知（阶段 + 模式）
const statePath = join(projectRoot, ".claude/.harness-state");
if (existsSync(statePath)) {
  try {
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    lines.push("---");
    lines.push("Harness 状态: 阶段=" + (state.phase || "build") + "  模式=" + (state.mode || "full"));
  } catch {}
}

// === crates 进度本地副本（SessionStart 自动刷新；不阻断、不入库）===
// 主仓/任意分支可写 gitignore 的 CRATES_STATUS.local.md，避免手敲 make status。
// 入库 STATUS.md 仍由 feature PR 顺带更新；此处永不 --tracked。
{
  const genScript = join(projectRoot, "scripts/docs/gen-crate-status.mjs");
  if (existsSync(genScript)) {
    lines.push("---");
    try {
      const out = execSync(`node "${genScript}" --local-only`, {
        cwd: projectRoot,
        encoding: "utf-8",
        timeout: 12000,
        env: NO_OPTIONAL_LOCKS_GIT_ENV,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      const avgM = out.match(/avg\s+(\d+)%/);
      const nM = out.match(/\((\d+)\s+crates/);
      const avg = avgM ? avgM[1] : "?";
      const n = nM ? nM[1] : "?";
      lines.push(
        "📊 crates 进度: " + n + " members · 平均 " + avg + "%（已刷新本地副本）",
      );
      lines.push(
        "   本地: docs/status/CRATES_STATUS.local.md  |  入库 STATUS.md 随 feature PR 顺带更新",
      );
    } catch {
      lines.push(
        "📊 crates 进度: 自动刷新跳过（可手动 make status / node scripts/docs/gen-crate-status.mjs --local-only）",
      );
    }
  }
}

// Loop 状态 (hot state — 从 STATE.md 提取)
const loopStatePath = join(loopsDir, "STATE.md");
if (existsSync(loopStatePath)) {
  const sc = readFileSync(loopStatePath, "utf-8");
  const phaseMatch = sc.match(/\*\*Phase\*\*: (.+)/);
  const lastRunMatch = sc.match(/\*\*Last Run\*\*: (.+)/);
  const findingsMatch = sc.match(/\*\*Findings Open\*\*: (.+)/);
  const phase = phaseMatch ? phaseMatch[1] : "unknown";
  const lastRun = lastRunMatch ? lastRunMatch[1] : "never";
  const findings = findingsMatch ? findingsMatch[1] : "0";
  lines.push("---", "Loop 状态: Phase=" + phase + " | Last Run=" + lastRun + " | Open Findings=" + findings);

  // LOG.md 最近摘要
  const logPath = join(loopsDir, "LOG.md");
  if (existsSync(logPath)) {
    const logContent = readFileSync(logPath, "utf-8");
    const entries = logContent.split("\n").filter(l => l.includes("|") && l.includes("auto") && !l.includes("Timestamp |"));
    const recent = entries.slice(-3);
    if (recent.length > 0) {
      lines.push("  最近 GC 扫描:");
      for (const e of recent) {
        const cols = e.split("|").map(c => c.trim()).filter(Boolean);
        if (cols.length >= 3) lines.push("    " + cols[0] + " → " + cols[2]);
      }
    }
  }
}

// 加载最近 5 次审查报告
const reviewsDir = join(projectRoot, ".claude/reviews");
if (existsSync(reviewsDir)) {
  const reviewFiles = readdirSync(reviewsDir)
    .filter(f => f.endsWith(".md"))
    .sort()
    .reverse()
    .slice(0, 5);

  if (reviewFiles.length > 0) {
    lines.push("---", "最近 " + reviewFiles.length + " 次审查:");
    for (const file of reviewFiles) {
      const content = readFileSync(join(reviewsDir, file), "utf-8");
      const flagSection = (content.split("### 规则检查\n")[1] || "").split("\n###")[0] || "";
      const flags = flagSection.split("\n").filter(l => l.trim());
      lines.push(file.replace(".md", ""));
      lines.push(...flags.map(f => "  " + f));
    }
  }
}

// 检查 CLAUDE.md 是否未初始化
const claudeMdPath = join(projectRoot, "CLAUDE.md");
if (existsSync(claudeMdPath)) {
  const claudeContent = readFileSync(claudeMdPath, "utf-8");
  if (claudeContent.includes("【待填写")) {
    lines.push("---", "⚠️ CLAUDE.md 还有占位符未替换，请对 AI 说：帮我初始化 Harness");
  }
}

// === Worktree / stash GC 观测（事故止血：SessionStart 永远只报告）===
// SessionStart 是隐式生命周期钩子，不能证明候选已无人使用，也没有 lease / owner
// 协议。WORKTREE_GC_AUTO / WORKTREE_GC_CLEAN 仅作为请求信号显示；本钩子不删除
// registered、detached、orphan worktree，也不 drop stash。数量阈值只产生告警。
const worktreeBase = join(projectRoot, ".worktree");
if (existsSync(worktreeBase)) {
  const cleanRequested = process.env.WORKTREE_GC_CLEAN === "1";
  const autoRequested = process.env.WORKTREE_GC_AUTO === "1";
  const TTL_MS = 24 * 3600 * 1000;
  const PROTECT = new Set(["note.md", "v2.md"]);
  const worktreeCount = worktreeState.registered.size;
  const stashRaw = run("git stash list 2>/dev/null");
  const stashCount = stashRaw ? stashRaw.split("\n").filter(Boolean).length : 0;

  if (autoRequested) {
    lines.push("---", "🛡️ WORKTREE_GC_AUTO 已请求；SessionStart 仅报告，AUTO 不启用删除");
  }
  if (cleanRequested) {
    lines.push("---", "🛡️ WORKTREE_GC_CLEAN 已请求；SessionStart 仅报告，CLEAN 不启用删除");
  }
  if (worktreeCount > 15 || stashCount > 30) {
    lines.push(
      "---",
      "⚠️ GC 数量阈值：worktree=" + worktreeCount +
        (worktreeCount > 15 ? " (>15)" : " (<=15)") +
        "，stash=" + stashCount +
        (stashCount > 30 ? " (>30)" : " (<=30)") +
        "；仅报告，不触发删除",
    );
  }

  // 注册的 worktree 路径（git worktree list）
  const registered = worktreeState.registered;
  // 排除主 worktree，避免其路径作为 .worktree/* 的前缀污染判定
  const regSub = new Set([...registered].filter(r => r !== projectRoot));

  // 候选：.worktree/<top> 与 .worktree/<top>/<sub>
  const candidates = [];
  for (const top of readdirSync(worktreeBase, { withFileTypes: true })) {
    if (!top.isDirectory()) continue;
    const tp = join(worktreeBase, top.name);
    candidates.push(tp);
    for (const sub of readdirSync(tp, { withFileTypes: true })) {
      if (sub.isDirectory()) candidates.push(join(tp, sub.name));
    }
  }

  const classify = (c) => {
    if (registered.has(c)) return "self";
    for (const r of regSub) {
      if (c === r) return "self";
      if (c.startsWith(r + "/")) return "inside-active";
      if (r.startsWith(c + "/")) return "active-container";
    }
    return "ORPHAN";
  };

  // 白名单：目录直接含 note.md / v2.md 文件则保护
  const hasProtectedFile = (dir) => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .some(e => e.isFile() && PROTECT.has(e.name));
    } catch {
      return false;
    }
  };

  // 被 `git worktree forget` 的工作区仍可能保留 `.git` 文件；报告为残骸，
  // 不据此推断安全或执行删除。
  const hasWorktreeRemnant = (dir) => {
    try {
      const g = join(dir, ".git");
      return existsSync(g) && statSync(g).isFile();
    } catch {
      return false;
    }
  };

  // 状态必须三值化。失败/超时不能解释为 clean，而是 UNKNOWN（受保护）。
  const inspectWorktreeStatus = (dir) => {
    try {
      const out = execGit(["-C", dir, "status", "--porcelain"], {
        encoding: "utf-8",
        timeout: 3000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const files = out.trim().split("\n").filter(Boolean);
      return { state: files.length > 0 ? "DIRTY" : "CLEAN", files };
    } catch {
      return { state: "UNKNOWN", files: [] };
    }
  };

  const protectionLabel = ({ status, locked = false }) => {
    if (locked) return "  🛡️ locked，保护";
    if (status.state === "DIRTY") return "  🛡️ dirty/untracked，保护";
    if (status.state === "UNKNOWN") return "  🛡️ 状态未知（UNKNOWN），保护";
    return "  🛡️ clean 仅是观测，不构成删除授权";
  };

  const now = Date.now();
  const orphans = candidates
    .filter((c) => classify(c) === "ORPHAN")
    .filter((c) => !hasProtectedFile(c))
    .map((c) => ({ path: c, ageMs: now - statSync(c).mtimeMs }))
    .filter((o) => o.ageMs > TTL_MS)
    .sort((a, b) => b.ageMs - a.ageMs);

  if (orphans.length > 0) {
    const tagged = orphans.map((o) => ({ ...o, remnant: hasWorktreeRemnant(o.path) }));
    const remnantCount = tagged.filter((o) => o.remnant).length;
    lines.push("---");
    lines.push("🧹 Worktree 孤儿（仅报告）：发现 " + orphans.length + " 个 >24h 目录" + (remnantCount > 0 ? "（其中 " + remnantCount + " 个 worktree 残骸）" : ""));
    for (const o of tagged.slice(0, 15)) {
      lines.push("   " + Math.floor(o.ageMs / 3600000) + "h  " + relative(projectRoot, o.path) + (o.remnant ? "  🛡️ 残骸，保护" : "  🛡️ 未注册目录，保护"));
    }
    if (tagged.length > 15) lines.push("   ... 还有 " + (tagged.length - 15) + " 个");
  }

  // Branch tip 位于 main 历史只是一项观测：新建同 HEAD 分支、main 前进后的
  // 无提交分支与真正已合入分支都会满足，不能作为“可清理”的证明。
  {
    const pathToBranch = worktreeState.pathToBranch;
    const inMainHistory = [];
    for (const [wtPath, wtBranch] of pathToBranch) {
      if (wtPath === projectRoot) continue;
      if (hasProtectedFile(wtPath)) continue;
      if (isAncestor(wtBranch)) inMainHistory.push({ path: wtPath, branch: wtBranch });
    }

    const tagged = inMainHistory.map((m) => ({
      ...m,
      status: inspectWorktreeStatus(m.path),
      locked: worktreeState.lockedPaths.has(m.path),
    }));
    if (tagged.length > 0) {
      lines.push("---");
      lines.push("♻️ Branch tip 位于 main 历史（仅报告；不能证明可清理）：" + tagged.length + " 个");
      for (const m of tagged.slice(0, 15)) {
        lines.push("   " + relative(projectRoot, m.path) + "  ← " + m.branch + protectionLabel(m));
      }
      if (tagged.length > 15) lines.push("   ... 还有 " + (tagged.length - 15) + " 个");
    }

    const dirtyInMainHistory = tagged.filter((m) => m.status.state === "DIRTY");
    if (dirtyInMainHistory.length > 0) {
      lines.push("---");
      lines.push("🧟 dirty/untracked worktree（branch tip 位于 main 历史）：" + dirtyInMainHistory.length + " 个");
      for (const m of dirtyInMainHistory.slice(0, 10)) {
        lines.push("   " + relative(projectRoot, m.path) + "  ← " + m.branch + "  (" + m.status.files.length + " 个改动，保护；需人工处置)");
      }
    }

    // === #12: 长期未活动 feature worktree 告警 ===
    // 未合入 main 的 feature worktree，HEAD commit 超 7 天未活动 → 提醒。信息护栏。
    {
      const INACTIVE_MS = 7 * 24 * 3600 * 1000;
      const now = Date.now();
      const inactive = [];
      for (const [wtPath, wtBranch] of pathToBranch) {
        if (wtPath === projectRoot) continue;
        if (hasProtectedFile(wtPath)) continue;
        const br = wtBranch.replace(/^refs\/heads\//, "");
        if (isAncestor(br)) continue;
        // 取 HEAD commit 时间
        let headTs = 0;
        try {
          const t = execGit(["-C", wtPath, "log", "-1", "--format=%ct", "HEAD"], { encoding: "utf-8", timeout: 3000 }).trim();
          headTs = parseInt(t, 10) * 1000;
        } catch { continue; }
        if (headTs > 0 && (now - headTs) > INACTIVE_MS) {
          inactive.push({ path: wtPath, branch: br, ageDays: Math.floor((now - headTs) / 86400000) });
        }
      }
      if (inactive.length > 0) {
        lines.push("---");
        lines.push("💤 长期未活动 feature worktree（>7 天无 commit）：" + inactive.length + " 个");
        for (const w of inactive.slice(0, 10)) {
          lines.push("   " + relative(projectRoot, w.path) + "  ← " + w.branch + "  (" + w.ageDays + "d 未活动)");
        }
      }
    }
  }

  // Detached HEAD 在 main 历史同样只报告；HEAD 可达性不能证明 owner/lease 已结束。
  {
    const detachedStale = [];
    for (const wtPath of worktreeState.detachedPaths) {
      if (wtPath === projectRoot) continue; // 主 worktree 过滤
      if (hasProtectedFile(wtPath)) continue; // 尊重 PROTECT 白名单
      // 取 detached worktree 的 HEAD SHA
      let sha = "";
      try {
        sha = execGit(["-C", wtPath, "rev-parse", "HEAD"], { encoding: "utf-8", timeout: 3000 }).trim();
      } catch { continue; }
      if (!sha) continue;
      // isAncestor 判断 sha 是否已合入 main（是 main 祖先）
      let merged = false;
      try {
        execGit(["merge-base", "--is-ancestor", sha, "main"], { stdio: "ignore", timeout: 3000 });
        merged = true;
      } catch { merged = false; }
      if (merged) detachedStale.push({ path: wtPath, sha: sha.slice(0, 8) });
    }

    if (detachedStale.length > 0) {
      const tagged = detachedStale.map((d) => ({
        ...d,
        status: inspectWorktreeStatus(d.path),
        locked: worktreeState.lockedPaths.has(d.path),
      }));
      lines.push("---");
      lines.push("👻 detached HEAD 位于 main 历史（仅报告；不能证明可清理）：" + detachedStale.length + " 个");
      for (const d of tagged.slice(0, 15)) {
        lines.push("   " + relative(projectRoot, d.path) + "  ← " + d.sha + protectionLabel(d));
      }
      if (tagged.length > 15) lines.push("   ... 还有 " + (tagged.length - 15) + " 个");
    }
  }

  // Stash 只报告。消息前缀、年龄与来源分支都不是删除授权。
  {
    if (stashRaw) {
      const STASH_TTL_MS = 3 * 24 * 3600 * 1000;
      const STASH_LIMIT = 30;
      const AUTO_PATTERN = /^auto-safety-stash-(before|after)-/;
      const now = Date.now();
      const entries = stashRaw.split("\n").filter(Boolean).map((line, idx) => {
        // 格式：stash@{N}: On <branch>: <msg>  或  stash@{N}: WIP on <branch>: ...
        const idxMatch = line.match(/^stash@\{(\d+)\}/);
        const stashIdx = idxMatch ? idxMatch[1] : String(idx);
        const onMatch = line.match(/(?:On|WIP on|On ) ([^:]+):/);
        const srcBranch = onMatch ? onMatch[1].trim() : "";
        const msg = line.split(":").slice(2).join(":").trim();
        // 取 stash commit 时间戳
        let ts = 0;
        try {
          const t = execGit(["log", "-1", "--format=%ct", "stash@{" + stashIdx + "}"], { encoding: "utf-8", timeout: 3000 }).trim();
          ts = parseInt(t, 10) * 1000;
        } catch {}
        return { idx: stashIdx, srcBranch, msg, ts, isAuto: AUTO_PATTERN.test(msg), line };
      });

      const expired = entries.filter((e) => e.isAuto && e.ts > 0 && (now - e.ts) > STASH_TTL_MS);
      const overLimit = entries.length > STASH_LIMIT ? entries.slice(STASH_LIMIT) : [];

      if (expired.length > 0 || overLimit.length > 0) {
        lines.push("---");
        lines.push("📦 Stash GC（仅报告，不 drop）：" + entries.length + " 个 stash");
        if (expired.length > 0) {
          lines.push("   过期自动 stash（>3 天）：" + expired.length + " 个");
          for (const e of expired.slice(0, 10)) {
            const days = e.ts ? Math.floor((now - e.ts) / 86400000) : "?";
            lines.push("      stash@{" + e.idx + "}  " + days + "d  " + e.msg.slice(0, 50) + "  🛡️ 保护");
          }
        }
        if (overLimit.length > 0) {
          lines.push("   超上限（>" + STASH_LIMIT + "）最旧：" + overLimit.length + " 个");
          for (const e of overLimit.slice(0, 10)) {
            lines.push("      stash@{" + e.idx + "}  " + (e.isAuto ? "auto" : "manual") + "  " + e.msg.slice(0, 40) + "  🛡️ 保护");
          }
        }
      }
    }
  }
}

lines.push("------------------------");

process.stdout.write(lines.join("\n"));
