#!/usr/bin/env node
/**
 * Count Guard — PreToolUse Hook
 *
 * Targets: write/edit on STATUS.md, README.md, ARCHITECTURE.md
 * Scans the proposed content for count/number patterns.
 * Warns if counts are being changed — the AI must verify via `grep`/counting,
 * NOT by making up numbers. Does NOT block; only warns with verification
 * checklist.
 *
 * Rationale: 2026-06-15 STATUS.md audit found 7+ instances of made-up counts
 * (18 vs 14 releases, 67% vs 62% avg, 1 vs 2/3/3 version counts, etc.)
 * spanning 12 corrective PRs. This guard enforces the CLAUDE.md rule:
 * "声称已完成前必须核对源码 — 用 grep/head/git log 确认，禁止凭常识假设"
 */
import { readFileSync } from "fs";

const TRACKED_FILES = [
  "STATUS.md",
  "README.md",
  "ARCHITECTURE.md",
];

// BLOCK-level patterns: editing these numbers requires pre-verification.
// Exit code 2 = block the edit. Set COUNT_GUARD_STRICT=false to demote to warn-only.
const BLOCK_PATTERNS = [
  { re: /组件总数[：:]\s*\d+/g, label: "组件总数 (BLOCKED)" },
  { re: /平均进度[：:]\s*\d+%/g, label: "平均进度 (BLOCKED)" },
  { re: /有版本号[：:]\s*\d+/g, label: "有版本号计数 (BLOCKED)" },
];

// WARN-level patterns: suspect but may be legitimate
const COUNT_PATTERNS = [
  { re: /\d+\/\d+\s*(已发布|已创建|缺失|全部)/g, label: "X/Y 分数" },
  { re: /\d+\s*个\s*[\(（]\s*\d+%\s*[\)）]/g, label: "N 个 (X%)" },
  { re: /[：:]\s*\*?\*?\d+\*?\*?\s*$|^\s*\*?\*?\d+\*?\*?\s*$/gm, label: "裸数字 (可能是合计)" },
  { re: /\d+个\s*\(\s*(全部|全\))/g, label: "N 个 (全部)" },
  { re: /已有[：:]\s*\d+/g, label: "已有计数" },
  { re: /已创建[：:]\s*\d+/g, label: "已创建计数" },
];

const STRICT = (process.env.COUNT_GUARD_STRICT || "true") !== "false";

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
    "# Verify GitHub releases: for repo in ...; do gh release list -R ZoneCNH/\$repo; done",
  ],
  "README.md": [
    "grep -oP 'github\\.com/ZoneCNH/[a-zA-Z0-9_.-]+' README.md | sort -u | wc -l",
  ],
  "ARCHITECTURE.md": [
    "grep -oP 'github\\.com/ZoneCNH/[a-zA-Z0-9_.-]+' ARCHITECTURE.md | sort -u | wc -l",
  ],
};

function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
  });
  process.stdin.on("end", () => {
    let toolCall;
    try {
      toolCall = JSON.parse(input);
    } catch (_) {
      process.stdout.write(input);
      return;
    }

    const toolName = toolCall.tool_name || "";
    if (toolName !== "Write" && toolName !== "Edit") {
      process.stdout.write(input);
      return;
    }

    const filePath = toolCall.tool_input?.file_path || "";
    const fileName = filePath.split("/").pop();
    if (!TRACKED_FILES.includes(fileName)) {
      process.stdout.write(input);
      return;
    }

    // Extract content being written
    const content =
      toolCall.tool_input?.content ||
      toolCall.tool_input?.new_string ||
      "";
    if (!content) {
      process.stdout.write(input);
      return;
    }

    // Scan for block-level patterns first
    const blocked = [];
    for (const { re, label } of BLOCK_PATTERNS) {
      const matches = content.match(re);
      if (matches && matches.length > 0) {
        blocked.push({ label, matches: [...new Set(matches)] });
      }
    }

    // Scan for warn-level patterns
    const found = [];
    for (const { re, label } of COUNT_PATTERNS) {
      const matches = content.match(re);
      if (matches && matches.length > 0) {
        found.push({ label, matches: [...new Set(matches)] });
      }
    }

    if (found.length === 0 && blocked.length === 0) {
      process.stdout.write(input);
      return;
    }

    // Build message
    const lines = [];
    lines.push("");
    lines.push("══════════════════════════════════════════════");
    if (blocked.length > 0 && STRICT) {
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

    if (blocked.length > 0 && STRICT) {
      lines.push("  To bypass (after verification): export COUNT_GUARD_STRICT=false");
      lines.push("  Or attach verification output to commit message.");
      lines.push("══════════════════════════════════════════════");
      console.error(lines.join("\n"));
      process.exit(2);
    }

    lines.push("  本次会话 audit (2026-06-15): 20 PRs 修复了 7+ 处编造的数量。");
    lines.push("  Don't make count changes without verification.");
    lines.push("══════════════════════════════════════════════");

    console.error(lines.join("\n"));
    process.stdout.write(input);
  });
}

main();
