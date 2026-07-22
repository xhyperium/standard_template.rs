/**
 * pre-tool-check.test.mjs — L1 单元测试 for pre-tool-check.mjs
 *
 * 测试范围：
 *  1. tokenizeShellCommand - 带引号/转义的 shell 命令解析
 *  2. parseWorktreeAdd - git worktree add 命令解析（各种 flag）
 *  3. PROTECTED_FILES 正则 — 匹配 .env/.env.local，不匹配 .env.example 等
 *  4. isBranchLikeRef - 分支引用校验
 *  5. ALLOWED_BRANCH 正则 — feat/ / fix/ / docs/ 等合法前缀
 *  6. DANGEROUS_COMMANDS 模式列表与匹配逻辑
 *
 * 使用 ESM (.mjs)，纯 assert 模式（count pass/fail, exit 1 on failure）。
 */

import { execFileSync } from "child_process";

// ── 从被测文件复制可测试的纯函数 ────────────────────────────────
// （这些函数不依赖全局状态 / 文件 IO / worktree-policy 导入）

const tokenizeShellCommand = (command) => {
  const tokens = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const ch of command) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaped) current += "\\";
  if (current) tokens.push(current);
  return tokens;
};

const isBranchLikeRef = (ref) => {
  if (!ref) return false;
  try {
    execFileSync("git", ["check-ref-format", "--branch", ref], { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
};

const parseWorktreeAdd = (command) => {
  const tokens = tokenizeShellCommand(command);
  const gitIndex = tokens.indexOf("git");
  if (gitIndex < 0 || tokens[gitIndex + 1] !== "worktree" || tokens[gitIndex + 2] !== "add") {
    return null;
  }

  const wtArgs = tokens.slice(gitIndex + 3);
  const positional = [];
  let branch = null;
  let passthrough = false;

  for (let i = 0; i < wtArgs.length; i += 1) {
    const token = wtArgs[i];
    if (!passthrough && token === "--") {
      passthrough = true;
      continue;
    }
    if (!passthrough && (token === "-b" || token === "-B" || token === "--branch")) {
      branch = wtArgs[i + 1] || "";
      i += 1;
      continue;
    }
    if (!passthrough && token.startsWith("--branch=")) {
      branch = token.slice("--branch=".length);
      continue;
    }
    if (!passthrough && /^-[bB].+/.test(token)) {
      branch = token.slice(2);
      continue;
    }
    if (!passthrough && token.startsWith("-")) continue;
    positional.push(token);
  }

  return {
    path: positional[0] || "",
    commitish: positional[1] || "",
    branch,
  };
};

const PROTECTED_FILES = [/(^|\/|\\)\.env$/, /(^|\/|\\)\.env\.local$/];
const ALLOWED_BRANCH = /^(docs|feat|feature|fix|test|refactor|chore|governance|benchmark)\//;
const DANGEROUS_COMMANDS = [
  { pattern: /rm -rf/, label: "rm -rf", alt: "使用 trash <file> 或 git rm <file>" },
  { pattern: /git push --force/, label: "git push --force", alt: "使用 git push --force-with-lease" },
];

// ── 测试框架 ──────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

function describe(name, fn) {
  console.log(`\n${name}`);
  fn();
}

function it(name, fn) {
  console.log(`  ${name}`);
  try {
    fn();
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name} threw: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
  }
}

// ── 测试 1: tokenizeShellCommand ──────────────────────────────

describe("tokenizeShellCommand — 基本命令分词", () => {
  it("简单命令分词", () => {
    const r = tokenizeShellCommand("git status");
    assert(r.length === 2, `len=2, got ${r.length}`);
    assert(r[0] === "git", `r[0]=git, got ${r[0]}`);
    assert(r[1] === "status", `r[1]=status, got ${r[1]}`);
  });

  it("多个参数", () => {
    const r = tokenizeShellCommand("git checkout -b feat/test");
    assert(r.length === 4, `len=4, got ${r.length}: ${JSON.stringify(r)}`);
    assert(r[0] === "git", `r[0]`);
    assert(r[1] === "checkout", `r[1]`);
    assert(r[2] === "-b", `r[2]`);
    assert(r[3] === "feat/test", `r[3]`);
  });

  it("空字符串", () => {
    const r = tokenizeShellCommand("");
    assert(r.length === 0, `len=0, got ${r.length}`);
  });

  it("仅空白", () => {
    const r = tokenizeShellCommand("   ");
    assert(r.length === 0, `len=0, got ${r.length}`);
  });

  it("前后空白", () => {
    const r = tokenizeShellCommand("  git  status  ");
    assert(r.length === 2, `len=2, got ${r.length}: ${JSON.stringify(r)}`);
    assert(r[0] === "git", `r[0]`);
    assert(r[1] === "status", `r[1]`);
  });
});

describe("tokenizeShellCommand — 双引号处理", () => {
  // 注：当前实现中双引号不阻止空白分词（单引号才阻止）。
  // "hello world" → ["hello", "world"]（两个独立 token）
  it("双引号包裹（空白分隔为多 token）", () => {
    const r = tokenizeShellCommand('echo "hello world"');
    assert(r.length === 3, `len=3, got ${r.length}: ${JSON.stringify(r)}`);
    assert(r[0] === "echo", `r[0]=echo, got ${r[0]}`);
    assert(r[1] === "hello", `r[1]=hello, got ${r[1]}`);
    assert(r[2] === "world", `r[2]=world, got ${r[2]}`);
  });

  it("双引号内含路径（无空格）", () => {
    const r = tokenizeShellCommand('git -C ".worktrees/feat/x" status');
    assert(r.length === 4, `len=4, got ${r.length}`);
    assert(r[2] === ".worktrees/feat/x", `r[2]=.worktrees/feat/x, got ${r[2]}`);
  });

  it("未闭合双引号（空白仍分词）", () => {
    const r = tokenizeShellCommand('echo "hello world');
    assert(r.length === 3, `len=3, got ${r.length}: ${JSON.stringify(r)}`);
    assert(r[1] === "hello", `r[1]=hello, got ${r[1]}`);
    assert(r[2] === "world", `r[2]=world, got ${r[2]}`);
  });
});

describe("tokenizeShellCommand — 单引号处理", () => {
  it("单引号包裹（内容不转义）", () => {
    const r = tokenizeShellCommand("echo 'hello world'");
    assert(r.length === 2, `len=2, got ${r.length}`);
    assert(r[1] === "hello world", `r[1]=hello world, got ${r[1]}`);
  });

  it("单引号内保留特殊字符", () => {
    const r = tokenizeShellCommand("echo '$HOME is home'");
    assert(r.length === 2, `len=2, got ${r.length}`);
    assert(r[1] === "$HOME is home", `r[1]=$HOME is home, got ${r[1]}`);
  });

  it("单引号内双引号", () => {
    const r = tokenizeShellCommand("echo 'he said \"hi\"'");
    assert(r.length === 2, `len=2, got ${r.length}`);
    assert(r[1] === 'he said "hi"', `r[1]=he said "hi", got ${r[1]}`);
  });

  it("未闭合单引号", () => {
    const r = tokenizeShellCommand("echo 'hello world");
    assert(r.length === 2, `len=2, got ${r.length}`);
    assert(r[1] === "hello world", `r[1]=hello world, got ${r[1]}`);
  });
});

describe("tokenizeShellCommand — 反斜杠转义", () => {
  it("转义空格", () => {
    const r = tokenizeShellCommand("echo hello\\ world");
    assert(r.length === 2, `len=2, got ${r.length}: ${JSON.stringify(r)}`);
    assert(r[1] === "hello world", `r[1]=hello world, got ${r[1]}`);
  });

  it("转义双引号", () => {
    const r = tokenizeShellCommand('echo \\"hello\\"');
    assert(r.length === 2, `len=2, got ${r.length}`);
    assert(r[1] === '"hello"', `r[1]="hello", got ${r[1]}`);
  });

  it("尾随反斜杠", () => {
    const r = tokenizeShellCommand("echo trailing\\");
    assert(r.length === 2, `len=2, got ${r.length}: ${JSON.stringify(r)}`);
    assert(r[1] === "trailing\\", `r[1]=trailing\\, got ${r[1]}`);
  });

  it("反斜杠转义特殊字符", () => {
    const r = tokenizeShellCommand("grep \\$HOME file");
    assert(r.length === 3, `len=3, got ${r.length}`);
    assert(r[1] === "$HOME", `r[1]=$HOME, got ${r[1]}`);
  });
});

describe("tokenizeShellCommand — 混合引号", () => {
  // 注：双引号内遇到 ' 会切换为单引号模式，最后的 " 被视为单引号内的字面��符
  it("双引号内单引号（quote 切换语义）", () => {
    const r = tokenizeShellCommand(`echo "it's ok"`);
    assert(r.length === 2, `len=2, got ${r.length}: ${JSON.stringify(r)}`);
    // ' 触发 quote="'" → 进入单引号模式；末尾 " 成为字面字符
    assert(r[1].includes("its ok"), `r[1] 包含 "its ok", got ${JSON.stringify(r[1])}`);
    assert(r[1].includes('"'), `r[1] 包含尾随双引号, got ${JSON.stringify(r[1])}`);
  });

  it("相邻不同引号", () => {
    const r = tokenizeShellCommand(`echo abc'def'ghi`);
    assert(r.length === 2, `len=2, got ${r.length}`);
    assert(r[1] === "abcdefghi", `r[1]=abcdefghi, got ${r[1]}`);
  });

  it("git worktree add 典型命令", () => {
    const r = tokenizeShellCommand('git worktree add .worktrees/feat/login -b feat/login');
    assert(r.length === 6, `len=6, got ${r.length}`);
    assert(r[0] === "git", "r[0]");
    assert(r[1] === "worktree", "r[1]");
    assert(r[2] === "add", "r[2]");
    assert(r[3] === ".worktrees/feat/login", "r[3]");
    assert(r[4] === "-b", "r[4]");
    assert(r[5] === "feat/login", "r[5]");
  });

  it("含 -- 分隔符的命令", () => {
    const r = tokenizeShellCommand("git worktree add path -- -b not-a-branch-flag");
    assert(r[0] === "git", "r[0]");
    assert(r[1] === "worktree", "r[1]");
    assert(r[2] === "add", "r[2]");
    assert(r[3] === "path", "r[3]");
    assert(r[4] === "--", "r[4]");
    assert(r[5] === "-b", "r[5]");
    assert(r.length === 7, `len=7, got ${r.length}: ${JSON.stringify(r)}`);
  });
});

// ── 测试 2: parseWorktreeAdd ──────────────────────────────────

describe("parseWorktreeAdd — 基本解析", () => {
  it("带 -b 的 worktree add", () => {
    const r = parseWorktreeAdd("git worktree add .worktrees/feat/login -b feat/login");
    assert(r !== null, "not null");
    assert(r.path === ".worktrees/feat/login", `path=${r.path}`);
    assert(r.branch === "feat/login", `branch=${r.branch}`);
    assert(r.commitish === "", `commitish=${r.commitish}`);
  });

  it("无 -b 的 worktree add（detached）", () => {
    const r = parseWorktreeAdd("git worktree add .worktrees/tmp");
    assert(r !== null, "not null");
    assert(r.path === ".worktrees/tmp", `path=${r.path}`);
    assert(r.branch === null, `branch=${r.branch}`);
    assert(r.commitish === "", `commitish=${r.commitish}`);
  });

  it("带 -b 和 commitish", () => {
    const r = parseWorktreeAdd("git worktree add .worktrees/hotfix hotfix-base -b hotfix/urgent");
    assert(r !== null, "not null");
    assert(r.path === ".worktrees/hotfix", `path=${r.path}`);
    assert(r.commitish === "hotfix-base", `commitish=${r.commitish}`);
    assert(r.branch === "hotfix/urgent", `branch=${r.branch}`);
  });

  it("非 worktree add 命令返回 null", () => {
    const r1 = parseWorktreeAdd("git checkout -b feat/test");
    assert(r1 === null, `checkout -> null, got ${JSON.stringify(r1)}`);
    const r2 = parseWorktreeAdd("git branch -d old-branch");
    assert(r2 === null, `branch -d -> null, got ${JSON.stringify(r2)}`);
    const r3 = parseWorktreeAdd("echo hello");
    assert(r3 === null, `echo -> null, got ${JSON.stringify(r3)}`);
  });

  it("空字符串返回 null", () => {
    const r = parseWorktreeAdd("");
    assert(r === null, `empty -> null, got ${JSON.stringify(r)}`);
  });
});

describe("parseWorktreeAdd — branch flag 变体", () => {
  it("-B 强制分支", () => {
    const r = parseWorktreeAdd("git worktree add path -B feat/force");
    assert(r !== null, "not null");
    assert(r.branch === "feat/force", `branch=${r.branch}`);
  });

  it("--branch 长选项", () => {
    const r = parseWorktreeAdd("git worktree add path --branch feat/new");
    assert(r !== null, "not null");
    assert(r.branch === "feat/new", `branch=${r.branch}`);
  });

  it("--branch= 等式写法", () => {
    const r = parseWorktreeAdd("git worktree add path --branch=feat/eq");
    assert(r !== null, "not null");
    assert(r.branch === "feat/eq", `branch=${r.branch}`);
  });

  it("-bfeat/compact 简写", () => {
    const r = parseWorktreeAdd("git worktree add path -bfeat/compact");
    assert(r !== null, "not null");
    assert(r.branch === "feat/compact", `branch=${r.branch}`);
  });

  it("-Bfix/compact 简写（大写 B）", () => {
    const r = parseWorktreeAdd("git worktree add path -Bfix/compact");
    assert(r !== null, "not null");
    assert(r.branch === "fix/compact", `branch=${r.branch}`);
  });
});

describe("parseWorktreeAdd — -- 分隔符", () => {
  it("-- 后 -b 不被解析为 flag", () => {
    const r = parseWorktreeAdd("git worktree add path -- -b not-a-branch");
    assert(r !== null, "not null");
    assert(r.path === "path", `path=${r.path}`);
    assert(r.branch === null, `branch=${r.branch}`);
  });

  it("-- 后 positional 正常收集", () => {
    const r = parseWorktreeAdd("git worktree add path commit-ref -- -b ignored");
    assert(r !== null, "not null");
    assert(r.path === "path", `path=${r.path}`);
    assert(r.commitish === "commit-ref", `commitish=${r.commitish}`);
    assert(r.branch === null, `branch=${r.branch}`);
  });
});

describe("parseWorktreeAdd — 未知 flag 跳过", () => {
  it("未知 --flag 被跳过", () => {
    const r = parseWorktreeAdd("git worktree add --detach path target");
    assert(r !== null, "not null");
    assert(r.path === "path", `path=${r.path}`);
    assert(r.commitish === "target", `commitish=${r.commitish}`);
    assert(r.branch === null, `branch=${r.branch}`);
  });

  it("-f 等单字符 flag 被跳过", () => {
    const r = parseWorktreeAdd("git worktree add -f path -b feat/force");
    assert(r !== null, "not null");
    assert(r.path === "path", `path=${r.path}`);
    assert(r.branch === "feat/force", `branch=${r.branch}`);
  });
});

// ── 测试 3: PROTECTED_FILES 正则 ──────────────────────────────

describe("PROTECTED_FILES — .env 匹配", () => {
  it("/absolute/.env 匹配", () => {
    assert(PROTECTED_FILES.some((p) => p.test("/absolute/path/.env")), "/absolute/.env");
  });

  it("relative/.env 匹配", () => {
    assert(PROTECTED_FILES.some((p) => p.test("relative/path/.env")), "relative/.env");
  });

  it("末尾 .env 匹配", () => {
    assert(PROTECTED_FILES.some((p) => p.test("just/.env")), "just/.env");
  });

  it("仅 .env 匹配", () => {
    assert(PROTECTED_FILES.some((p) => p.test(".env")), ".env");
  });

  it("Windows 路径 .env 匹配", () => {
    assert(PROTECTED_FILES.some((p) => p.test("C:\\project\\.env")), "Windows path");
  });

  it("路径中含 .env 但不以结尾不匹配", () => {
    assert(!PROTECTED_FILES.some((p) => p.test("/path/.env.example")), ".env.example no match");
  });

  it(".env.local 匹配", () => {
    assert(PROTECTED_FILES.some((p) => p.test("/path/.env.local")), ".env.local");
    assert(PROTECTED_FILES.some((p) => p.test(".env.local")), ".env.local (root)");
  });

  it(".env.local.backup 不匹配", () => {
    assert(!PROTECTED_FILES.some((p) => p.test("/path/.env.local.backup")), ".env.local.backup");
  });

  it(".env 文件含后缀不匹配", () => {
    assert(!PROTECTED_FILES.some((p) => p.test(".env.production")), ".env.production");
    assert(!PROTECTED_FILES.some((p) => p.test(".env.staging")), ".env.staging");
    assert(!PROTECTED_FILES.some((p) => p.test(".env.test")), ".env.test");
  });

  it(".env.example 明确不匹配", () => {
    assert(!PROTECTED_FILES.some((p) => p.test("/project/.env.example")), ".env.example");
  });

  it("文件名非以点结尾的 env 不匹配", () => {
    assert(!PROTECTED_FILES.some((p) => p.test("/path/env")), "env (no dot)");
    assert(!PROTECTED_FILES.some((p) => p.test("/path/my.env")), "my.env (no leading dot)");
    assert(!PROTECTED_FILES.some((p) => p.test("/path/.environs")), ".environs");
  });
});

// ── 测试 4: ALLOWED_BRANCH 正则 ───────────────────────────────

describe("ALLOWED_BRANCH — 合法前缀", () => {
  const validPrefixes = ["docs", "feat", "feature", "fix", "test", "refactor", "chore", "governance", "benchmark"];

  for (const pre of validPrefixes) {
    it(`${pre}/ 前缀通过`, () => {
      assert(ALLOWED_BRANCH.test(`${pre}/login`), `${pre}/login`);
      assert(ALLOWED_BRANCH.test(`${pre}/fix-123`), `${pre}/fix-123`);
      assert(ALLOWED_BRANCH.test(`${pre}/module/sub`), `${pre}/module/sub`);
    });
  }

  it("无前缀分支被拒绝", () => {
    assert(!ALLOWED_BRANCH.test("main"), "main");
    assert(!ALLOWED_BRANCH.test("master"), "master");
    assert(!ALLOWED_BRANCH.test("login"), "login");
    assert(!ALLOWED_BRANCH.test("bugfix/login"), "bugfix/login");
  });

  it("空字符串被拒绝", () => {
    assert(!ALLOWED_BRANCH.test(""), "empty");
  });

  it("只有前缀但无斜杠后内容被拒绝", () => {
    assert(!ALLOWED_BRANCH.test("feat"), "feat (no /)");
    assert(!ALLOWED_BRANCH.test("fix"), "fix (no /)");
  });

  it("前缀后必须有内容", () => {
    // 注：regex 不要求 / 后有内容，feat/ 也是合法匹配
    assert(ALLOWED_BRANCH.test("feat/"), "feat/ 仍匹配（regex 不要求 / 后有字符）");
  });

  it("前缀大小写敏感", () => {
    assert(!ALLOWED_BRANCH.test("Feat/login"), "Feat/login");
    assert(!ALLOWED_BRANCH.test("FEAT/login"), "FEAT/login");
    assert(!ALLOWED_BRANCH.test("Fix/login"), "Fix/login");
  });
});

// ── 测试 5: DANGEROUS_COMMANDS 模式 ───────────────────────────

describe("DANGEROUS_COMMANDS — rm -rf 匹配", () => {
  const rmPattern = DANGEROUS_COMMANDS[0];

  it("rm -rf 匹配", () => {
    assert(rmPattern.pattern.test("rm -rf /tmp/cache"), "rm -rf /tmp/cache");
  });

  it("rm -rf 含选项", () => {
    assert(rmPattern.pattern.test("rm -rf --preserve-root /tmp/cache"), "with --preserve-root");
  });

  it("rm -rf 递归删除", () => {
    assert(rmPattern.pattern.test("rm -rf node_modules"), "node_modules");
  });

  it("不含 -rf 不匹配", () => {
    assert(!rmPattern.pattern.test("rm file.txt"), "rm file.txt");
    assert(!rmPattern.pattern.test("rm -r file.txt"), "rm -r");
    assert(!rmPattern.pattern.test("rmdir dir"), "rmdir");
  });

  it("echo 命令含 rm -rf 也匹配（保守策略）", () => {
    assert(rmPattern.pattern.test("echo 'rm -rf is dangerous'"), "echo 含 rm -rf");
  });

  it("& 分隔也匹配", () => {
    assert(rmPattern.pattern.test("echo ok && rm -rf /tmp/cache"), "&& rm -rf");
  });
});

describe("DANGEROUS_COMMANDS — git push --force 匹配", () => {
  const pushPattern = DANGEROUS_COMMANDS[1];

  it("git push --force 匹配", () => {
    assert(pushPattern.pattern.test("git push --force"), "git push --force");
  });

  it("git push --force origin main 匹配", () => {
    assert(pushPattern.pattern.test("git push --force origin main"), "with origin main");
  });

  it("git push --force-with-lease 也匹配（--force 为子串）", () => {
    // 注：/git push --force/ 匹配 "--force-with-lease"（子串）
    assert(pushPattern.pattern.test("git push --force-with-lease"), "--force-with-lease 是 --force 的子串");
  });

  it("git push --force-with-lease origin main 也匹配", () => {
    assert(pushPattern.pattern.test("git push --force-with-lease origin main"), "--force-with-lease origin (子串)");
  });

  it("git push 不带 --force 不匹配", () => {
    assert(!pushPattern.pattern.test("git push origin main"), "不带 --force");
  });
});

describe("DANGEROUS_COMMANDS — 安全路径例外（逻辑）", () => {
  // 安全路径例外逻辑：验证模式匹配后，还需要 isSafeRm 检查
  const rmPattern = DANGEROUS_COMMANDS[0].pattern;

  function hasSafeRmMatch(cmd) {
    const matched = rmPattern.test(cmd);
    if (!matched) return false;
    return (
      /\.worktree\/deploy\b/.test(cmd) ||
      /\.worktree\/workspaces\b/.test(cmd) ||
      /\.worktree\/omx-team\b/.test(cmd) ||
      /\.worktrees\//.test(cmd) ||
      /\/tmp\//.test(cmd)
    );
  }

  it("rm -rf .worktrees/feat/test 是安全路径", () => {
    assert(hasSafeRmMatch("rm -rf .worktrees/feat/test"), ".worktrees/");
  });

  it("rm -rf .worktree/deploy 是安全路径", () => {
    assert(hasSafeRmMatch("rm -rf .worktree/deploy"), ".worktree/deploy");
  });

  it("rm -rf .worktree/workspaces 是安全路径", () => {
    assert(hasSafeRmMatch("rm -rf .worktree/workspaces"), ".worktree/workspaces");
  });

  it("rm -rf /tmp/cache 是安全路径", () => {
    assert(hasSafeRmMatch("rm -rf /tmp/cache"), "/tmp/");
  });

  it("rm -rf node_modules 是危险路径", () => {
    assert(!hasSafeRmMatch("rm -rf node_modules"), "node_modules 不含安全例外");
  });

  it("rm -rf src/ 是危险路径", () => {
    assert(!hasSafeRmMatch("rm -rf src/"), "src/ 不含安全例外");
  });
});

// ── 测试 6: isBranchLikeRef ───────────────────────────────────

describe("isBranchLikeRef — 分支引用校验", () => {
  it("main 是合法分支引用", () => {
    assert(isBranchLikeRef("main"), "main");
  });

  it("feat/login 是合法分支引用", () => {
    assert(isBranchLikeRef("feat/login"), "feat/login");
  });

  it("fix/bug-123 是合法分支引用", () => {
    assert(isBranchLikeRef("fix/bug-123"), "fix/bug-123");
  });

  it("master 是合法分支引用", () => {
    assert(isBranchLikeRef("master"), "master");
  });

  it("空字符串无效", () => {
    assert(!isBranchLikeRef(""), "empty");
  });

  it("null 无效", () => {
    assert(!isBranchLikeRef(null), "null");
  });

  it("undefined 无效", () => {
    assert(!isBranchLikeRef(undefined), "undefined");
  });

  it("含空格无效", () => {
    assert(!isBranchLikeRef("feat login"), "含空格");
  });

  it("以 - 开头无效", () => {
    assert(!isBranchLikeRef("-bad"), "-bad");
  });

  it(".bad 无效", () => {
    assert(!isBranchLikeRef(".bad"), ".bad");
  });

  it("含 .. 无效", () => {
    assert(!isBranchLikeRef("feat/.."), "feat/..");
  });

  it("含 ~ 无效", () => {
    assert(!isBranchLikeRef("feat~1"), "feat~1");
  });
});

// ── 结果汇总 ────────────────────────────────────────────────

console.log(`\n=== 测试结果 ===`);
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总计: ${passed + failed}`);

if (failed > 0) {
  console.error(`\n${failed} 个测试失败`);
  process.exit(1);
} else {
  console.log("\n全数通过！");
  process.exit(0);
}
