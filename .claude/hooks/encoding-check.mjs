#!/usr/bin/env node

/**
 * encoding-check.mjs — Pre-tool 编码门禁
 *
 * 在 Write/Edit 前校验：
 * 1. 本次写入载荷（contents / new_string）不得含 BOM、U+FFFD、非 UTF-8
 * 2. 磁盘上已有文件若编码损坏：Edit 阻断；Write 仅在载荷干净时放行（修复路径）
 *
 * 阻断方式：stdout `{ "block": true, "reason": "..." }`（与 pre-tool-check 一致）
 * 兼容 settings 中的 `|| exit 2`。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "encoding-check";
export const type = "pre-tool";

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const FFFD = Buffer.from([0xef, 0xbf, 0xbd]);

const EXCLUDE = [
  ".git/",
  "node_modules/",
  ".cargo/",
  "target/",
  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.ico",
  "*.svg",
  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.eot",
  "*.lock",
];

const TEXT_EXTS = [
  ".md",
  ".toml",
  ".json",
  ".yml",
  ".yaml",
  ".rs",
  ".mjs",
  ".js",
  ".cjs",
  ".sh",
  ".txt",
];

function relPathOf(filePath) {
  return String(filePath).replace(/^\/home\/[^/]+\/[^/]+\//, "");
}

function isExcluded(filePath) {
  const rel = relPathOf(filePath);
  for (const pattern of EXCLUDE) {
    if (pattern.endsWith("/") && rel.includes(pattern)) return true;
    if (pattern.startsWith("*") && rel.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

function isTextFile(filePath) {
  const base = String(filePath).split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTS.includes(base.slice(dot).toLowerCase());
}

/**
 * @param {Buffer} raw
 * @returns {string|null} issue label or null
 */
export function inspectBytes(raw) {
  if (raw.length >= 3 && raw.subarray(0, 3).equals(BOM)) {
    return "含 UTF-8 BOM";
  }
  if (raw.includes(FFFD)) {
    return "含 U+FFFD 替换字符（编码损坏）";
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return "非 UTF-8 编码";
  }
  return null;
}

/**
 * @param {string} text
 * @returns {string|null}
 */
export function inspectText(text) {
  if (typeof text !== "string") return null;
  return inspectBytes(Buffer.from(text, "utf8"));
}

/**
 * @param {{ tool: string, args: Record<string, unknown> }} context
 */
export function evaluate(context) {
  const tool = context.tool || "";
  if (tool !== "Write" && tool !== "Edit") {
    return { result: "pass" };
  }

  const args = context.args || {};
  const filePath = args.file_path || args.filePath || args.path;
  if (!filePath || typeof filePath !== "string") {
    return { result: "pass" };
  }

  if (isExcluded(filePath) || !isTextFile(filePath)) {
    return { result: "pass" };
  }

  const relPath = relPathOf(filePath);

  // 1) 校验本次写入载荷（防止新建/覆盖时引入损坏）
  const payloadKeys =
    tool === "Write"
      ? ["contents", "content"]
      : ["new_string", "newString", "new_str"];

  for (const key of payloadKeys) {
    const value = args[key];
    if (typeof value !== "string") continue;
    const issue = inspectText(value);
    if (issue) {
      return {
        result: "block",
        message:
          `❌ ${relPath} 写入内容${issue}，拒绝写入。\n` +
          `  项目要求 UTF-8 无 BOM，禁止 U+FFFD。\n` +
          `  修复: 重写中文内容，或 node scripts/fix-encoding.mjs --check`,
      };
    }
  }

  // 2) 磁盘已有文件
  if (!existsSync(filePath)) {
    return { result: "pass" };
  }

  let raw;
  try {
    raw = readFileSync(filePath);
  } catch {
    return { result: "pass" };
  }

  const diskIssue = inspectBytes(raw);
  if (!diskIssue) {
    return { result: "pass" };
  }

  // Write 且载荷干净：允许整文件覆写修复
  if (tool === "Write") {
    const hasCleanPayload = payloadKeys.some((k) => typeof args[k] === "string");
    if (hasCleanPayload) {
      return { result: "pass" };
    }
  }

  // Edit 无法保证整文件清零 U+FFFD → 阻断，要求 Write 全量修复
  return {
    result: "block",
    message:
      `❌ ${relPath} 磁盘文件${diskIssue}。\n` +
      (tool === "Edit"
        ? `  请使用 Write 写入完整正确内容（Edit 可能残留 U+FFFD）。\n`
        : `  请先修复编码后再写入。\n`) +
      `  扫描: node scripts/fix-encoding.mjs --check`,
  };
}

// 兼容旧 handler 形状
export async function handler(context) {
  return evaluate(context);
}

function block(reason) {
  process.stdout.write(JSON.stringify({ block: true, reason }));
  process.exit(2);
}

function main() {
  let input = "";
  try {
    input = readFileSync(0, "utf8").trim();
  } catch {
    process.exit(0);
  }
  if (!input) process.exit(0);

  let call;
  try {
    call = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  // 兼容 Claude Code / 内部钩子字段差异
  const tool =
    call.tool || call.tool_name || call.toolName || call.name || "";
  const args =
    call.input || call.tool_input || call.toolInput || call.args || {};

  const result = evaluate({ tool, args });
  if (result.result === "block") {
    block(result.message || "编码检查失败");
  }
  process.exit(0);
}

// 仅作为 CLI 执行时跑 main（被 import 测试时不跑）
const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectRun) {
  main();
}
