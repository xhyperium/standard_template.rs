#!/usr/bin/env node
/**
 * check-public-api.mjs — 核心 crate 公开 API 与 checked-in baseline 比对
 *
 * DEFER-5 / PLAN-CORE-PROD-002 W5（infra-asa.6）
 *
 * 用法:
 *   node scripts/quality-gates/check-public-api.mjs
 *   node scripts/quality-gates/check-public-api.mjs --help
 *   node scripts/quality-gates/check-public-api.mjs -p kernel
 *   node scripts/quality-gates/check-public-api.mjs --update
 *   node scripts/quality-gates/check-public-api.mjs --allow-breaking
 *   node scripts/quality-gates/check-public-api.mjs --require-tool   # 工具缺失则失败（CI）
 *
 * 环境:
 *   PUBLIC_API_ALLOW_BREAKING=1  等同 --allow-breaking
 *   REGEN=1                      等同 --update（刷新 baseline）
 *
 * 退出码: 0 通过；1 有意外 diff 或工具/基线问题；2 用法错误
 */
import { spawnSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const BASELINE_DIR = join(ROOT, "docs", "api-baselines");

/** 门禁覆盖的 package（与 docs/api-baselines/*.txt 对齐） */
const DEFAULT_PACKAGES = [
  "kernel",
  "testkit",
  "decimalx",
  "canonical",
  "contracts",
];

const args = process.argv.slice(2);

function printHelp() {
  console.log(`check-public-api.mjs — public API baseline gate (DEFER-5)

Usage:
  node scripts/quality-gates/check-public-api.mjs [options]

Options:
  -h, --help            Show this help
  -p, --package <name>  Only check package (repeatable). Default: ${DEFAULT_PACKAGES.join(", ")}
  --update              Rewrite baselines from current public API
  --allow-breaking      Exit 0 even when diff is non-empty (still prints diff)
  --require-tool        Fail if cargo-public-api is not installed (CI)
  --list                List default packages and baseline paths

Env:
  PUBLIC_API_ALLOW_BREAKING=1   Same as --allow-breaking
  REGEN=1                       Same as --update

Baselines: docs/api-baselines/<package>.txt
Tool: cargo public-api -p <pkg> --simplified --color never
Install: cargo install cargo-public-api --locked
     or:  (CI) taiki-e/install-action with tool: cargo-public-api

Without cargo-public-api (local soft mode): still require baselines present + non-empty;
prints notice and skips live API diff.
`);
}

function parseArgs(argv) {
  const out = {
    help: false,
    update: process.env.REGEN === "1",
    allowBreaking: process.env.PUBLIC_API_ALLOW_BREAKING === "1",
    requireTool: false,
    list: false,
    packages: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--update") out.update = true;
    else if (a === "--allow-breaking") out.allowBreaking = true;
    else if (a === "--require-tool") out.requireTool = true;
    else if (a === "--list") out.list = true;
    else if (a === "-p" || a === "--package") {
      const name = argv[++i];
      if (!name) {
        console.error("error: -p/--package requires a name");
        process.exit(2);
      }
      out.packages.push(name);
    } else {
      console.error(`error: unknown argument: ${a}`);
      printHelp();
      process.exit(2);
    }
  }
  if (out.packages.length === 0) out.packages = [...DEFAULT_PACKAGES];
  return out;
}

function baselinePath(pkg) {
  return join(BASELINE_DIR, `${pkg}.txt`);
}

function toolAvailable() {
  const r = spawnSync("cargo", ["public-api", "--version"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  return r.status === 0;
}

function capturePublicApi(pkg) {
  // cargo-public-api needs rustdoc JSON (nightly). Prefer +nightly when available.
  const r = spawnSync(
    "cargo",
    ["+nightly", "public-api", "-p", pkg, "--simplified", "--color", "never"],
    {
      encoding: "utf8",
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
    },
  );
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim();
    return {
      ok: false,
      error: err || `cargo public-api -p ${pkg} exited ${r.status}`,
    };
  }
  // stdout = API lines; stderr = cargo "Documenting…" noise
  const text = (r.stdout || "").replace(/\r\n/g, "\n");
  const normalized = text.endsWith("\n") || text.length === 0 ? text : `${text}\n`;
  return { ok: true, text: normalized };
}

function unifiedDiff(expected, actual, label) {
  const a = expected.split("\n");
  const b = actual.split("\n");
  // drop trailing empty from final newline
  if (a.length && a[a.length - 1] === "") a.pop();
  if (b.length && b[b.length - 1] === "") b.pop();

  const aSet = new Set(a);
  const bSet = new Set(b);
  const removed = a.filter((line) => !bSet.has(line));
  const added = b.filter((line) => !aSet.has(line));

  if (removed.length === 0 && added.length === 0) {
    // multiset / order drift: fall back to line-by-line
    if (expected === actual) return null;
    const lines = [`--- baseline ${label}`, `+++ current ${label}`];
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < max; i++) {
      if (a[i] !== b[i]) {
        if (a[i] !== undefined) lines.push(`- ${a[i]}`);
        if (b[i] !== undefined) lines.push(`+ ${b[i]}`);
      }
    }
    return lines.join("\n");
  }

  const lines = [
    `--- baseline ${label}`,
    `+++ current ${label}`,
    `@@ removed ${removed.length} / added ${added.length} @@`,
  ];
  for (const line of removed) lines.push(`- ${line}`);
  for (const line of added) lines.push(`+ ${line}`);
  return lines.join("\n");
}

/** 工具缺失时：仍强制 baseline 文件存在且非空，再可选跑 cargo doc。 */
function softBaselinePresenceCheck(packages) {
  console.error(
    "notice: cargo-public-api 未安装 — 跳过 live API diff；仅校验 baseline 存在且非空。",
  );
  console.error(
    "安装: cargo install cargo-public-api --locked\n" +
      "或 CI: taiki-e/install-action  tool: cargo-public-api",
  );

  let failures = 0;
  for (const pkg of packages) {
    const bpath = baselinePath(pkg);
    const rel = relative(ROOT, bpath);
    if (!existsSync(bpath)) {
      console.error(`FAIL missing baseline: ${rel}`);
      failures++;
      continue;
    }
    const text = readFileSync(bpath, "utf8").trim();
    if (text.length === 0) {
      console.error(`FAIL empty baseline: ${rel}`);
      failures++;
      continue;
    }
    console.error(`OK present ${rel} (${text.split("\n").length} lines)`);
  }

  if (failures > 0) {
    console.error(
      `\npublic-api gate: FAIL (${failures} baseline issue(s); tool missing so no live diff).`,
    );
    return 1;
  }

  const pkgs = packages.flatMap((p) => ["-p", p]);
  const r = spawnSync(
    "cargo",
    ["doc", "--no-deps", "--all-features", ...pkgs],
    {
      encoding: "utf8",
      cwd: ROOT,
      stdio: "inherit",
    },
  );
  if (r.status !== 0) {
    console.error("error: cargo doc --no-deps 失败");
    return 1;
  }
  console.log(
    "public-api gate: SOFT PASS (baselines present; install cargo-public-api for baseline diff)",
  );
  return 0;
}

function main() {
  const opts = parseArgs(args);
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (opts.list) {
    for (const p of DEFAULT_PACKAGES) {
      const rel = relative(ROOT, baselinePath(p));
      console.log(`${p}\t${rel}\t${existsSync(baselinePath(p)) ? "ok" : "MISSING"}`);
    }
    return 0;
  }

  if (!toolAvailable()) {
    if (opts.requireTool) {
      console.error(
        "error: cargo-public-api 未安装（--require-tool）。\n" +
          "  cargo install cargo-public-api --locked\n" +
          "  CI: uses: taiki-e/install-action@v2  with: tool: cargo-public-api",
      );
      return 1;
    }
    if (opts.update) {
      console.error("error: --update 需要已安装 cargo-public-api");
      return 1;
    }
    return softBaselinePresenceCheck(opts.packages);
  }

  mkdirSync(BASELINE_DIR, { recursive: true });

  let failures = 0;
  let diffs = 0;

  for (const pkg of opts.packages) {
    process.stderr.write(`public-api: ${pkg}… `);
    const cap = capturePublicApi(pkg);
    if (!cap.ok) {
      console.error("FAIL");
      console.error(cap.error);
      failures++;
      continue;
    }

    const bpath = baselinePath(pkg);
    if (opts.update) {
      writeFileSync(bpath, cap.text, "utf8");
      console.error(`updated ${relative(ROOT, bpath)} (${cap.text.split("\n").length - 1} lines)`);
      continue;
    }

    if (!existsSync(bpath)) {
      console.error("FAIL (missing baseline)");
      console.error(
        `  缺少 ${relative(ROOT, bpath)}；运行:\n` +
          `  node scripts/quality-gates/check-public-api.mjs --update -p ${pkg}`,
      );
      failures++;
      continue;
    }

    const baseline = readFileSync(bpath, "utf8").replace(/\r\n/g, "\n");
    if (baseline === cap.text) {
      console.error("OK");
      continue;
    }

    diffs++;
    console.error("DIFF");
    const d = unifiedDiff(baseline, cap.text, pkg);
    console.log(d);
    if (!opts.allowBreaking) failures++;
  }

  if (opts.update) {
    console.log(
      `public-api gate: baselines updated for ${opts.packages.join(", ")}`,
    );
    return 0;
  }

  if (failures > 0) {
    console.error(
      `\npublic-api gate: FAIL (${failures} package(s)).\n` +
        "  若为预期 additive/breaking：更新 baseline 并在 PR 说明；\n" +
        "  breaking 请打 label `api-breaking` 或本地 --allow-breaking 探查。\n" +
        "  node scripts/quality-gates/check-public-api.mjs --update",
    );
    return 1;
  }

  if (diffs > 0 && opts.allowBreaking) {
    console.log(
      `public-api gate: PASS with allowed breaking (${diffs} diff package(s))`,
    );
    return 0;
  }

  console.log(
    `public-api gate: OK (${opts.packages.length} package(s), baselines match)`,
  );
  return 0;
}

process.exit(main());
