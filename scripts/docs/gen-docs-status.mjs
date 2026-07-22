#!/usr/bin/env node
/**
 * gen-docs-status.mjs — 从 .github/workflows 生成 CI 工作流矩阵快照
 *
 * 用法:
 *   node scripts/docs/gen-docs-status.mjs           # 写入 docs/status/CI_WORKFLOW_MATRIX.generated.md
 *   node scripts/docs/gen-docs-status.mjs --check   # 仅校验是否与已生成文件一致
 *
 * SSOT: docs/status/README.md
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const WF_DIR = join(ROOT, ".github", "workflows");
const OUT = join(ROOT, "docs", "status", "CI_WORKFLOW_MATRIX.generated.md");
const CHECK = process.argv.includes("--check");

function parseWorkflow(file, text) {
  const nameMatch = text.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  const name = nameMatch ? nameMatch[1].trim() : file;

  // crude job names: under jobs: keys at indent 2
  const jobs = [];
  let inJobs = false;
  for (const line of text.split("\n")) {
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (inJobs) {
      if (/^[a-zA-Z_]/.test(line) && !line.startsWith(" ")) {
        // next top-level key
        break;
      }
      const m = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
      if (m) jobs.push(m[1]);
    }
  }

  // triggers summary
  const triggers = [];
  if (/^\s+push:/m.test(text) || /^on:\s*\n\s+push:/m.test(text) || /on:\s*\[.*push/m.test(text)) {
    triggers.push("push");
  }
  if (/pull_request/m.test(text)) triggers.push("pull_request");
  if (/schedule:/m.test(text)) triggers.push("schedule");
  if (/workflow_dispatch/m.test(text)) triggers.push("workflow_dispatch");
  // also catch on: [push, pull_request]
  const onLine = text.match(/^on:\s*\[([^\]]+)\]/m);
  if (onLine) {
    for (const t of onLine[1].split(",")) {
      const s = t.trim();
      if (s && !triggers.includes(s)) triggers.push(s);
    }
  }

  return { file, name, jobs, triggers: triggers.length ? triggers : ["(see workflow)"] };
}

const files = readdirSync(WF_DIR)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .sort();

const rows = files.map((f) => parseWorkflow(f, readFileSync(join(WF_DIR, f), "utf8")));

const now = new Date().toISOString().slice(0, 10);
const lines = [
  "# CI 工作流矩阵（自动生成）",
  "",
  `> **生成方式**：\`node scripts/docs/gen-docs-status.mjs\``,
  `> **生成日期**：${now}`,
  `> **源目录**：\`.github/workflows/\``,
  `> **勿手改**：本文件由脚本覆盖；叙事性说明见 [CI_STATUS_REPORT.md](CI_STATUS_REPORT.md) / [CONFIG_SUMMARY.md](CONFIG_SUMMARY.md)。`,
  "",
  "## 工作流一览",
  "",
  "| 文件 | name | 触发（启发式） | Jobs |",
  "|------|------|----------------|------|",
];

for (const r of rows) {
  const jobs = r.jobs.length ? r.jobs.map((j) => `\`${j}\``).join(", ") : "—";
  const trig = r.triggers.join(", ");
  lines.push(`| \`${r.file}\` | ${r.name} | ${trig} | ${jobs} |`);
}

lines.push(
  "",
  "## 统计",
  "",
  `| 指标 | 值 |`,
  `|------|-----|`,
  `| 工作流文件数 | ${rows.length} |`,
  `| Job 总数（解析） | ${rows.reduce((n, r) => n + r.jobs.length, 0)} |`,
  "",
  "## 维护",
  "",
  "```bash",
  "node scripts/docs/gen-docs-status.mjs          # 重新生成",
  "node scripts/docs/gen-docs-status.mjs --check  # CI/本地一致性检查",
  "```",
  "",
);

const body = lines.join("\n");

if (CHECK) {
  if (!existsSync(OUT)) {
    console.error(`FAIL: missing ${OUT}; run without --check first`);
    process.exit(1);
  }
  const cur = readFileSync(OUT, "utf8");
  // Compare ignoring generation date line
  const norm = (s) => s.replace(/> \*\*生成日期\*\*：\d{4}-\d{2}-\d{2}/, "> **生成日期**：DATE");
  if (norm(cur) !== norm(body)) {
    console.error("FAIL: CI_WORKFLOW_MATRIX.generated.md is stale; run: node scripts/docs/gen-docs-status.mjs");
    process.exit(1);
  }
  console.log("OK: CI_WORKFLOW_MATRIX.generated.md is up to date");
  process.exit(0);
}

writeFileSync(OUT, body, "utf8");
console.log(`wrote ${OUT} (${rows.length} workflows)`);
