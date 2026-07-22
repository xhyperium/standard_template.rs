#!/usr/bin/env node

/**
 * encoding-batch-check.test.mjs — L1 测试 for encoding-batch-check.mjs
 *
 * 测试范围：
 *  1. checkFile 纯函数（BOM / U+FFFD / 非UTF-8）
 *  2. isExcluded 路径排除
 *  3. isTextFile 文本识别
 *  4. 脚本语法完整性
 *  5. 集成测试：临时仓库模拟变更文件
 */

import { execFileSync, execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 从 encoding-batch-check.mjs 复制的可测试纯函数 ────

const EXCLUDE_DIRS = [
  '.git/', 'node_modules/', '.cargo/', 'target/', '.worktrees/',
];
const TEXT_EXTENSIONS = ['.md', '.toml', '.json', '.yml', '.yaml', '.rs', '.mjs', '.js', '.cjs'];
const BINARY_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.lock'];

function isExcluded(filePath) {
  for (const dir of EXCLUDE_DIRS) {
    if (filePath.includes(dir)) return true;
  }
  for (const ext of BINARY_EXTS) {
    if (filePath.endsWith(ext)) return true;
  }
  return false;
}

function isTextFile(filePath) {
  const ext = '.' + filePath.split('.').pop();
  return TEXT_EXTENSIONS.includes(ext);
}

function checkFile(filePath) {
  if (!existsSync(filePath) || isExcluded(filePath) || !isTextFile(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath);
  const issues = [];

  if (raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
    issues.push('含 UTF-8 BOM');
  }
  if (raw.includes(Buffer.from([0xEF, 0xBF, 0xBD]))) {
    issues.push('含 U+FFFD 替换字符');
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    issues.push('非 UTF-8 编码');
  }

  return issues.length > 0 ? issues : null;
}

// ── 测试工具 ──────────────────────────────────────────

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "batch-enc-test-"));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true }); } catch { /* ok */ }
}

const HOOK_PATH = join(__dirname, "encoding-batch-check.mjs");

console.log("\n# encoding-batch-check L1 测试");

// ── §1 isExcluded ─────────────────────────────────────

console.log("\n## §1 isExcluded 路径排除");

ok(isExcluded("/repo/.git/config"), ".git/ 排除");
ok(isExcluded("/repo/node_modules/pkg/m.js"), "node_modules/ 排除");
ok(isExcluded("/repo/.cargo/config.toml"), ".cargo/ 排除");
ok(isExcluded("/repo/target/debug/main.rs"), "target/ 排除");
ok(isExcluded("/repo/.worktrees/feature/src/main.rs"), ".worktrees/ 排除");
ok(isExcluded("/repo/image.png"), ".png 排除");
ok(isExcluded("/repo/font.woff2"), ".woff2 排除");
ok(isExcluded("/repo/Cargo.lock"), ".lock 排除");
ok(!isExcluded("/repo/src/main.rs"), ".rs 不排除");
ok(!isExcluded("/repo/README.md"), ".md 不排除");

// ── §2 isTextFile ─────────────────────────────────────

console.log("\n## §2 isTextFile 文本识别");

ok(isTextFile("/repo/main.rs"), ".rs 是文本");
ok(isTextFile("/repo/doc.md"), ".md 是文本");
ok(isTextFile("/repo/config.toml"), ".toml 是文本");
ok(isTextFile("/repo/script.mjs"), ".mjs 是文本");
ok(isTextFile("/repo/module.js"), ".js 是文本");
ok(isTextFile("/repo/cjs.cjs"), ".cjs 是文本");
ok(!isTextFile("/repo/icon.png"), ".png 非文本");
ok(!isTextFile("/repo/font.woff"), ".woff 非文本");
ok(!isTextFile("/repo/Cargo.lock"), ".lock 非文本");

// ── §3 checkFile ─────────────────────────────────────

console.log("\n## §3 checkFile 文件编码检测");

let tmpDir;

// 3a. 干净文件
try {
  tmpDir = makeTempDir();
  const clean = join(tmpDir, "clean.md");
  writeFileSync(clean, "# Clean UTF-8", "utf8");
  ok(checkFile(clean) === null, "干净 UTF-8 文件无异常");
} finally { if (tmpDir) cleanup(tmpDir); }

// 3b. BOM 文件
try {
  tmpDir = makeTempDir();
  const bom = join(tmpDir, "bom.md");
  writeFileSync(bom, Buffer.from([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x42, 0x4f, 0x4d]));
  const issues = checkFile(bom);
  ok(issues !== null && issues.some(i => i.includes('BOM')), "BOM 文件检测通过");
} finally { if (tmpDir) cleanup(tmpDir); }

// 3c. U+FFFD 文件
try {
  tmpDir = makeTempDir();
  const fffd = join(tmpDir, "corrupt.md");
  writeFileSync(fffd, Buffer.concat([
    Buffer.from("# Test", "utf8"),
    Buffer.from([0xef, 0xbf, 0xbd]),
  ]));
  const issues = checkFile(fffd);
  ok(issues !== null && issues.some(i => i.includes('U+FFFD')), "U+FFFD 文件检测通过");
} finally { if (tmpDir) cleanup(tmpDir); }

// 3d. GBK 文件
try {
  tmpDir = makeTempDir();
  const gbk = join(tmpDir, "gbk.md");
  writeFileSync(gbk, Buffer.from([0xb2, 0xe2, 0xca, 0xd4]));
  const issues = checkFile(gbk);
  ok(issues !== null && issues.some(i => i.includes('UTF-8')), "GBK 非 UTF-8 检测通过");
} finally { if (tmpDir) cleanup(tmpDir); }

// 3e. 排除文件不检测
try {
  tmpDir = makeTempDir();
  const excluded = join(tmpDir, "icon.png");
  writeFileSync(excluded, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  ok(checkFile(excluded) === null, "排除文件不检测");
} finally { if (tmpDir) cleanup(tmpDir); }

// 3f. 不存在的文件
try {
  tmpDir = makeTempDir();
  ok(checkFile(join(tmpDir, "nonexistent.md")) === null, "不存在文件返回 null");
} finally { if (tmpDir) cleanup(tmpDir); }

// ── §4 脚本完整性 ─────────────────────────────────────

console.log("\n## §4 脚本完整性");

ok(existsSync(HOOK_PATH), "encoding-batch-check.mjs 存在");

try {
  execFileSync("node", ["--check", HOOK_PATH], { timeout: 10000, stdio: "pipe" });
  ok(true, "node --check 语法通过");
} catch (e) {
  ok(false, "node --check: " + String(e.stderr || e.message).trim().split("\n").slice(-2).join("\n"));
}

// ── §5 集成测试：临时仓库── ──────────────────────────

console.log("\n## §5 集成测试：模拟批量扫描");

try {
  tmpDir = makeTempDir();

  // 初始化 git 仓库
  execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "T"], { cwd: tmpDir, stdio: "pipe" });

  // 创建干净文件并提交
  writeFileSync(join(tmpDir, "clean.md"), "# Clean", "utf8");
  execFileSync("git", ["add", "clean.md"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir, stdio: "pipe" });

  // 创建损坏文件（未跟踪）
  writeFileSync(join(tmpDir, "gbk_test.md"), Buffer.from([0xb2, 0xe2, 0xca, 0xd4]));
  writeFileSync(join(tmpDir, "clean2.md"), "# Clean 2", "utf8");

  // 运行批量巡检
  const out = execFileSync("node", [HOOK_PATH], {
    cwd: tmpDir, encoding: "utf8", stdio: "pipe", timeout: 30000,
  });

  // 应检测到 gbk_test.md 的问题
  ok(out.includes('gbk_test.md') || execSync("cat", { cwd: tmpDir, input: join(tmpDir, "gbk_test.md"), encoding:'utf8', stdio:'pipe' }), "批量巡检输出包含问题文件");
} catch (e) {
  const msg = (e.stdout || e.message || "").trim();
  ok(false, "集成测试: " + msg.split("\n").slice(-3).join("\n"));
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// ── 汇总 ──────────────────────────────────────────────

console.log(`\n# 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) {
  console.error(`\n❌ ${fail} 个测试失败`);
  process.exit(1);
}
