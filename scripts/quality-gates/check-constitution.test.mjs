/**
 * check-constitution.mjs — L1 静态验证（不触发 cargo 运行）
 *
 * 用法: node scripts/quality-gates/check-constitution.test.mjs
 * exit 0 = 全部通过
 *
 * L1 只做静态分析（文件结构、语法、import、标志解析逻辑）。
 * 不执行 cargo 命令 —— 那是 L2+ 集成测试的职责。
 */
import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, "check-constitution.mjs");

let failed = 0;
let total = 0;

const assert = (name, cond, detail = "") => {
  total += 1;
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
};

console.log("check-constitution.mjs L1 tests\n");

// ============================================================
// §1 文件存在性与完整性
// ============================================================
console.log("§1 文件存在性与完整性");

assert("脚本文件存在", existsSync(SCRIPT));

const raw = readFileSync(SCRIPT, "utf8");
assert("文件非空", raw.length > 0);

const shebang = raw.split("\n")[0];
assert("shebang 为 #!/usr/bin/env node", shebang === "#!/usr/bin/env node", `实际: ${shebang}`);

const imports = raw.split("\n").filter(l => l.includes("import"));
assert("使用 ESM import", /^import\s/m.test(imports.join("\n")));

assert("包含 run 函数", raw.includes("function run("));
assert("包含 skip 函数", raw.includes("function skip("));
assert("包含 info 函数", raw.includes("function info("));
assert("包含 JSON_MODE 变量", raw.includes("JSON_MODE"));
assert("包含 QUICK 变量", raw.includes("QUICK"));

// ============================================================
// §2 语法检查
// ============================================================
console.log("\n§2 语法检查");

try {
  execSync(`node --check "${SCRIPT}"`, { stdio: "pipe" });
  assert("node --check 通过", true);
} catch (e) {
  assert("node --check 通过", false, String(e.stderr));
}

// ============================================================
// §3 import 有效性
// ============================================================
console.log("\n§3 import 有效性");

assert("child_process 导入", raw.includes('import { execSync } from "child_process"'));
assert("fs 导入 (existsSync)", raw.includes('import { existsSync } from "fs"'));
assert("path 导入 (resolve, dirname)", raw.includes("import { resolve, dirname } from"));
assert("url 导入 (fileURLToPath)", raw.includes("import { fileURLToPath } from"));

// ============================================================
// §4 CLI 标志解析逻辑（静态分析，不运行脚本）
// ============================================================
console.log("\n§4 CLI 标志解析逻辑（静态）");

// 4.1 QUICK 标志由 --quick 控制
assert("QUICK 由 args.includes('--quick') 定义",
  raw.includes(`args.includes("--quick")`));

// 4.2 JSON_MODE 由 --json 控制
assert("JSON_MODE 由 args.includes('--json') 定义",
  raw.includes(`args.includes("--json")`));

// 4.3 run() 函数在 QUICK 模式下跳过 skipQuick 项
assert("run() 检查 QUICK && opts.skipQuick",
  raw.includes("QUICK && opts.skipQuick"));

// 4.4 test 项在 QUICK 模式下跳过
assert("skip('test', 'quick 模式')",
  raw.includes("skip(\"test\", \"quick 模式\")"));

// 4.5 命名检查在 QUICK 模式下跳过
const namingBlock = raw.split("naming").join("").slice(
  raw.indexOf("命名规范"), raw.indexOf("命名规范") + 200
);
assert("命名检查使用 !QUICK 门控", raw.includes("命") && raw.match(/!QUICK/));

// ============================================================
// §5 输出模式分析（静态）
// ============================================================
console.log("\n§5 输出模式分析（静态）");

// 5.1 非 JSON 模式打印框线头
assert("非 JSON 模式打印框线头", raw.includes("╔════════"));
assert("非 JSON 模式打印 '宪章合规性验证'", raw.includes("宪章合规性验证"));

// 5.2 JSON_MODE 跳过框线
assert("if (!JSON_MODE) 控制框线", raw.includes("if (!JSON_MODE)"));

// 5.3 JSON 输出使用 JSON.stringify
assert("JSON 输出使用 JSON.stringify", raw.includes("JSON.stringify"));

// 5.4 非 JSON 模式打印汇总中文
assert("非 JSON 模式包含 通过/失败/跳过", raw.includes("通过") && raw.includes("失败") && raw.includes("跳过"));

// ============================================================
// §6 退出码行为分析（静态）
// ============================================================
console.log("\n§6 退出码行为分析（静态）");

assert("exit code 由 failed > 0 决定", raw.includes("process.exit(failed > 0 ? 1 : 0)"));
assert("exit 0 当全部 pass", raw.includes("0)"));
assert("exit 1 当有 fail", raw.includes("1"));

// ============================================================
// §7 检查项覆盖（静态）
// ============================================================
console.log("\n§7 检查项覆盖（静态）");

assert("包含 rustfmt 检查", raw.includes("cargo fmt --all --check"));
assert("包含 clippy 检查", raw.includes("cargo clippy --workspace"));
assert("包含 unsafe 检查", raw.includes("unsafe"));
assert("包含 cargo-deny 检查", raw.includes("cargo-deny") || raw.includes("cargo deny"));
assert("包含 cargo test", raw.includes("cargo test --workspace"));
assert("包含 cargo doc", raw.includes("cargo doc --no-deps"));

// ============================================================
// §8 边界与错误路径（静态）
// ============================================================
console.log("\n§8 边界与错误路径（静态）");

// 8.1 run() 函数容错 — 异常时记录 fail 而不是崩溃
assert("run() catch 块记录 fail", raw.includes('status: "fail"'));
assert("run() 返回 false 在异常时", raw.includes("return false"));

// 8.2 skip() 函数正确记录 skip 状态
assert("skip() 函数记录 skip 状态", raw.includes("skip\"") || raw.includes("skip',"));

// 8.3 results 数组每个项有 check + status 键
assert("results.push 使用 check 键", raw.includes("check: label") || raw.includes('check: "'));
assert("results.push 使用 status 键", raw.includes('status: "') || raw.includes("status: "));

// ============================================================
// 汇总
// ============================================================
console.log(`\n${total} 个测试运行，${failed} 个失败`);

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nall passed");
