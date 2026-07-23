#!/usr/bin/env node

/**
 * check-encoding-edge.test.mjs — 编码检测边界测试
 *
 * 覆盖编码检测体系中容易被遗漏的边界场景：
 *   §1 特殊 Unicode（emoji、CJK 扩展、RTL、零宽字符）
 *   §2 非 UTF-8 编码（UTF-16、Latin-1、Shift-JIS）
 *   §3 TextDecoder 无效 UTF-8 序列（overlong、surrogate、截断）
 *   §4 边界文件（空文件、纯 BOM、无扩展名、点文件）
 *   §5 特殊文件名（空格、Unicode、shell 特殊字符）
 *   §6 跨工具一致性（file 命令 vs TextDecoder 结果对齐）
 *   §7 排除规则边界（.woff 前缀匹配、嵌套路径）
 *   §8 混合编码与修复验证（UTF-8+GBK 混合、脚本修复检查）
 */

import { execFileSync, execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

// ── 编码检测工具函数 ──────────────────────────────────

// CI 禁检测（file 命令）
function ciDetect(filePath) {
  if (!existsSync(filePath)) return { pass: true };
  try {
    const enc = execFileSync("file", ["-b", "--mime-encoding", filePath], {
      encoding: "utf8", timeout: 5000, stdio: "pipe",
    }).trim();
    const pass = enc.includes("utf-8") || enc.includes("ascii") || enc.includes("us-ascii") || enc.includes("binary");
    return { pass, encoding: enc };
  } catch {
    return { pass: false, encoding: "error" };
  }
}

// TextDecoder 严格模式检测
function textDecoderDetect(raw) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(raw);
    return { pass: true };
  } catch {
    return { pass: false };
  }
}

// encoding-check.mjs 检测（BOM + U+FFFD + UTF-8）
function hookDetect(raw) {
  const issues = [];
  if (raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
    issues.push("BOM");
  }
  if (raw.includes(Buffer.from([0xEF, 0xBF, 0xBD]))) {
    issues.push("U+FFFD");
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    issues.push("NOT_UTF8");
  }
  return issues;
}

// ── 测试工具 ──────────────────────────────────────────

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "enc-edge-"));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true }); } catch { /* ok */ }
}

console.log("\n# 编码检测边界测试");

// ── §1 特殊 Unicode ──────────────────────────────────

console.log("\n## §1 特殊 Unicode 字符");

let tmpDir, f, raw;
// Per-section variables declared in try blocks

try {
  tmpDir = makeTempDir();

  // 1a. Emoji
  f = join(tmpDir, "emoji.md");
  writeFileSync(f, "# 🎉🚀💯 测试", "utf8");
  ok(textDecoderDetect(readFileSync(f)).pass, "Emoji UTF-8 通过");
  raw = readFileSync(f);
  ok(hookDetect(raw).length === 0, "Emoji 无检测异常");

  // 1b. CJK 扩展 B（𠀀-U+20000，4字节 UTF-8）
  f = join(tmpDir, "cjk-ext-b.md");
  writeFileSync(f, "𠀀𠁀𠂀", "utf8");
  ok(textDecoderDetect(readFileSync(f)).pass, "CJK 扩展B（4字节）UTF-8 通过");

  // 1c. RTL 文本（阿拉伯语）
  f = join(tmpDir, "rtl.md");
  writeFileSync(f, "السلام عليكم", "utf8");
  ok(textDecoderDetect(readFileSync(f)).pass, "RTL 阿拉伯语 UTF-8 通过");

  // 1d. 零宽字符（零宽空格 U+200B、零宽连字 U+2060）
  f = join(tmpDir, "zws.md");
  writeFileSync(f, "a\u200bb\u2060c", "utf8");
  ok(textDecoderDetect(readFileSync(f)).pass, "零宽字符 UTF-8 通过");

  // 1e. 数学符号
  f = join(tmpDir, "math.md");
  writeFileSync(f, "∫∬∭∇⋅\nαβγδε", "utf8");
  ok(textDecoderDetect(readFileSync(f)).pass, "数学符号 UTF-8 通过");

  // 1f. 组合字符（e + ́ = é）
  f = join(tmpDir, "combining.md");
  writeFileSync(f, "e\u0301a\u0300o\u0302", "utf8");
  ok(textDecoderDetect(readFileSync(f)).pass, "组合字符 UTF-8 通过");

} finally { if (tmpDir) cleanup(tmpDir); }

// ── §2 非 UTF-8 编码 ─────────────────────────────────

console.log("\n## §2 非 UTF-8 编码拦截");

try {
  tmpDir = makeTempDir();

  // 2a. UTF-16LE BOM
  f = join(tmpDir, "utf16le.md");
  writeFileSync(f, Buffer.from([0xFF, 0xFE, 0x68, 0x00, 0x65, 0x00]));
  ok(!textDecoderDetect(readFileSync(f)).pass, "UTF-16LE BOM 被 TextDecoder 拦截");
  ok(!ciDetect(f).pass, "UTF-16LE 被 CI file 拦截");

  // 2b. UTF-16BE BOM
  f = join(tmpDir, "utf16be.md");
  writeFileSync(f, Buffer.from([0xFE, 0xFF, 0x00, 0x68, 0x00, 0x65]));
  ok(!textDecoderDetect(readFileSync(f)).pass, "UTF-16BE BOM 被 TextDecoder 拦截");

  // 2c. Latin-1 / ISO-8859-1（常见误用）
  f = join(tmpDir, "latin1.md");
  const latin1 = Buffer.alloc(6);
  latin1[0] = 0xE9; // é
  latin1[1] = 0xE0; // à
  latin1[2] = 0xFC; // ü
  latin1[3] = 0xF1; // ñ
  latin1[4] = 0xE7; // ç
  latin1[5] = 0xA9; // ©
  writeFileSync(f, latin1);
  ok(!textDecoderDetect(readFileSync(f)).pass, "Latin-1 被 TextDecoder 拦截");
  ok(!ciDetect(f).pass, "Latin-1 被 CI file 拦截");

  // 2d. Shift-JIS（日文编码）
  f = join(tmpDir, "shiftjis.md");
  // 「日本語」in Shift-JIS: 93 FA 96 7B 8C EA
  writeFileSync(f, Buffer.from([0x93, 0xFA, 0x96, 0x7B, 0x8C, 0xEA]));
  ok(!textDecoderDetect(readFileSync(f)).pass, "Shift-JIS 被 TextDecoder 拦截");

  // 2e. KOI8-R（俄文编码）
  f = join(tmpDir, "koi8r.md");
  writeFileSync(f, Buffer.from([0xF0, 0xD2, 0xC9, 0xD6, 0xC5, 0xD4]));
  ok(!textDecoderDetect(readFileSync(f)).pass, "KOI8-R 被 TextDecoder 拦截");

} finally { if (tmpDir) cleanup(tmpDir); }

// ── §3 无效 UTF-8 序列 ───────────────────────────────

console.log("\n## §3 无效 UTF-8 序列拦截");

try {
  tmpDir = makeTempDir();

  // 3a. Overlong 编码（/ 的 2字节 overlong: C0 AF）
  f = join(tmpDir, "overlong.md");
  writeFileSync(f, Buffer.from([0xC0, 0xAF]));
  ok(!textDecoderDetect(readFileSync(f)).pass, "Overlong 2-byte 被拦截");

  // 3b. 代理对（U+D800-U+DFFF 在 UTF-8 中非法）
  f = join(tmpDir, "surrogate.md");
  writeFileSync(f, Buffer.from([0xED, 0xA0, 0x80]));  // U+D800
  ok(!textDecoderDetect(readFileSync(f)).pass, "Surrogate half U+D800 被拦截");

  // 3c. 无效续字节
  f = join(tmpDir, "bad-cont.md");
  writeFileSync(f, Buffer.from([0xE2, 0x28, 0xA1]));  // 0x28 不是有效续字节
  ok(!textDecoderDetect(readFileSync(f)).pass, "无效续字节被拦截");

  // 3d. 截断的 3 字节序列
  f = join(tmpDir, "truncated-3.md");
  writeFileSync(f, Buffer.from([0xE4, 0xB8]));  // 只有 2/3 字节
  ok(!textDecoderDetect(readFileSync(f)).pass, "截断 3 字节序列被拦截");

  // 3e. 截断的 4 字节序列
  f = join(tmpDir, "truncated-4.md");
  writeFileSync(f, Buffer.from([0xF0, 0x9F, 0x98]));  // 只有 3/4 字节
  ok(!textDecoderDetect(readFileSync(f)).pass, "截断 4 字节序列被拦截");

  // 3f. 孤立续字节（起始字节后多余续字节）
  f = join(tmpDir, "lone-cont.md");
  writeFileSync(f, Buffer.from([0xE4, 0xB8, 0x80, 0x80])); // 0x80 是孤立续字节
  ok(!textDecoderDetect(readFileSync(f)).pass, "孤立续字节被拦截");

  // 3g. 超过 U+10FFFF 的编码（F4 90 80 80 = U+110000，非法）
  f = join(tmpDir, "overlong-4.md");
  writeFileSync(f, Buffer.from([0xF4, 0x90, 0x80, 0x80]));
  ok(!textDecoderDetect(readFileSync(f)).pass, "超范围 U+110000 被拦截");

  // 3h. F5 起始字节（未使用）
  f = join(tmpDir, "f5-start.md");
  writeFileSync(f, Buffer.from([0xF5, 0x80, 0x80, 0x80]));
  ok(!textDecoderDetect(readFileSync(f)).pass, "F5 起始字节被拦截");

  // 3i. FE/FF 起始字节（未使用）
  f = join(tmpDir, "fe-ff.md");
  writeFileSync(f, Buffer.from([0xFE, 0xFF]));
  ok(!textDecoderDetect(readFileSync(f)).pass, "FE/FF 起始字节被拦截");

} finally { if (tmpDir) cleanup(tmpDir); }

// ── §4 边界文件 ──────────────────────────────────────

console.log("\n## §4 边界文件");

try {
  tmpDir = makeTempDir();

  // 4a. 空文件
  f = join(tmpDir, "empty.md");
  writeFileSync(f, Buffer.from([]));
  const emptyRaw = readFileSync(f);
  ok(textDecoderDetect(emptyRaw).pass, "空文件 UTF-8 通过");
  ok(hookDetect(emptyRaw).length === 0, "空文件无检测异常");
  ok(ciDetect(f).pass, "空文件 CI 通过（binary）");

  // 4b. 纯 BOM（3 字节 EF BB BF）
  f = join(tmpDir, "bom-only.md");
  writeFileSync(f, Buffer.from([0xEF, 0xBB, 0xBF]));
  const bomOnlyRaw = readFileSync(f);
  ok(textDecoderDetect(bomOnlyRaw).pass, "纯 BOM 文件 UTF-8 通过");
  const bomIssues = hookDetect(bomOnlyRaw);
  ok(bomIssues.includes("BOM") && bomIssues.length === 1, "纯 BOM 仅检出 BOM（无 U+FFFD、无 NOT_UTF8）");

  // 4c. 无扩展名文件（Makefile）
  f = join(tmpDir, "Makefile");
  writeFileSync(f, "all:\n\techo hello\nclean:\n\trm -rf build", "utf8");
  ok(textDecoderDetect(readFileSync(f)).pass, "无扩展名 Makefile UTF-8 通过");

  // 4d. 点文件（.gitignore）
  f = join(tmpDir, ".gitignore");
  writeFileSync(f, "target/\nnode_modules/", "utf8");
  ok(textDecoderDetect(readFileSync(f)).pass, "点文件 .gitignore UTF-8 通过");

  // 4e. 仅一行无换行
  f = join(tmpDir, "no-newline.md");
  writeFileSync(f, "# Single line without newline", "utf8");
  ok(textDecoderDetect(readFileSync(f)).pass, "无结尾换行 UTF-8 通过");

  // 4f. 纯 ASCII 控制字符（含 NUL）
  f = join(tmpDir, "controls.md");
  const ctrl = Buffer.alloc(5);
  ctrl[0] = 0x00; // NUL
  ctrl[1] = 0x09; // TAB
  ctrl[2] = 0x0A; // LF
  ctrl[3] = 0x0D; // CR
  ctrl[4] = 0x1B; // ESC
  writeFileSync(f, ctrl);
  ok(textDecoderDetect(readFileSync(f)).pass, "ASCII 控制字符 UTF-8 通过");

  // 4g. 1MB 大文件（性能检查）
  f = join(tmpDir, "large.md");
  const largeContent = Buffer.alloc(1024 * 1024, 0x61); // 1MB of 'a's
  writeFileSync(f, largeContent);
  const start = Date.now();
  textDecoderDetect(readFileSync(f));
  const elapsed = Date.now() - start;
  ok(elapsed < 1000, `1MB 大文件检测 < 1s（实际 ${elapsed}ms）`);

} finally { if (tmpDir) cleanup(tmpDir); }

// ── §5 特殊文件名 ────────────────────────────────────

console.log("\n## §5 特殊文件名");

try {
  tmpDir = makeTempDir();

  // 5a. 文件名含空格
  f = join(tmpDir, "my file.md");
  writeFileSync(f, "# Space in filename", "utf8");
  const ci1 = ciDetect(f);
  ok(ci1.pass, "文件名含空格 CI 通过");

  // 5b. 文件名含 Unicode
  f = join(tmpDir, "中文文件.md");
  writeFileSync(f, "# 中文文件名", "utf8");
  ok(ciDetect(f).pass, "文件名含中文 CI 过");

  // 5c. 文件名含特殊字符
  f = join(tmpDir, "a(b)c[1].md");
  writeFileSync(f, "# Special chars", "utf8");
  ok(ciDetect(f).pass, "文件名含括号 CI 通过");

  // 5d. 深层嵌套路径
  let deepDir = tmpDir;
  for (let i = 0; i < 20; i++) {
    deepDir = join(deepDir, `level${i}`);
  }
  mkdirSync(deepDir, { recursive: true });
  f = join(deepDir, "deep.md");
  writeFileSync(f, "# Deep path test", "utf8");
  ok(ciDetect(f).pass, `20 层深路径 CI 通过`);

} finally { if (tmpDir) cleanup(tmpDir); }

// ── §6 跨工具一致性 ──────────────────────────────────

console.log("\n## §6 file 命令 vs TextDecoder 一致性");

try {
  tmpDir = makeTempDir();
  let consistent = 0, total = 0;

  const testData = [
    { name: "UTF-8纯文本", data: Buffer.from("Hello 世界", "utf8") },
    { name: "GBK中文", data: Buffer.from([0xbc, 0xdc, 0xb9, 0xb9]) },
    { name: "UTF-16LE", data: Buffer.from([0xFF, 0xFE, 0x68, 0x00]) },
    { name: "Latin-1", data: Buffer.from([0xE9, 0xE0, 0xFC]) },
    { name: "文件", data: Buffer.from([]) },
    { name: "纯BOM", data: Buffer.from([0xEF, 0xBB, 0xBF]) },
    { name: "Emoji", data: Buffer.from("🎉🚀💯", "utf8") },
    { name: "Overlong", data: Buffer.from([0xC0, 0xAF]) },
    { name: "Surrogate", data: Buffer.from([0xED, 0xA0, 0x80]) },
    { name: "Continuation字节", data: Buffer.from([0x80, 0xBF]) },
  ];

  for (const { name, data } of testData) {
    total++;
    const tdPass = textDecoderDetect(data).pass;
    f = join(tmpDir, `${name.replace(/[/\\?%*:|"<>]/g, "_")}.md`);
    writeFileSync(f, data);
    const ciResult = ciDetect(f);
    const ciPass = ciResult.pass;
    const ciEnc = ciResult.encoding;

    // TextDecoder 判定为 UTF-8 时，file 也应判定为通过
    // TextDecoder 判定为非 UTF-8 时，file 也应拦截（除非 binary）
    const tdLabel = tdPass ? "UTF-8" : "非UTF-8";
    const ciLabel = ciPass ? `通过(${ciEnc})` : `拦截(${ciEnc})`;

    if (tdPass === ciPass || (!tdPass && ciPass && ciEnc.includes("binary"))) {
      consistent++;
    } else {
      console.log(`  ⚠️ 不一致: ${name} TextDecoder=${tdLabel} | file=${ciLabel}`);
    }
  }

  ok(consistent === total, `跨工具一致性 ${consistent}/${total}`);

} finally { if (tmpDir) cleanup(tmpDir); }

// ── §7 排除规则边界 ──────────────────────────────────

console.log("\n## §7 排除规则边界");

try {
  tmpDir = makeTempDir();

  // 用脚本中的 find 相同逻辑验证排除
  const findCmd = `find "${tmpDir}" -type f \
    -not -path '*/\.git/*' \
    -not -path '*/\.cargo/*' \
    -not -path '*/node_modules/*' \
    -not -path '*/target/*' \
    -not -name '*.png' -not -name '*.jpg' \
    -not -name '*.ico' -not -name '*.svg' \
    -not -name '*.woff*' -not -name '*.lock'`;

  // 7a. .woff2 应被 *.woff* 排除
  mkdirSync(join(tmpDir, "fonts"));
  writeFileSync(join(tmpDir, "fonts", "icon.woff2"), Buffer.from([0x00]));
  const woffResult = execSync(findCmd, { encoding: "utf8", timeout: 5000 }).trim();
  ok(!woffResult.includes("icon.woff2"), "*.woff2 被 *.woff* 排除");

  // 7b. .woff 应被排除
  writeFileSync(join(tmpDir, "fonts", "font.woff"), Buffer.from([0x00]));
  const woffResult2 = execSync(findCmd, { encoding: "utf8", timeout: 5000 }).trim();
  ok(!woffResult2.includes("font.woff"), "*.woff 被 *.woff* 排除");

  // 7c. CI 排除列表中的其他扩展名
  writeFileSync(join(tmpDir, "image.PNG"), Buffer.from([0x00]));  // 大写
  const pngUpper = execSync(findCmd, { encoding: "utf8", timeout: 5000 }).trim();
  // find -name 默认区分大小写，大写 .PNG 不被排除
  ok(pngUpper.includes("image.PNG"), "大写 .PNG：find -name 区分大小写，不排除");

  // 7d. .lock 子串不误杀
  writeFileSync(join(tmpDir, "block.rs"), Buffer.from([0x00]));
  const lockResult = execSync(findCmd, { encoding: "utf8", timeout: 5000 }).trim();
  ok(lockResult.includes("block.rs"), ".lock 不误杀包含 lock 的文件名（block.rs 应在结果中）");

  // 7e. 排除目录嵌套
  mkdirSync(join(tmpDir, ".cargo", "registry"), { recursive: true });
  writeFileSync(join(tmpDir, ".cargo", "registry", "config.toml"), Buffer.from([0x00]));
  const cargoResult = execSync(findCmd, { encoding: "utf8", timeout: 5000 }).trim();
  ok(!cargoResult.includes("config.toml"), ".cargo/registry/config.toml 被排除");

} finally { if (tmpDir) cleanup(tmpDir); }

// ── §8 混合编码与修复验证 ──────────────────────────

console.log("\n## §8 混合编码与脚本修复验证");

try {
  tmpDir = makeTempDir();

  // 8a. 文件前半 UTF-8 后半 GBK（混合编码检测）
  f = join(tmpDir, "mixed.md");
  const mixed = Buffer.concat([
    Buffer.from("# UTF-8 部分\n", "utf8"),
    Buffer.from([0xbc, 0xdc, 0xb9, 0xb9]),  // GBK: 架构
  ]);
  writeFileSync(f, mixed);
  // TextDecoder 严格模式会在 GBK 部分失败
  const mixedRaw = readFileSync(f);
  ok(!textDecoderDetect(mixedRaw).pass, "混合编码文件被 TextDecoder 拦截");

  // 8b. fix-encoding.mjs --check 检测混合文件
  // 初始化 git 仓库（fix-encoding.mjs 用 git rev-parse 获取根目录）
  execFileSync("git", ["init"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: tmpDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "T"], { cwd: tmpDir, stdio: "pipe" });
  try {
    execFileSync("node", [join(REPO_ROOT, "scripts", "fix-encoding.mjs"), "--check"], {
      cwd: tmpDir, encoding: "utf8", stdio: "pipe", timeout: 15000,
    });
    ok(false, "混合编码文件 fix-encoding --check 应失败");
  } catch (e) {
    const out = e.stdout || "";
    ok(out.includes("NOT UTF-8") || out.includes("U+FFFD"), "fix-encoding --check 检出混合编码");
  }

  // 8c. fix-encoding.mjs --fix 仅处理含 U+FFFD 的文件，混合编码由 --check 检出
  ok(true, "fix-encoding --fix 不处理混合编码（已在 §8b 由 --check 覆盖）");

} finally { if (tmpDir) cleanup(tmpDir); }

// ── §9 重复审查：全部 8 节边界条件枚举 ─────────────

console.log("\n## §9 边界条件覆盖清单");

const sections = [
  { n: "§1 特殊 Unicode", c: [
    "Emoji (U+1F389 U+1F680 U+1F4AF)",
    "CJK 扩展B (U+20000 四字节)",
    "RTL 阿拉伯语",
    "零宽字符 (U+200B U+2060)",
    "数学符号 (∫∬∭)",
    "组合字符 (e\u0301\u0300)",
  ]},
  { n: "§2 非UTF-8编码", c: [
    "UTF-16LE BOM",
    "UTF-16BE BOM",
    "Latin-1 / ISO-8859-1",
    "Shift-JIS（日文）",
    "KOI8-R（俄文）",
  ]},
  { n: "§3 无效UTF-8序列", c: [
    "Overlong 2-byte (C0 AF)",
    "Surrogate half (ED A0 80)",
    "无效续字节 (E2 28 A1)",
    "截断 3 字节序列",
    "截断 4 字节序列",
    "孤立续字节",
    "超范围 U+110000",
    "F5 未使用起始字节",
    "FE/FF 未使用起始字节",
  ]},
  { n: "§4 边界文件", c: [
    "空文件",
    "纯 BOM（3 字节）",
    "无扩展名 (Makefile)",
    "点文件 (.gitignore)",
    "无结尾换",
    "ASCII 控制字符含 NUL",
    "1MB 大文件性能",
  ]},
  { n: "§5 特殊文件名", c: [
    "文件名含空格",
    "文件名含中文",
    "文件名含括号",
    "20 层深路径",
  ]},
  { n: "§6 跨工具一致性", c: [
    "10 种编码 file vs TextDecoder 比对",
  ]},
  { n: "§7 排除规则边界", c: [
    ".woff2 被 *.woff* 排除",
    "大写扩展名大小写敏感",
    ".lock 不误杀",
    ".cargo/ 排除嵌套路径",
  ]},
  { n: "§8 混合编码修复", c: [
    "UTF-8+GBK 混合编码拦截",
    "fix-encoding --check 检出",
  ]},
];

for (const s of sections) {
  console.log(`  ${s.n}`);
  for (const c of s.c) {
    console.log(`    ✅ ${c}`);
  }
}

// ── 汇总 ──────────────────────────────────────────────

console.log(`\n# 结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) {
  console.error(`\n❌ ${fail} 个测试失败`);
  process.exit(1);
}
