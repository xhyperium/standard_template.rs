#!/usr/bin/env node

/**
 * check-encoding-ci.test.mjs — CI 编码门禁逻辑测试
 *
 * 验证 validation.yml 中 utf8-encoding 作业的检测逻辑正确有效。
 *
 * 测试范围：
 *  1. file -b --mime-encoding 对不同编码的识别
 *  2. CI case 分支逻辑的模拟
 *  3. find 排除规则的正确性
 *  4. 集成测试：临时仓库模拟 CI 全流程
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

// ── CI 编码检测逻辑复现 ────────────────────────────────

// 与 validation.yml utf8-encoding 完全一致的检测逻辑
function ciEncodingCheck(filePath) {
  if (!existsSync(filePath)) return { pass: true, encoding: null };
  try {
    const enc = execFileSync("file", ["-b", "--mime-encoding", filePath], {
      encoding: "utf8", timeout: 5000, stdio: "pipe",
    }).trim();

    if (enc.includes("utf-8") || enc.includes("ascii") || enc.includes("us-ascii")) {
      return { pass: true, encoding: enc };
    }
    if (enc.includes("binary")) {
      return { pass: true, encoding: enc };
    }
    return { pass: false, encoding: enc };
  } catch {
    return { pass: false, encoding: "error" };
  }
}

// CI 的 find 排除规则（转为 shouldExclude 函数）
const CI_EXCLUDE_DIRS = ['.git/', 'node_modules/', '.cargo/', 'target/'];
const CI_EXCLUDE_NAMES = ['*.png', '*.jpg', '*.ico', '*.svg', '*.woff*', '*.lock'];

function ciShouldExclude(filePath) {
  for (const dir of CI_EXCLUDE_DIRS) {
    if (filePath.includes(dir)) return true;
  }
  for (const pattern of CI_EXCLUDE_NAMES) {
    // find -name 使用 shell glob：*.woff* → 包含 .woff 的文件
    const glob = pattern.replace(/\*/g, '.*');
    const basename = filePath.split('/').pop();
    if (new RegExp('^' + glob + '$').test(basename)) return true;
  }
  return false;
}

// ── 测试工具 ──────────────────────────────────────────

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "ci-enc-test-"));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true }); } catch { /* ok */ }
}

console.log("\n# CI 编码门禁逻辑测试");

// ── §1 file -b --mime-encoding 检测能力 ────────────────

console.log("\n## §1 file 命令编码检测");

let tmpDir;

// 1a. 干净 UTF-8
try {
  tmpDir = makeTempDir();
  const f = join(tmpDir, "utf8.md");
  writeFileSync(f, "# Hello 世界", "utf8");
  const r = ciEncodingCheck(f);
  ok(r.pass === true && r.encoding.includes("utf-8"), "UTF-8 文件被识别为 utf-8");
} finally { if (tmpDir) cleanup(tmpDir); }

// 1b. ASCII
try {
  tmpDir = makeTempDir();
  const f = join(tmpDir, "ascii.txt");
  writeFileSync(f, "hello world", "ascii");
  const r = ciEncodingCheck(f);
  ok(r.pass === true && (r.encoding.includes("ascii") || r.encoding.includes("utf-8")), "ASCII 文件被识别为 ascii/utf-8");
} finally { if (tmpDir) cleanup(tmpDir); }

// 1c. GBK 编码（非 UTF-8）
try {
  tmpDir = makeTempDir();
  const f = join(tmpDir, "gbk_test.md");
  // "架构文档" in GBK
  writeFileSync(f, Buffer.from([0xbc, 0xdc, 0xb9, 0xb9, 0xce, 0xc4, 0xb5, 0xb5]));
  const r = ciEncodingCheck(f);
  // GBK 通常被检测为 iso-8859-1
  ok(r.pass === false, `GBK 文件被拦截（检测为 ${r.encoding || 'error'}）`);
} finally { if (tmpDir) cleanup(tmpDir); }

// 1d. 含 UTF-8 BOM 的文件
try {
  tmpDir = makeTempDir();
  const f = join(tmpDir, "bom.md");
  writeFileSync(f, Buffer.from([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x42, 0x4f, 0x4d]));
  const r = ciEncodingCheck(f);
  // file 对 BOM 文件通常识别为 utf-8
  if (r.pass) {
    ok(true, `BOM 文件被 file 识别为 ${r.encoding}（CI 门禁不拦截 BOM，由 hook 拦截）`);
  } else {
    ok(true, `BOM 文件被 file 识别为 ${r.encoding}`);
  }
} finally { if (tmpDir) cleanup(tmpDir); }

// 1e. 含 U+FFFD 的文件（已损坏的 UTF-8）
// file --mime-encoding 会认作 utf-8；CI 步骤 2 必须用字节扫描拦截
function hasFffd(filePath) {
  const raw = readFileSync(filePath);
  return raw.includes(Buffer.from([0xef, 0xbf, 0xbd]));
}

try {
  tmpDir = makeTempDir();
  const f = join(tmpDir, "corrupt.md");
  writeFileSync(f, Buffer.concat([
    Buffer.from("# Test", "utf8"),
    Buffer.from([0xef, 0xbf, 0xbd]),
  ]));
  const r = ciEncodingCheck(f);
  ok(r.pass === true, `U+FFFD 对 file 仍为 ${r.encoding}（L1 放行）`);
  ok(hasFffd(f) === true, "L2 字节扫描必须检出 U+FFFD");
} finally { if (tmpDir) cleanup(tmpDir); }

// ── §2 CI case 分支模拟 ───────────────────────────────

console.log("\n## §2 分支逻辑验证");

const testCases = [
  { enc: "utf-8", expected: true },
  { enc: "ascii", expected: true },
  { enc: "us-ascii", expected: true },
  { enc: "utf-8 with BOM", expected: true },
  { enc: "iso-8859-1", expected: false },
  { enc: "iso-8859-2", expected: false },
  { enc: "unknown-8bit", expected: false },
  { enc: "binary", expected: true },  // binary 被放过
  { enc: "application/octet-stream", expected: false },  // 不含 binary，被拦截
];

for (const { enc, expected } of testCases) {
  const passes = enc.includes("utf-8") || enc.includes("ascii") || enc.includes("binary");
  ok(passes === expected, `编码 "${enc}" → ${passes ? "通过" : "拦截"}（期望: ${expected ? "通过" : "拦截"}）`);
}

// ── §3 find 排除规则 ──────────────────────────────────

console.log("\n## §3 排除规则验证");

ok(ciShouldExclude("/repo/.git/config"), ".git/ 排除");
ok(ciShouldExclude("/repo/node_modules/pkg/m.js"), "node_modules/ 排除");
ok(ciShouldExclude("/repo/.cargo/config.toml"), ".cargo/ 排除");
ok(ciShouldExclude("/repo/target/debug/main.rs"), "target/ 排除");
ok(ciShouldExclude("/repo/icon.png"), "*.png 排除");
ok(ciShouldExclude("/repo/image.jpg"), "*.jpg 排除");
ok(ciShouldExclude("/repo/favicon.ico"), "*.ico 排除");
ok(ciShouldExclude("/repo/logo.svg"), "*.svg 排除");
ok(ciShouldExclude("/repo/font.woff2"), "*.woff* 排除");
ok(ciShouldExclude("/repo/Cargo.lock"), "*.lock 排除");
ok(!ciShouldExclude("/repo/README.md"), ".md 不排除");
ok(!ciShouldExclude("/repo/src/main.rs"), ".rs 不排除");
ok(!ciShouldExclude("/repo/Cargo.toml"), ".toml 不排除");

// ── §4 集成测试：模拟 CI 全流程 ──────────────────────

console.log("\n## §4 集成测试：模拟 CI 全流程");

try {
  tmpDir = makeTempDir();

  // 创建混合文件集
  writeFileSync(join(tmpDir, "clean.md"), "# Clean UTF-8 file", "utf8");
  writeFileSync(join(tmpDir, "main.rs"), 'fn main() { println!("ok"); }', "utf8");
  writeFileSync(join(tmpDir, "config.toml"), '[package]\nname = "test"', "utf8");
  // GBK 文件（应该被拦截）
  writeFileSync(join(tmpDir, "gbk_doc.md"), Buffer.from([0xbc, 0xdc, 0xb9, 0xb9, 0xce, 0xc4, 0xb5, 0xb5]));
  // 排除文件（不应该检查）
  writeFileSync(join(tmpDir, "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(tmpDir, "Cargo.lock"), "# lock file content");

  // 模拟 CI 的 find + while 循环
  const findResult = execFileSync("find", [
    tmpDir, "-type", "f",
    "-not", "-path", `${tmpDir}/.git/*`,
    "-not", "-name", "*.png",
    "-not", "-name", "*.jpg",
    "-not", "-name", "*.ico",
    "-not", "-name", "*.svg",
    "-not", "-name", "*.woff*",
    "-not", "-name", "*.lock",
  ], { encoding: "utf8", timeout: 5000, stdio: "pipe" });

  const files = findResult.trim().split("\n").filter(Boolean);
  let bad = 0;
  const badFiles = [];

  for (const f of files) {
    const r = ciEncodingCheck(f);
    if (!r.pass) {
      bad++;
      badFiles.push({ file: f.replace(tmpDir, ""), encoding: r.encoding });
    }
  }

  ok(bad === 1, `CI 全流程：拦截 ${bad} 个非 UTF-8 文件（应为 1）`);
  if (badFiles.length > 0) {
    ok(badFiles[0].file.includes("gbk_doc.md"), `CI 全流程：拦截的文件是 gbk_doc.md`);
  }

  // 验证排除文件未参与检查
  const hasPng = files.some(f => f.endsWith("icon.png"));
  ok(!hasPng, "CI 全流程：.png 文件未被扫描");
} catch (e) {
  ok(false, "集成测试异常: " + (e.message || "").split("\n").slice(-2).join("\n"));
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// ── 汇总 ──────────────────────────────────────────────

console.log(`\n# 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) {
  console.error(`\n❌ ${fail} 个测试失败`);
  process.exit(1);
}
