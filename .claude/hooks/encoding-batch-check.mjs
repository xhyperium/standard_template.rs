#!/usr/bin/env node

/**
 * encoding-batch-check.mjs — Post-tool 批量编码巡检
 *
 * 在每次 Write/Edit 后扫描项目中所有变更过的文本文件，
 * 批量检测编码问题（非 UTF-8/BOM/U+FFFD）。
 * 非阻断式，仅输出报告。
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// ── 配置 ──────────────────────────────────────────────

const EXCLUDE_DIRS = [
  '.git/', 'node_modules/', '.cargo/', 'target/', '.worktrees/',
];

const TEXT_EXTENSIONS = ['.md', '.toml', '.json', '.yml', '.yaml', '.rs', '.mjs', '.js', '.cjs'];

const BINARY_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.woff', '.woff2', '.ttf', '.eot', '.lock'];

// ── 编码检测 ──────────────────────────────────────────

function getRepoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function isExcluded(filePath) {
  for (const dir of EXCLUDE_DIRS) {
    if (filePath.includes(dir)) return true;
  }
  for (const ext of BINARY_EXTS) {
    if (filePath.endsWith(ext)) return true;
  }
  return false;
}

function isTextFile(filePath) {
  const ext = '.' + filePath.split('.').pop();
  return TEXT_EXTENSIONS.includes(ext);
}

function checkFile(filePath) {
  if (!existsSync(filePath) || isExcluded(filePath) || !isTextFile(filePath)) {
    return null;
  }

  const raw = readFileSync(filePath);
  const issues = [];

  // 检查 BOM
  if (raw.length >= 3 && raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF) {
    issues.push('含 UTF-8 BOM');
  }

  // 检查 U+FFFD
  if (raw.includes(Buffer.from([0xEF, 0xBF, 0xBD]))) {
    issues.push('含 U+FFFD 替换字符');
  }

  // 检查 UTF-8
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    issues.push('非 UTF-8 编码');
  }

  return issues.length > 0 ? issues : null;
}

// ── 主流程 ────────────────────────────────────────────

const repoRoot = getRepoRoot();
const results = [];

// 收集变更文件：已暂存 + 未暂存 + 未跟踪
let changedFiles = [];

try {
  // 已暂存和未暂存的修改
  const diff = execSync('git diff --name-only HEAD', {
    cwd: repoRoot, encoding: 'utf8', stdio: 'pipe',
  }).trim();
  if (diff) changedFiles.push(...diff.split('\n'));
} catch {
  // HEAD 可能不存在（新仓库）
}

try {
  // 未跟踪文件
  const untracked = execSync('git ls-files --others --exclude-standard', {
    cwd: repoRoot, encoding: 'utf8', stdio: 'pipe',
  }).trim();
  if (untracked) changedFiles.push(...untracked.split('\n'));
} catch {
  // ignore
}

// 去重
changedFiles = [...new Set(changedFiles)].filter(Boolean);

if (changedFiles.length === 0) {
  // 没有变更文件时做快速抽样检查（扫描根目录关键文件）
  const criticalFiles = ['README.md', 'AGENTS.md', 'CLAUDE.md', 'Cargo.toml'];
  for (const f of criticalFiles) {
    const fp = resolve(repoRoot, f);
    const issues = checkFile(fp);
    if (issues) {
      results.push({ file: f, issues });
    }
  }
} else {
  // 批量检查所有变更文件
  for (const relPath of changedFiles) {
    const fp = resolve(repoRoot, relPath);
    const issues = checkFile(fp);
    if (issues) {
      results.push({ file: relPath, issues });
    }
  }
}

// ── 输出报告 ──────────────────────────────────────────

const relRoot = repoRoot.replace(/^\/home\/[^/]+\/[^/]+\//, '');

if (results.length === 0) {
  // 完全安静模式——只有控制台有输出时不显示
  // 无输出 = 全部通过
} else {
  console.error(`\n⚠️  [编码批量巡检] ${relRoot}`);
  for (const { file, issues } of results) {
    console.error(`  ❌ ${file}`);
    for (const issue of issues) {
      console.error(`     ${issue}`);
    }
  }
  console.error(`  共 ${results.length} 个文件编码异常`);
  console.error(`  修复: node scripts/fix-encoding.mjs --fix\n`);
}
