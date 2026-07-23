#!/usr/bin/env node

/**
 * encoding-batch-check.test.mjs — L1 测试 for encoding-batch-check.mjs
 *
 * 测试范围：
 *  1. 导出纯函数 isExcluded / isTextFile / checkFile
 *  2. runBatchCheck 检出损坏
 *  3. CLI 默认 STRICT 下 exit 2
 *  4. ENCODING_BATCH_STRICT=false 仅警告
 */

import { execFileSync } from "child_process";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, "encoding-batch-check.mjs");

const { isExcluded, isTextFile, checkFile, runBatchCheck } = await import(
  pathToFileURL(HOOK_PATH).href
);

let pass = 0,
  fail = 0;
function ok(cond, name) {
  if (cond) {
    pass++;
    console.log("  ok  " + name);
  } else {
    fail++;
    console.log("  FAIL " + name);
  }
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "batch-enc-test-"));
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true });
  } catch {
    /* ok */
  }
}

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
ok(isTextFile("/repo/run.sh"), ".sh 是文本");
ok(!isTextFile("/repo/icon.png"), ".png 非文本");
ok(!isTextFile("/repo/font.woff"), ".woff 非文本");
ok(!isTextFile("/repo/Cargo.lock"), ".lock 非文本");

// ── §3 checkFile ─────────────────────────────────────

console.log("\n## §3 checkFile 文件编码检测");

let tmpDir;

try {
  tmpDir = makeTempDir();
  const clean = join(tmpDir, "clean.md");
  writeFileSync(clean, "# Clean UTF-8", "utf8");
  ok(checkFile(clean) === null, "干净 UTF-8 文件无异常");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

try {
  tmpDir = makeTempDir();
  const bom = join(tmpDir, "bom.md");
  writeFileSync(bom, Buffer.from([0xef, 0xbb, 0xbf, 0x23, 0x20, 0x42, 0x4f, 0x4d]));
  const issues = checkFile(bom);
  ok(issues !== null && issues.some((i) => i.includes("BOM")), "BOM 文件检测通过");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

try {
  tmpDir = makeTempDir();
  const fffd = join(tmpDir, "corrupt.md");
  writeFileSync(
    fffd,
    Buffer.concat([Buffer.from("# Test", "utf8"), Buffer.from([0xef, 0xbf, 0xbd])])
  );
  const issues = checkFile(fffd);
  ok(issues !== null && issues.some((i) => i.includes("U+FFFD")), "U+FFFD 文件检测通过");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

try {
  tmpDir = makeTempDir();
  const gbk = join(tmpDir, "gbk.md");
  writeFileSync(gbk, Buffer.from([0xb2, 0xe2, 0xca, 0xd4]));
  const issues = checkFile(gbk);
  ok(issues !== null && issues.some((i) => i.includes("UTF-8")), "GBK 非 UTF-8 检测通过");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

try {
  tmpDir = makeTempDir();
  const excluded = join(tmpDir, "icon.png");
  writeFileSync(excluded, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  ok(checkFile(excluded) === null, "排除文件不检测");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

try {
  tmpDir = makeTempDir();
  ok(checkFile(join(tmpDir, "nonexistent.md")) === null, "不存在文件返回 null");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// ── §4 脚本完整性 ─────────────────────────────────────

console.log("\n## §4 脚本完整性");

ok(existsSync(HOOK_PATH), "encoding-batch-check.mjs 存在");

try {
  execFileSync("node", ["--check", HOOK_PATH], { timeout: 10000, stdio: "pipe" });
  ok(true, "node --check 语法通过");
} catch (e) {
  ok(
    false,
    "node --check: " + String(e.stderr || e.message).trim().split("\n").slice(-2).join("\n")
  );
}

// ── §5 集成：runBatchCheck + CLI exit 2 ────────────────

console.log("\n## §5 集成测试：阻断行为");

try {
  tmpDir = makeTempDir();
  execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "T"], { cwd: tmpDir, stdio: "pipe" });

  writeFileSync(join(tmpDir, "clean.md"), "# Clean", "utf8");
  execFileSync("git", ["add", "clean.md"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir, stdio: "pipe" });

  writeFileSync(join(tmpDir, "gbk_test.md"), Buffer.from([0xb2, 0xe2, 0xca, 0xd4]));
  writeFileSync(join(tmpDir, "clean2.md"), "# Clean 2", "utf8");

  const batch = runBatchCheck(tmpDir);
  ok(batch.ok === false, "runBatchCheck 检出问题");
  ok(
    batch.results.some((r) => r.file.includes("gbk_test.md")),
    "检出 gbk_test.md"
  );

  // CLI STRICT：exit 2
  try {
    execFileSync("node", [HOOK_PATH], {
      cwd: tmpDir,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 30000,
      env: { ...process.env, ENCODING_BATCH_STRICT: "true" },
    });
    ok(false, "CLI STRICT 应 exit 2");
  } catch (e) {
    const err = String(e.stderr || e.stdout || "");
    ok(e.status === 2, "CLI STRICT exit 2");
    ok(err.includes("gbk_test.md") || err.includes("编码"), "CLI 报告异常文件");
  }

  // CLI 非 STRICT：exit 0 但仍有 stderr
  try {
    execFileSync("node", [HOOK_PATH], {
      cwd: tmpDir,
      encoding: "utf8",
      stdio: "pipe",
      timeout: 30000,
      env: { ...process.env, ENCODING_BATCH_STRICT: "false" },
    });
    ok(true, "CLI STRICT=false exit 0");
  } catch (e) {
    ok(false, "CLI STRICT=false 不应失败: " + e.status);
  }
} catch (e) {
  ok(false, "集成测试异常: " + String(e.message || e).slice(0, 200));
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// 干净仓库：exit 0
try {
  tmpDir = makeTempDir();
  execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "T"], { cwd: tmpDir, stdio: "pipe" });
  writeFileSync(join(tmpDir, "README.md"), "# ok", "utf8");
  writeFileSync(join(tmpDir, "AGENTS.md"), "# ok", "utf8");
  writeFileSync(join(tmpDir, "CLAUDE.md"), "# ok", "utf8");
  writeFileSync(join(tmpDir, "Cargo.toml"), "[package]\nname='x'\nversion='0.1.0'\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir, stdio: "pipe" });

  execFileSync("node", [HOOK_PATH], {
    cwd: tmpDir,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 30000,
  });
  ok(true, "干净仓库 CLI exit 0");
} catch (e) {
  ok(false, "干净仓库应通过: " + String(e.stderr || e.message).slice(0, 200));
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// ── 汇总 ──────────────────────────────────────────────

console.log(`\n# 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) {
  console.error(`\n❌ ${fail} 个测试失败`);
  process.exit(1);
}
