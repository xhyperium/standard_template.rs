#!/usr/bin/env node
/**
 * gen-crate-status.mjs — 扫描 workspace crates，生成进度看板
 *
 * 度量维度（机械可复现，不等于 Production Ready 签字）：
 *   1. 标准布局七项（crates/AGENTS.md）
 *   2. 源码/测试/示例实质（文件数、LOC、是否仅 scaffold）
 *   3. SSOT 对齐文档是否存在
 *
 * 双写策略（减轻 worktree / main 摩擦）：
 *   - 始终写入 gitignore 本地副本 docs/status/CRATES_STATUS.local.md（主仓可刷、不脏 git）
 *   - 入库 STATUS.md：仅在非 main 分支默认写入；main 上需 --tracked 才写
 *   - 不必「每改一次 crate 就开 PR」；改布局/加成员的 feature PR 顺带 make status 即可
 *
 * 用法:
 *   node scripts/docs/gen-crate-status.mjs              # 本地副本 +（非 main）STATUS.md
 *   node scripts/docs/gen-crate-status.mjs --tracked    # 强制写入库 STATUS.md
 *   node scripts/docs/gen-crate-status.mjs --local-only # 只写本地副本
 *   node scripts/docs/gen-crate-status.mjs --check      # 校验已提交 STATUS.md 是否过期
 *   node scripts/docs/gen-crate-status.mjs --summary    # 打印 GitHub Job Summary 友好摘要（stdout）
 *   node scripts/docs/gen-crate-status.mjs --json       # 额外打印 JSON 摘要到 stdout
 *   node scripts/docs/gen-crate-status.mjs --watch 30   # 每 30s 重扫（默认行为同上）
 *
 * SSOT: STATUS.md / docs/status/README.md / crates/AGENTS.md
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  watch as fsWatch,
  mkdirSync,
} from "fs";
import { join, dirname, relative, extname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const OUT = join(ROOT, "STATUS.md");
/** 本地实时副本（gitignore）；主仓/任意目录可刷，不污染 tracked tree */
const OUT_LOCAL = join(ROOT, "docs", "status", "CRATES_STATUS.local.md");
const CARGO_TOML = join(ROOT, "Cargo.toml");

const CHECK = process.argv.includes("--check");
const SUMMARY = process.argv.includes("--summary");
const JSON_OUT = process.argv.includes("--json");
const FORCE_TRACKED = process.argv.includes("--tracked");
const LOCAL_ONLY = process.argv.includes("--local-only");
const watchIdx = process.argv.indexOf("--watch");
const WATCH =
  watchIdx >= 0
    ? Math.max(5, Number(process.argv[watchIdx + 1]) || 30)
    : 0;

function currentBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function shouldWriteTracked() {
  if (LOCAL_ONLY) return false;
  if (FORCE_TRACKED) return true;
  const b = currentBranch();
  // main 主工作区默认不写 tracked，避免脏 tree / 与 worktree 门禁打架
  return b !== "main" && b !== "master" && b !== "HEAD";
}

/** 标准布局七项（顺序与 crates/AGENTS.md 一致） */
const LAYOUT_ITEMS = [
  { key: "src", label: "src/", kind: "dir_rs" },
  { key: "tests", label: "tests/", kind: "dir" },
  { key: "docs", label: "docs/", kind: "dir" },
  { key: "benches", label: "benches/", kind: "dir" },
  { key: "README.md", label: "README.md", kind: "file" },
  { key: "review", label: "review/", kind: "dir" },
  { key: "releases", label: "releases/", kind: "dir" },
];

/** package 路径 → SSOT 对齐文档（相对仓库根） */
const SSOT_DOC_BY_PREFIX = [
  { prefix: "crates/kernel", doc: "docs/ssot/kernel-ssot-alignment.md" },
  { prefix: "crates/testkit", doc: "docs/ssot/testkit-ssot-alignment.md" },
  {
    prefix: "crates/test-support/contracts",
    doc: "docs/ssot/testkit-ssot-alignment.md",
  },
  { prefix: "crates/configx", doc: "docs/ssot/configx-ssot-alignment.md" },
  { prefix: "crates/schedulex", doc: "docs/ssot/schedulex-ssot-alignment.md" },
  { prefix: "crates/bootstrap", doc: "docs/ssot/bootstrap-ssot-alignment.md" },
  { prefix: "crates/evidence", doc: "docs/ssot/evidence-ssot-alignment.md" },
  { prefix: "crates/observex", doc: "docs/ssot/observex-ssot-alignment.md" },
  { prefix: "crates/resiliencx", doc: "docs/ssot/resiliencx-ssot-alignment.md" },
  { prefix: "crates/transport", doc: "docs/ssot/transport-ssot-alignment.md" },
  { prefix: "crates/contracts", doc: "docs/ssot/contracts-ssot-alignment.md" },
  { prefix: "crates/types/", doc: "docs/ssot/types-ssot-alignment.md" },
  { prefix: "crates/adapters/storage/redis", doc: "docs/ssot/redisx-ssot-alignment.md" },
  { prefix: "crates/adapters/storage/postgres", doc: "docs/ssot/postgresx-ssot-alignment.md" },
  { prefix: "crates/adapters/storage/kafka", doc: "docs/ssot/kafkax-ssot-alignment.md" },
  { prefix: "crates/adapters/storage/nats", doc: "docs/ssot/natsx-ssot-alignment.md" },
  { prefix: "crates/adapters/storage/oss", doc: "docs/ssot/ossx-ssot-alignment.md" },
  { prefix: "crates/adapters/storage/clickhouse", doc: "docs/ssot/clickhousex-ssot-alignment.md" },
  { prefix: "crates/adapters/storage/taos", doc: "docs/ssot/taosx-ssot-alignment.md" },
  { prefix: "crates/adapters/", doc: "docs/ssot/adapters-ssot-alignment.md" },
  { prefix: "tools/goalctl", doc: "docs/ssot/tools-ssot-alignment.md" },
  { prefix: "tools/verifyctl", doc: "docs/ssot/tools-ssot-alignment.md" },
];

function parseWorkspaceMembers(text) {
  const m = text.match(/\[workspace\][\s\S]*?members\s*=\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

function parsePackageName(cargoTomlText) {
  const m = cargoTomlText.match(
    /^\[package\][\s\S]*?^name\s*=\s*"([^"]+)"/m,
  );
  return m ? m[1] : null;
}

function isGitkeepOnly(dir) {
  if (!existsSync(dir)) return true;
  const entries = readdirSync(dir).filter((e) => e !== ".DS_Store");
  if (entries.length === 0) return true;
  return entries.every((e) => e === ".gitkeep" || e.startsWith("."));
}

function listFilesRecursive(dir, pred, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "target" || name === ".git") continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) listFilesRecursive(p, pred, acc);
    else if (pred(p, name)) acc.push(p);
  }
  return acc;
}

function countLoc(files) {
  let n = 0;
  for (const f of files) {
    try {
      const t = readFileSync(f, "utf8");
      n += t.split("\n").length;
    } catch {
      /* skip */
    }
  }
  return n;
}

function readSafe(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function hasCfgTest(srcFiles) {
  for (const f of srcFiles) {
    if (/#\[cfg\s*\(\s*test\s*\)\]/.test(readSafe(f))) return true;
  }
  return false;
}

function scaffoldSignal(cratePath, srcFiles) {
  // 生产默认路径优先：adapters 若 default features 不含 scaffold，且存在 pool/client
  // 生产模块，则 **不** 因文档/可选 feature 中的 "scaffold" 字样封顶为 scaffold+mock。
  if (cratePath.startsWith("crates/adapters/")) {
    const cargo = readSafe(join(ROOT, cratePath, "Cargo.toml"));
    const defaultBlock = cargo.match(/\[features\][\s\S]*?default\s*=\s*\[([^\]]*)\]/);
    const defaultHasScaffold =
      defaultBlock && /\bscaffold\b/.test(defaultBlock[1] || "");
    const hasProdMod =
      existsSync(join(ROOT, cratePath, "src", "pool.rs")) ||
      existsSync(join(ROOT, cratePath, "src", "client.rs")) ||
      existsSync(join(ROOT, cratePath, "src", "live.rs")) ||
      // exchange 生产默认：鉴权 + 行情解析（非 storage pool 形态）
      (existsSync(join(ROOT, cratePath, "src", "auth.rs")) &&
        existsSync(join(ROOT, cratePath, "src", "market.rs")));
    if (!defaultHasScaffold && hasProdMod) {
      return false;
    }
  }
  // 非生产默认：源码头部显式 scaffold 信号，或 adapters 无生产模块
  for (const f of srcFiles.slice(0, 40)) {
    // 文档/注释中的「非 scaffold」叙述不应触发封顶
    const head = readSafe(f).slice(0, 6000);
    if (/\bscaffold\b/i.test(head) && !/非.*scaffold|not.*scaffold|生产默认/i.test(head)) {
      return true;
    }
  }
  if (cratePath.startsWith("crates/adapters/")) return true;
  return false;
}

function ssotDocFor(cratePath) {
  for (const { prefix, doc } of SSOT_DOC_BY_PREFIX) {
    if (cratePath === prefix || cratePath.startsWith(prefix)) return doc;
  }
  return null;
}

function layerOf(cratePath) {
  if (cratePath === "crates/kernel") return "L0";
  if (cratePath === "crates/testkit") return "T0";
  if (cratePath.startsWith("crates/types/")) return "types";
  if (cratePath.startsWith("crates/adapters/")) return "adapter";
  if (cratePath === "crates/contracts") return "contracts";
  return "L1";
}

/**
 * 完成度 0–100（结构进度，非生产签字）。
 * layout 50% + tests 25% + content 25%
 */
function computeCompletion(layoutOk, hasTests, contentScore) {
  const layoutPct = layoutOk / LAYOUT_ITEMS.length;
  const testPct = hasTests ? 1 : 0;
  const contentPct = Math.max(0, Math.min(1, contentScore));
  return Math.round((layoutPct * 0.5 + testPct * 0.25 + contentPct * 0.25) * 100);
}

function contentScore({ loc, exampleRs, docsReadme, isScaffold }) {
  // LOC 桶：0→0, 50→0.3, 200→0.6, 500+→0.85
  let locPart = 0;
  if (loc >= 500) locPart = 0.85;
  else if (loc >= 200) locPart = 0.65;
  else if (loc >= 80) locPart = 0.45;
  else if (loc >= 30) locPart = 0.25;
  else if (loc > 0) locPart = 0.1;

  const exPart = exampleRs > 0 ? 0.1 : 0;
  const docPart = docsReadme && docsReadme.trim().length > 80 ? 0.05 : 0;
  let s = locPart + exPart + docPart;
  if (isScaffold) s = Math.min(s, 0.55); // scaffold 实质分封顶
  return Math.min(1, s);
}

function maturityLabel({ layoutOk, isScaffold, hasTests, loc, completion }) {
  if (layoutOk < LAYOUT_ITEMS.length) return "layout-incomplete";
  if (isScaffold) {
    if (hasTests && loc >= 80) return "scaffold+mock";
    return "scaffold";
  }
  if (completion >= 90 && hasTests && loc >= 200) return "active";
  if (hasTests && loc >= 80) return "partial";
  if (layoutOk === LAYOUT_ITEMS.length) return "thin";
  return "unknown";
}

function progressBar(pct, width = 10) {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function scanCrate(memberPath) {
  const abs = join(ROOT, memberPath);
  const cargoText = readSafe(join(abs, "Cargo.toml"));
  const packageName = parsePackageName(cargoText) || relative(ROOT, abs);

  const layout = {};
  let layoutOk = 0;
  for (const item of LAYOUT_ITEMS) {
    const p = join(abs, item.key);
    let ok = false;
    if (item.kind === "file") {
      ok = existsSync(p) && statSync(p).isFile();
    } else if (item.kind === "dir") {
      ok = existsSync(p) && statSync(p).isDirectory();
    } else if (item.kind === "dir_rs") {
      ok =
        existsSync(p) &&
        statSync(p).isDirectory() &&
        listFilesRecursive(p, (_fp, name) => extname(name) === ".rs").length > 0;
    }
    layout[item.key] = ok;
    if (ok) layoutOk += 1;
  }

  const srcFiles = listFilesRecursive(
    join(abs, "src"),
    (_fp, name) => extname(name) === ".rs",
  );
  const testFiles = listFilesRecursive(
    join(abs, "tests"),
    (_fp, name) => extname(name) === ".rs",
  );
  const exampleFiles = listFilesRecursive(
    join(abs, "examples"),
    (_fp, name) => extname(name) === ".rs",
  );
  const loc = countLoc(srcFiles);
  const unitTests = hasCfgTest(srcFiles);
  const hasTests = unitTests || testFiles.length > 0;
  const isScaffold = scaffoldSignal(memberPath, srcFiles);
  const docsReadme = readSafe(join(abs, "docs", "README.md"));
  const cScore = contentScore({
    loc,
    exampleRs: exampleFiles.length,
    docsReadme,
    isScaffold,
  });
  const completion = computeCompletion(layoutOk, hasTests, cScore);
  const maturity = maturityLabel({
    layoutOk,
    isScaffold,
    hasTests,
    loc,
    completion,
  });
  const ssot = ssotDocFor(memberPath);
  const ssotOk = ssot ? existsSync(join(ROOT, ssot)) : false;

  return {
    path: memberPath,
    package: packageName,
    layer: layerOf(memberPath),
    layout,
    layoutOk,
    layoutTotal: LAYOUT_ITEMS.length,
    srcFiles: srcFiles.length,
    loc,
    testFiles: testFiles.length,
    unitTests,
    hasTests,
    exampleFiles: exampleFiles.length,
    examplesPlaceholder: isGitkeepOnly(join(abs, "examples")),
    docsPlaceholder: isGitkeepOnly(join(abs, "docs")),
    isScaffold,
    maturity,
    completion,
    ssot,
    ssotOk,
  };
}

function scanAll() {
  if (!existsSync(CARGO_TOML)) {
    throw new Error(`missing ${CARGO_TOML}`);
  }
  const members = parseWorkspaceMembers(readFileSync(CARGO_TOML, "utf8"));
  if (members.length === 0) {
    throw new Error("no workspace.members found in Cargo.toml");
  }
  const crates = members.map(scanCrate).sort((a, b) => {
    const layerOrder = {
      L0: 0,
      T0: 1,
      types: 2,
      L1: 3,
      contracts: 4,
      adapter: 5,
    };
    const d = (layerOrder[a.layer] ?? 9) - (layerOrder[b.layer] ?? 9);
    if (d !== 0) return d;
    return a.path.localeCompare(b.path);
  });
  return crates;
}

function summarize(crates) {
  const n = crates.length;
  const layoutFull = crates.filter((c) => c.layoutOk === c.layoutTotal).length;
  const withTests = crates.filter((c) => c.hasTests).length;
  const scaffold = crates.filter((c) => c.isScaffold).length;
  const avg =
    n === 0
      ? 0
      : Math.round(crates.reduce((s, c) => s + c.completion, 0) / n);
  const byMaturity = {};
  for (const c of crates) {
    byMaturity[c.maturity] = (byMaturity[c.maturity] || 0) + 1;
  }
  return { n, layoutFull, withTests, scaffold, avg, byMaturity };
}

function mark(ok) {
  return ok ? "✅" : "❌";
}

function renderMarkdown(crates, generatedAt) {
  const s = summarize(crates);
  const lines = [
    "# crates 子模块进度看板（自动生成）",
    "",
    `> **生成方式**：\`node scripts/docs/gen-crate-status.mjs\``,
    `> **生成时间**：${generatedAt}`,
    `> **源权威**：根 \`Cargo.toml\` \`[workspace.members]\` + 各 crate 目录树`,
    `> **勿手改**：本文件由脚本覆盖。标准布局定义见 [crates/AGENTS.md](crates/AGENTS.md)；对齐叙事见 [docs/ssot/](docs/ssot/)。`,
    `> **口径声明**：完成度是**结构/可观测进度**（布局·测试·源码实质），**不是** Production Ready 签字，也不是 SSOT 镜像 COMPLETE。`,
    "",
    "## 总览",
    "",
    "| 指标 | 值 |",
    "|------|-----|",
    `| workspace members | **${s.n}** |`,
    `| 布局七项齐全 | **${s.layoutFull}** / ${s.n}（${pct(s.layoutFull, s.n)}%） |`,
    `| 含测试（单元或集成） | **${s.withTests}** / ${s.n}（${pct(s.withTests, s.n)}%） |`,
    `| scaffold 信号 | **${s.scaffold}** |`,
    `| **平均完成度** | **${s.avg}%** ${progressBar(s.avg)} |`,
    "",
    "### 成熟度分布",
    "",
    "| 标签 | 含义 | 数量 |",
    "|------|------|------|",
    `| \`layout-incomplete\` | 标准七项缺项 | ${s.byMaturity["layout-incomplete"] || 0} |`,
    `| \`scaffold\` | adapter/显式 scaffold 骨架 | ${s.byMaturity.scaffold || 0} |`,
    `| \`scaffold+mock\` | scaffold 且具备 mock/测试入口 | ${s.byMaturity["scaffold+mock"] || 0} |`,
    `| \`thin\` | 布局齐但实质偏薄 | ${s.byMaturity.thin || 0} |`,
    `| \`partial\` | 有测试 + 一定源码量 | ${s.byMaturity.partial || 0} |`,
    `| \`active\` | 布局齐 + 测试 + 较厚实现 | ${s.byMaturity.active || 0} |`,
    "",
    "## 完成度公式",
    "",
    "```text",
    "completion = layout(7项)×50% + has_tests×25% + content×25%",
    "content    = LOC 桶 + 可运行 example + docs/README 实质",
    "scaffold   → content 上限 0.55（避免把内存桩当成生产实现）",
    "```",
    "",
    "## 成员明细",
    "",
    "| Package | 路径 | 层 | 布局 | 测试 | LOC | 示例 | 成熟度 | 完成度 | SSOT |",
    "|---------|------|----|:----:|:----:|----:|:----:|--------|--------|------|",
  ];

  for (const c of crates) {
    const layoutCell = `${c.layoutOk}/${c.layoutTotal}`;
    const testCell = c.hasTests
      ? c.testFiles > 0
        ? `✅ ${c.testFiles}i${c.unitTests ? "+u" : ""}`
        : "✅ u"
      : "❌";
    const exampleCell =
      c.exampleFiles > 0
        ? String(c.exampleFiles)
        : c.examplesPlaceholder
          ? "·"
          : "—";
    const ssotCell = c.ssot
      ? c.ssotOk
        ? `[✓](${c.ssot})`
        : "缺失"
      : "—";
    lines.push(
      `| \`${c.package}\` | \`${c.path}\` | ${c.layer} | ${layoutCell} | ${testCell} | ${c.loc} | ${exampleCell} | \`${c.maturity}\` | **${c.completion}%** ${progressBar(c.completion, 8)} | ${ssotCell} |`,
    );
  }

  lines.push(
    "",
    "### 图例",
    "",
    "- 测试列：`i` = `tests/*.rs` 集成测试数，`u` = `src` 内 `#[cfg(test)]`",
    "- 示例列：数字 = `examples/*.rs` 个数；`·` = 仅 `.gitkeep` 占位",
    "- SSOT 列：链到 `docs/ssot/*-alignment.md`（存在即 ✓）",
    "",
    "## 布局七项矩阵",
    "",
    "| Package | src | tests | docs | benches | README | review | releases |",
    "|---------|:---:|:-----:|:----:|:-------:|:------:|:------:|:--------:|",
  );

  for (const c of crates) {
    const L = c.layout;
    lines.push(
      `| \`${c.package}\` | ${mark(L.src)} | ${mark(L.tests)} | ${mark(L.docs)} | ${mark(L.benches)} | ${mark(L["README.md"])} | ${mark(L.review)} | ${mark(L.releases)} |`,
    );
  }

  // 低分 crate 提醒
  const low = crates.filter((c) => c.completion < 70).sort((a, b) => a.completion - b.completion);
  lines.push("", "## 需关注（完成度 < 70%）", "");
  if (low.length === 0) {
    lines.push("_当前无成员低于 70%。_");
  } else {
    lines.push("| Package | 完成度 | 成熟度 | 主要缺口 |");
    lines.push("|---------|--------|--------|----------|");
    for (const c of low) {
      const gaps = [];
      if (c.layoutOk < c.layoutTotal) {
        const missing = LAYOUT_ITEMS.filter((i) => !c.layout[i.key]).map(
          (i) => i.label,
        );
        gaps.push(`布局缺: ${missing.join(", ")}`);
      }
      if (!c.hasTests) gaps.push("无测试");
      if (c.isScaffold) gaps.push("scaffold");
      if (c.loc < 80) gaps.push("LOC 偏低");
      if (c.exampleFiles === 0) gaps.push("无 example");
      if (c.ssot && !c.ssotOk) gaps.push("SSOT 文档缺失");
      lines.push(
        `| \`${c.package}\` | ${c.completion}% | \`${c.maturity}\` | ${gaps.join("；") || "—"} |`,
      );
    }
  }

  lines.push(
    "",
    "## 维护（不必每次手同步）",
    "",
    "```text",
    "日常查看     make status                 → 写本地副本（gitignore，主仓可跑）",
    "持续监控     make status-watch           → 同上 + 定时/变更重扫",
    "入库更新     在 feature worktree 中 make status",
    "            （非 main 会写根目录 STATUS.md，随 crate PR 一并提交）",
    "强制入库     node scripts/docs/gen-crate-status.mjs --tracked",
    "CI 门禁     node scripts/docs/gen-crate-status.mjs --check",
    "```",
    "",
    "**何时更新入库 STATUS.md**：`Cargo.toml` members / crate 标准布局 / 测试面实质变化时，",
    "在同一 feature PR 里顺带刷新即可；**不要**为刷进度单独开 PR。",
    "",
    "本地实时副本：`docs/status/CRATES_STATUS.local.md`（已 gitignore）。",
    "",
    "相关：",
    "",
    "- [crates/AGENTS.md](crates/AGENTS.md) — 子模块标准布局",
    "- [docs/ssot/workspace-ssot-alignment.md](docs/ssot/workspace-ssot-alignment.md) — 镜像 vs 落地",
    "- [docs/status/](docs/status/) — CI 状态快照",
    "- [docs/plans/2026-07-21-core-crates-production-readiness.md](docs/plans/2026-07-21-core-crates-production-readiness.md) — 生产就绪计划（人签字）",
    "",
  );

  return lines.join("\n");
}

function pct(a, b) {
  if (!b) return 0;
  return Math.round((a / b) * 100);
}

/** 比较时忽略生成时间行 */
function normalize(body) {
  return body.replace(
    /> \*\*生成时间\*\*：.*/,
    "> **生成时间**：TIMESTAMP",
  );
}

function ensureParentDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeLocalCopy(body) {
  ensureParentDir(OUT_LOCAL);
  const banner =
    "<!-- LOCAL COPY (gitignore) — 主仓/任意 cwd 可刷；入库以根目录 STATUS.md 为准 -->\n";
  writeFileSync(OUT_LOCAL, banner + body, "utf8");
}

/** GitHub Actions Job Summary / 人读短摘要（stdout only） */
function renderSummary(crates) {
  const s = summarize(crates);
  const low = crates
    .filter((c) => c.completion < 70)
    .sort((a, b) => a.completion - b.completion)
    .slice(0, 10);
  const lines = [
    "## crates 子模块进度",
    "",
    "| 指标 | 值 |",
    "|------|-----|",
    `| members | ${s.n} |`,
    `| 布局七项齐全 | ${s.layoutFull}/${s.n} |`,
    `| 含测试 | ${s.withTests}/${s.n} |`,
    `| scaffold | ${s.scaffold} |`,
    `| **平均完成度** | **${s.avg}%** |`,
    "",
    "### 成熟度",
    "",
    "| 标签 | 数量 |",
    "|------|------|",
  ];
  for (const [k, v] of Object.entries(s.byMaturity).sort()) {
    lines.push(`| \`${k}\` | ${v} |`);
  }
  if (low.length) {
    lines.push("", "### 完成度 < 70%", "", "| Package | % | 成熟度 |", "|---------|---:|--------|");
    for (const c of low) {
      lines.push(`| \`${c.package}\` | ${c.completion} | \`${c.maturity}\` |`);
    }
  } else {
    lines.push("", "_无成员完成度 < 70%。_");
  }
  lines.push(
    "",
    "> 结构进度 ≠ Production Ready。详情见根目录 `STATUS.md`；本地副本 `docs/status/CRATES_STATUS.local.md`。",
    "",
  );
  return lines.join("\n");
}

function runOnce() {
  if (CHECK && (FORCE_TRACKED || LOCAL_ONLY || WATCH > 0 || SUMMARY)) {
    console.error("--check 不可与 --tracked / --local-only / --watch / --summary 混用");
    process.exit(2);
  }

  const crates = scanAll();
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const body = renderMarkdown(crates, generatedAt);

  if (SUMMARY) {
    // 摘要模式：只 stdout，可选刷新本地副本便于本地联调
    writeLocalCopy(body);
    process.stdout.write(renderSummary(crates));
    if (JSON_OUT) {
      process.stdout.write(
        "\n" + JSON.stringify({ summary: summarize(crates) }, null, 2) + "\n",
      );
    }
    return { crates, summary: summarize(crates) };
  }

  if (CHECK) {
    if (!existsSync(OUT)) {
      console.error(
        `FAIL: missing ${OUT}; run in a feature worktree: node scripts/docs/gen-crate-status.mjs`,
      );
      process.exit(1);
    }
    const cur = readFileSync(OUT, "utf8");
    if (normalize(cur) !== normalize(body)) {
      console.error(
        "FAIL: STATUS.md is stale; in a feature worktree run: node scripts/docs/gen-crate-status.mjs",
      );
      console.error(
        "hint: 日常查看用 make status（写 docs/status/CRATES_STATUS.local.md，不脏 main）",
      );
      process.exit(1);
    }
    console.log("OK: STATUS.md is up to date");
    // check 时也刷新本地副本，方便主仓即时查看
    writeLocalCopy(body);
    if (JSON_OUT) {
      console.log(JSON.stringify({ summary: summarize(crates), crates }, null, 2));
    }
    process.exit(0);
  }

  writeLocalCopy(body);
  const s = summarize(crates);
  const stats = `${s.n} crates, avg ${s.avg}%, layout-full ${s.layoutFull}/${s.n}`;
  console.log(`wrote ${OUT_LOCAL} (${stats})`);

  if (shouldWriteTracked()) {
    writeFileSync(OUT, body, "utf8");
    console.log(`wrote ${OUT} (tracked)`);
  } else {
    const branch = currentBranch() || "(unknown)";
    console.log(
      `skip tracked STATUS.md (branch=${branch}; use --tracked in worktree when crates layout changed)`,
    );
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary: s, crates }, null, 2));
  }
  return { crates, summary: s };
}

function startWatch() {
  console.log(`watch: rescan every ${WATCH}s + on crates/ changes (Ctrl+C to stop)`);
  runOnce();
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        runOnce();
      } catch (e) {
        console.error("watch rescan failed:", e.message || e);
      }
    }, 400);
  };
  const interval = setInterval(() => {
    try {
      runOnce();
    } catch (e) {
      console.error("watch interval failed:", e.message || e);
    }
  }, WATCH * 1000);

  const cratesRoot = join(ROOT, "crates");
  try {
    fsWatch(cratesRoot, { recursive: true }, schedule);
  } catch {
    // 部分 FS 不支持 recursive；仍依赖 interval
    console.warn("fs.watch recursive unavailable; interval-only mode");
  }

  process.on("SIGINT", () => {
    clearInterval(interval);
    process.exit(0);
  });
}

if (WATCH > 0) {
  if (CHECK) {
    console.error("--watch 与 --check 互斥");
    process.exit(2);
  }
  startWatch();
} else {
  runOnce();
}

// 供测试/复用
export {
  OUT,
  OUT_LOCAL,
  shouldWriteTracked,
  currentBranch,
  normalize,
  scanAll,
  renderMarkdown,
  summarize,
};
