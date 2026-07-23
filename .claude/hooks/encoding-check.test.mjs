#!/usr/bin/env node
/**
 * encoding-check.test.mjs — L1 测试 for encoding-check.mjs
 *
 * 测试范围：
 *  1. 纯函数：inspectBytes / inspectText
 *  2. 排除路径与文本扩展名
 *  3. 写入载荷 U+FFFD / BOM 阻断
 *  4. 磁盘损坏 + Write 修复路径
 *  5. Edit 遇磁盘 U+FFFD 阻断
 *  6. CLI 语法
 */

import { execFileSync } from "child_process";
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const hookPath = join(__dirname, "encoding-check.mjs");

const { inspectBytes, inspectText, evaluate } = await import(
  pathToFileURL(hookPath).href
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
  return mkdtempSync(join(tmpdir(), "enc-test-"));
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true });
  } catch {
    /* ok */
  }
}

console.log("\n# encoding-check L1 测试");

// ── §1 inspectBytes / inspectText ─────────────────────

console.log("\n## §1 inspectBytes / inspectText");

ok(inspectBytes(Buffer.from("hello 世界", "utf8")) === null, "干净 UTF-8 无问题");
ok(inspectBytes(Buffer.from([0xef, 0xbb, 0xbf, 0x68])) === "含 UTF-8 BOM", "BOM 检出");
ok(
  inspectBytes(Buffer.from([0xef, 0xbf, 0xbd])) === "含 U+FFFD 替换字符（编码损坏）",
  "U+FFFD 检出"
);
ok(inspectBytes(Buffer.from([0xbc, 0xdc])) === "非 UTF-8 编码", "GBK 字节非 UTF-8");
ok(inspectText("正常中文") === null, "inspectText 干净");
ok(
  inspectText("坏\uFFFD字") === "含 U+FFFD 替换字符（编码损坏）",
  "inspectText U+FFFD"
);

// ── §2 evaluate 载荷 ──────────────────────────────────

console.log("\n## §2 evaluate 写入载荷");

{
  const r = evaluate({
    tool: "Write",
    args: { file_path: "/tmp/clean.md", contents: "# 正常\n" },
  });
  ok(r.result === "pass", "Write 干净内容放行");
}

{
  const r = evaluate({
    tool: "Write",
    args: {
      file_path: "/tmp/bad.md",
      contents: "损坏\uFFFD内容",
    },
  });
  ok(r.result === "block" && /U\+FFFD/.test(r.message), "Write 载荷含 U+FFFD 阻断");
}

{
  const r = evaluate({
    tool: "Edit",
    args: {
      file_path: "/tmp/x.md",
      old_string: "a",
      new_string: "新\uFFFD值",
    },
  });
  ok(r.result === "block", "Edit new_string 含 U+FFFD 阻断");
}

{
  const r = evaluate({
    tool: "Bash",
    args: { command: "echo hi" },
  });
  ok(r.result === "pass", "非 Write/Edit 放行");
}

{
  const r = evaluate({
    tool: "Write",
    args: { file_path: "/tmp/icon.png", contents: "\uFFFD" },
  });
  ok(r.result === "pass", "二进制扩展名跳过");
}

// ── §3 磁盘损坏 + 修复路径 ────────────────────────────

console.log("\n## §3 磁盘损坏与 Write 修复");

let tmpDir;
try {
  tmpDir = makeTempDir();
  const corrupt = join(tmpDir, "corrupt.md");
  writeFileSync(
    corrupt,
    Buffer.concat([
      Buffer.from("# 测", "utf8"),
      Buffer.from([0xef, 0xbf, 0xbd]),
      Buffer.from("试", "utf8"),
    ])
  );

  const editBlock = evaluate({
    tool: "Edit",
    args: {
      file_path: corrupt,
      old_string: "测",
      new_string: "测",
    },
  });
  ok(
    editBlock.result === "block" && /Write/.test(editBlock.message || ""),
    "Edit 遇磁盘 U+FFFD 阻断并提示 Write"
  );

  const writeFix = evaluate({
    tool: "Write",
    args: {
      file_path: corrupt,
      contents: "# 测试文档\n干净内容\n",
    },
  });
  ok(writeFix.result === "pass", "Write 干净载荷可覆盖修复损坏文件");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// ── §4 集成：干净磁盘文件 ─────────────────────────────

console.log("\n## §4 干净磁盘文件");

try {
  tmpDir = makeTempDir();
  const clean = join(tmpDir, "clean.md");
  writeFileSync(clean, "# 正常 UTF-8\n", "utf8");
  const r = evaluate({
    tool: "Edit",
    args: {
      file_path: clean,
      old_string: "正常",
      new_string: "规范",
    },
  });
  ok(r.result === "pass", "干净文件 Edit 放行");
} finally {
  if (tmpDir) cleanup(tmpDir);
}

// ── §5 脚本完整性 ─────────────────────────────────────

console.log("\n## §5 脚本完整性");

ok(existsSync(hookPath), "encoding-check.mjs 存在");

try {
  execFileSync("node", ["--check", hookPath], { timeout: 10000, stdio: "pipe" });
  ok(true, "node --check 语法通过");
} catch (e) {
  ok(
    false,
    "node --check: " + String(e.stderr || e.message).trim().split("\n").slice(-2).join("\n")
  );
}

// CLI：stdin 干净 Write → exit 0
try {
  execFileSync(
    "node",
    [hookPath],
    {
      timeout: 10000,
      input: JSON.stringify({
        tool: "Write",
        input: { file_path: "/tmp/cli-ok.md", contents: "ok 中文" },
      }),
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  ok(true, "CLI 干净 Write exit 0");
} catch (e) {
  ok(false, "CLI 干净 Write 应 exit 0: " + e.status);
}

// CLI：stdin 坏载荷 → exit 2 + block JSON
try {
  execFileSync(
    "node",
    [hookPath],
    {
      timeout: 10000,
      input: JSON.stringify({
        tool: "Write",
        input: { file_path: "/tmp/cli-bad.md", contents: "坏\uFFFD" },
      }),
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  ok(false, "CLI 坏载荷应非 0 退出");
} catch (e) {
  const out = String(e.stdout || "");
  ok(e.status === 2, "CLI 坏载荷 exit 2");
  ok(/"block"\s*:\s*true/.test(out), "CLI 输出 block:true JSON");
}

// ── 汇总 ──────────────────────────────────────────────

console.log(`\n# 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) {
  console.error(`\n❌ ${fail} 个测试失败`);
  process.exit(1);
}
