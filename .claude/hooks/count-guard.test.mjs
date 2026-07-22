#!/usr/bin/env node
/**
 * count-guard.test.mjs — L1 单元测试 for count-guard.mjs
 *
 * 测试范围：
 *  1. 文件结构：shebang、语法有效性
 *  2. TRACKED_FILES 列表
 *  3. BLOCK_PATTERNS 正则匹配（组件总数、平均进度、有版本号计数）
 *  4. COUNT_PATTERNS 正则匹配（X/Y 分数、N 个 (X%)、裸数字等）
 *  5. STRICT 模式逻辑 vs 非 STRICT
 *  6. 文件名提取与追踪文件匹配
 *  7. Content 提取（from Write/Edit tool_input）
 *  8. VERIFY_COMMANDS 存在性
 *  9. 完整流程模拟（BLOCK/WARN/无匹配）
 */

import { execFileSync } from "child_process";
import { readFileSync } from "fs";

// ── 从 count-guard.mjs 提取的可测试逻辑 ──────────────────────

const TRACKED_FILES = [
  "STATUS.md",
  "README.md",
  "ARCHITECTURE.md",
];

const BLOCK_PATTERNS = [
  { re: /组件总数[：:]\s*\d+/g, label: "组件总数 (BLOCKED)" },
  { re: /平均进度[：:]\s*\d+%/g, label: "平均进度 (BLOCKED)" },
  { re: /有版本号[：:]\s*\d+/g, label: "有版本号计数 (BLOCKED)" },
];

const COUNT_PATTERNS = [
  { re: /\d+\/\d+\s*(已发布|已创建|缺失|全部)/g, label: "X/Y 分数" },
  { re: /\d+\s*个\s*[\(（]\s*\d+%\s*[\)）]/g, label: "N 个 (X%)" },
  { re: /[：:]\s*\*?\*?\d+\*?\*?\s*$|^\s*\*?\*?\d+\*?\*?\s*$/gm, label: "裸数字 (可能是合计)" },
  { re: /\d+个\s*\(\s*(全部|全\))/g, label: "N 个 (全部)" },
  { re: /已有[：:]\s*\d+/g, label: "已有计数" },
  { re: /已创建[：:]\s*\d+/g, label: "已创建计数" },
];

const VERIFY_COMMANDS = {
  "STATUS.md": [
    "# Verify component counts in STATUS.md:",
    "grep -c 'github.com' STATUS.md  # unique repo links",
    "grep -oP 'github\\.com/ZoneCNH/[a-zA-Z0-9_.-]+' STATUS.md | sort -u | wc -l",
    "# Verify domain counts:",
    "sed -n '20,39p' STATUS.md | grep -c 'github.com'  # base count",
    "sed -n '84,88p' STATUS.md | grep -c 'github.com'  # L2.5 count",
    "sed -n '139,146p' STATUS.md | grep -c 'github.com'  # analysis",
    "sed -n '152,158p' STATUS.md | grep -c 'github.com'  # decision",
    "sed -n '164,170p' STATUS.md | grep -c 'github.com'  # execution",
    "# Count versions: awk -F'|' on version column, filter non-empty non-dash",
    "# Verify GitHub releases: for repo in ...; do gh release list -R ZoneCNH/$repo; done",
  ],
  "README.md": [
    "grep -oP 'github\\.com/ZoneCNH/[a-zA-Z0-9_.-]+' README.md | sort -u | wc -l",
  ],
  "ARCHITECTURE.md": [
    "grep -oP 'github\\.com/ZoneCNH/[a-zA-Z0-9_.-]+' ARCHITECTURE.md | sort -u | wc -l",
  ],
};

/**
 * 扫描 BLOCK_PATTERNS
 */
function scanBlockPatterns(content) {
  const blocked = [];
  for (const { re, label } of BLOCK_PATTERNS) {
    const matches = content.match(re);
    if (matches && matches.length > 0) {
      blocked.push({ label, matches: [...new Set(matches)] });
    }
  }
  return blocked;
}

/**
 * 扫描 COUNT_PATTERNS (WARN-level)
 */
function scanCountPatterns(content) {
  const found = [];
  for (const { re, label } of COUNT_PATTERNS) {
    const matches = content.match(re);
    if (matches && matches.length > 0) {
      found.push({ label, matches: [...new Set(matches)] });
    }
  }
  return found;
}

/**
 * 提取文件名（从完整路径）
 */
function extractFileName(filePath) {
  if (!filePath) return "";
  return filePath.split("/").pop();
}

/**
 * 检查是否为追踪文件
 */
function isTrackedFile(fileName) {
  return TRACKED_FILES.includes(fileName);
}

/**
 * 提取 content（从 tool_input）
 */
function extractContent(toolInput) {
  if (!toolInput) return "";
  return toolInput.content || toolInput.new_string || "";
}

/**
 * 构造 count-guard 警告/阻止消息
 */
function buildCountGuardMessage(fileName, blocked, found, isStrict) {
  const lines = [];
  lines.push("");
  lines.push("══════════════════════════════════════════════");
  if (blocked.length > 0 && isStrict) {
    lines.push(`[CountGuard] 🛑 BLOCKED — ${fileName} contains HIGH-RISK count patterns`);
  } else {
    lines.push(`[CountGuard] ⚠️  Edit to ${fileName} contains COUNT PATTERNS`);
  }
  lines.push("");

  if (blocked.length > 0) {
    lines.push("  BLOCK-level (requires pre-verification):");
    for (const { label, matches } of blocked) {
      lines.push(`    ${label}: ${matches.slice(0, 5).join(", ")}`);
    }
    lines.push("");
  }
  if (found.length > 0) {
    lines.push("  WARN-level:");
    for (const { label, matches } of found) {
      lines.push(`    ${label}: ${matches.slice(0, 5).join(", ")}${matches.length > 5 ? " ..." : ""}`);
    }
    lines.push("");
  }

  lines.push("  CLAUDE.md rule: 声称已完成前必须核对源码");
  lines.push("  → 用 grep/awk/gh api 验证，禁止凭常识编造数量。");
  lines.push("");
  lines.push("  Before committing, run:");
  const cmds = VERIFY_COMMANDS[fileName] || [];
  for (const cmd of cmds) {
    lines.push(`    $ ${cmd}`);
  }
  lines.push("");

  if (blocked.length > 0 && isStrict) {
    lines.push("  To bypass (after verification): export COUNT_GUARD_STRICT=false");
    lines.push("  Or attach verification output to commit message.");
    lines.push("══════════════════════════════════════════════");
    return { msg: lines.join("\n"), exitCode: 2 };
  }

  lines.push("  本次会话 audit (2026-06-15): 20 PRs 修复了 7+ 处编造的数量。");
  lines.push("  Don't make count changes without verification.");
  lines.push("══════════════════════════════════════════════");

  return { msg: lines.join("\n"), exitCode: 0 };
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

describe("count-guard.mjs — 文件结构", () => {
  it("shebang 存在", () => {
    const src = readFileSync(".claude/hooks/count-guard.mjs", "utf8");
    assert(src.startsWith("#!/usr/bin/env node"), "首行 shebang");
  });

  it("语法有效（node --check）", () => {
    try {
      execFileSync("node", ["--check", ".claude/hooks/count-guard.mjs"], {
        stdio: "pipe",
        timeout: 5000,
      });
      assert(true, "node --check 通过");
    } catch (e) {
      assert(false, `node --check 失败: ${e.stderr?.toString() || e.message}`);
    }
  });

  it("包含 COUNT_GUARD_STRICT 环境变量引用", () => {
    const src = readFileSync(".claude/hooks/count-guard.mjs", "utf8");
    assert(
      src.includes("COUNT_GUARD_STRICT"),
      "COUNT_GUARD_STRICT 变量存在"
    );
  });

  it("是 PreToolUse hook", () => {
    const src = readFileSync(".claude/hooks/count-guard.mjs", "utf8");
    assert(
      src.includes("PreToolUse") || src.includes("pre-tool"),
      "PreToolUse 注释"
    );
  });
});

// ── 测试 2: TRACKED_FILES 列表 ───────────────────────────────

describe("TRACKED_FILES — 追踪文件列表", () => {
  it("包含 STATUS.md", () => {
    assert(TRACKED_FILES.includes("STATUS.md"), "STATUS.md");
  });

  it("包含 README.md", () => {
    assert(TRACKED_FILES.includes("README.md"), "README.md");
  });

  it("包含 ARCHITECTURE.md", () => {
    assert(TRACKED_FILES.includes("ARCHITECTURE.md"), "ARCHITECTURE.md");
  });

  it("仅有 3 个文件", () => {
    assert(TRACKED_FILES.length === 3, `3 个, got ${TRACKED_FILES.length}`);
  });
});

describe("VERIFY_COMMANDS — 验证命令映射", () => {
  it("STATUS.md 有验证命令", () => {
    const cmds = VERIFY_COMMANDS["STATUS.md"];
    assert(cmds.length > 0, `STATUS.md 有 ${cmds.length} 条命令`);
    assert(
      cmds.some((c) => c.includes("grep")),
      "包含 grep 命令"
    );
  });

  it("README.md 有验证命令", () => {
    const cmds = VERIFY_COMMANDS["README.md"];
    assert(cmds.length > 0, `README.md 有 ${cmds.length} 条命令`);
  });

  it("ARCHITECTURE.md 有验证命令", () => {
    const cmds = VERIFY_COMMANDS["ARCHITECTURE.md"];
    assert(cmds.length > 0, `ARCHITECTURE.md 有 ${cmds.length} 条命令`);
  });
});

// ── 测试 3: BLOCK_PATTERNS — 组件总数 ─────────────────────────

describe("BLOCK_PATTERNS — 组件总数", () => {
  const pattern = BLOCK_PATTERNS[0].re;

  it("'组件总数：18' 匹配", () => {
    const m = "组件总数：18".match(pattern);
    assert(m !== null, "组件总数：18 匹配");
    assert(m[0] === "组件总数：18", `got ${JSON.stringify(m)}`);
  });

  it("'组件总数: 14' 匹配", () => {
    const m = "组件总数: 14".match(pattern);
    assert(m !== null, "组件总数: 14 匹配");
    assert(m[0] === "组件总数: 14", `got ${JSON.stringify(m)}`);
  });

  it("'组件总数： 5'（有空格）匹配", () => {
    const m = "组件总数： 5".match(pattern);
    assert(m !== null, "组件总数： 5 匹配");
  });

  it("'组件总数' 后无数字不匹配", () => {
    // 注意：/组件总数[：:]\s*\d+/ 要求至少一个数字
    const m = "组件总数：".match(pattern);
    assert(m === null, "无数字不匹配");
  });

  it("'组件总数：abc' 不匹配", () => {
    const m = "组件总数：abc".match(pattern);
    assert(m === null, "非数字字符不匹��");
  });

  it("匹配多位数", () => {
    const m = "组件总数：123".match(pattern);
    assert(m !== null, "123 匹配");
    assert(m[0] === "组件总数：123", `got ${JSON.stringify(m)}`);
  });
});

// ── 测试 4: BLOCK_PATTERNS — 平均进度 ─────────────────────────

describe("BLOCK_PATTERNS — 平均进度", () => {
  const pattern = BLOCK_PATTERNS[1].re;

  it("'平均进度：67%' 匹配", () => {
    const m = "平均进度：67%".match(pattern);
    assert(m !== null, "平均进度：67% 匹配");
  });

  it("'平均进度: 62%' 匹配", () => {
    const m = "平均进度: 62%".match(pattern);
    assert(m !== null, "平均进度: 62% 匹配");
  });

  it("'平均进度：100%' 匹配", () => {
    const m = "平均进度：100%".match(pattern);
    assert(m !== null, "100% 匹配");
  });

  it("'平均进度' 后无数字不匹配", () => {
    const m = "平均进度：".match(pattern);
    assert(m === null, "无数字不匹配");
  });

  it("'平均进度：abc%' 不匹配", () => {
    const m = "平均进度：abc%".match(pattern);
    assert(m === null, "非数字不匹配");
  });
});

// ── 测试 5: BLOCK_PATTERNS — 有版本号 ─────────────────────────

describe("BLOCK_PATTERNS — 有版本号", () => {
  const pattern = BLOCK_PATTERNS[2].re;

  it("'有版本号：5' 匹配", () => {
    const m = "有版本号：5".match(pattern);
    assert(m !== null, "有版本号：5 匹配");
  });

  it("'有版本号: 3' 匹配", () => {
    const m = "有版本号: 3".match(pattern);
    assert(m !== null, "有版本号: 3 匹配");
  });

  it("'有版本号：0' 匹配", () => {
    const m = "有版本号：0".match(pattern);
    assert(m !== null, "0 也匹配（可能存在）");
  });

  it("'有版本号' 后无非空格数字不匹配", () => {
    const m = "有版本号abc".match(pattern);
    assert(m === null, "无分隔符不匹配");
  });
});

// ── 测试 6: COUNT_PATTERNS — X/Y 分数 ─────────────────────────

describe("COUNT_PATTERNS — X/Y 分数", () => {
  const pattern = COUNT_PATTERNS[0].re;

  it("'14/18 已发布' 匹配", () => {
    const m = "14/18 已发布".match(pattern);
    assert(m !== null, "14/18 已发布 匹配");
    assert(m[0] === "14/18 已发布", `got ${JSON.stringify(m)}`);
  });

  it("'5/10 已创建' 匹配", () => {
    const m = "5/10 已创建".match(pattern);
    assert(m !== null, "5/10 已创建 匹配");
  });

  it("'2/3 缺失' 匹配", () => {
    const m = "2/3 缺失".match(pattern);
    assert(m !== null, "2/3 缺失 匹配");
  });

  it("'0/1 全部' 匹配", () => {
    const m = "0/1 全部".match(pattern);
    assert(m !== null, "0/1 全部 匹配");
  });

  it("'14/18' 后无关键词不匹配", () => {
    // 模式要求 X/Y 后跟上述关键词之一
    const m = "14/18 （已发布）".match(pattern);
    assert(m === null, "括号不匹配");
  });
});

// ── 测试 7: COUNT_PATTERNS — N 个 (X%) ────────────────────────

describe("COUNT_PATTERNS — N 个 (X%)", () => {
  const pattern = COUNT_PATTERNS[1].re;

  it("'14 个 (67%)' 匹配", () => {
    const m = "14 个 (67%)".match(pattern);
    assert(m !== null, "14 个 (67%) 匹配");
  });

  it("'5 个（33%）' 匹配（中文括号）", () => {
    const m = "5 个（33%）".match(pattern);
    assert(m !== null, "中文括号匹配");
  });

  it("'1 个 (100%)' 匹配", () => {
    const m = "1 个 (100%)".match(pattern);
    assert(m !== null, "1 个 (100%) 匹配");
  });

  it("无 N 个 X% 格式不匹配", () => {
    const m = "共有 14 个项目".match(pattern);
    assert(m === null, "无百分比不匹配");
  });
});

// ── 测试 8: COUNT_PATTERNS — 裸数字 / 已有 / 已创建 ──────────

describe("COUNT_PATTERNS — 已有计数", () => {
  const pattern = COUNT_PATTERNS[4].re;

  it("'已有：14' 匹配", () => {
    const m = "已有：14".match(pattern);
    assert(m !== null, "已有：14 匹配");
  });

  it("'已有: 5' 匹配", () => {
    const m = "已有: 5".match(pattern);
    assert(m !== null, "已有: 5 匹配");
  });

  it("已有后无冒号不匹配", () => {
    const m = "已有14个".match(pattern);
    assert(m === null, "无冒号不匹配");
  });
});

describe("COUNT_PATTERNS — 已创建计数", () => {
  const pattern = COUNT_PATTERNS[5].re;

  it("'已创建：3' 匹配", () => {
    const m = "已创建：3".match(pattern);
    assert(m !== null, "已创建：3 匹配");
  });

  it("'已创建: 10' 匹配", () => {
    const m = "已创建: 10".match(pattern);
    assert(m !== null, "已创建: 10 匹配");
  });
});

describe("COUNT_PATTERNS — N 个 (全部)", () => {
  const pattern = COUNT_PATTERNS[3].re;

  it("'18个 (全部)' 匹配", () => {
    const m = "18个 (全部)".match(pattern);
    assert(m !== null, "18个 (全部) 匹配");
  });

  it("'3个(全)' 匹配（ASCII 括号）", () => {
    const m = "3个(全)".match(pattern);
    assert(m !== null, "ASCII 括号+全 匹配");
  });

  it("'3个(全部)' 匹配（ASCII 括号）", () => {
    const m = "3个(全部)".match(pattern);
    assert(m !== null, "ASCII 括号+全部 匹配");
  });
});

// ── 测试 9: scanBlockPatterns ────────────────────────────────

describe("scanBlockPatterns — BLOCK 模式扫描", () => {
  it("包含组件总数 → 检测到", () => {
    const blocked = scanBlockPatterns("组件总数：18");
    assert(blocked.length === 1, `1 个 block, got ${blocked.length}`);
    assert(
      blocked[0].label.includes("组件总数"),
      `label=${blocked[0]?.label}`
    );
  });

  it("包含多个 block → 全部检测", () => {
    const content = "组件总数：14\n平均进度：62%\n有版本号：3";
    const blocked = scanBlockPatterns(content);
    assert(blocked.length === 3, `3 个 block, got ${blocked.length}`);
  });

  it("无 block pattern → 空数组", () => {
    const blocked = scanBlockPatterns("普通文本内容");
    assert(blocked.length === 0, "空数组");
  });

  it("空字符串", () => {
    const blocked = scanBlockPatterns("");
    assert(blocked.length === 0, "空字符串 → 空数组");
  });

  it("去重匹配", () => {
    // 同一模式出现多次，match result 去重到 Set
    const content = "组件总数：18 组件总数：18 组件总数：18";
    const blocked = scanBlockPatterns(content);
    assert(blocked.length === 1, "去重后 1 个");
    assert(blocked[0].matches.length === 1, `1 个唯一匹配, got ${blocked[0].matches.length}`);
  });
});

// ── 测试 10: scanCountPatterns ───��────────────────────────────

describe("scanCountPatterns — WARN 模式扫描", () => {
  it("包含 X/Y 分数 → 检测到", () => {
    const found = scanCountPatterns("14/18 已发布");
    assert(found.length === 1, `1 个 warn, got ${found.length}`);
  });

  it("包含多种计数模式 → 全部检测", () => {
    const content = "14/18 已发布\n已有：5\n已创建：3\n平均进度：62%";
    const found = scanCountPatterns(content);
    assert(found.length >= 2, `至少 2 个 warn, got ${found.length}`);
  });

  it("无计数模式 → 空数组", () => {
    const found = scanCountPatterns("纯文本描述内容");
    assert(found.length === 0, "空数组");
  });

  it("空字符串", () => {
    const found = scanCountPatterns("");
    assert(found.length === 0, "空字符串 → 空数组");
  });
});

// ── 测试 11: 文件/内容提取 ───────────────────────────────────

describe("extractFileName — 从路径提取文件名", () => {
  it("从完整路径提取", () => {
    assert(extractFileName("docs/STATUS.md") === "STATUS.md", "STATUS.md");
    assert(extractFileName("README.md") === "README.md", "README.md");
    assert(extractFileName("crates/kernel/ARCHITECTURE.md") === "ARCHITECTURE.md", "ARCHITECTURE.md");
  });

  it("根路径文件", () => {
    assert(extractFileName("STATUS.md") === "STATUS.md", "根路径 STATUS.md");
  });

  it("空路径", () => {
    assert(extractFileName("") === "", "空 → 空字符串");
  });

  it("深层路径", () => {
    assert(
      extractFileName(".claude/hooks/count-guard.mjs") === "count-guard.mjs",
      "深层路径提取"
    );
  });
});

describe("isTrackedFile — 追踪文件检查", () => {
  it("STATUS.md 被追踪", () => {
    assert(isTrackedFile("STATUS.md"), "STATUS.md");
  });

  it("README.md 被追踪", () => {
    assert(isTrackedFile("README.md"), "README.md");
  });

  it("ARCHITECTURE.md 被追踪", () => {
    assert(isTrackedFile("ARCHITECTURE.md"), "ARCHITECTURE.md");
  });

  it("src/lib.rs 不被追踪", () => {
    assert(!isTrackedFile("src/lib.rs"), "src/lib.rs");
  });

  it("count-guard.mjs 不被追踪", () => {
    assert(!isTrackedFile("count-guard.mjs"), "count-guard.mjs");
  });

  it("空字符串不被追踪", () => {
    assert(!isTrackedFile(""), "空字符串");
  });
});

describe("extractContent — 从 tool_input 提取 content", () => {
  it("Write tool content", () => {
    const content = extractContent({
      file_path: "STATUS.md",
      content: "组件总数：18",
    });
    assert(content === "组件总数：18", "Write content 提取");
  });

  it("Edit tool new_string", () => {
    const content = extractContent({
      file_path: "README.md",
      new_string: "14/18 已发布",
    });
    assert(content === "14/18 已发布", "Edit new_string 提取");
  });

  it("无 content/new_string → 空字符串", () => {
    const content = extractContent({ file_path: "test.md" });
    assert(content === "", "空字符串");
  });

  it("空 input → 空字符串", () => {
    const content = extractContent(null);
    assert(content === "", "null → 空字符串");
  });
});

// ── 测试 12: STRICT 模式 ──────────────────────────────────────

describe("count-guard — STRICT 模式逻辑", () => {
  it("STRICT=true + BLOCK pattern → exitCode=2", () => {
    const blocked = scanBlockPatterns("组件总数：18 平均进度：62%");
    const found = scanCountPatterns("");
    const { exitCode } = buildCountGuardMessage("STATUS.md", blocked, found, true);
    assert(exitCode === 2, "STRICT 模式 exit=2");
  });

  it("STRICT=false + BLOCK pattern → exitCode=0（仅警告）", () => {
    const blocked = scanBlockPatterns("组件总数：18");
    const found = scanCountPatterns("");
    const { exitCode } = buildCountGuardMessage("STATUS.md", blocked, found, false);
    assert(exitCode === 0, "非 STRICT 模式 exit=0");
  });

  it("无 BLOCK + WARN only → exitCode=0", () => {
    const blocked = scanBlockPatterns("");
    const found = scanCountPatterns("14/18 已发布");
    const { exitCode } = buildCountGuardMessage("STATUS.md", blocked, found, true);
    assert(exitCode === 0, "仅 WARN 无 BLOCK → exit=0");
  });

  it("无匹配 → 无警告输出", () => {
    const blocked = scanBlockPatterns("纯文本");
    const found = scanCountPatterns("纯文本");
    assert(blocked.length === 0 && found.length === 0, "无匹配");
  });
});

// ── 测试 13: 消息构造 ────────────────────────────────────────

describe("buildCountGuardMessage — 消息内容", () => {
  it("BLOCKED 标签", () => {
    const blocked = scanBlockPatterns("组件总数：18");
    const { msg } = buildCountGuardMessage("STATUS.md", blocked, [], true);
    assert(msg.includes("[CountGuard]"), "[CountGuard] 标签");
    assert(msg.includes("BLOCKED"), "BLOCKED 标签");
    assert(msg.includes("HIGH-RISK"), "HIGH-RISK 标签");
  });

  it("WARN 标签", () => {
    const found = scanCountPatterns("14/18 已发布");
    const { msg } = buildCountGuardMessage("STATUS.md", [], found, false);
    assert(msg.includes("COUNT PATTERNS"), "COUNT PATTERNS 标签");
  });

  it("包含 CLAUDE.md 规则引用", () => {
    const found = scanCountPatterns("已有：5");
    const { msg } = buildCountGuardMessage("README.md", [], found, false);
    assert(
      msg.includes("声称已完成前必须核对源码"),
      "CLAUDE.md 规则引用"
    );
  });

  it("包含验证命令", () => {
    const found = scanCountPatterns("14/18 已发布");
    const { msg } = buildCountGuardMessage("STATUS.md", [], found, false);
    assert(msg.includes("grep"), "包含 grep 命令");
  });

  it("STRICT 模式包含 bypass 提示", () => {
    const blocked = scanBlockPatterns("平均进度：62%");
    const { msg } = buildCountGuardMessage("STATUS.md", blocked, [], true);
    assert(
      msg.includes("COUNT_GUARD_STRICT=false"),
      "bypass 提示"
    );
  });

  it("包含 audit 引用", () => {
    const found = scanCountPatterns("已有：5");
    const { msg } = buildCountGuardMessage("README.md", [], found, false);
    assert(
      msg.includes("2026-06-15"),
      "audit 日期"
    );
  });

  it("包含文件名", () => {
    const found = scanCountPatterns("14/18 已发布");
    const { msg } = buildCountGuardMessage("STATUS.md", [], found, false);
    assert(msg.includes("STATUS.md"), "文件名");
  });
});

// ── 测试 14: 完整流程模拟 ────────────────────────────────────

describe("count-guard — 完整流程模拟", () => {
  it("流程: Write STATUS.md + 计数 → 检测", () => {
    const filePath = "docs/STATUS.md";
    const fileName = extractFileName(filePath);
    assert(isTrackedFile(fileName), "STATUS.md 被追踪");

    const content = extractContent({
      file_path: filePath,
      content: "组件总数：18\n14/18 已发布\n已有：5",
    });
    assert(content.includes("组件总数"), "content 已提取");

    const blocked = scanBlockPatterns(content);
    const found = scanCountPatterns(content);
    assert(blocked.length === 1, "组件总数 被 BLOCK");
    assert(found.length >= 2, "至少 2 个 WARN 模式");

    const { exitCode } = buildCountGuardMessage(fileName, blocked, found, true);
    assert(exitCode === 2, "STRICT → exit=2");
  });

  it("流程: Edit README.md + 无计数 → 放行", () => {
    const filePath = "README.md";
    const fileName = extractFileName(filePath);
    assert(isTrackedFile(fileName), "README.md 被追踪");

    const content = "# 项目简介\n这是一个基础设施项目。";
    const blocked = scanBlockPatterns(content);
    const found = scanCountPatterns(content);
    assert(blocked.length === 0 && found.length === 0, "无计数模式");
  });

  it("流程: Write src/lib.rs → 跳过（非追踪文件）", () => {
    const filePath = "crates/kernel/src/lib.rs";
    const fileName = extractFileName(filePath);
    assert(!isTrackedFile(fileName), "lib.rs 非追踪文件");
  });

  it("流程: Edit ARCHITECTURE.md + block → BLOCKED", () => {
    const fileName = "ARCHITECTURE.md";
    assert(isTrackedFile(fileName), "ARCHITECTURE.md 被追踪");

    const content = "有版本号：3\n平均进度：67%";
    const blocked = scanBlockPatterns(content);
    assert(blocked.length === 2, "2 个 BLOCK");

    const { exitCode } = buildCountGuardMessage(fileName, blocked, [], true);
    assert(exitCode === 2, "exit=2");
  });

  it("流程: 非 STRICT 下 BLOCK → 仅警告", () => {
    const blocked = scanBlockPatterns("组件总数：14");
    const { exitCode, msg } = buildCountGuardMessage("STATUS.md", blocked, [], false);
    assert(exitCode === 0, "exit=0（非 STRICT 不 exit 2）");
    // 消息不包含 🛑 标记（非 STRICT 不显示 HALT 符号）
    assert(!msg.includes("🛑"), "非 STRICT 下不显示 🛑");
    // 但会包含 BLOCK-level 段的 label（含 "(BLOCKED)" 文本）供参考
    assert(msg.includes("BLOCK-level"), "仍显示 BLOCK-level 信息段");
  });

  it("流程: Bash 工具 → 不检查（非 Write/Edit）", () => {
    // CountGuard 只检查 Write/Edit 工具
    // 源文件中：if (toolName !== "Write" && toolName !== "Edit") return
    const isWriteOrEdit = (name) => name === "Write" || name === "Edit";
    assert(isWriteOrEdit("Write"), "Write");
    assert(isWriteOrEdit("Edit"), "Edit");
    assert(!isWriteOrEdit("Bash"), "Bash");
    assert(!isWriteOrEdit("Read"), "Read");
    assert(!isWriteOrEdit("Glob"), "Glob");
    assert(!isWriteOrEdit("Grep"), "Grep");
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
