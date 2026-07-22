#!/usr/bin/env node
/**
 * check-workspace-deps.test.mjs — 依赖集中管理门禁脚本 L1 测试套件
 *
 * 被测脚本: check-workspace-deps.mjs
 * 调用方式: node check-workspace-deps.mjs [--root <dir>] [--json]
 *
 * 覆盖:
 *   1. 已统一 fixture PASS (workspace 引用 + 合法 path 依赖)
 *   2. 内联裸版本 FAIL (R-DEP-001)
 *   3. 内联 inline-table 版本 FAIL (R-DEP-001)
 *   4. 未解析 workspace 引用 FAIL (R-DEP-002)
 *   5. 仅 path 依赖 + workspace 引用 PASS
 *   6. 真实仓库集成 PASS (不带 --root, 自动解析仓库根)
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, "check-workspace-deps.mjs");

let passed = 0;
let failed = 0;

/**
 * 以指定参数运行校验脚本，返回 { status, stdout, stderr, out }
 * out 为 stdout 与 stderr 合并，便于断言 PASS/FAIL 与错误码出现位置。
 */
function run(args = [], env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    encoding: "utf-8",
    timeout: 15_000,
  });
  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  return {
    status: result.status ?? null,
    stdout,
    stderr,
    out: `${stdout}\n${stderr}`.trim(),
    error: result.error || null,
  };
}

function assert(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * 在 os.tmpdir() 下创建临时根目录，调用 fn(tmp)，最终清理。
 */
function withTempRoot(fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ws-deps-"));
  try {
    fn(tmp);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** 写入根 Cargo.toml 的 [workspace.dependencies] 段 (deps 为段内文本) */
function writeRoot(tmp, deps) {
  const content = `[workspace]\nmembers = []\n\n[workspace.dependencies]\n${deps}\n`;
  fs.writeFileSync(path.join(tmp, "Cargo.toml"), content, "utf-8");
}

/** 在 <root>/<rel> 写入 crate/tool 的 Cargo.toml */
function writeManifest(tmp, rel, content) {
  const full = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

console.log("\n=== 测试: 已统一 fixture 通过校验 (workspace 引用 + 合法 path 依赖) ===\n");
withTempRoot((tmp) => {
  writeRoot(tmp, `serde = "1"\ntokio = "1"\n`);
  writeManifest(
    tmp,
    "crates/foo/Cargo.toml",
    `[package]\nname = "foo"\nversion = "0.1.0"\n\n[dependencies]\nserde = { workspace = true }\nkernel = { path = "../kernel", version = "0.1.0" }\n`,
  );

  const { status, out } = run(["--root", tmp]);
  assert("exit code == 0", status === 0);
  assert("输出包含校验通过 (PASS)", out.includes("PASS"));
});

console.log("\n=== 测试: 内联裸版本 FAIL (R-DEP-001) ===\n");
withTempRoot((tmp) => {
  writeRoot(tmp, `serde = "1"\ntokio = "1"\n`);
  writeManifest(
    tmp,
    "crates/foo/Cargo.toml",
    `[package]\nname = "foo"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"\n`,
  );

  const { status, out } = run(["--root", tmp]);
  assert("exit code != 0 (失败)", status !== 0 && status !== null);
  assert("输出包含校验失败 (FAIL)", out.includes("FAIL"));
  assert("输出包含错误码 R-DEP-001", out.includes("R-DEP-001"));
});

console.log("\n=== 测试: 内联 inline-table 版本 FAIL (R-DEP-001) ===\n");
withTempRoot((tmp) => {
  writeRoot(tmp, `serde = "1"\ntokio = "1"\n`);
  writeManifest(
    tmp,
    "crates/foo/Cargo.toml",
    `[package]\nname = "foo"\nversion = "0.1.0"\n\n[dependencies]\nserde = { version = "1" }\n`,
  );

  const { status, out } = run(["--root", tmp]);
  assert("exit code != 0 (失败)", status !== 0 && status !== null);
  assert("输出包含校验失败 (FAIL)", out.includes("FAIL"));
  assert("输出包含错误码 R-DEP-001", out.includes("R-DEP-001"));
});

console.log("\n=== 测试: 未解析 workspace 引用 FAIL (R-DEP-002) ===\n");
withTempRoot((tmp) => {
  // 根仅声明 serde，未声明 tokio
  writeRoot(tmp, `serde = "1"\n`);
  writeManifest(
    tmp,
    "crates/foo/Cargo.toml",
    `[package]\nname = "foo"\nversion = "0.1.0"\n\n[dependencies]\nserde = { workspace = true }\ntokio = { workspace = true }\n`,
  );

  const { status, out } = run(["--root", tmp]);
  assert("exit code != 0 (失败)", status !== 0 && status !== null);
  assert("输出包含校验失败 (FAIL)", out.includes("FAIL"));
  assert("输出包含错误码 R-DEP-002", out.includes("R-DEP-002"));
});

console.log("\n=== 测试: 仅 path 依赖 + workspace 引用 通过校验 ===\n");
withTempRoot((tmp) => {
  writeRoot(tmp, `serde = "1"\n`);
  writeManifest(
    tmp,
    "crates/foo/Cargo.toml",
    `[package]\nname = "foo"\nversion = "0.1.0"\n\n[dependencies]\nkernel = { path = "../kernel", version = "0.1.0" }\nserde = { workspace = true }\n`,
  );

  const { status, out } = run(["--root", tmp]);
  assert("exit code == 0", status === 0);
  assert("输出包含校验通过 (PASS)", out.includes("PASS"));
});

console.log("\n=== 测试: 真实仓库集成 — 不带 --root 自动解析仓库根 ===\n");
{
  // 不传 --root，脚本应自动解析为脚本所在仓库根 (当前仓库已全量统一)
  const { status, out } = run([]);
  assert("exit code == 0", status === 0);
  assert("输出包含校验通过 (PASS)", out.includes("PASS"));
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------

console.log(`\n${"─".repeat(40)}`);
const total = passed + failed;
console.log(`结果: ${passed}/${total} 通过`);
if (failed > 0) {
  console.log(`${"─".repeat(40)}`);
  process.exit(1);
}
console.log(`${"─".repeat(40)}`);
process.exit(0);
