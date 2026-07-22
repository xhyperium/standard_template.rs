#!/usr/bin/env node
/**
 * check-pr-template.mjs — PR 描述模板合规性校验
 *
 * 职责: CI 中校验 PR body 是否按模板填写了必填字段。
 * 通过环境变量 PR_BODY 接收 PR 描述文本。
 *
 * 用法:
 *   PR_BODY="..." node scripts/quality-gates/check-pr-template.mjs
 */

const body = process.env.PR_BODY || "";

if (!body.trim()) {
  console.log("::error::未检测到 PR 描述");
  process.exit(1);
}

let pass = true;

// 降级配置: PR_TEMPLATE_ERROR_DOWNGRADE=type,summary,all
const downgrade = new Set((process.env.PR_TEMPLATE_ERROR_DOWNGRADE || "").split(",").map(s => s.trim()).filter(Boolean));
const DOWNGRADE_ALL = downgrade.has("all");

function warn(msg) { console.log(`::warning::${msg}`); }
function error(msg, key = "") {
  if (DOWNGRADE_ALL || downgrade.has(key)) {
    console.log(`::warning::${msg} (误差降级)`);
  } else {
    console.log(`::error::${msg}`);
    pass = false;
  }
}
function notice(msg) { console.log(`::notice::${msg}`); }

// 1. 变更类型择
if (/^\s*-\s*\[\s*x\s*\]/m.test(body)) {
  notice("变更类型: 已勾选");
} else {
  error("变更类型: 请勾选至少一项 (- [x])", "type");
}

// 2. 关联 Issue
const closesMatch = body.match(/Closes #\d+/);
if (closesMatch) {
  notice(`关联 Issue: ${closesMatch[0]}`);
} else {
  warn("关联 Issue: 未找到 'Closes #<num>' 链接，建议关联 Issue");
}

// 3. 变更摘要
const summarySection = body.match(/## 变更摘要\n\n([\s\S]*?)(?=\n## |$)/);
const summary = summarySection ? summarySection[1].replace(/<!--[\s\S]*?-->/g, "").trim() : "";
if (!summary) {
  error("变更摘要: 请填写变更说明", "summary");
} else {
  notice("变更摘要: 已填写");
}

// 4. 宪章合规性
const constitutionSection = body.match(/## 宪章合规性\n\n([\s\S]*?)(?=\n## |$)/);
if (constitutionSection) {
  const content = constitutionSection[1];
  const unchecked = content.match(/^\s*-\s*\[\s*\]\s*`/gm);
  const checked = content.match(/^\s*-\s*\[\s*x\s*\]\s*`/gm);

  if (unchecked) {
    warn(`宪章合规性: ${unchecked.length} 项未勾选，请确认或说明原因`);
    unchecked.forEach(u => warn(`  ${u.trim()}`));
  } else if (checked) {
    notice(`宪章合规性: ${checked.length} 项已勾选`);
  }
}

// 5. 验证方式
const verifySection = body.match(/## 验证方式\n\n([\s\S]*?)(?=\n## |$)/);
if (verifySection) {
  const content = verifySection[1];
  const codeContent = content.match(/```(?:bash|shell)?\n([\s\S]*?)```/);
  const hasContent = codeContent && codeContent[1].replace(/#.*/gm, "").trim().length > 0;
  if (hasContent) {
    notice("验证方式: 已填写");
  } else {
    warn("验证方式: 请在代码块中贴入验证命令和输出");
  }
}

// 6. 审查聚焦
const focusSection = body.match(/## 审查聚焦\n\n([\n]*)([\s\S]*?)(?=\n\n|$)/);
if (focusSection) {
  const content = focusSection[2].replace(/<!--[\s\S]*?-->/g, "").trim();
  if (content) {
    notice("审查聚焦: 已填写");
  } else {
    warn("审查聚焦: 请指出需要 reviewer 关注的部分");
  }
}

if (pass) {
  console.log("::notice::PR 模板校验通过");
  process.exit(0);
} else {
  console.log("::error::PR 模板校验失败 — 请完善 PR 描述后重新推送");
  process.exit(1);
}
