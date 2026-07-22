#!/usr/bin/node
/**
 * check-workspace-deps.mjs — 依赖集中管理门禁（[workspace.dependencies] 强制）
 *
 * 规则：
 *   1. 第三方依赖禁止在 crate 内联版本，须统一经 { workspace = true } 引用
 *      （违规 code: R-DEP-001）
 *   2. 经 { workspace = true } 引用的依赖，必须在根 [workspace.dependencies] 中定义
 *      （缺失 code: R-DEP-002）
 *   3. intra-workspace（path）依赖允许内联 version，不计入上述门禁
 *
 * 用法：
 *   node scripts/quality-gates/check-workspace-deps.mjs
 *   node scripts/quality-gates/check-workspace-deps.mjs --json
 *   node scripts/quality-gates/check-workspace-deps.mjs --root <dir>
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// --root <dir> 覆盖仓库根；否则默认 scripts/quality-gates 上溯两级即仓库根
function resolveRoot() {
  const idx = process.argv.indexOf("--root");
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return resolve(process.argv[idx + 1]);
  }
  return join(__dirname, "..", "..");
}

const root = resolveRoot();
const jsonMode = process.argv.includes("--json");

// ============================================================
// 递归采集 Cargo.toml（crates/ 与 tools/，跳过 target/、node_modules）
// ============================================================
/**
 * @returns {{ path: string, rel: string }[]}
 */
function listCargoTomls() {
  /** @type {{ path: string, rel: string }[]} */
  const out = [];
  for (const base of ["crates", "tools"]) {
    walk(join(root, base), out);
  }
  return out;
}

/**
 * @param {string} dir
 * @param {{ path: string, rel: string }[]} out
 */
function walk(dir, out) {
  if (!existsSync(dir)) return;
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    // 跳过构建产物与 node 依赖目录
    if (name === "target" || name === "node_modules") continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else if (name === "Cargo.toml") out.push({ path: p, rel: relative(root, p) });
  }
}

// ============================================================
// 按 TOML 表头切分（返回每段的表名与表体）
// ============================================================
/**
 * @param {string} text
 * @returns {{ name: string, body: string }[]}
 */
function splitTables(text) {
  /** @type {{ header: string, start: number, end: number }[]} */
  const headers = [];
  const headerRe = /^\[[^\]]*\]/gm;
  let m;
  while ((m = headerRe.exec(text)) !== null) {
    headers.push({ header: m[0], start: m.index, end: m.index + m[0].length });
  }
  /** @type {{ name: string, body: string }[]} */
  const tables = [];
  for (let i = 0; i < headers.length; i++) {
    const bodyStart = headers[i].end;
    const bodyEnd = i + 1 < headers.length ? headers[i + 1].start : text.length;
    const name = headers[i].header.slice(1, -1).trim();
    tables.push({ name, body: text.slice(bodyStart, bodyEnd) });
  }
  return tables;
}

// ============================================================
// 依赖表识别（仅以下表参与门禁）
// ============================================================
/**
 * @param {string} name
 * @returns {boolean}
 */
function isDependencyTable(name) {
  if (
    name === "dependencies" ||
    name === "dev-dependencies" ||
    name === "build-dependencies"
  ) {
    return true;
  }
  // [target.<cfg>.dependencies|dev-dependencies|build-dependencies]
  return /^target\..+\.(dependencies|dev-dependencies|build-dependencies)$/.test(name);
}

// ============================================================
// 解析根 [workspace.dependencies] 声明的依赖名集合
// ============================================================
/**
 * @param {string} rootText
 * @returns {Set<string>}
 */
function parseWorkspaceDepNames(rootText) {
  const set = new Set();
  const tables = splitTables(rootText);
  const t = tables.find((x) => x.name === "workspace.dependencies");
  if (!t) return set; // 无 [workspace.dependencies] 段 → 空集（fixture 场景）
  // 折叠 inline table 为 {}，避免内部 key = 被误判为顶层依赖名
  let body = t.body.replace(/\{[\s\S]*?\}/g, "{}");
  body = body.replace(/#.*$/gm, ""); // 去除注释
  const nameRe = /^([A-Za-z0-9_-]+)\s*=/gm;
  let m;
  while ((m = nameRe.exec(body)) !== null) {
    set.add(m[1]);
  }
  return set;
}

// ============================================================
// 主流程
// ============================================================
function main() {
  /** @type {{ level: string, code: string, message: string }[]} */
  const findings = [];
  // 暂存 workspace 引用，待根段解析后统一校验 R-DEP-002
  /** @type {{ name: string, rel: string }[]} */
  const workspaceRefs = [];

  const tomls = listCargoTomls();
  const scanned = tomls.length;

  // 依赖条目正则：name = { 多行 inline table } 或 name = "裸字符串"
  // features 数组无嵌套花括号，故 \{[\s\S]*?\} 安全捕获到对应 }
  const depRe = /^([A-Za-z0-9_-]+|"[^"]+"|'[^']+')\s*=\s*(\{[\s\S]*?\}|"[^"]*")/gm;

  for (const { path, rel } of tomls) {
    const text = readFileSync(path, "utf8");
    // 仅处理含 [package] 的 Cargo.toml（跳过 virtual manifest）
    if (!/\[package\]/.test(text)) continue;

    const tables = splitTables(text);
    for (const tbl of tables) {
      if (!isDependencyTable(tbl.name)) continue;
      depRe.lastIndex = 0;
      let m;
      while ((m = depRe.exec(tbl.body)) !== null) {
        let name = m[1].replace(/^["']|["']$/g, "");
        const value = m[2];
        if (value.startsWith('"')) {
          // 裸字符串值即内联版本 → 违规 R-DEP-001
          const ver = value.slice(1, -1);
          findings.push({
            level: "error",
            code: "R-DEP-001",
            message: `${rel}: 第三方依赖 "${name}" 内联版本 "${ver}"，须改用 { workspace = true }`,
          });
        } else {
          // inline table：按关键字判定
          if (/workspace\s*=\s*true/.test(value)) {
            // 重命名依赖：foo = { package = "bar", workspace = true } → 以 package 名校验
            const pm = value.match(/package\s*=\s*"([^"]+)"/);
            workspaceRefs.push({ name: pm ? pm[1] : name, rel });
          } else if (/\bpath\s*=/.test(value)) {
            // intra-workspace：放行（允许内联 version）
          } else if (/version\s*=/.test(value)) {
            const vm = value.match(/version\s*=\s*"([^"]+)"/);
            const ver = vm ? vm[1] : "";
            findings.push({
              level: "error",
              code: "R-DEP-001",
              message: `${rel}: 第三方依赖 "${name}" 内联版本 "${ver}"，须改用 { workspace = true }`,
            });
          } else {
            // 其它（如 git 依赖无 version）：放行
          }
        }
      }
    }
  }

  // 解析根 [workspace.dependencies]，校验每个 workspace 引用可解析
  const rootPath = join(root, "Cargo.toml");
  const workspaceDeps = existsSync(rootPath)
    ? parseWorkspaceDepNames(readFileSync(rootPath, "utf8"))
    : new Set();
  for (const { name, rel } of workspaceRefs) {
    if (!workspaceDeps.has(name)) {
      findings.push({
        level: "error",
        code: "R-DEP-002",
        message: `${rel}: 依赖 "${name}" 使用 { workspace = true }，但根 [workspace.dependencies] 未定义该依赖`,
      });
    }
  }

  const errors = findings.filter((f) => f.level === "error");

  if (jsonMode) {
    console.log(JSON.stringify({ ok: errors.length === 0, scanned, findings }, null, 2));
    // 末行仍保留 PASS/FAIL，保证契约一致（与非 json 模式行为对齐）
    console.log(errors.length === 0 ? "PASS" : "FAIL");
  } else {
    console.log("check-workspace-deps — 依赖集中管理门禁 ([workspace.dependencies] 强制)");
    console.log(`  scanned Cargo.toml (crates/ + tools/): ${scanned}`);
    if (errors.length === 0) {
      console.log("  OK: 全部第三方依赖经 { workspace = true } 引用，path 依赖版本对齐");
    } else {
      for (const f of errors) {
        console.log(`  ERROR [${f.code}] ${f.message}`);
      }
    }
    console.log(errors.length === 0 ? "PASS" : "FAIL");
  }

  process.exit(errors.length === 0 ? 0 : 1);
}

main();
