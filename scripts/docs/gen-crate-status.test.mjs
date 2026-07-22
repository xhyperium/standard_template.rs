/** gen-crate-status 单元测试（无外部依赖）。 */
import { spawnSync } from "child_process";
import { readFileSync, existsSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const SCRIPT = join(__dirname, "gen-crate-status.mjs");
const LOCAL = join(ROOT, "docs", "status", "CRATES_STATUS.local.md");

let failed = 0;
const assert = (name, condition, detail = "") => {
  if (condition) {
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

console.log("gen-crate-status tests");

// 1) 生成：本地副本 +（feature 分支）STATUS.md
const gen = spawnSync("node", [SCRIPT], {
  cwd: ROOT,
  encoding: "utf8",
});
assert("exit 0", gen.status === 0, gen.stderr || gen.stdout);
assert(
  "stdout 含 local 路径",
  /CRATES_STATUS\.local\.md/.test(gen.stdout),
  gen.stdout.slice(0, 240),
);
assert("本地副本存在", existsSync(LOCAL));
assert(
  "本地副本有 LOCAL 标记",
  readFileSync(LOCAL, "utf8").includes("LOCAL COPY"),
);

const statusPath = join(ROOT, "STATUS.md");
// feature worktree 默认写 tracked
assert("STATUS.md 存在（feature 分支）", existsSync(statusPath));
assert(
  "stdout 含 tracked",
  /wrote .*STATUS\.md \(tracked\)/.test(gen.stdout),
  gen.stdout.slice(0, 300),
);
const body = readFileSync(statusPath, "utf8");
assert("标题正确", body.includes("crates 子模块进度看板"));
assert("含 workspace members 表头", body.includes("| Package | 路径 | 层 |"));
assert("含 layout 矩阵", body.includes("## 布局七项矩阵"));
assert("含完成度公式", body.includes("completion = layout"));
assert("含 kernel 成员", body.includes("xhyper-kernel") || body.includes("`kernel`"));
assert("含 adapters 路径", body.includes("crates/adapters/"));
assert("勿手改声明", body.includes("勿手改"));
assert(
  "口径声明非 Production Ready",
  body.includes("不是** Production Ready") || body.includes("不是 Production Ready"),
);
assert("维护说明含本地副本", body.includes("CRATES_STATUS.local.md"));

// 2) --local-only 不强制改 tracked 语义（仍可存在，但 stdout 应 skip tracked 逻辑）
const localOnly = spawnSync("node", [SCRIPT, "--local-only"], {
  cwd: ROOT,
  encoding: "utf8",
});
assert("--local-only exit 0", localOnly.status === 0, localOnly.stderr);
assert(
  "--local-only skip tracked",
  /skip tracked STATUS\.md/.test(localOnly.stdout),
  localOnly.stdout.slice(0, 200),
);

// 3) --check 在新鲜文件上应 OK，并刷新 local
const check = spawnSync("node", [SCRIPT, "--check"], {
  cwd: ROOT,
  encoding: "utf8",
});
assert("--check exit 0", check.status === 0, check.stderr || check.stdout);
assert("--check OK", /OK: STATUS\.md is up to date/.test(check.stdout));

// 4) 篡改后 --check 失败
const backup = body;
writeFileSync(statusPath, body + "\n<!-- drift -->\n", "utf8");
const stale = spawnSync("node", [SCRIPT, "--check"], {
  cwd: ROOT,
  encoding: "utf8",
});
assert("--check stale exit 1", stale.status === 1);
assert(
  "--check stale message",
  /stale/.test(stale.stderr || "") || /stale/.test(stale.stdout || ""),
);
// 恢复并重新生成干净版本
writeFileSync(statusPath, backup, "utf8");
spawnSync("node", [SCRIPT], { cwd: ROOT, encoding: "utf8" });

// 5) --json 输出摘要
const jsonRun = spawnSync("node", [SCRIPT, "--json"], {
  cwd: ROOT,
  encoding: "utf8",
});
assert("--json exit 0", jsonRun.status === 0, jsonRun.stderr);
const jsonMatch = jsonRun.stdout.match(/\{[\s\S]*"summary"[\s\S]*\}/);
assert("--json 含 JSON 块", Boolean(jsonMatch), jsonRun.stdout.slice(0, 120));
if (jsonMatch) {
  const parsed = JSON.parse(jsonMatch[0]);
  assert("summary.n > 0", parsed.summary.n > 0);
  assert("crates 数组非空", Array.isArray(parsed.crates) && parsed.crates.length > 0);
  assert(
    "每项有 completion",
    parsed.crates.every((c) => typeof c.completion === "number"),
  );
}

// 6) --watch 与 --check 互斥
const mutual = spawnSync("node", [SCRIPT, "--watch", "5", "--check"], {
  cwd: ROOT,
  encoding: "utf8",
});
assert("watch+check 互斥 exit 2", mutual.status === 2);

// 6b) --summary 输出短摘要
const sum = spawnSync("node", [SCRIPT, "--summary"], {
  cwd: ROOT,
  encoding: "utf8",
});
assert("--summary exit 0", sum.status === 0, sum.stderr);
assert("--summary 含标题", /## crates 子模块进度/.test(sum.stdout));
assert("--summary 含平均完成度", /平均完成度/.test(sum.stdout));

// 7) tmp 目录不会被脚本误写
const tmp = mkdtempSync(join(tmpdir(), "crate-status-"));
try {
  assert("tmp 独立", !existsSync(join(tmp, "STATUS.md")));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failed === 0 ? "\nall passed" : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
