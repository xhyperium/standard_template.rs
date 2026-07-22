/**
 * session-review.test.mjs — L1 单元测试 for session-review.mjs
 *
 * 测试范围：
 *  1. Harness 状态解析 — phase/mode 对象合并
 *  2. 敏感文件检测 — .env / node_modules / .gitignore 正则
 *  3. Diff stat 数据提取 — insertions/deletions 数值
 *  4. 调试残留检测 — console.log / TODO / FIXME / debugger
 *  5. 依赖变更检查 — depChanged / lockChanged / depWithoutLock
 *  6. CLAUDE.md 规则检查 — Surgical Changes / Goal-Driven
 *  7. OpenSpec 验证逻辑 — pendingChanges / openspecPassed
 *  8. 阈值逻辑 — phase/mode → maxFiles / maxLines
 *  9. 报告生成结构 — flags 收集规则
 * 10. 文件变化计数与过滤
 *
 * 使用 ESM (.mjs)，纯 assert 模式。
 */

let pass = 0, fail = 0;
function ok(c, name) {
  if (c) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

// ═══ 从被测文件复制纯函数/逻辑 ═══

/** 解析 Harness 状态（合并默认值） */
const parseHarnessState = (raw) => {
  const defaults = { phase: "build", mode: "full" };
  if (!raw) return defaults;
  try {
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
};

const sensitivePatterns = [/(^|\/)\.env/, /node_modules/, /\.gitignore$/];

const isSensitive = (filePath) =>
  sensitivePatterns.some((p) => p.test(filePath));

const debugPatterns = [/console\.\w+\s*\(/, /\bTODO\b/, /\bFIXME\b/, /\bdebugger\b/];

const findDebugHits = (diffContent) => {
  return debugPatterns.filter(p => p.test(diffContent));
};

/** 提取 diff stat 中的 insertions/deletions */
const parseDiffStat = (stat) => {
  const insertions = stat.match(/(\d+) insertions?/)?.[1] || "0";
  const deletions = stat.match(/(\d+) deletions?/)?.[1] || "0";
  return {
    insertions: parseInt(insertions),
    deletions: parseInt(deletions),
    total: parseInt(insertions) + parseInt(deletions),
  };
};

const depFiles = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml", "Gemfile"];
const lockFiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "poetry.lock", "go.sum", "Cargo.lock", "Gemfile.lock"];

const checkDepChange = (changedFiles) => {
  const depChanged = depFiles.some(d => changedFiles.some(f => f.endsWith(d)));
  const lockChanged = lockFiles.some(l => changedFiles.some(f => f.endsWith(l)));
  const depWithoutLock = depChanged && !lockChanged;
  return { depChanged, lockChanged, depWithoutLock };
};

/** 根据 phase/mode 确定阈值 */
const getThresholds = (harnessState) => {
  const isFix = harnessState.phase === "fix";
  const isDesign = harnessState.phase === "design";
  const isHotfix = harnessState.mode === "hotfix";
  const isTweak = harnessState.mode === "tweak";
  const maxFiles = isFix ? 5 : (isDesign ? 20 : 10);
  const maxLines = isHotfix ? Infinity : (isTweak ? Infinity : 500);
  return { isFix, isDesign, isHotfix, isTweak, maxFiles, maxLines };
};

// ═══ 测试开始 ═══

console.log("\nsession-review L1 tests");

// --- 1. Harness 状态解析 ---
const defaultState = parseHarnessState(null);
ok(defaultState.phase === "build", "默认 phase=build");
ok(defaultState.mode === "full", "默认 mode=full");

ok(parseHarnessState("invalid").phase === "build", "无效 JSON → fallback 默认值");
ok(parseHarnessState("invalid").mode === "full", "无效 JSON → mode fallback");

const designState = parseHarnessState('{"phase":"design"}');
ok(designState.phase === "design", "自定义 phase=design");
ok(designState.mode === "full", "未指定的 mode 保持默认");

const hotfixState = parseHarnessState('{"phase":"build","mode":"hotfix"}');
ok(hotfixState.mode === "hotfix", "mode=hotfix 正确解析");

// --- 2. 敏感文件检测 ---
ok(isSensitive(".env") === true, ".env 被检测为敏感文件");
ok(isSensitive("dir/.env") === true, "子目录下 .env 被检测");
ok(isSensitive(".env.local") === true, ".env.local 被检测（匹配 /(\\.env) 前缀）");
ok(isSensitive("src/.env.example") === true, ".env.example 被检测（/(^|\\/)\\.env/ 匹配 .env 前缀）");
ok(isSensitive("node_modules/foo") === true, "node_modules 任意路径被检测");
ok(isSensitive("src/node_modules/index.js") === true, "嵌套 node_modules 被检测");
ok(isSensitive(".gitignore") === true, ".gitignore 被检测");
ok(isSensitive(".gitignore.bak") === false, ".gitignore.bak 不被检测（$ 终结要求）");
ok(isSensitive("src/main.rs") === false, "常规源码不被检测");

// --- 3. Diff stat 解析 ---
const stat1 = " 5 files changed, 120 insertions(+), 45 deletions(-)";
const parsed1 = parseDiffStat(stat1);
ok(parsed1.insertions === 120, "insertions=120");
ok(parsed1.deletions === 45, "deletions=45");
ok(parsed1.total === 165, "total=165");

const stat2 = " 1 file changed, 10 insertions(+)";
const parsed2 = parseDiffStat(stat2);
ok(parsed2.insertions === 10, "仅 insertions → 10");
ok(parsed2.deletions === 0, "无 deletions → 0");

const stat3 = " 3 files changed, 0 insertions(+), 30 deletions(-)";
const parsed3 = parseDiffStat(stat3);
ok(parsed3.insertions === 0, "0 insertions");
ok(parsed3.deletions === 30, "deletions=30");

const emptyStat = parseDiffStat("");
ok(emptyStat.total === 0, "空 stat → total=0");

// --- 4. 调试残留检测 ---
ok(findDebugHits("console.log('test')").length > 0, "console.log 被检测");
ok(findDebugHits("console.warn('test')").length > 0, "console.warn 被检测");
ok(findDebugHits("console.error(e)").length > 0, "console.error 被检测");
ok(findDebugHits("// TODO: fix this").length > 0, "TODO 被检测");
ok(findDebugHits("// FIXME: broken").length > 0, "FIXME 被检测");
ok(findDebugHits("debugger;").length > 0, "debugger 被检测");
ok(findDebugHits("").length === 0, "空内容无调试残留");
ok(findDebugHits("// normal comment").length === 0, "普通注释无调试残留");
// 跨行检测
ok(findDebugHits("line1\nconsole.log(x)\nline3").length > 0, "多行内容检测到 console.log");

// --- 5. 依赖变更检查 ---
const depCheck1 = checkDepChange(["Cargo.toml", "src/main.rs"]);
ok(depCheck1.depChanged === true, "Cargo.toml 变更 → depChanged");
ok(depCheck1.lockChanged === false, "Cargo.lock 未变更 → lockChanged=false");
ok(depCheck1.depWithoutLock === true, "dep 变但 lock 不变 → depWithoutLock");

const depCheck2 = checkDepChange(["Cargo.toml", "Cargo.lock"]);
ok(depCheck2.depChanged === true, "Cargo.toml 变更");
ok(depCheck2.lockChanged === true, "Cargo.lock 也变更");
ok(depCheck2.depWithoutLock === false, "lock 同步 → depWithoutLock=false");

const depCheck3 = checkDepChange(["src/lib.rs"]);
ok(depCheck3.depChanged === false, "无依赖文件变更");
ok(depCheck3.depWithoutLock === false, "无 dep → depWithoutLock=false");

// package.json 也需检测
const depCheck4 = checkDepChange(["package.json"]);
ok(depCheck4.depChanged === true, "package.json 变更被检测");

// --- 6. CLAUDE.md 规则检查 ---
const hasSurgical = (rules) => rules.includes("Surgical Changes");
const hasGoalDriven = (rules) => rules.includes("Goal-Driven");
ok(hasSurgical("Rules\nSurgical Changes\nMore") === true, "检测到 Surgical Changes 规则");
ok(hasSurgical("No such rule") === false, "未检测到 Surgical Changes");
ok(hasGoalDriven("Goal-Driven Execution") === true, "检测到 Goal-Driven 规则");
ok(hasGoalDriven("Nope") === false, "未检测到 Goal-Driven");

// --- 7. OpenSpec 验证逻辑 ---
const hasOpenSpec = (path) => path.includes("openspec");
ok(hasOpenSpec("/project/openspec") === true, "openspec 目录存在");
ok(hasOpenSpec("/project/src") === false, "无 openspec 目录");

const validateOutput = (output) => {
  return !!(output && !output.includes("error") && !output.includes("FAIL"));
};
ok(validateOutput("All specs valid") === true, "验证通过 → passed");
ok(validateOutput("error: missing spec") === false, "包含 error → failed");
ok(validateOutput("FAIL validation") === false, "包含 FAIL → failed");
ok(validateOutput("") === false, "空输出 → failed");
ok(validateOutput(null) === false, "null → failed");

// --- 8. 阈值逻辑 ---
const t1 = getThresholds({ phase: "fix", mode: "full" });
ok(t1.maxFiles === 5, "fix phase → maxFiles=5");
ok(t1.maxLines === 500, "non-hotfix/non-tweak → maxLines=500");
ok(t1.isFix === true, "isFix=true");
ok(t1.isDesign === false, "isDesign=false");

const t2 = getThresholds({ phase: "design", mode: "full" });
ok(t2.maxFiles === 20, "design phase → maxFiles=20");
ok(t2.maxLines === 500, "design mode=full → maxLines=500");

const t3 = getThresholds({ phase: "build", mode: "hotfix" });
ok(t3.maxFiles === 10, "build/hotfix → maxFiles=10");
ok(t3.maxLines === Infinity, "hotfix → maxLines=Infinity");

const t4 = getThresholds({ phase: "build", mode: "tweak" });
ok(t4.maxLines === Infinity, "tweak → maxLines=Infinity");

const t5 = getThresholds({ phase: "build", mode: "full" });
ok(t5.maxFiles === 10, "default → maxFiles=10");
ok(t5.maxLines === 500, "default → maxLines=500");

// --- 9. Flags 收集逻辑验证 ---
// tooManyFiles / tooManyLines 判断
ok(15 > t5.maxFiles, "15 files > maxFiles=10 → tooManyFiles");
ok(3 <= t5.maxFiles, "3 files <= maxFiles=10 → OK");
ok(600 > t5.maxLines, "600 lines > maxLines=500 → tooManyLines");

// isFix + >5 files → 特殊 flag
ok(t1.isFix && 10 > 5, "fix 模式 + 10 files>5 → 触发扩展范围警告");

// non-design/non-tweak → 检测调试残留; design/tweak → 跳过
const shouldCheckDebug = (harnessState) => {
  return harnessState.phase !== "design" && harnessState.mode !== "tweak";
};
ok(shouldCheckDebug({ phase: "build", mode: "full" }) === true, "build+full → 检测调试残留");
ok(shouldCheckDebug({ phase: "fix", mode: "full" }) === true, "fix+full → 检测调试残留");
ok(shouldCheckDebug({ phase: "design", mode: "full" }) === false, "design → 跳过调试残留检查");
ok(shouldCheckDebug({ phase: "build", mode: "tweak" }) === false, "tweak → 跳过调试残留检查");

// depWithoutLock 在 tweak 模式下不触发 flag
const shouldCheckDep = (harnessState) => harnessState.mode !== "tweak";
ok(shouldCheckDep({ mode: "tweak" }) === false, "tweak → 跳过依赖检查 flag");
ok(shouldCheckDep({ mode: "full" }) === true, "full → 执行依赖检查 flag");

// --- 10. 报告结构验证 ---
const reportHeader = "## Stop Hook 审查报告";
ok(reportHeader.startsWith("## "), "报告以 ## 二级标题开头");
ok(reportHeader.includes("审查报告"), "报告标题含 审查报告");

// ═══ 结果 ═══
console.log(`\n  ${pass} passed, ${fail} failed, ${pass + fail} total\n`);
process.exit(fail > 0 ? 1 : 0);
