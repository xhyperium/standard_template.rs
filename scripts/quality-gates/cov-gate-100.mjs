#!/usr/bin/env node
/**
 * 行覆盖率 100% 门禁（LCOV DA 计数）。
 *
 * 对指定 package 运行 `cargo llvm-cov --lcov`，校验过滤后的源码路径中
 * 不存在 `DA:<line>,0`（每条可插桩行至少执行一次）。
 *
 * 用法:
 *   node scripts/quality-gates/cov-gate-100.mjs -p kernel --filter crates/kernel/src
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function usage(code = 1) {
  console.error(
    "usage: node scripts/quality-gates/cov-gate-100.mjs -p <package> --filter <path-substr> [--extra cargo-llvm-cov-args...]",
  );
  process.exit(code);
}

const args = process.argv.slice(2);
let pkg = null;
let filter = null;
const extra = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-p" || args[i] === "--package") {
    pkg = args[++i];
  } else if (args[i] === "--filter") {
    filter = args[++i];
  } else if (args[i] === "-h" || args[i] === "--help") {
    usage(0);
  } else {
    extra.push(args[i]);
  }
}
if (!pkg || !filter) usage(1);

const dir = mkdtempSync(join(tmpdir(), "cov-gate-"));
const lcovPath = join(dir, "cov.lcov");

try {
  const clean = spawnSync("cargo", ["llvm-cov", "clean", "--workspace"], {
    encoding: "utf8",
    stdio: "inherit",
  });
  if (clean.status !== 0) {
    console.error("cargo llvm-cov clean failed");
    process.exit(clean.status ?? 1);
  }

  const covArgs = [
    "llvm-cov",
    "-p",
    pkg,
    "--lcov",
    "--output-path",
    lcovPath,
    ...extra,
  ];
  console.log(`+ cargo ${covArgs.join(" ")}`);
  const cov = spawnSync("cargo", covArgs, { encoding: "utf8", stdio: "inherit" });
  if (cov.status !== 0) {
    console.error("cargo llvm-cov failed");
    process.exit(cov.status ?? 1);
  }

  const text = readFileSync(lcovPath, "utf8");
  let cur = null;
  let instrumented = 0;
  let hit = 0;
  const zeros = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      cur = line.slice(3);
      continue;
    }
    if (!cur || !cur.includes(filter)) continue;
    if (!line.startsWith("DA:")) continue;
    const body = line.slice(3);
    const [ln, count] = body.split(",");
    instrumented += 1;
    if (count === "0") {
      zeros.push(`${cur}:${ln}`);
    } else {
      hit += 1;
    }
  }

  const pct = instrumented === 0 ? 100 : (100 * hit) / instrumented;
  console.log(
    `${pkg}: instrumented=${instrumented} hit=${hit} zeros=${zeros.length} line%=${pct.toFixed(4)}`,
  );
  if (zeros.length > 0) {
    console.error("uncovered lines (DA:*,0):");
    for (const z of zeros.slice(0, 50)) console.error(`  ${z}`);
    if (zeros.length > 50) console.error(`  ... +${zeros.length - 50} more`);
    process.exit(1);
  }
  if (instrumented === 0) {
    console.error("no instrumented lines matched filter; refusing empty pass");
    process.exit(1);
  }
  console.log(`${pkg}: PASS line coverage 100% (LCOV)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
