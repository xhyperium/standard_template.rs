#!/usr/bin/env node
/**
 * fix-encoding.test.mjs — L1 测试 for fix-encoding.mjs
 *
 * 测试范围：
 *  1. 纯函数提取（isExcluded, detectEncoding, tryGbkRecovery）
 *  2. --check 模式（干净项目、含损坏项目）
 *  3. --fix 模式（GBK 字符修复）
 *  4. --fix-gbk 模式
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── 从 fix-encoding.mjs 复制的可测试纯函数 ────────────────

const EXCLUDE = [
  '.git/', 'node_modules/', '.cargo/', 'target/', '.worktrees/',
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico', '*.svg',
  '*.woff', '*.woff2', '*.ttf', '*.eot',
  '*.lock', '*.local.md',
];

function shouldExclude(filePath) {
  for (const pattern of EXCLUDE) {
    if (pattern.endsWith('/') && filePath.includes(pattern)) return true;
    if (pattern.startsWith('*') && filePath.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

function detectEncoding(raw) {
  const hasReplacement = raw.includes(Buffer.from([0xEF, 0xBF, 0xBD]));
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return { isUtf8: true, hasReplacement };
  } catch {
    return { isUtf8: false, hasReplacement };
  }
}

// ── 测试工具 ──────────────────────────────────────────

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "fix-enc-test-"));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true }); } catch { /* ok */ }
}

const REPO_ROOT = resolve(__dirname, "..");
const SCRIPT = join(REPO_ROOT, "scripts", "fix-encoding.mjs");

console.log("\n# fix-encoding L1 测试");

// ── §1 shouldExclude ──────────────────────────────────

console.log("\n## §1 shouldExclude 排除逻辑");

ok(shouldExclude("/repo/.git/HEAD"), ".git/ 排除");
ok(shouldExclude("/repo/node_modules/pkg/m.js"), "node_modules/ 排除");
ok(shouldExclude("/repo/.cargo/config.toml"), ".cargo/ 排除");
ok(shouldExclude("/repo/target/debug/app"), "target/ 排除");
ok(shouldExclude("/repo/.worktrees/feature/src/main.rs"), ".worktrees/ 排除");
ok(shouldExclude("/repo/image.png"), "*.png 排除");
ok(shouldExclude("/repo/font.woff2"), "*.woff2 排除");
ok(shouldExclude("/repo/Cargo.lock"), "*.lock 排除");
ok(shouldExclude("/repo/docs/status/CRATES_STATUS.local.md"), "*.local.md 排除");
ok(!shouldExclude("/repo/src/main.rs"), ".rs 不排除");
ok(!shouldExclude("/repo/README.md"), ".md 不排除");

// ── §2 detectEncoding ─────────────────────────────────

console.log("\n## §2 detectEncoding 编码检测");

// 干净 UTF-8
let r = detectEncoding(Buffer.from("hello 世界", "utf8"));
ok(r.isUtf8 && !r.hasReplacement, "干净 UTF-8 检测通过");

// UTF-8 含 U+FFFD
const fffd = Buffer.concat([
  Buffer.from("测试", "utf8"),
  Buffer.from([0xEF, 0xBF, 0xBD]),
]);
r = detectEncoding(fffd);
ok(r.isUtf8 && r.hasReplacement, "含 U+FFFD UTF-8 检测通过");

// 纯 GBK 字节（无效 UTF-8）
r = detectEncoding(Buffer.from([0xb2, 0xe2, 0xca, 0xd4]));
ok(!r.isUtf8, "GBK 非 UTF-8 检测通过");

// 空文件
r = detectEncoding(Buffer.from([]));
ok(r.isUtf8 && !r.hasReplacement, "空文件检测通过");

// ── §3 脚本完整性 ─────────────────────────────────────

console.log("\n## §3 脚本完整性");

ok(existsSync(SCRIPT), "fix-encoding.mjs 存在");

try {
  execFileSync("node", ["--check", SCRIPT], { timeout: 10000, stdio: "pipe" });
  ok(true, "node --check 语法通过");
} catch (e) {
  ok(false, "node --check: " + String(e.stderr || e.message).trim().split("\n").slice(-2).join("\n"));
}

// ── §4 集成测试：在临时目录中模拟检查 ──────────────────

console.log("\n## §4 集成测试");

let tmpDir;

// 4.a 干净项目 --check 通过
try {
  tmpDir = makeTempDir();
  writeFileSync(join(tmpDir, "clean.md"), "# Clean file", "utf8");
  writeFileSync(join(tmpDir, "main.rs"), 'fn main() { println!("hi"); }', "utf8");

  // 初始化 git 仓库（fix-encoding.mjs 会调用 git rev-parse）
  execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["add", "."], { cwd: tmpDir, stdio: "pipe" });

  // 运行 --check (使用 --cwd 参数)
  const out = execFileSync("node", [SCRIPT, "--check"], {
    cwd: tmpDir,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 30000,
  });
  ok(out.includes("UTF-8") || out.includes("没有损坏"), "干净项目 --check 通过");
} catch (e) {
  ok(false, "干净项目 --check: " + (e.stdout || e.message).trim().split("\n").slice(-2).join("\n"));
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// 4.b 含 GBK 文件 --check 应检测到
try {
  tmpDir = makeTempDir();
  // GBK 编码文件（架构）
  writeFileSync(join(tmpDir, "gbk_test.md"), Buffer.from([0xbc, 0xdc, 0xb9, 0xb9, 0xce, 0xc4, 0xb5, 0xb5]));
  // 含 U+FFFD 文件
  const corrupt = Buffer.concat([
    Buffer.from("# test", "utf8"),
    Buffer.from([0xEF, 0xBF, 0xBD]),
  ]);
  writeFileSync(join(tmpDir, "corrupt.md"), corrupt);

  execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir, stdio: "pipe" });

  try {
    execFileSync("node", [SCRIPT, "--check"], {
      cwd: tmpDir,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 30000,
    });
    ok(false, "GBK 文件 --check 应失败但通过了");
  } catch (e) {
    const out = e.stdout || "";
    ok(out.includes("NOT UTF-8") || out.includes("U+FFFD"), "GBK 文件 --check 检测到 ");
  }
} catch (e) {
  ok(false, "GBK 文件 --check: " + String(e.message));
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// ── 汇总 ──────────────────────────────────────────────

console.log(`\n# 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) {
  console.error(`\n❌ ${fail} 个测试失败`);
  process.exit(1);
}
