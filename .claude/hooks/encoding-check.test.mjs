#!/usr/bin/env node
/**
 * encoding-check.test.mjs — L1 测试 for encoding-check.mjs
 *
 * 测试范围：
 *  1. 纯函数提取
 *  2. 文件编码检测逻辑
 *  3. BOM 检测
 *  4. U+FFFD 检测
 *  5. 排除路径
 *  6. 二进制扩展名跳过
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 从 encoding-check.mjs 复制的可测试纯函数 ─────────────────

// 排除路径检测
const EXCLUDE_PATTERNS = [
  /\/\.git\//, /\/node_modules\//, /\/\.cargo\//, /\/target\//,
  /\.png$/, /\.jpg$/, /\.jpeg$/, /\.gif$/, /\.ico$/, /\.svg$/,
  /\.woff$/, /\.woff2$/, /\.ttf$/, /\.eot$/, /\.lock$/,
];

function isExcluded(filePath) {
  return EXCLUDE_PATTERNS.some((re) => re.test(filePath));
}

function isTextFile(ext) {
  const TEXT_EXTS = [".md", ".toml", ".json", ".yml", ".yaml", ".rs", ".mjs", ".js", ".cjs"];
  return TEXT_EXTS.includes(ext);
}

function hasBom(raw) {
  return raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
}

function hasReplacementChar(raw) {
  return raw.includes(Buffer.from([0xef, 0xbf, 0xbd]));
}

function isValidUtf8(raw) {
  try {
    // Use TextDecoder with fatal:true for strict UTF-8 validation
    new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return true;
  } catch {
    return false;
  }
}

// ── 测试工具 ──────────────────────────────────────────

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), "enc-test-"));
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true }); } catch { /* ok */ }
}

console.log("\n# encoding-check L1 测试");

// ── §1 isExcluded ─────────────────────────────────────

console.log("\n## §1 isExcluded 路径排除");

ok(isExcluded("/repo/.git/config"), ".git/ 排除");
ok(isExcluded("/repo/node_modules/pkg/index.js"), "node_modules/ 排除");
ok(isExcluded("/repo/.cargo/config.toml"), ".cargo/ 排除");
ok(isExcluded("/repo/target/debug/main.rs"), "target/ 排除");
ok(isExcluded("/repo/icon.png"), ".png 排除");
ok(isExcluded("/repo/font.woff2"), ".woff2 排除");
ok(isExcluded("/repo/Cargo.lock"), ".lock 排除");
ok(!isExcluded("/repo/src/main.rs"), ".rs 不排除");
ok(!isExcluded("/repo/README.md"), ".md 不排除");
ok(!isExcluded("/repo/Cargo.toml"), ".toml 不排除");

// ── §2 isTextFile ─────────────────────────────────────

console.log("\n## §2 isTextFile 文本文件识别");

ok(isTextFile(".md"), ".md 是文本");
ok(isTextFile(".rs"), ".rs 是文本");
ok(isTextFile(".mjs"), ".mjs 是文本");
ok(!isTextFile(".png"), ".png 不是文本");
ok(!isTextFile(".woff2"), ".woff2 不是文本");
ok(!isTextFile(".lock"), ".lock 不是文本");

// ── §3 hasBom ─────────────────────────────────────────

console.log("\n## §3 hasBom BOM 检测");

// UTF-8 BOM 文件
ok(hasBom(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69])), "BOM 前缀检测通过");
// 无 BOM 文件
ok(!hasBom(Buffer.from([0x68, 0x69])), "无 BOM 检测通过");
// 空文件
ok(!hasBom(Buffer.from([])), "空文件无 BOM");

// ── §4 hasReplacementChar ─────────────────────────────

console.log("\n## §4 hasReplacementChar U+FFFD 检测");

// 含 U+FFFD
const fffd = Buffer.from([0xef, 0xbf, 0xbd]);
ok(hasReplacementChar(fffd), "U+FFFD 检测通过");
// UTF-8 纯文本
ok(!hasReplacementChar(Buffer.from("hello 世界", "utf8")), "纯 UTF-8 无 U+FFFD");
// 混合
const mixed = Buffer.concat([Buffer.from("测试", "utf8"), fffd, Buffer.from("继续", "utf8")]);
ok(hasReplacementChar(mixed), "混合文本 U+FFFD 检测通过");

// ── §5 isValidUtf8 ────────────────────────────────────

console.log("\n## §5 isValidUtf8 UTF-8 有效性");

ok(isValidUtf8(Buffer.from("hello 世界", "utf8")), "有效 UTF-8 通过");
// GBK 编码字节（非 UTF-8）
// 0xbc 0xdc = "架" 在 GBK 中，但不是有效 UTF-8
ok(!isValidUtf8(Buffer.from([0xbc, 0xdc])), "GBK 字节非 UTF-8 通过");

// ── §6 完整流程：创建临时文件并验证检测逻辑 ──────────────

console.log("\n## §6 文件级集成验证");

let tmpDir;

// 6.a 干净 UTF-8 文件
try {
  tmpDir = makeTempDir();
  const cleanFile = join(tmpDir, "clean.md");
  writeFileSync(cleanFile, "# 测试文档\n\nUTF-8 内容。", "utf8");
  const raw = readFileSync(cleanFile);
  ok(!hasBom(raw) && !hasReplacementChar(raw) && isValidUtf8(raw), "干净 UTF-8 文件检查通过");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// 6.b 含 BOM 的文件
try {
  tmpDir = makeTempDir();
  const bomFile = join(tmpDir, "bom.md");
  writeFileSync(bomFile, Buffer.from([0xef, 0xbb, 0xbf, 0x23, 0x20, 0xe6, 0xb5, 0x8b, 0xe8, 0xaf, 0x95]));
  const raw = readFileSync(bomFile);
  ok(hasBom(raw), "BOM 文件检测通过");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// 6.c 含 U+FFFD 的文件
try {
  tmpDir = makeTempDir();
  const fffdFile = join(tmpDir, "corrupt.md");
  const corrupted = Buffer.concat([
    Buffer.from("# 测试", "utf8"),
    Buffer.from([0xef, 0xbf, 0xbd]),
    Buffer.from("内容", "utf8"),
  ]);
  writeFileSync(fffdFile, corrupted);
  const raw = readFileSync(fffdFile);
  ok(hasReplacementChar(raw), "U+FFFD 文件检测通过");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// 6.d GBK 编码文件
try {
  tmpDir = makeTempDir();
  const gbkFile = join(tmpDir, "gbk.md");
  // GBK 编码的 "测试" = 0xb2 0xe2 0xca 0xd4
  writeFileSync(gbkFile, Buffer.from([0xb2, 0xe2, 0xca, 0xd4]));
  const raw = readFileSync(gbkFile);
  ok(!isValidUtf8(raw), "GBK 文件非 UTF-8 通过");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// 6.e 排除路径不检测
try {
  tmpDir = makeTempDir();
  const excludedFile = join(tmpDir, "icon.png");
  writeFileSync(excludedFile, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  ok(isExcluded(excludedFile), "排除路径不检测");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// ── §7 脚本完整性 ─────────────────────────────────────

console.log("\n## §7 脚本完整性");

const hookPath = join(__dirname, "encoding-check.mjs");
ok(existsSync(hookPath), "encoding-check.mjs 存在");

try {
  execFileSync("node", ["--check", hookPath], { timeout: 10000, stdio: "pipe" });
  ok(true, "node --check 语法通过");
} catch (e) {
  ok(false, "node --check: " + String(e.stderr || e.message).trim().split("\n").slice(-2).join("\n"));
}

// ── 汇总 ──────────────────────────────────────────────

console.log(`\n# 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) {
  console.error(`\n❌ ${fail} 个测试失败`);
  process.exit(1);
}
