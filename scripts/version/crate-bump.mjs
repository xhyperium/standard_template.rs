#!/usr/bin/env node
/**
 * crate-bump.mjs — 对单个 crates/ package 执行 PATCH +1，并同步 path 依赖 version 字符串
 *
 * 规则：docs/governance/VERSIONING.md R-C2
 *
 * 用法:
 *   node scripts/version/crate-bump.mjs <package-name|relative-path>
 *   node scripts/version/crate-bump.mjs kernel --dry-run
 *   node scripts/version/crate-bump.mjs crates/configx
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const args = process.argv.slice(2).filter((a) => a !== "--");
const dryRun = args.includes("--dry-run");
const targetArg = args.find((a) => !a.startsWith("--"));

if (!targetArg) {
  console.error("用法: node scripts/version/crate-bump.mjs <package-name|path> [--dry-run]");
  process.exit(2);
}

function bumpPatch(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(.*)?$/);
  if (!m) throw new Error(`无法解析版本: ${v}`);
  const patch = Number(m[3]) + 1;
  return `${m[1]}.${m[2]}.${patch}${m[4] || ""}`;
}

function loadMetadata() {
  const raw = execSync("cargo metadata --no-deps --format-version 1", {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  return JSON.parse(raw);
}

function listAllCargoTomls() {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === "target" || name === "node_modules" || name === ".git") continue;
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
  walk(join(root, "crates"));
  walk(join(root, "tools"));
  return out;
}

function main() {
  const meta = loadMetadata();
  const packages = (meta.packages || []).filter((p) =>
    String(p.manifest_path || "").startsWith(root),
  );

  let pkg = packages.find((p) => p.name === targetArg);
  if (!pkg) {
    const abs = resolve(root, targetArg);
    pkg = packages.find(
      (p) =>
        dirname(p.manifest_path) === abs ||
        p.manifest_path === join(abs, "Cargo.toml") ||
        relative(root, dirname(p.manifest_path)) === targetArg.replace(/\/$/, ""),
    );
  }
  if (!pkg) {
    console.error(`未找到 package: ${targetArg}`);
    process.exit(1);
  }

  const manifest = pkg.manifest_path;
  if (!manifest.includes(`${join(root, "crates")}`) && !manifest.startsWith(join(root, "crates"))) {
    // 允许 tools，但提示规则范围
    if (!manifest.includes(`${join(root, "tools")}`)) {
      console.error(`目标不在 crates/ 或 tools/: ${manifest}`);
      process.exit(1);
    }
  }

  const oldVersion = pkg.version;
  const newVersion = bumpPatch(oldVersion);
  const text = readFileSync(manifest, "utf8");

  if (/^\s*version\.workspace\s*=\s*true\s*$/m.test(text)) {
    console.error(
      `${relative(root, manifest)} 仍使用 version.workspace = true；请先改为显式 version`,
    );
    process.exit(1);
  }

  const nextManifest = text.replace(
    /^(\s*version\s*=\s*")([^"]+)(")/m,
    `$1${newVersion}$3`,
  );
  if (nextManifest === text) {
    console.error(`未能在 ${relative(root, manifest)} 替换 version`);
    process.exit(1);
  }

  console.log(`${pkg.name}: ${oldVersion} → ${newVersion}`);
  if (!dryRun) {
    writeFileSync(manifest, nextManifest, "utf8");
  }

  // 同步 path 依赖中引用该 package 目录或 name 的 version
  const pkgDir = dirname(manifest);
  let syncCount = 0;
  for (const toml of listAllCargoTomls()) {
    if (resolve(toml) === resolve(manifest)) continue;
    let t = readFileSync(toml, "utf8");
    const orig = t;
    // inline table with path pointing to pkgDir
    t = t.replace(
      /([A-Za-z0-9_-]+\s*=\s*\{[^}]*path\s*=\s*"([^"]+)"[^}]*version\s*=\s*")([^"]+)(")/g,
      (full, pre, pathVal, _ver, post) => {
        const abs = resolve(dirname(toml), pathVal);
        if (resolve(abs) === resolve(pkgDir)) {
          syncCount += 1;
          return `${pre}${newVersion}${post}`;
        }
        return full;
      },
    );
    // version before path order
    t = t.replace(
      /([A-Za-z0-9_-]+\s*=\s*\{[^}]*version\s*=\s*")([^"]+)("[^}]*path\s*=\s*"([^"]+)"[^}]*\})/g,
      (full, pre, _ver, mid, pathVal) => {
        const abs = resolve(dirname(toml), pathVal);
        if (resolve(abs) === resolve(pkgDir)) {
          // 避免重复计数：若已改过则 full 中 version 已是 newVersion
          if (_ver === oldVersion) {
            syncCount += 1;
            return `${pre}${newVersion}${mid}`;
          }
        }
        return full;
      },
    );
    if (t !== orig) {
      console.log(`  sync path dep version in ${relative(root, toml)}`);
      if (!dryRun) writeFileSync(toml, t, "utf8");
    }
  }

  console.log(
    dryRun
      ? `dry-run: 将 bump ${pkg.name} 并同步约 ${syncCount} 处 path version`
      : `done: bumped ${pkg.name}; path version refs updated where matched`,
  );
}

main();
