#!/usr/bin/env node
/**
 * edit-guard.test.mjs — L1 单元测试 for edit-guard.mjs
 *
 * 测试范围：
 *  1. 文件结构：shebang、语法有效性
 *  2. 状态管理：parse/count/halt 逻辑（纯函数）
 *  3. 工具检测：Edit vs 其他 tool 的分流逻辑
 *  4. 阈值逻辑：count > EDIT_THRESHOLD（4）触发警告
 *  5. 警告消息：内容包含阈值、建议、token 估算
 */

import { execFileSync } from "child_process";
import { readFileSync } from "fs";

// ── 从 edit-guard.mjs 提取的可测试��辑 ──────────────────────

const EDIT_THRESHOLD = 4;

/**
 * 解析状态 JSON（模拟 loadState + 异常处理）
 */
function parseState(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch (_) {
    return {};
  }
}

/**
 * 递增文件计数器（模拟 state[filePath] = (state[filePath] || 0) + 1）
 */
function incrementCounter(state, filePath) {
  const next = { ...state };
  next[filePath] = (next[filePath] || 0) + 1;
  return next;
}

/**
 * 检查是否超出阈值
 */
function exceedsThreshold(count, threshold = EDIT_THRESHOLD) {
  return count > threshold;
}

/**
 * 检测是否为 Edit 工具
 */
function isEditTool(toolName) {
  return toolName === "Edit";
}

/**
 * 构造 EditGuard 警告消息
 */
function buildWarning(filePath, count, threshold = EDIT_THRESHOLD) {
  const msg = `[EditGuard] ⚠️ ${filePath}: ${count} Edits since last Write (threshold: ${threshold}).`;
  const hint = `Consider using Write tool once instead of ${count} incremental Edits.`;
  const savings = `Estimated token waste: ${(count - 1) * 4000}+ tokens (re-read cycles after hook).`;
  const ref = `See CLAUDE.md "xlibgate Trust Alignment session 复盘成本规则" — Atomic Write > incremental Edit.`;
  return `${msg}\n${hint}\n${savings}\n${ref}`;
}

/**
 * 从 tool input 提取 file_path
 */
function extractFilePath(toolCall) {
  try {
    const parsed = typeof toolCall === "string" ? JSON.parse(toolCall) : toolCall;
    return parsed.tool_input?.file_path || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * 从 tool input 提取 tool_name
 */
function extractToolName(toolCall) {
  try {
    const parsed = typeof toolCall === "string" ? JSON.parse(toolCall) : toolCall;
    return parsed.tool_name || "";
  } catch {
    return "";
  }
}

// ── 测试框架 ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function describe(name, fn) {
  console.log(`\n${name}`);
  fn();
}

function it(name, fn) {
  console.log(`  ${name}`);
  try {
    fn();
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name} threw: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
  }
}

// ── 测试 1: 文件结构 ────────────────────────────────────────

describe("edit-guard.mjs — 文件结构", () => {
  it("shebang 存在", () => {
    const src = readFileSync(".claude/hooks/edit-guard.mjs", "utf8");
    assert(src.startsWith("#!/usr/bin/env node"), "首行 shebang");
  });

  it("语法有效（node --check）", () => {
    try {
      execFileSync("node", ["--check", ".claude/hooks/edit-guard.mjs"], {
        stdio: "pipe",
        timeout: 5000,
      });
      assert(true, "node --check 通过");
    } catch (e) {
      assert(false, `node --check 失败: ${e.stderr?.toString() || e.message}`);
    }
  });

  it("包含 EDIT_THRESHOLD 常量", () => {
    const src = readFileSync(".claude/hooks/edit-guard.mjs", "utf8");
    assert(src.includes("EDIT_THRESHOLD"), "EDIT_THRESHOLD 常量存在");
  });

  it("包含 STATE_FILE 路径", () => {
    const src = readFileSync(".claude/hooks/edit-guard.mjs", "utf8");
    assert(
      src.includes(".claude/.edit-guard-state.json"),
      ".edit-guard-state.json 路径存在"
    );
  });
});

// ── 测试 2: 状态解析 ────────────────────────────────────────

describe("parseState — JSON 状态解析", () => {
  it("解析有效 JSON 状态", () => {
    const state = parseState('{"file1.ts": 2, "file2.ts": 1}');
    assert(state["file1.ts"] === 2, `file1=2, got ${state["file1.ts"]}`);
    assert(state["file2.ts"] === 1, `file2=1, got ${state["file2.ts"]}`);
  });

  it("空 JSON 对象", () => {
    const state = parseState("{}");
    assert(Object.keys(state).length === 0, `空对象, got ${JSON.stringify(state)}`);
  });

  it("无效 JSON → 返回空对象", () => {
    const state = parseState("not json");
    assert(Object.keys(state).length === 0, `空对象, got ${JSON.stringify(state)}`);
  });

  it("空字符串 → 空对象", () => {
    const state = parseState("");
    assert(Object.keys(state).length === 0, `空对象`);
  });

  it("计数为 0", () => {
    const state = parseState('{"file.ts": 0}');
    assert(state["file.ts"] === 0, `计数为 0`);
  });
});

// ── 测试 3: 计数器递增 ──────────────────────────────────────

describe("incrementCounter — 文件计数器递增", () => {
  it("新文件计数为 1", () => {
    const state = {};
    const next = incrementCounter(state, "src/lib.rs");
    assert(next["src/lib.rs"] === 1, `新文件=1, got ${next["src/lib.rs"]}`);
  });

  it("已有文件计数 +1", () => {
    const state = { "src/lib.rs": 2 };
    const next = incrementCounter(state, "src/lib.rs");
    assert(next["src/lib.rs"] === 3, `2→3, got ${next["src/lib.rs"]}`);
  });

  it("多个文件独立计数", () => {
    const state = { "a.ts": 1 };
    const next = incrementCounter(state, "b.ts");
    assert(next["a.ts"] === 1, `a 不变, got ${next["a.ts"]}`);
    assert(next["b.ts"] === 1, `b=1, got ${next["b.ts"]}`);
  });

  it("不修改原状态（不可变）", () => {
    const state = { "lib.rs": 1 };
    const next = incrementCounter(state, "lib.rs");
    assert(next !== state, "返回新对象");
    assert(state["lib.rs"] === 1, "原状态不变");
  });

  it("filePath 为 'unknown'（默认值）", () => {
    const state = {};
    const next = incrementCounter(state, "unknown");
    assert(next["unknown"] === 1, "unknown 计数为 1");
  });
});

// ── 测试 4: 阈值判断 ────────────────────────────────────────

describe("exceedsThreshold — 阈值判断 (EDIT_THRESHOLD=4)", () => {
  it("count=1 不触发 (1 <= 4)", () => {
    assert(!exceedsThreshold(1), "1 不触发");
  });

  it("count=4 不触发 (4 <= 4, 正好阈值)", () => {
    assert(!exceedsThreshold(4), "4 等于阈值，不触发");
  });

  it("count=5 触发警告 (5 > 4)", () => {
    assert(exceedsThreshold(5), "5 触发警告");
  });

  it("count=0 不触发", () => {
    assert(!exceedsThreshold(0), "0 不触发");
  });

  it("count=10 触发（远超出阈值）", () => {
    assert(exceedsThreshold(10), "10 触发");
  });

  it("自定义阈值", () => {
    assert(!exceedsThreshold(3, 4), "3 <= 4 不触发");
    assert(exceedsThreshold(5, 4), "5 > 4 触发");
    assert(!exceedsThreshold(2, 3), "2 <= 3 不触发");
    assert(exceedsThreshold(4, 3), "4 > 3 触发");
  });
});

// ── 测试 5: 工具检测 ────────────────────────────────────────

describe("isEditTool — Edit 工具识别", () => {
  it("'Edit' 识别为 Edit 工具", () => {
    assert(isEditTool("Edit"), "Edit → true");
  });

  it("'Write' 非 Edit 工具", () => {
    assert(!isEditTool("Write"), "Write → false");
  });

  it("'Read' 非 Edit 工具", () => {
    assert(!isEditTool("Read"), "Read → false");
  });

  it("'Bash' 非 Edit 工具", () => {
    assert(!isEditTool("Bash"), "Bash → false");
  });

  it("空字符串非 Edit 工具", () => {
    assert(!isEditTool(""), "空字符串 → false");
  });

  it("'edit' 大小写敏感（不匹配）", () => {
    assert(!isEditTool("edit"), "'edit' 不匹配");
  });
});

// ── 测试 6: 警告消息 ────────────────────────────────────────

describe("buildWarning — 警告消息构造", () => {
  it("包含 [EditGuard] 标签", () => {
    const msg = buildWarning("src/lib.rs", 5);
    assert(msg.includes("[EditGuard]"), "[EditGuard] 标签");
  });

  it("包含文件名", () => {
    const msg = buildWarning("crates/kernel/src/lib.rs", 5);
    assert(msg.includes("crates/kernel/src/lib.rs"), "文件名");
  });

  it("包含当前 Edit 计数", () => {
    const msg = buildWarning("file.ts", 7);
    assert(msg.includes("7 Edits"), "7 Edits");
  });

  it("包含阈值", () => {
    const msg = buildWarning("file.ts", 5);
    assert(msg.includes("threshold: 4"), "threshold: 4");
  });

  it("包含 Write 建议", () => {
    const msg = buildWarning("file.ts", 5);
    assert(msg.includes("Consider using Write tool"), "Write 建议");
  });

  it("包含 token 浪费估算", () => {
    const msg = buildWarning("file.ts", 5);
    assert(msg.includes("token waste"), "token waste");
    assert(msg.includes("16000+"), "4*4000=16000+ tokens");
  });

  it("包含规则来源引用", () => {
    const msg = buildWarning("file.ts", 5);
    assert(msg.includes("xlibgate Trust Alignment"), "xlibgate 引用");
    assert(msg.includes("Atomic Write"), "Atomic Write 概念");
  });

  it("count=6 → token waste = 20000+ (5*4000)", () => {
    const msg = buildWarning("file.ts", 6);
    assert(msg.includes("20000+"), "20000+ tokens (5*4000)");
  });

  it("count=2 → token waste = 4000+ (1*4000)", () => {
    const msg = buildWarning("file.ts", 2);
    assert(msg.includes("4000+"), "4000+ tokens (1*4000)");
  });
});

// ── 测试 7: JSON 输入解析 ───────────────────────────────────

describe("extractFilePath — 从 tool call 提取 file_path", () => {
  it("标准 Write tool call", () => {
    const json = '{"tool_name":"Write","tool_input":{"file_path":"src/lib.rs"}}';
    assert(extractFilePath(json) === "src/lib.rs", "Write tool file_path");
  });

  it("Edit tool call", () => {
    const json = '{"tool_name":"Edit","tool_input":{"file_path":"docs/README.md"}}';
    assert(extractFilePath(json) === "docs/README.md", "Edit tool file_path");
  });

  it("无 file_path → 'unknown'", () => {
    const json = '{"tool_name":"Bash","tool_input":{"command":"ls"}}';
    assert(extractFilePath(json) === "unknown", "Bash → unknown");
  });

  it("无效 JSON → 'unknown'", () => {
    assert(extractFilePath("not json") === "unknown", "无效 JSON");
  });

  it("已解析对象", () => {
    const obj = { tool_name: "Edit", tool_input: { file_path: "test.mjs" } };
    assert(extractFilePath(obj) === "test.mjs", "对象输入 file_path");
  });
});

describe("extractToolName — 从 tool call 提取 tool_name", () => {
  it("Write", () => {
    assert(extractToolName('{"tool_name":"Write","tool_input":{}}') === "Write", "Write");
  });

  it("Edit", () => {
    assert(extractToolName('{"tool_name":"Edit","tool_input":{"file_path":"test"}}') === "Edit", "Edit");
  });

  it("Bash", () => {
    assert(extractToolName('{"tool_name":"Bash","tool_input":{"command":"ls"}}') === "Bash", "Bash");
  });

  it("无效 JSON → 空字符串", () => {
    assert(extractToolName("bad") === "", "无效 JSON → 空");
  });

  it("已解析对象", () => {
    const obj = { tool_name: "Read", tool_input: {} };
    assert(extractToolName(obj) === "Read", "对象输入 tool_name");
  });
});

// ── 测试 8: 完整流程模拟 ────────────────────────────────────

describe("edit-guard — 完整流程模拟", () => {
  it("流程: Edit 工具 → 递增 → 未超阈值 → 无警告", () => {
    const input = '{"tool_name":"Edit","tool_input":{"file_path":"lib.rs"}}';
    const toolName = extractToolName(input);
    const filePath = extractFilePath(input);

    assert(isEditTool(toolName), "是 Edit 工具");
    let state = { "lib.rs": 2 };
    state = incrementCounter(state, filePath); // 2 → 3
    assert(!exceedsThreshold(state["lib.rs"]), "3 <= 4，无警告");
  });

  it("流程: Edit 工具 → 递增 → 超阈值 → 触发警告", () => {
    const input = '{"tool_name":"Edit","tool_input":{"file_path":"SPEC.md"}}';
    const toolName = extractToolName(input);
    const filePath = extractFilePath(input);

    assert(isEditTool(toolName), "是 Edit 工具");
    let state = { "SPEC.md": 4 };
    state = incrementCounter(state, filePath); // 4 → 5
    assert(exceedsThreshold(state["SPEC.md"]), "5 > 4，触发警告");

    const msg = buildWarning(filePath, state["SPEC.md"]);
    assert(msg.includes("[EditGuard]"), "生成警告");
  });

  it("流程: Write 工具 → 不处理（由 edit-guard-reset 处理）", () => {
    const input = '{"tool_name":"Write","tool_input":{"file_path":"lib.rs","content":"..."}}';
    const toolName = extractToolName(input);
    assert(!isEditTool(toolName), "Write 非 Edit，跳过");
  });

  it("流程: Read 工具 → 不处理", () => {
    const input = '{"tool_name":"Read","tool_input":{"file_path":"README.md"}}';
    const toolName = extractToolName(input);
    assert(!isEditTool(toolName), "Read 非 Edit，跳过");
  });

  it("流程: 无效 JSON → 直接 pass-through", () => {
    const toolName = extractToolName("not json at all");
    assert(toolName === "", "无效 JSON → toolName 为空");
    assert(!isEditTool(toolName), "空 toolName 非 Edit");
  });

  it("流程: 新文件首次 Edit → 计数为 1", () => {
    const input = '{"tool_name":"Edit","tool_input":{"file_path":"new_file.rs"}}';
    const toolName = extractToolName(input);
    const filePath = extractFilePath(input);
    assert(isEditTool(toolName), "Edit 工具");
    const state = incrementCounter({}, filePath);
    assert(state["new_file.rs"] === 1, "新文件计数 = 1");
  });
});

// ── 结果汇总 ────────────────────────────────────────────────

console.log(`\n=== 测试结果 ===`);
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总计: ${passed + failed}`);

if (failed > 0) {
  console.error(`\n${failed} 个测试失败`);
  process.exit(1);
} else {
  console.log("\n全数通过！");
  process.exit(0);
}
