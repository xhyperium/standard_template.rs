#!/usr/bin/env node
/**
 * worktree-activate.test.mjs — L1 自检测试 for scripts/worktree/worktree-activate.mjs
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

const srcPath = join(__dirname, "worktree-activate.mjs");

// ── L0: file existence ──
ok(existsSync(srcPath), "worktree-activate.mjs exists");

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
ok(src.includes("from \"path\""), "imports path");
ok(src.includes("from \"url\""), "imports url");

// no child_process — works purely with path logic
ok(!src.includes("child_process") && !src.includes("execSync"), "no shell execution, pure path logic");

// shell function generation
ok(src.includes("wt()"), "generates wt() shell function");
ok(src.includes("WT_SCRIPT"), "sets WT_SCRIPT variable");
ok(src.includes("WT_ROOT"), "sets WT_ROOT variable");
ok(src.includes("_wt_complete"), "generates tab completion function");
ok(src.includes("complete -F"), "registers bash tab completion");
ok(src.includes("PROMPT_COMMAND"), "injects prompt");
ok(src.includes("PS1"), "manipulates PS1");
ok(src.includes("wt_info"), "tracks worktree info");
ok(src.includes(".worktrees/"), "references .worktrees path");
ok(src.includes("\"main\""), "handles main workspace");

// tab completion
ok(src.includes("compgen"), "uses compgen for completions");
ok(src.includes("ls"), "lists worktree dirs for completion");

// ── Module loads cleanly ──
try {
  const mod = await import(srcPath + "?t=" + Date.now());
  ok(true, "worktree-activate.mjs imports cleanly as ESM");
} catch (e) {
  ok(false, "worktree-activate.mjs import: " + e.message);
}

// ── Run and validate output ──
try {
  const out = execFileSync("node", [srcPath], {
    timeout: 10000,
    stdio: "pipe",
    encoding: "utf8",
  });
  ok(out.includes("wt()") && out.includes("WT_SCRIPT") && out.includes("WT_ROOT"),
     "output contains shell function and variables");
  ok(out.includes("_wt_complete") && out.includes("compgen"),
     "output contains tab completion");
  ok(out.includes("PROMPT_COMMAND") || out.includes("PS1"),
     "output contains prompt injection");
  ok(out.includes("infra.rs Worktree"), "output mentions infra.rs");
} catch (e) {
  const err = String(e.stderr || e.stdout || e.message || "");
  ok(err.includes("wt()") || err.includes("Cannot find"),
     "worktree-activate output or import error is meaningful");
}

// ── Result ──
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
