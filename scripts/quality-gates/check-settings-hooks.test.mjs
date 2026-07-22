#!/usr/bin/env node
/**
 * check-settings-hooks.test.mjs — L1 测试 for check-settings-hooks.mjs
 */
import { existsSync, readFileSync } from "fs";
import { join, dirname, normalize } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name); }
}

console.log("\ncheck-settings-hooks L1 tests");

// §1 脚本文件存在
const scriptPath = join(__dirname, "check-settings-hooks.mjs");
ok(existsSync(scriptPath), "check-settings-hooks.mjs 存在");

// §2 语法检查
try {
  execFileSync("node", ["--check", scriptPath], { timeout: 10000, stdio: "pipe" });
  ok(true, "node --check 通过");
} catch (e) {
  ok(false, "node --check: " + String(e.stderr || e.message).trim().split("\n").slice(-2).join("\n"));
}

// §3 脚本执行 — 正向（非零退出必须记失败，不可靠 summary 文本）
try {
  const out = execFileSync("node", [scriptPath], {
    cwd: join(__dirname, "..", ".."),
    encoding: "utf8",
    stdio: "pipe",
    timeout: 30000,
  });
  ok(out.includes("All settings commands pass"), "正向: 全部通过");
  ok(out.includes("ok  "), "正向: 输出包含测试结果");
  ok(!out.includes("FAIL"), "正向: 没有 FAIL 项");
} catch (e) {
  const output = String(e.stdout || e.stderr || e.message || "");
  ok(false, "正向: 执行失败 (exit non-zero): " + output.slice(-200));
}

// §4 源码: 引用
const src = readFileSync(scriptPath, "utf8");
ok(src.includes("settings.json"), "源码引用 settings.json");
ok(src.includes("process.exit(0)"), "源码成功退出");
ok(src.includes("process.exit(1)"), "源码失败退出");

// §5 阈值常量
ok(src.includes("NICE_MIN"), "阈值常量: NICE_MIN");
ok(src.includes("NICE_MAX"), "阈值常量: NICE_MAX");
ok(src.includes("TMO_MIN"),  "阈值常量: TMO_MIN");
ok(src.includes("TMO_MAX"),  "阈值常量: TMO_MAX");

// §6 检项覆盖（字符串检测各错误分支存在）
ok(src.includes("裸 node 命令"),          "检项: 裸 node 命令");
ok(src.includes("首尾空格"),              "检项: 首尾空格");
ok(src.includes("连续空格"),              "检项: 连续空格");
ok(src.includes("顺序错误"),              "检项: 顺序错误");
ok(src.includes("nice 值"),               "检项: nice 值范围");
ok(src.includes("timeout 值"),            "检项: timeout 值范围");
ok(src.includes("脚本路径不在 hooks"),    "检项: 路径校验");
ok(src.includes("扩展名非"),              "检项: 扩展名校验");
ok(src.includes("非预期 node 引用"),      "检项: 异常引用检测");
ok(src.includes("isSafeHooksPath"),       "检项: 路径 normalize 穿越防护");
ok(src.includes("fail-closed") || src.includes("failClosed"), "检项: fail-closed");
ok(src.includes("|| exit 2"),             "检项: exit 2 映射");

// §7 parseNiceTimeoutNode 函数
ok(src.includes("parseNiceTimeoutNode"), "函数: parseNiceTimeoutNode 存在");
ok(src.includes("return {"),             "函数: 返回结构体");
ok(src.includes("niceVal"),              "函数: niceVal 字段");
ok(src.includes("tmoVal"),               "函数: tmoVal 字段");
ok(src.includes("script:"),              "函数: script 字段");
ok(src.includes("failClosed"),           "函数: failClosed 字段");

// §8 正则单元测试 — nice/timeout 值范围 + 路径穿越 + fail-closed
{
  const HOOK_SCRIPT_RE = /^\.claude\/hooks\/[a-z][a-z0-9_.-]*\.(mjs|cjs)$/;

  const isSafeHooksPath = (script) => {
    if (!script || typeof script !== "string") return false;
    if (script.includes("\0")) return false;
    if (script.startsWith("/") || /^[A-Za-z]:/.test(script)) return false;
    const norm = normalize(script).replace(/\\/g, "/");
    if (!HOOK_SCRIPT_RE.test(norm)) return false;
    if (norm.split("/").includes("..")) return false;
    return true;
  };

  const parse = (cmd) => {
    const m = /^nice -n (\d+) timeout (\d+) node (.+?)( \|\| exit 2)?$/.exec(cmd);
    if (!m) return null;
    return {
      niceVal: parseInt(m[1], 10),
      tmoVal: parseInt(m[2], 10),
      script: m[3],
      failClosed: Boolean(m[4]),
    };
  };

  const NICE_MIN = 10, NICE_MAX = 19, TMO_MIN = 5, TMO_MAX = 60;

  const check = (cmd, { requireFailClosed = false } = {}) => {
    const p = parse(cmd);
    if (!p) return false;
    if (requireFailClosed !== p.failClosed) return false;
    return p.niceVal >= NICE_MIN && p.niceVal <= NICE_MAX
        && p.tmoVal  >= TMO_MIN  && p.tmoVal  <= TMO_MAX
        && isSafeHooksPath(p.script);
  };

  // 正确格式
  ok(check("nice -n 19 timeout 30 node .claude/hooks/x.mjs"),  "范围: nice=19,tmo=30 通过");
  ok(check("nice -n 10 timeout 30 node .claude/hooks/x.mjs"),  "范围: nice=10 (边界低) 通过");
  ok(check("nice -n 19 timeout 5 node .claude/hooks/x.mjs"),   "范围: tmo=5 (边界低) 通过");
  ok(check("nice -n 10 timeout 60 node .claude/hooks/x.mjs"),  "范围: tmo=60 (边界高) 通过");
  ok(check("nice -n 15 timeout 15 node .claude/hooks/x.cjs"),  "范围: .cjs 扩展名 通过");
  ok(
    check("nice -n 19 timeout 30 node .claude/hooks/x.mjs || exit 2", { requireFailClosed: true }),
    "范围: fail-closed 后缀 通过",
  );

  // 拒绝: nice 值越界
  ok(!check("nice -n 9 timeout 30 node .claude/hooks/x.mjs"),  "拒绝: nice=9 (<10)");
  ok(!check("nice -n 0 timeout 30 node .claude/hooks/x.mjs"),  "拒绝: nice=0 (正常优先级)");
  ok(!check("nice -n -5 timeout 30 node .claude/hooks/x.mjs"), "拒绝: nice=-5 (负值高优先级)");

  // 拒绝: timeout 值越界
  ok(!check("nice -n 19 timeout 3 node .claude/hooks/x.mjs"),  "拒绝: tmo=3 (<5)");
  ok(!check("nice -n 19 timeout 120 node .claude/hooks/x.mjs"),"拒绝: tmo=120 (>60)");
  ok(!check("nice -n 19 timeout 3600 node .claude/hooks/x.mjs"),"拒绝: tmo=3600 (无意义)");

  // 拒绝: 路径/扩展名
  ok(!check("nice -n 19 timeout 30 node scripts/other.mjs"),    "拒绝: 非 hooks 路径");
  ok(!check("nice -n 19 timeout 30 node .claude/hooks/x.js"),   "拒绝: .js 非 .mjs/.cjs");

  // 拒绝: 路径穿越（normalize 后逃逸 hooks）
  ok(!isSafeHooksPath(".claude/hooks/../outside.mjs"),          "拒绝: .. 逃逸 hooks");
  ok(!isSafeHooksPath(".claude/hooks/../../etc/passwd"),        "拒绝: 深层 .. 穿越");
  ok(!isSafeHooksPath("/abs/path.mjs"),                         "拒绝: 绝对路径");
  ok(!check("nice -n 19 timeout 30 node .claude/hooks/../outside.mjs"), "拒绝: 命令中的路径穿越");
  ok(isSafeHooksPath(".claude/hooks/pre-tool-check.mjs"),       "接受: 正常 hooks 路径");
}

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total\n`);
process.exit(fail > 0 ? 1 : 0);
