#!/usr/bin/env node
/**
 * ci-monitor.mjs — CI 状态监控器
 *
 * 监视 develop 和 main 分支的 coverage workflow 运行状态，自动报告结果。
 *
 * 用法:
 *   node scripts/workflow/ci-monitor.mjs                     # 检查最近一次运行
 *   node scripts/workflow/ci-monitor.mjs --watch             # 轮询直到全部完成
 *   node scripts/workflow/ci-monitor.mjs --json              # JSON 输出
 *   node scripts/workflow/ci-monitor.mjs --ref <branch>     # ���定分支
 */

import { execSync } from "child_process";

const args = process.argv.slice(2);
const WATCH = args.includes("--watch");
const JSON_MODE = args.includes("--json");
const refIdx = args.indexOf("--ref");
const REF = refIdx >= 0 ? args[refIdx + 1] : "develop";

const WORKFLOWS = [
  "kernel", "testkit", "configx", "observex", "resiliencx",
  "schedulex", "contracts", "canonical", "decimal", "evidence",
];

function getRun(name) {
  try {
    const out = execSync(
      `gh run list -w ${name}-coverage.yml --branch ${REF} --limit 1 --json conclusion,status,databaseId,headSha`,
      { encoding: "utf8", stdio: "pipe" }
    );
    const data = JSON.parse(out);
    return data[0] || null;
  } catch {
    return null;
  }
}

async function poll(maxWait = 300) {
  const start = Date.now();
  if (!JSON_MODE) console.log(`Monitoring ${REF} branch CI (timeout: ${maxWait}s)...\n`);

  while ((Date.now() - start) / 1000 < maxWait) {
    const results = {};
    let done = 0, total = WORKFLOWS.length;

    for (const wf of WORKFLOWS) {
      const run = getRun(wf);
      if (run) {
        results[wf] = run.conclusion || run.status;
        if (run.conclusion) done++;
      }
    }

    if (!JSON_MODE) {
      console.clear();
      printTable(results, done, total);
    }

    if (done === total) {
      if (JSON_MODE) console.log(JSON.stringify(results, null, 2));
      else printSummary(results, done, total);
      return;
    }

    await new Promise(r => setTimeout(r, 10000));
  }

  console.log("Timeout: some workflows still running");
}

function printTable(results, done, total) {
  console.log(`  ${REF} branch — ${done}/${total} complete\n`);
  console.log("  Crate          Status");
  console.log("  ──────────────────────");
  for (const wf of WORKFLOWS) {
    const status = results[wf] || "pending";
    const icon = status === "success" ? "✓" : status === "failure" ? "✗" : "⟳";
    console.log(`  ${icon} ${wf.padEnd(12)} ${status}`);
  }
}

function printSummary(results, done, total) {
  const passes = Object.values(results).filter(s => s === "success").length;
  const fails = Object.values(results).filter(s => s === "failure").length;
  console.log(`\n  ${passes}/${total} pass, ${fails}/${total} fail`);
  process.exit(fails > 0 ? 1 : 0);
}

// Single-shot mode
if (!WATCH) {
  const results = {};
  for (const wf of WORKFLOWS) {
    const run = getRun(wf);
    results[wf] = run ? (run.conclusion || run.status) : "not found";
  }

  if (JSON_MODE) {
    console.log(JSON.stringify({ ref: REF, results, timestamp: new Date().toISOString() }, null, 2));
  } else {
    printTable(results, Object.values(results).filter(s => s !== "not found" && s !== "in_progress").length, WORKFLOWS.length);
    const passes = Object.values(results).filter(s => s === "success").length;
    const fails = Object.values(results).filter(s => s === "failure").length;
    printSummary(results, passes + fails, WORKFLOWS.length);
  }
} else {
  poll(300);
}
