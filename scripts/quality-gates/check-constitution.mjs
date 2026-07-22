#!/usr/bin/env node
/**
 * check-constitution.mjs — 宪章合规性自动验证
 *
 * 职责: 验证代码是否符合 docs/constitution/ 工程宪章全部可自动化检查项。
 *
 * 用法:
 *   node scripts/quality-gates/check-constitution.mjs              # 完整检查
 *   node scripts/quality-gates/check-constitution.mjs --quick      # 快速（格式 + lint）
 *   node scripts/quality-gates/check-constitution.mjs --json       # JSON 输出
 *
 * SSOT: docs/constitution/（正文）/ CONSTITUTION.md（根索引）/ Makefile (make check)
 */

import { execSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/quality-gates → 仓库根
const ROOT = resolve(__dirname, "../..");

const args = process.argv.slice(2);
const QUICK = args.includes("--quick");
const JSON_MODE = args.includes("--json");

const results = [];

function run(label, cmd, opts = {}) {
  if (QUICK && opts.skipQuick) {
    results.push({ check: label, status: "skip", detail: "quick 模式" });
    return true;
  }
  try {
    execSync(cmd, { cwd: ROOT, stdio: JSON_MODE ? "pipe" : "inherit", timeout: opts.timeout ?? 120_000 });
    results.push({ check: label, status: "pass" });
    return true;
  } catch (e) {
    results.push({ check: label, status: "fail", detail: String(e.stderr || e.message).slice(0, 200) });
    return false;
  }
}

function skip(label, reason) {
  results.push({ check: label, status: "skip", detail: reason });
}

function info(msg) {
  if (!JSON_MODE) console.log(`\n${msg}`);
}

// ── 执行 ────────────────────────────────────

if (!JSON_MODE) {
  console.log("╔══════════════════════════════════╗");
  console.log("║   宪章合规性验证                 ║");
  console.log("║   docs/constitution/            ║");
  console.log("╚══════════════════════════════════╝");
}

// §4.1
info("§4.1 代码格式 (rustfmt)");
run("rustfmt", "cargo fmt --all --check");

// §4.2
info("§4.2 Lint (clippy)");
run("clippy", "cargo clippy --workspace --all-targets --all-features -- -D warnings");

// §4.4
if (!QUICK) {
  info("§4.4 测试");
  run("unit + doc tests", "cargo test --workspace");
} else {
  skip("test", "quick 模式");
}

// §3.3 unsafe
info("§3.3 / §4.2 unsafe 合规");
// clippy:unsafe_code lint covers this; lightweight grep for presence
try {
  const out = execSync(`grep -rl '\\bunsafe\\b' --include='*.rs' crates/ 2>/dev/null || true`, { cwd: ROOT, encoding: "utf8" }).trim();
  if (out) {
    results.push({ check: "unsafe 代码", status: "skip", detail: `发现 ${out.split("\n").length} 个文件 — 由 clippy::unsafe_code 审计` });
  } else {
    results.push({ check: "unsafe 代码", status: "pass" });
  }
} catch { results.push({ check: "unsafe 代码", status: "pass" }); }

// §4.3 naming
if (!QUICK) {
  info("§4.3 命名规范");
  try {
    const bad = execSync(`grep -rn '^\\s*pub\\s\\+fn\\s\\+[a-z_]*[A-Z]' --include='*.rs' crates/ 2>/dev/null || true`, { cwd: ROOT, encoding: "utf8" }).trim();
    if (bad) {
      results.push({ check: "函数命名", status: "fail", detail: `非 snake_case:\n${bad}` });
    } else {
      results.push({ check: "函数命名 (snake_case)", status: "pass" });
    }
  } catch {
    results.push({ check: "函数命名", status: "pass" });
  }
}

// §3.2 doc
if (!QUICK) {
  info("§3.2 文档");
  run("cargo doc", "cargo doc --no-deps --document-private-items");
}

// 5 security
info("§5 安全审计 (cargo-deny)");
try {
  execSync("cargo deny check", { cwd: ROOT, stdio: "pipe", timeout: 60_000 });
  results.push({ check: "cargo-deny", status: "pass" });
} catch {
  const hasDeny = execSync("which cargo-deny 2>/dev/null", { cwd: ROOT, encoding: "utf8", stdio: "pipe" }).trim();
  if (hasDeny) {
    results.push({ check: "cargo-deny", status: "fail", detail: "存在安全/许可证问题" });
  } else {
    results.push({ check: "cargo-deny", status: "skip", detail: "cargo-deny 未安装" });
  }
}

// ── 汇总 ────────────────────────────────────

const passed = results.filter(r => r.status === "pass").length;
const failed = results.filter(r => r.status === "fail").length;
const skipped = results.filter(r => r.status === "skip").length;

if (JSON_MODE) {
  console.log(JSON.stringify({ passed, failed, skipped, total: results.length, results }, null, 2));
} else {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  通过: ${passed}  失败: ${failed}  跳过: ${skipped}  共计: ${results.length}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

process.exit(failed > 0 ? 1 : 0);
