#!/usr/bin/env node

/**
 * encoding-check.mjs — Pre-tool 编码门禁
 *
 * 在每次 Write/Edit 前检查目标文件编码。
 * 拦截非 UTF-8 无 BOM 的文件写入。
 */

export const name = 'encoding-check';
export const type = 'pre-tool';

const ALLOWED_ENCODINGS = ['utf-8', 'ascii', 'us-ascii'];
const BOM = [0xEF, 0xBB, 0xBF]; // UTF-8 BOM

export async function handler(context) {
  const { tool, args } = context;

  // 只检查文件写入操作
  if (tool !== 'Write' && tool !== 'Edit') {
    return { result: 'pass' };
  }

  const filePath = args?.file_path || args?.filePath;
  if (!filePath || typeof filePath !== 'string') {
    return { result: 'pass' };
  }

  const fs = await import('node:fs');

  // 检查是否忽略编码检查的路径
  const EXCLUDE = [
    '.git/', 'node_modules/', '.cargo/', 'target/',
    '*.png', '*.jpg', '*.jpeg', '*.gif', '*.ico', '*.svg',
    '*.woff', '*.woff2', '*.ttf', '*.eot', '*.lock',
  ];

  const relPath = filePath.replace(/^\/home\/[^/]+\/[^/]+\//, '');
  for (const pattern of EXCLUDE) {
    if (pattern.endsWith('/') && relPath.includes(pattern)) return { result: 'pass' };
    if (pattern.startsWith('*') && relPath.endsWith(pattern.slice(1))) return { result: 'pass' };
  }

  // 只检查文本文件
  const textExts = ['.md', '.toml', '.json', '.yml', '.yaml', '.rs', '.mjs', '.js', '.cjs'];
  const ext = '.' + filePath.split('.').pop();
  if (!textExts.includes(ext)) {
    return { result: 'pass' };
  }

  // 检查文件是否存在
  if (!fs.existsSync(filePath)) {
    return { result: 'pass' };
  }

  const raw = fs.readFileSync(filePath);

  // 检查 BOM
  if (raw.length >= 3 && raw[0] === BOM[0] && raw[1] === BOM[1] && raw[2] === BOM[2]) {
    return {
      result: 'block',
      message: `❌ ${relPath} 包含 UTF-8 BOM，请移除 BOM 后重试。项目规范要求 UTF-8 无 BOM。`,
    };
  }

  // 检查 U+FFFD 替换字符
  if (raw.includes(Buffer.from([0xEF, 0xBF, 0xBD]))) {
    return {
      result: 'block',
      message: `❌ ${relPath} 包含 U+FFFD 替换字符（编码损坏），请修复后重试。\n  运行: node scripts/fix-encoding.mjs --fix`,
    };
  }

  // 检查编码（使用 TextDecoder 严格模式）
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return {
      result: 'block',
      message: `❌ ${relPath} 不是有效的 UTF-8 编码，请转换后重试。\n  运行: iconv -f gbk -t utf-8 "${relPath}"`,
    };
  }

  return { result: 'pass' };
}
