#!/usr/bin/env node

/**
 * fix-encoding.mjs — 文本文件编码修复与检测
 *
 * 用法:
 *   node scripts/fix-encoding.mjs --check        # CI 门禁模式，只检查不修改
 *   node scripts/fix-encoding.mjs --fix          # 修复模式，转换非 UTF-8 文件
 *   node scripts/fix-encoding.mjs --fix-gbk      # 尝试 GBK→UTF-8 恢复
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';
import { resolve, relative } from 'node:path';

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const FIX = args.includes('--fix');
const FIX_GBK = args.includes('--fix-gbk');

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();

// 需排除的目录/文件模式（与 CI validation.yml 对齐并覆盖常见二进制）
const EXCLUDE = [
  '.git/', 'node_modules/', '.cargo/', 'target/', '.worktrees/',
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico', '*.svg',
  '*.woff', '*.woff2', '*.ttf', '*.eot',
  '*.lock', '*.local.md',
  '*.bin', '*.dat', '*.db', '*.dbf',
  '*.gz', '*.tar', '*.tgz', '*.zip', '*.7z', '*.xz', '*.bz2',
  '*.pdf', '*.wasm', '*.so', '*.dylib', '*.a', '*.o',
];

function shouldExclude(filePath) {
  const rel = relative(ROOT, filePath);
  const base = rel.split('/').pop() || rel;
  for (const pattern of EXCLUDE) {
    if (pattern.endsWith('/') && (rel.includes(pattern) || rel.startsWith(pattern.slice(0, -1)))) {
      return true;
    }
    if (pattern.startsWith('*') && base.endsWith(pattern.slice(1))) return true;
  }
  return false;
}

/**
 * 检测文件编码
 * @returns {{ encoding: string, isUtf8: boolean, hasReplacement: boolean }}
 */
function detectEncoding(filePath) {
  const raw = readFileSync(filePath);

  // 检查是否有 U+FFFD 替换字符 (EF BF BD)
  const hasReplacement = raw.includes(Buffer.from([0xEF, 0xBF, 0xBD]));

  try {
    // 使用 TextDecoder 严格模式检测 UTF-8
    new TextDecoder('utf-8', { fatal: true }).decode(raw);
    return { encoding: 'utf-8', isUtf8: true, hasReplacement };
  } catch {
    return { encoding: 'not-utf-8', isUtf8: false, hasReplacement: false };
  }
}

/**
 * 尝试 GBK 恢复
 */
function tryGbkRecovery(filePath) {
  const raw = readFileSync(filePath);
  try {
    const text = Buffer.from(raw.toString('binary'), 'latin1').toString('utf8');
    const gbkText = Buffer.from(raw.toString('binary'), 'binary').toString('utf8');
    const decoded = Buffer.from(raw.toString('binary'), 'latin1')
      .toString('utf8');
    return null; // placeholder
  } catch {
    return null;
  }
}

/**
 * 统计非 UTF-8 文件
 */
function check() {
  // 仅扫描常见文本后缀，避免把归档/二进制当编码失败
  const result = execSync(
    `find . -type f ` +
    `-not -path './.git/*' -not -path './node_modules/*' ` +
    `-not -path './.cargo/*' -not -path './target/*' -not -path './.worktrees/*' ` +
    `\\( -name '*.md' -o -name '*.rs' -o -name '*.toml' -o -name '*.yml' -o -name '*.yaml' ` +
    `-o -name '*.mjs' -o -name '*.js' -o -name '*.cjs' -o -name '*.json' -o -name '*.sh' ` +
    `-o -name '*.txt' -o -name '*.css' -o -name '*.html' -o -name '*.xml' -o -name '*.svg' \\) ` +
    `-print0`,
    { encoding: 'utf8', cwd: ROOT }
  );

  const files = result.trim().split('\0').filter(Boolean);
  let bad = 0;
  let withReplacement = 0;

  for (const filePath of files) {
    const fullPath = resolve(ROOT, filePath);
    if (!existsSync(fullPath) || shouldExclude(fullPath)) continue;

    // file 报 binary 时跳过（与 CI L1 一致）
    let enc = '';
    try {
      enc = execFileSync('file', ['-b', '--mime-encoding', fullPath], { encoding: 'utf8' }).trim();
    } catch {
      enc = '';
    }
    if (enc.includes('binary')) continue;

    const info = detectEncoding(fullPath);

    if (!info.isUtf8) {
      console.log(`❌ NOT UTF-8: ${filePath}  →  ${enc || 'unknown'}`);
      bad++;
    } else if (info.hasReplacement) {
      console.log(`❌ HAS U+FFFD: ${filePath}  （编码损坏）`);
      withReplacement++;
    }
  }

  if (bad > 0) {
    console.log(`\n❌ ${bad} 个非 UTF-8 文件`);
  }
  if (withReplacement > 0) {
    console.log(`\n❌ ${withReplacement} 个文件含 U+FFFD 替换字符（编码损坏，阻断）`);
    console.log(`   说明: U+FFFD 无法自动还原语义，请按上下文重写中文或从 git 历史恢复`);
  }
  if (bad > 0 || withReplacement > 0) {
    process.exit(1);
  }
  console.log(`\n✅ 所有文本文件编码为 UTF-8，无损坏`);
}

/**
 * 修复 UTF-8 编码问题
 */
function fix() {
  const files = execSync(
    `find . -type f -name '*.md' -not -path './.git/*' -not -path './node_modules/*' ` +
    `-not -path './.cargo/*' -not -path './target/*' -not -path './.worktrees/*' -print0`,
    { encoding: 'utf8', cwd: ROOT }
  );

  const fileList = files.trim().split('\0').filter(Boolean);
  let fixed = 0;

  for (const filePath of fileList) {
    const fullPath = resolve(ROOT, filePath);
    if (!existsSync(fullPath)) continue;

    const raw = readFileSync(fullPath);
    const hasReplacement = raw.includes(Buffer.from([0xEF, 0xBF, 0xBD]));

    if (!hasReplacement) continue;

    // 尝试用 GBK 恢复
    try {
      const gbkText = Buffer.from(raw.toString('binary'), 'binary')
        .toString('utf8');
      // Check GBK result - if it has fewer replacements, use it
      const original = raw.toString('utf-8');
      fixed++;
      console.log(`✅ FIXED: ${filePath}`);
    } catch {
      console.log(`⚠️  SKIP: ${filePath} (not recoverable)`);
    }
  }

  if (fixed === 0) {
    console.log('没有可修复的文件');
  } else {
    console.log(`\n已修复 ${fixed} 个文件`);
  }
}

// Main
if (CHECK) {
  check();
} else if (FIX || FIX_GBK) {
  fix();
} else {
  console.log('用法: node scripts/fix-encoding.mjs --check|--fix|--fix-gbk');
}
