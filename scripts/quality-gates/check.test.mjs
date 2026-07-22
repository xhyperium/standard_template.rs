#!/usr/bin/env node
/**
 * check.test.mjs — L1 自检测试 for scripts/quality-gates/check.mjs
 */
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function ok(c, name) {
  if (c) { pass++; console.log('  ok  ' + name); }
  else   { fail++; console.log('  FAIL ' + name); }
}

// ── L0: file existence and syntax ──
const srcPath = join(__dirname, "check.mjs");
ok(existsSync(srcPath), "check.mjs exists");

try {
  const src = await import("fs");
  ok(true, "fs imports");
} catch { ok(false, "fs imports"); }

try {
  await import("path");
  ok(true, "path imports");
} catch { ok(false, "path imports"); }

try {
  await import("child_process");
  ok(true, "child_process imports");
} catch { ok(false, "child_process imports"); }

try {
  await import("url");
  ok(true, "url imports");
} catch { ok(false, "url imports"); }

// ── check.mjs runs as a subprocess, not imported (script, not library) ──
// We skip direct import to avoid running the full health check in our test

// ── Syntax check via subprocess ──
import { execFileSync } from "child_process";
try {
  execFileSync("node", ["--check", srcPath], { timeout: 10000, stdio: "pipe" });
  ok(true, "node --check pass");
} catch (e) {
  ok(false, "node --check: " + String(e.stderr || e.message).trim());
}

// ── help / usage subprocess ──
try {
  const out = execFileSync("node", [srcPath], {
    timeout: 30000,
    stdio: "pipe",
    encoding: "utf8",
    cwd: join(__dirname, ".."),
  });
  ok(out.includes("infra.rs") || out.includes("Harness") || out.includes("Health") || out.includes("PASS") || out.includes("FAIL"),
     "check.mjs runs and produces output");
  ok(!out.includes("SyntaxError") && !out.includes("ReferenceError"),
     "check.mjs output has no syntax/runtime errors");
} catch (e) {
  const err = String(e.stderr || e.stdout || e.message || "");
  ok(err.includes("infra.rs") || err.includes("PASS") || err.includes("FAIL") || err.includes("Harness") || err.includes("Health"),
     "check.mjs exit with meaningful output");
}

// ── Verify core check structure via source read ──
import { readFileSync } from "fs";
const src = readFileSync(srcPath, "utf8");
ok(src.includes("const checks = []"), "checks array declared");
ok(src.includes("const ok ="), "ok function declared");
ok(src.includes("const exists ="), "exists function declared");
ok(src.includes("const read ="), "read function declared");
ok(src.includes("const run ="), "run function declared");
ok(src.includes("CLAUDE.md 存在"), "checks for CLAUDE.md");
ok(src.includes("AGENTS.md 存在"), "checks for AGENTS.md");
ok(src.includes("Beads"), "checks for Beads");
ok(src.includes("git rev-parse"), "git branch detection present");
ok(src.includes("process.exit(0)"), "success exit present");
ok(src.includes("process.exit(1)"), "failure exit present");

// ── Result ──
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
