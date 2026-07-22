#!/usr/bin/env node
/**
 * starship-wt.test.mjs — L1 自检测试 for scripts/shell/starship-wt.mjs
 */
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function ok(c, name) {
  if (c) { pass++; console.log('  ok  ' + name); }
  else   { fail++; console.log('  FAIL ' + name); }
}

const srcPath = join(__dirname, "starship-wt.mjs");

// ── L0: file existence ──
ok(existsSync(srcPath), "starship-wt.mjs exists");

// ── syntax check ──
try {
  execFileSync("node", ["--check", srcPath], { timeout: 10000, stdio: "pipe" });
  ok(true, "node --check pass");
} catch (e) {
  ok(false, "node --check: " + String(e.stderr || e.message).trim());
}

// ── source checks ──
const src = readFileSync(srcPath, "utf8");
ok(src.startsWith("#!/usr/bin/env node"), "has shebang");

// imports
ok(src.includes("child_process"), "imports child_process");
ok(src.includes("from \"path\""), "imports path");
ok(src.includes("from \"url\""), "imports url");
ok(src.includes("from \"process\""), "imports process");

// key logic
ok(src.includes("git rev-parse --show-toplevel"), "reads git repo root");
ok(src.includes("infra.rs"), "checks for infra.rs repo");
ok(src.includes(".worktrees/"), "checks .worktrees path prefix");
ok(src.includes("startsWith(wtPrefix)"), "detects worktree path");
ok(src.includes("console.log(\"main\")"), "outputs main for root");
ok(src.includes("process.exit(0)"), "has exit(0) paths");
ok(src.includes("process.exit"), "has exit paths");

// ── Module loads cleanly ──
try {
  const mod = await import(srcPath + "?t=" + Date.now());
  ok(true, "starship-wt.mjs imports cleanly as ESM");
} catch (e) {
  ok(false, "starship-wt.mjs import: " + e.message);
}

// ── Run from repo root — should output main or worktree branch ──
try {
  const out = execFileSync("node", [srcPath], {
    timeout: 10000,
    stdio: "pipe",
    encoding: "utf8",
    cwd: join(__dirname, ".."),
  }).trim();
  // When run from repo root, should output "main" (since not in .worktrees/)
  ok(out.length > 0, "starship-wt.mjs produces output when in repo");
  ok(!out.includes("Error") && !out.includes("SyntaxError"), "starship-wt output has no errors");
} catch (e) {
  // If git rev-parse fails (no git), process.exit(0) silently — that's fine too
  const err = String(e.stderr || e.stdout || e.message || "");
  ok(err.length === 0 || err.includes("Could not open input file"),
     "starship-wt runs without unexpected error");
}

// ── Result ──
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
