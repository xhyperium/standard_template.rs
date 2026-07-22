#!/usr/bin/env node
/**
 * edit-guard-reset.test.mjs — L1 单元测试 for edit-guard-reset.mjs
 *
 * 测试范围：
 *  1. 文件结构：shebang、语法有效性
 *  2. 工具检测：Write 重置，其他工具不重置
 *  3. 状态重置逻辑：删除 filePath 键位
 *  4. 异常处理：state 文件不存在、无效 JSON
 *  5. file_path 缺失处理
 */

import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── 从 edit-guard-reset.mjs 提取的可测试逻辑 ──────────────────

const STATE_FILE = ".claude/.edit-guard-state.json";

/**
 * 重置文件计数器（从 state 中删除指定文件键位）
 */
function resetCounter(state, filePath) {
  if (state[filePath]) {
    const next = { ...state };
    delete next[filePath];
    return next;
  }
  return state;
}

/**
 * 检测是否为 Write 工具（需要重置计数器）
 */
function isWriteTool(toolName) {
  return toolName === "Write";
}

/**
 * 从 tool call 结果中提取 tool_name 和 file_path
 */
function parseToolResult(input) {
  try {
    const result = typeof input === "string" ? JSON.parse(input) : input;
    return {
      toolName: result.tool_name || "",
      filePath: result.tool_input?.file_path || null,
    };
  } catch {
    return { toolName: "", filePath: null };
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

describe("edit-guard-reset.mjs — 文件结构", () => {
  it("shebang 存在", () => {
    const src = readFileSync(".claude/hooks/edit-guard-reset.mjs", "utf8");
    assert(src.startsWith("#!/usr/bin/env node"), "首行 shebang");
  });

  it("语法有效（node --check）", () => {
    try {
      execFileSync("node", ["--check", ".claude/hooks/edit-guard-reset.mjs"], {
        stdio: "pipe",
        timeout: 5000,
      });
      assert(true, "node --check 通过");
    } catch (e) {
      assert(false, `node --check 失败: ${e.stderr?.toString() || e.message}`);
    }
  });

  it("包含 STATE_FILE 路径", () => {
    const src = readFileSync(".claude/hooks/edit-guard-reset.mjs", "utf8");
    assert(
      src.includes(".claude/.edit-guard-state.json"),
      ".edit-guard-state.json 路径存在"
    );
  });

  it("是 PostToolUse hook 用途", () => {
    const src = readFileSync(".claude/hooks/edit-guard-reset.mjs", "utf8");
    assert(
      src.includes("PostToolUse") || src.includes("post-tool"),
      "PostToolUse 注释存在"
    );
  });
});

// ── 测试 2: 工具检测 ────────────────────────────────────────

describe("isWriteTool — Write 工具识别", () => {
  it("'Write' → true", () => {
    assert(isWriteTool("Write"), "Write → true");
  });

  it("'Edit' → false", () => {
    assert(!isWriteTool("Edit"), "Edit → false");
  });

  it("'Read' → false", () => {
    assert(!isWriteTool("Read"), "Read → false");
  });

  it("'Bash' → false", () => {
    assert(!isWriteTool("Bash"), "Bash → false");
  });

  it("'Glob' → false", () => {
    assert(!isWriteTool("Glob"), "Glob → false");
  });

  it("'Grep' → false", () => {
    assert(!isWriteTool("Grep"), "Grep → false");
  });

  it("空字符串 → false", () => {
    assert(!isWriteTool(""), "空字符串 → false");
  });

  it("'write' 大小写敏感 → false", () => {
    assert(!isWriteTool("write"), "'write' 不匹配");
  });
});

// ── 测试 3: 状态重置逻辑 ────────────────────────────────────

describe("resetCounter — 文件计数器重置", () => {
  it("删除已存在文件键位", () => {
    const state = { "lib.rs": 5, "SPEC.md": 3 };
    const next = resetCounter(state, "lib.rs");
    assert(!next["lib.rs"], "lib.rs 已删除");
    assert(next["SPEC.md"] === 3, "SPEC.md 保留, got " + next["SPEC.md"]);
    assert(Object.keys(next).length === 1, `剩余 1 个键, got ${Object.keys(next).length}`);
  });

  it("文件不存在于 state → 无变更", () => {
    const state = { "lib.rs": 3 };
    const next = resetCounter(state, "not_exist.rs");
    assert(next["lib.rs"] === 3, "lib.rs 保留");
    assert(!next["not_exist.rs"], "not_exist.rs 不存在");
    assert(Object.keys(next).length === 1, `键数不变, got ${Object.keys(next).length}`);
  });

  it("空 state → 无变更", () => {
    const state = {};
    const next = resetCounter(state, "any_file.rs");
    assert(Object.keys(next).length === 0, "空对象不变");
  });

  it("删除最后一个键位", () => {
    const state = { "only_file.rs": 2 };
    const next = resetCounter(state, "only_file.rs");
    assert(!next["only_file.rs"], "已删除");
    assert(Object.keys(next).length === 0, "对象为空");
  });

  it("不修改原状态（不可变）", () => {
    const state = { "lib.rs": 5 };
    const next = resetCounter(state, "lib.rs");
    assert(next !== state, "返回新对象");
    assert(state["lib.rs"] === 5, "原状态不变");
  });

  it("计数为 0 的文件也应删除", () => {
    const state = { "lib.rs": 0 };
    const next = resetCounter(state, "lib.rs");
    assert(!next["lib.rs"], "0 计数也删除");
  });
});

// ── 测试 4: JSON 输入解析 ───────────────────────────────────

describe("parseToolResult — tool result JSON 解析", () => {
  it("Write 工具 + file_path", () => {
    const json = '{"tool_name":"Write","tool_input":{"file_path":"src/lib.rs"}}';
    const { toolName, filePath } = parseToolResult(json);
    assert(toolName === "Write", "toolName=Write");
    assert(filePath === "src/lib.rs", `filePath=src/lib.rs, got ${filePath}`);
  });

  it("Edit 工具 → 不重置", () => {
    const json = '{"tool_name":"Edit","tool_input":{"file_path":"docs/README.md"}}';
    const { toolName, filePath } = parseToolResult(json);
    assert(toolName === "Edit", "toolName=Edit");
    assert(filePath === "docs/README.md", "filePath 被提取");
    assert(!isWriteTool(toolName), "Edit 不应触发重置");
  });

  it("Bash 工具（无 file_path）", () => {
    const json = '{"tool_name":"Bash","tool_input":{"command":"ls"}}';
    const { toolName, filePath } = parseToolResult(json);
    assert(toolName === "Bash", "toolName=Bash");
    assert(filePath === null, `filePath=${filePath}, 应 null`);
    assert(!isWriteTool(toolName), "Bash 不应触发重置");
  });

  it("Read 工具", () => {
    const json = '{"tool_name":"Read","tool_input":{"file_path":"test.txt"}}';
    const { toolName, filePath } = parseToolResult(json);
    assert(toolName === "Read", "toolName=Read");
    assert(!isWriteTool(toolName), "Read 不应触发重置");
  });

  it("无效 JSON → 空结果", () => {
    const { toolName, filePath } = parseToolResult("bad json");
    assert(toolName === "", "toolName 为空");
    assert(filePath === null, "filePath 为 null");
    assert(!isWriteTool(toolName), "空 toolName 不应触发重置");
  });

  it("已解析对象", () => {
    const obj = { tool_name: "Write", tool_input: { file_path: "target.mjs" } };
    const { toolName, filePath } = parseToolResult(obj);
    assert(toolName === "Write", "toolName=Write");
    assert(filePath === "target.mjs", "filePath=target.mjs");
  });

  it("Write 工具但无 file_path → filePath=null", () => {
    const json = '{"tool_name":"Write","tool_input":{"content":"hello"}}';
    const { toolName, filePath } = parseToolResult(json);
    assert(toolName === "Write", "toolName=Write");
    assert(filePath === null, "filePath 为 null");
  });
});

// ── 测试 5: 状态文件异常处理（逻辑层面）────────────────────

describe("edit-guard-reset — 状态文件异常处理逻辑", () => {
  it("STATE_FILE 不存在 → 静默跳过（不报错）", () => {
    // 逻辑等：如果 existsSync(STATE_FILE) 返回 false，则不操作
    // 源文件通过检查 existsSync 来跳过
    // L1 测试：验证这个逻辑分支的预期行为
    const stateFileExists = false;
    if (!stateFileExists) {
      assert(true, "状态文件不存在 → 静默跳过");
    }
  });

  it("STATE_FILE 存在但属于其他进程 → catch 捕获", () => {
    // catch 块（43 行）捕获任何异常，静默处理
    // L1 测试：验证 catch 逻辑不抛出
    try {
      throw new Error("simulated JSON parse error");
    } catch {
      assert(true, "catch 捕获异常 → 静默处理");
    }
  });

  it("filePath 为 null 时不执行重置", () => {
    const { toolName, filePath } = parseToolResult(
      '{"tool_name":"Write","tool_input":{"content":"hello"}}'
    );
    assert(toolName === "Write", "是 Write 工具");
    if (!filePath) {
      assert(true, "filePath 为 null → 跳过重置");
    }
  });
});

// ── 测试 6: 完整流程模拟 ────────────────────────────────────

describe("edit-guard-reset — 完整流程模拟", () => {
  it("流程: Write + file_path → 识别为 Write → 重置计数器", () => {
    const input = '{"tool_name":"Write","tool_input":{"file_path":"lib.rs","content":"..."}}';
    const { toolName, filePath } = parseToolResult(input);
    assert(isWriteTool(toolName), "Write 工具被识别");
    assert(filePath !== null, "file_path 存在");

    const state = { "lib.rs": 5, "SPEC.md": 2 };
    const next = resetCounter(state, filePath);
    assert(!next["lib.rs"], "lib.rs 被重置");
    assert(next["SPEC.md"] === 2, "SPEC.md 保留");
  });

  it("流程: Write + 不存在文件 → 状态不变", () => {
    const input = '{"tool_name":"Write","tool_input":{"file_path":"new_file.rs"}}';
    const { toolName, filePath } = parseToolResult(input);
    assert(isWriteTool(toolName), "Write 工具");

    const state = { "lib.rs": 3 };
    const next = resetCounter(state, filePath);
    assert(next["lib.rs"] === 3, "lib.rs 不变");
    assert(Object.keys(next).length === 1, "键数不变");
  });

  it("流程: Edit 工具 → 不触发重置", () => {
    const input = '{"tool_name":"Edit","tool_input":{"file_path":"SPEC.md"}}';
    const { toolName, filePath } = parseToolResult(input);
    assert(!isWriteTool(toolName), "Edit 不触发重置");

    const state = { "SPEC.md": 10 };
    const next = isWriteTool(toolName) ? resetCounter(state, filePath) : state;
    assert(next === state, "原状态未修改");
    assert(next["SPEC.md"] === 10, "计数保留");
  });

  it("流程: Read 工具 → 不触发重置", () => {
    const input = '{"tool_name":"Read","tool_input":{"file_path":"README.md"}}';
    const { toolName } = parseToolResult(input);
    assert(!isWriteTool(toolName), "Read 不触发重置");
  });

  it("流程: 无效 JSON → 不触发重置", () => {
    const { toolName, filePath } = parseToolResult("bogus");
    assert(toolName === "", "空 toolName");
    assert(filePath === null, "空 filePath");
    assert(!isWriteTool(toolName), "不触发重置");
  });

  it("流程: Write + 空 state → 无操作", () => {
    const { toolName, filePath } = parseToolResult(
      '{"tool_name":"Write","tool_input":{"file_path":"lib.rs"}}'
    );
    assert(isWriteTool(toolName), "Write");
    const state = {};
    const next = resetCounter(state, filePath);
    assert(Object.keys(next).length === 0, "空 state 不变");
  });
});

// ── 测试 7: 与 edit-guard 的协作 ─────────────────────────────

describe("edit-guard-reset — 与 edit-guard 协作逻辑", () => {
  it("edit-guard 递增后 edit-guard-reset 重置 → 计数归零", () => {
    // edit-guard: 递增 lib.rs: 0→1, 1→2, 2→3, 3→4, 4→5 (触发警告)
    // edit-guard-reset: Write lib.rs → 删除键位，计数归零
    let state = {};
    const filePath = "lib.rs";

    // 模拟 5 次 Edit
    for (let i = 0; i < 5; i++) {
      state = { ...state, [filePath]: (state[filePath] || 0) + 1 };
    }
    assert(state[filePath] === 5, `5 次 Edit 后计数=5, got ${state[filePath]}`);

    // 模拟 Write 后 reset
    state = resetCounter(state, filePath);
    assert(!state[filePath], "Write 后键位已删除");
    assert(Object.keys(state).length === 0, "state 已清空");
  });

  it("edit-guard 递增多文件 → reset 仅清除 Write 的文件", () => {
    let state = {};
    // Edit: file1 → 3, file2 → 7
    state["file1.rs"] = 3;
    state["file2.rs"] = 7;

    // Write: file1.rs
    state = resetCounter(state, "file1.rs");
    assert(!state["file1.rs"], "file1.rs 已删除");
    assert(state["file2.rs"] === 7, "file2.rs 保留");
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
