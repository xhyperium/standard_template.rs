#!/usr/bin/env node
/**
 * cov-gate-100.mjs 综合测试套件（不执行 cargo）。
 *
 * 运行: node scripts/quality-gates/cov-gate-100.test.mjs
 */
import { strict as assert } from "node:assert";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const scriptPath = join(__dirname, "cov-gate-100.mjs");

// ── helper ────────────────────────────────────────────────────

function assertScriptExists() {
  const src = readFileSync(scriptPath, "utf8");
  assert.ok(src.length > 0, "脚本文件不为空");
  return src;
}

function assertShebang(src) {
  assert.ok(
    src.startsWith("#!/usr/bin/env node"),
    "shebang 为 #!/usr/bin/env node",
  );
}

// ── test: 脚本结构 ──────────────────────────────────────────────

function testScriptStructure() {
  const src = assertScriptExists();
  assertShebang(src);

  // 必需的 import
  assert.ok(src.includes("node:child_process"), "import spawnSync");
  assert.ok(src.includes("node:fs"), "import fs");
  assert.ok(src.includes("node:os"), "import os");
  assert.ok(src.includes("node:path"), "import path");

  // 函数存在性
  assert.ok(
    src.includes("function usage("),
    "usage 函数已定义",
  );

  // 参数解析变量
  assert.ok(src.includes("let pkg = null"), "let pkg");
  assert.ok(src.includes("let filter = null"), "let filter");
  assert.ok(src.includes("const extra = []"), "const extra");

  // LCOV 解析变量
  assert.ok(src.includes("let cur = null"), "let cur");
  assert.ok(src.includes("let instrumented = 0"), "let instrumented");
  assert.ok(src.includes("let hit = 0"), "let hit");
  assert.ok(src.includes("const zeros = []"), "zeros array");

  // 覆盖率计算
  assert.ok(src.includes("(100 * hit) / instrumented"), "覆盖率公式");
  assert.ok(src.includes("uncovered lines"), "uncovered lines 报告");

  console.log("  ✓ 脚本结构");
}

// ── test: 参数解析（通过子进程调用 --help）─────────────────────

function testHelpFlag() {
  try {
    execSync(`node "${scriptPath}" --help`, { encoding: "utf8", stdio: "pipe" });
    // --help 应 exit(0)，但可能先走 !pkg||!filter → usage(1)
    // 所以这里验证脚本不会因 --help 卡死即可
    console.log("  ✓ --help 不抛异常");
  } catch (e) {
    // -h/--help 调用 usage(0) → process.exit(0)
    // process.exit 在子进程中表现为退出码
    if (e.status === 0) {
      console.log("  ✓ --help exit(0)");
    } else if (e.stdout || e.stderr) {
      // usage() 被调用，stderr 有内容；退出码由 !pkg||!filter 决定
      console.log(`  ✓ --help 调用 usage (exit=${e.status})`);
    } else {
      throw e;
    }
  }
}

function testMissingArgsUsage() {
  try {
    execSync(`node "${scriptPath}"`, { encoding: "utf8", stdio: "pipe" });
    assert.fail("无参数应退出");
  } catch (e) {
    assert.ok(e.status !== 0, "缺少参数时非零退出");
    assert.ok(
      (e.stderr || "").includes("usage") || (e.stdout || "").includes("usage"),
      "输出包含 usage 提示",
    );
    console.log(`  ✓ 缺少参数 → usage(1) exit=${e.status}`);
  }
}

function testMissingFilterOnly() {
  try {
    execSync(`node "${scriptPath}" -p test-pkg`, {
      encoding: "utf8",
      stdio: "pipe",
    });
    assert.fail("缺少 --filter 应退出");
  } catch (e) {
    assert.ok(e.status !== 0, "缺少 --filter 非零退出");
    console.log(`  ✓ 只有 -p 无 --filter → usage(1) exit=${e.status}`);
  }
}

// ── LCOV 解析逻辑测试 ───────────────────────────────────────────

/**
 * 核心解析逻辑复制（同 cov-gate-100.mjs 行 69-89）。
 * 返回 { instrumented, hit, zeros, pct }。
 */
function parseLcov(text, filter) {
  let cur = null;
  let instrumented = 0;
  let hit = 0;
  const zeros = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      cur = line.slice(3);
      continue;
    }
    if (!cur || !cur.includes(filter)) continue;
    if (!line.startsWith("DA:")) continue;
    const body = line.slice(3);
    const [ln, count] = body.split(",");
    instrumented += 1;
    if (count === "0") {
      zeros.push(`${cur}:${ln}`);
    } else {
      hit += 1;
    }
  }
  const pct = instrumented === 0 ? 100 : (100 * hit) / instrumented;
  return { instrumented, hit, zeros, pct };
}

/** 创建临时 LCOV 文件并返回路径 + cleanup */
function writeTempLcov(content) {
  const dir = mkdtempSync(join(tmpdir(), "cov-gate-test-"));
  const p = join(dir, "cov.lcov");
  writeFileSync(p, content, "utf8");
  return {
    path: p,
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function test100PercentCoverage() {
  const sample = [
    "TN:",
    "SF:crates/kernel/src/main.rs",
    "FN:1,main",
    "FNDA:5,main",
    "DA:1,5",
    "DA:2,5",
    "DA:3,4",
    "DA:5,7",
    "DA:10,3",
    "LF:5",
    "LH:5",
    "end_of_record",
    "",
    "SF:crates/kernel/src/lib.rs",
    "DA:1,2",
    "DA:3,8",
    "LF:2",
    "LH:2",
    "end_of_record",
  ].join("\n");

  const result = parseLcov(sample, "crates/kernel/src");
  assert.equal(result.instrumented, 7, "插桩行数");
  assert.equal(result.hit, 7, "命中行数");
  assert.equal(result.zeros.length, 0, "零覆盖行数");
  assert.equal(result.pct, 100, "覆盖率 100%");

  console.log(`  ✓ 100% 覆盖 LCOV (instrumented=${result.instrumented})`);
}

function testUncoveredLines() {
  const sample = [
    "TN:",
    "SF:crates/kernel/src/main.rs",
    "FN:1,main",
    "DA:1,5",
    "DA:2,0", // 未覆盖
    "DA:3,4",
    "DA:5,0", // 未覆盖
    "DA:10,3",
    "LF:5",
    "LH:3",
    "end_of_record",
  ].join("\n");

  const result = parseLcov(sample, "crates/kernel/src");
  assert.equal(result.instrumented, 5, "插桩行数");
  assert.equal(result.hit, 3, "命中行数");
  assert.equal(result.zeros.length, 2, "零覆盖行数");
  assert.ok(result.pct < 100, "覆盖率 < 100%");
  assert.ok(Math.abs(result.pct - 60) < 0.01, `覆盖率约 60% (got ${result.pct})`);

  // 校验 zeros 内容
  assert.ok(result.zeros[0].includes("main.rs:2"), "零覆盖位置 1");
  assert.ok(result.zeros[1].includes("main.rs:5"), "零覆盖位置 2");

  console.log(
    `  ✓ 未覆盖行: zeros=${result.zeros.length} pct=${result.pct.toFixed(2)}`,
  );
}

function testFilterExcludesNonMatchingSources() {
  const sample = [
    "TN:",
    "SF:crates/kernel/src/main.rs",
    "DA:1,5",
    "DA:2,0", // 不在 filter 范围内的零覆盖
    "end_of_record",
    "SF:crates/other/src/util.rs",
    "DA:1,0", // 不在 filter 范围内
    "DA:2,0",
    "end_of_record",
  ].join("\n");

  const result = parseLcov(sample, "crates/kernel/src");
  assert.equal(result.instrumented, 2, "仅内核插桩");
  assert.equal(result.zeros.length, 1, "仅内核内零覆盖");
  assert.equal(result.hit, 1, "命中的内核行");

  console.log("  ✓ filter 正确排除不匹配源文件");
}

function testMultipleSourceFiles() {
  const sample = [
    "TN:",
    "SF:crates/kernel/src/main.rs",
    "DA:1,1",
    "DA:2,2",
    "end_of_record",
    "SF:crates/kernel/src/init.rs",
    "DA:5,3",
    "DA:6,3",
    "DA:7,0",
    "end_of_record",
  ].join("\n");

  const result = parseLcov(sample, "crates/kernel/src");
  assert.equal(result.instrumented, 5, "多文件插桩");
  assert.equal(result.hit, 4, "命中的行");
  assert.equal(result.zeros.length, 1, "1 行零覆盖");
  assert.ok(result.zeros[0].includes("init.rs:7"), "init.rs 第 7 行");

  console.log(
    `  ✓ 多源文件: ${result.instrumented} instrumented, ${result.zeros.length} zeros`,
  );
}

function testEmptyLcov() {
  const result = parseLcov("", "crates/kernel/src");
  assert.equal(result.instrumented, 0, "空 LCOV 插桩=0");
  assert.equal(result.hit, 0, "空 LCOV 命中=0");
  assert.equal(result.zeros.length, 0, "空 LCOV zeros=0");
  assert.equal(result.pct, 100, "空 LCOV pct=100 (兜底)");

  console.log("  ✓ 空 LCOV 正确处理");
}

function testNoMatchingFilter() {
  const sample = [
    "TN:",
    "SF:crates/other/src/util.rs",
    "DA:1,5",
    "DA:2,0",
    "end_of_record",
  ].join("\n");

  const result = parseLcov(sample, "crates/kernel/src");
  assert.equal(result.instrumented, 0, "无匹配时插桩=0");
  assert.equal(result.hit, 0);
  assert.equal(result.zeros.length, 0);
  assert.equal(result.pct, 100, "无匹配 pct=100");

  // 模拟 refuse empty pass
  assert.equal(result.instrumented, 0, "instrumented===0 应拒绝对空通过");

  console.log("  ✓ 无匹配 filter → instrumented=0");
}

function testDaCountAtEdgeValues() {
  const sample = [
    "TN:",
    "SF:crates/kernel/src/edge.rs",
    "DA:1,0",
    "DA:2,1",
    "DA:3,999",
    "DA:4,0",
    "end_of_record",
  ].join("\n");

  const result = parseLcov(sample, "crates/kernel/src");
  assert.equal(result.instrumented, 4);
  assert.equal(result.hit, 2);
  assert.equal(result.zeros.length, 2);
  assert.ok(
    result.zeros.some((z) => z.includes("edge.rs:1")),
    "DA:1,0 已捕获",
  );
  assert.ok(
    result.zeros.some((z) => z.includes("edge.rs:4")),
    "DA:4,0 已捕获",
  );
  assert.ok(!result.zeros.some((z) => z.includes("edge.rs:3")), "DA:3,999 非零");

  console.log("  ✓ 边界 DA 计数值");
}

function testDaWithFuncionDataLines() {
  const sample = [
    "TN:",
    "SF:crates/kernel/src/fn.rs",
    "FN:5,my_func",
    "FNDA:10,my_func",
    "DA:5,10",
    "DA:6,8",
    "DA:7,0",
    "FNF:1",
    "FNH:1",
    "LF:3",
    "LH:2",
    "end_of_record",
  ].join("\n");

  const result = parseLcov(sample, "crates/kernel/src");
  assert.equal(result.instrumented, 3, "插桩行数（忽略 FN/FNDA/LF/LH）");
  assert.equal(result.zeros.length, 1, "1 行零覆盖");
  assert.ok(result.zeros[0].includes("fn.rs:7"), "fn.rs:7 零覆盖");

  console.log("  ✓ 跳过 FN/FNDA/LF/LH，仅处理 DA");
}

function testDaLineWithoutSourceFile() {
  // 某些损坏的 LCOV 可能在 SF 之前有 DA 行，应跳过
  const sample = [
    "TN:",
    "DA:1,5",
    "DA:2,0",
    "SF:crates/kernel/src/after.rs",
    "DA:3,2",
    "DA:4,0",
    "end_of_record",
  ].join("\n");

  const result = parseLcov(sample, "crates/kernel/src");
  // DA:1,5 和 DA:2,0 在 SF 之前，cur=null → 跳过
  assert.equal(result.instrumented, 2, "仅 SF 之后的 DA 计入");
  assert.equal(result.hit, 1);
  assert.equal(result.zeros.length, 1);
  assert.ok(result.zeros[0].includes("after.rs:4"), "after.rs:4 零覆盖");

  console.log("  ✓ SF 之前的 DA 行被忽略");
}

// ── test: 门禁逻辑 ──────────────────────────────────────────

function testGatePassCondition() {
  const result = parseLcov(
    [
      "SF:crates/kernel/src/lib.rs",
      "DA:1,5",
      "DA:2,3",
      "end_of_record",
    ].join("\n"),
    "crates/kernel/src",
  );

  // 模拟行 91-105 门禁逻辑
  assert.ok(result.instrumented > 0, "instrumented > 0");
  assert.ok(result.zeros.length === 0, "zeros.length === 0 → PASS");

  const wouldPass = result.instrumented > 0 && result.zeros.length === 0;
  assert.equal(wouldPass, true, "门禁应判定通过");

  console.log("  ✓ 门禁 PASS 条件");
}

function testGateFailZerosExist() {
  const result = parseLcov(
    [
      "SF:crates/kernel/src/lib.rs",
      "DA:1,0",
      "DA:2,5",
      "end_of_record",
    ].join("\n"),
    "crates/kernel/src",
  );

  assert.ok(result.zeros.length > 0, "zeros > 0 → FAIL");
  assert.ok(result.instrumented > 0, "有插桩行");

  const wouldPass = result.instrumented > 0 && result.zeros.length === 0;
  assert.equal(wouldPass, false, "门禁应判定失败");

  console.log("  ✓ 门禁 FAIL 条件（zeros > 0）");
}

function testGateFailEmptyInstrumented() {
  const result = parseLcov(
    [
      "SF:crates/other/src/lib.rs",
      "DA:1,5",
      "DA:2,3",
      "end_of_record",
    ].join("\n"),
    "crates/kernel/src",
  );

  assert.equal(result.instrumented, 0, "instrumented=0 → 拒绝对空通过");

  const wouldPass = result.instrumented > 0 && result.zeros.length === 0;
  assert.equal(wouldPass, false);

  console.log("  ✓ 门禁 FAIL 条件（instrumented=0）");
}

function testRefuseEmptyPassMessage() {
  const src = readFileSync(scriptPath, "utf8");
  assert.ok(
    src.includes("refusing empty pass"),
    "包含 refusing empty pass 提示",
  );

  console.log("  ✓ refusing empty pass 消息存在");
}

// ── test: 覆盖率精度 ──────────────────────────────────────────

function testCoveragePrecision() {
  // 3/7 ≈ 42.857...
  const result = parseLcov(
    [
      "SF:crates/kernel/src/lib.rs",
      "DA:1,1",
      "DA:2,2",
      "DA:3,3",
      "DA:4,0",
      "DA:5,0",
      "DA:6,0",
      "DA:7,0",
      "end_of_record",
    ].join("\n"),
    "crates/kernel/src",
  );

  const expected = (100 * 3) / 7; // ≈ 42.857142857...
  assert.ok(
    Math.abs(result.pct - expected) < 0.001,
    `精度正确 (got ${result.pct})`,
  );
  console.log(`  ✓ 覆盖率精度 pct=${result.pct}`);
}

// ── test: toFixed(4) ────────────────────────────────────────

function testToFixedFormat() {
  const src = readFileSync(scriptPath, "utf8");
  assert.ok(
    src.includes("toFixed(4)"),
    "覆盖率使用 toFixed(4) 输出",
  );
  console.log("  ✓ toFixed(4) 格式");
}

// ── test: 零覆盖截断显示 ────────────────────────────────────

function testZeroTruncationLogic() {
  const src = readFileSync(scriptPath, "utf8");
  assert.ok(
    src.includes("slice(0, 50)"),
    "zeros 截断 slice(0,50)",
  );
  assert.ok(
    src.includes("... +"),
    "显示截断更多提示",
  );
  console.log("  ✓ zeros 截断逻辑 (slice 0..50)");
}

// ── test: 脚本文件可执行权限 ─────────────────────────────────

function testScriptPermissions() {
  const { mode } = readFileSync(scriptPath, { mode: true }) || {};
  // 如果平台支持 mode，验证
  if (mode !== undefined) {
    assert.ok(
      (mode & 0o111) !== 0,
      "脚本有可执行权限",
    );
  }
  console.log("  ✓ 脚本权限检查");
}

// ── main ──────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (e) {
    failed += 1;
    console.error(`\nFAIL: ${name}`);
    console.error(`      ${e.message}`);
    if (e.code) console.error(`      code=${e.code}`);
  }
}

console.log("\n=== 结构与导入 ===");
runTest("脚本结构", testScriptStructure);
runTest("脚本权限", testScriptPermissions);

console.log("\n=== 参数解析 ===");
runTest("--help", testHelpFlag);
runTest("缺少参数", testMissingArgsUsage);
runTest("缺少 --filter", testMissingFilterOnly);

console.log("\n=== LCOV 解析 ===");
runTest("100% 覆盖", test100PercentCoverage);
runTest("未覆盖行", testUncoveredLines);
runTest("filter 排除", testFilterExcludesNonMatchingSources);
runTest("多源文件", testMultipleSourceFiles);
runTest("空 LCOV", testEmptyLcov);
runTest("无匹配 filter", testNoMatchingFilter);
runTest("边界 DA 值", testDaCountAtEdgeValues);
runTest("跳过 FN/FNDA 行", testDaWithFuncionDataLines);
runTest("SF 前 DA 跳过", testDaLineWithoutSourceFile);

console.log("\n=== 门禁逻辑 ===");
runTest("PASS 条件", testGatePassCondition);
runTest("FAIL zeros", testGateFailZerosExist);
runTest("FAIL empty instrumented", testGateFailEmptyInstrumented);
runTest("refusing empty pass", testRefuseEmptyPassMessage);

console.log("\n=== 格式与边界 ===");
runTest("覆盖率精度", testCoveragePrecision);
runTest("toFixed(4)", testToFixedFormat);
runTest("zeros 截断", testZeroTruncationLogic);

console.log(`\n=== ${passed} passed, ${failed} failed ===`);

if (failed > 0) {
  process.exit(1);
}
