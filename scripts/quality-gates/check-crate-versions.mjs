#!/usr/bin/env node
/**
 * check-crate-versions.mjs — crates/ 独立版本门禁（VERSIONING.md R-C1 / R-C2 / R-V3）
 *
 * 规则：
 *   1. crates/** workspace member 禁止 version.workspace = true
 *   2. 必须显式 version = "X.Y.Z"
 *   3. path 依赖中的 version 必须与目标 package.version 一致
 *
 * 用法:
 *   node scripts/quality-gates/check-crate-versions.mjs
 *   node scripts/quality-gates/check-crate-versions.mjs --json
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const jsonMode = process.argv.includes("--json");

const SEMVER_RE = /^\d+\.\d+\.\d+([\-+].*)?$/;

/** @returns {string[]} */
function listCargoTomlsUnderCrates() {
  const cratesRoot = join(root, "crates");
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === "target" || name === "node_modules") continue;
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (name === "Cargo.toml") out.push(p);
    }
  }
  walk(cratesRoot);
  return out;
}

/**
 * 粗解析 package 表：version / version.workspace
 * @param {string} text
 */
function parsePackageVersion(text) {
  const pkgMatch = text.match(/\[package\]([\s\S]*?)(?=\n\[|\n*$)/);
  if (!pkgMatch) return { kind: "missing-package" };
  const body = pkgMatch[1];
  if (/^\s*version\.workspace\s*=\s*true\s*$/m.test(body)) {
    return { kind: "workspace" };
  }
  const m = body.match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  if (!m) return { kind: "missing" };
  return { kind: "explicit", version: m[1] };
}

/**
 * @param {string} text
 * @param {string} cargoTomlPath
 * @returns {{ name: string, path: string, version: string | null }[]}
 */
function parsePathDeps(text, cargoTomlPath) {
  /** @type {{ name: string, path: string, version: string | null }[]} */
  const deps = [];
  // 匹配 table 或 inline：name = { path = "...", version = "..." }
  const re =
    /^([A-Za-z0-9_-]+)\s*=\s*\{([^}]*)\}/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1];
    const body = m[2];
    const pathM = body.match(/path\s*=\s*"([^"]+)"/);
    if (!pathM) continue;
    const verM = body.match(/version\s*=\s*"([^"]+)"/);
    const abs = resolve(dirname(cargoTomlPath), pathM[1]);
    deps.push({
      name,
      path: abs,
      version: verM ? verM[1] : null,
    });
  }
  return deps;
}

/**
 * @returns {Map<string, { packageName: string, version: string, cargoToml: string }>}
 * key = absolute dir of package
 */
function loadPackageIndex() {
  /** @type {Map<string, { packageName: string, version: string, cargoToml: string }>} */
  const byDir = new Map();
  let meta;
  try {
    const raw = execSync("cargo metadata --no-deps --format-version 1", {
      cwd: root,
      encoding: "utf8",
      timeout: 120_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    meta = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `cargo metadata 失败: ${String(error.stderr || error.message || error).slice(0, 400)}`,
    );
  }
  for (const pkg of meta.packages || []) {
    const manifest = pkg.manifest_path;
    if (!manifest) continue;
    const dir = dirname(manifest);
    // 仅 index 本仓 path packages
    if (!dir.startsWith(root)) continue;
    byDir.set(resolve(dir), {
      packageName: pkg.name,
      version: pkg.version,
      cargoToml: manifest,
    });
  }
  return byDir;
}

function main() {
  /** @type {{ level: string, code: string, message: string }[]} */
  const findings = [];
  const tomls = listCargoTomlsUnderCrates();
  /** @type {Map<string, string>} absDir -> explicit version from file */
  const fileVersions = new Map();

  for (const toml of tomls) {
    const rel = relative(root, toml);
    const text = readFileSync(toml, "utf8");
    // 跳过纯 virtual / 无 [package] 的中间 Cargo.toml（若有）
    if (!/\[package\]/.test(text)) continue;

    const pv = parsePackageVersion(text);
    if (pv.kind === "workspace") {
      findings.push({
        level: "error",
        code: "R-C1",
        message: `${rel}: 禁止 version.workspace = true；须写独立 version = "X.Y.Z"`,
      });
      continue;
    }
    if (pv.kind === "missing" || pv.kind === "missing-package") {
      findings.push({
        level: "error",
        code: "R-C1",
        message: `${rel}: 缺少显式 version = "X.Y.Z"`,
      });
      continue;
    }
    if (!SEMVER_RE.test(pv.version)) {
      findings.push({
        level: "error",
        code: "R-C1",
        message: `${rel}: version "${pv.version}" 不是 X.Y.Z SemVer`,
      });
      continue;
    }
    fileVersions.set(resolve(dirname(toml)), pv.version);
  }

  // path 依赖一致性（在文件解析通过后再查 metadata）
  let index;
  try {
    index = loadPackageIndex();
  } catch (error) {
    findings.push({
      level: "error",
      code: "R-V3",
      message: String(error.message || error),
    });
    index = new Map();
  }

  for (const toml of tomls) {
    const rel = relative(root, toml);
    const text = readFileSync(toml, "utf8");
    if (!/\[package\]/.test(text)) continue;
    for (const dep of parsePathDeps(text, toml)) {
      // 解析 path 可能指向 crate 目录
      let target = index.get(resolve(dep.path));
      if (!target && existsSync(join(dep.path, "Cargo.toml"))) {
        target = index.get(resolve(dep.path));
      }
      // 仅强制 crates/ 内目标
      const targetRel = relative(root, dep.path);
      if (!targetRel.startsWith(`crates${targetRel.includes("/") ? "/" : ""}`) &&
          !targetRel.startsWith("crates/")) {
        // path 在 tools 等：若能解析到 package 仍建议一致，但不在 R-C1 范围硬失败
        continue;
      }
      if (!dep.version) {
        findings.push({
          level: "error",
          code: "R-C2",
          message: `${rel}: path 依赖 "${dep.name}" 缺少 version（禁止裸 path）`,
        });
        continue;
      }
      const expected =
        fileVersions.get(resolve(dep.path)) ||
        target?.version ||
        null;
      if (expected && dep.version !== expected) {
        findings.push({
          level: "error",
          code: "R-C2",
          message: `${rel}: path 依赖 "${dep.name}" version="${dep.version}" 与目标 package.version="${expected}" 不一致`,
        });
      }
    }
  }

  const errors = findings.filter((f) => f.level === "error");
  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          ok: errors.length === 0,
          cratesChecked: tomls.length,
          findings,
        },
        null,
        2,
      ),
    );
  } else {
    console.log("check-crate-versions — crates/ 独立版本门禁 (VERSIONING.md R-C1/R-C2)");
    console.log(`  scanned Cargo.toml under crates/: ${tomls.length}`);
    if (findings.length === 0) {
      console.log("  OK: 全部 crate 使用独立显式版本，path 依赖 version 对齐");
    } else {
      for (const f of findings) {
        console.log(`  ${f.level.toUpperCase()} [${f.code}] ${f.message}`);
      }
    }
    console.log(errors.length === 0 ? "PASS" : "FAIL");
  }

  process.exit(errors.length === 0 ? 0 : 1);
}

main();
