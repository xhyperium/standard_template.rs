#!/usr/bin/env node

/**
 * encoding-batch-check.mjs — Post-tool 批量编码巡检
 *
 * 在每次 Write/Edit 后扫描变更文本文件的编码问题（非 UTF-8 / BOM / U+FFFD）。
 * 默认阻断（exit 2），与 Pre-tool / CI L2 对齐。
 *
 * 环境变量：
 *   ENCODING_BATCH_STRICT=false  — 仅警告不阻断（调试用）
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

export const name = "encoding-batch-check";
export const type = "post-tool";

// ── 配置 ──────────────────────────────────────────────

const EXCLUDE_DIRS = [
  ".git/",
  "node_modules/",
  ".cargo/",
  "target/",
  ".worktrees/",
];

const TEXT_EXTENSIONS = [
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

const BINARY_EXTS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".lock",
  ".gz",
  ".tar",
  ".zip",
];

const STRICT =
  String(process.env.ENCODING_BATCH_STRICT ?? "true").toLowerCase() !==
  "false";

// ── 编码检测 ──────────────────────────────────────────

export function getRepoRoot() {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
}

export function isExcluded(filePath) {
  for (const dir of EXCLUDE_DIRS) {
    if (filePath.includes(dir)) return true;
  }
  for (const ext of BINARY_EXTS) {
    if (filePath.endsWith(ext)) return true;
  }
  return false;
}

export function isTextFile(filePath) {
  const base = filePath.split("/").pop() || filePath;
  const dot = base.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.includes(base.slice(dot).toLowerCase());
}

/**
 * @returns {string[]|null}
 */
export function checkFile(filePath) {
  if (!existsSync(filePath) || isExcluded(filePath) || !isTextFile(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath);
  const issues = [];

  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    issues.push("含 UTF-8 BOM");
  }
  if (raw.includes(Buffer.from([0xef, 0xbf, 0xbd]))) {
    issues.push("含 U+FFFD 替换字符");
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    issues.push("非 UTF-8 编码");
  }

  return issues.length > 0 ? issues : null;
}

/**
 * @returns {{ file: string, issues: string[] }[]}
 */
export function collectIssues(repoRoot = getRepoRoot()) {
  const results = [];
  let changedFiles = [];

  try {
    const diff = execSync("git diff --name-only HEAD", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
    if (diff) changedFiles.push(...diff.split("\n"));
  } catch {
    // HEAD 可能不存在
  }

  try {
    const untracked = execSync("git ls-files --others --exclude-standard", {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
    if (untracked) changedFiles.push(...untracked.split("\n"));
  } catch {
    // ignore
  }

  changedFiles = [...new Set(changedFiles)].filter(Boolean);

  if (changedFiles.length === 0) {
    const criticalFiles = ["README.md", "AGENTS.md", "CLAUDE.md", "Cargo.toml"];
    for (const f of criticalFiles) {
      const fp = resolve(repoRoot, f);
      const issues = checkFile(fp);
      if (issues) results.push({ file: f, issues });
    }
  } else {
    for (const relPath of changedFiles) {
      const fp = resolve(repoRoot, relPath);
      const issues = checkFile(fp);
      if (issues) results.push({ file: relPath, issues });
    }
  }

  return results;
}

/**
 * @returns {{ ok: boolean, results: {file:string,issues:string[]}[], message: string }}
 */
export function runBatchCheck(repoRoot = getRepoRoot()) {
  const results = collectIssues(repoRoot);
  if (results.length === 0) {
    return { ok: true, results, message: "" };
  }

  const relRoot = repoRoot.replace(/^\/home\/[^/]+\/[^/]+\//, "");
  const lines = [
    `\n❌ [编码批量巡检] ${relRoot}`,
    ...results.flatMap(({ file, issues }) => [
      `  ❌ ${file}`,
      ...issues.map((issue) => `     ${issue}`),
    ]),
    `  共 ${results.length} 个文件编码异常`,
    `  扫描: node scripts/fix-encoding.mjs --check`,
    `  说明: U+FFFD 需按上下文重写中文或从 git 历史恢复\n`,
  ];
  return { ok: false, results, message: lines.join("\n") };
}

// ── CLI 入口 ──────────────────────────────────────────

function main() {
  const { ok, message } = runBatchCheck();
  if (ok) process.exit(0);

  console.error(message);
  if (STRICT) {
    process.exit(2);
  }
  process.exit(0);
}

import { fileURLToPath } from "node:url";
import { resolve as pathResolve } from "node:path";

const isDirectRun =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === pathResolve(process.argv[1]);

if (isDirectRun) {
  main();
}
