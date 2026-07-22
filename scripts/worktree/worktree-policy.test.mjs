/**
 * worktree-policy 单元自检（无外部依赖）
 *
 * 用法: node scripts/worktree/worktree-policy.test.mjs
 * exit 0 = 全部通过
 */
import {
  WORKTREE_PATH_RULE,
  bareBranch,
  canonicalWorktreePath,
  worktreeBasePath,
  isPathInside,
  isMainWorkspaceTopLevel,
  evaluateEditPath,
  evaluateMainWorkspaceGitCommand,
  evaluateCommitOnMain,
  isWorktreeBypassEnabled,
  describeBranchWorktreePath,
  resolveMainProjectRoot,
} from "./worktree-policy.mjs";

const root = "/repo/infra.rs";
let failed = 0;

const assert = (name, cond, detail = "") => {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
};

console.log("worktree-policy tests");

assert("WORKTREE_PATH_RULE", WORKTREE_PATH_RULE === ".worktrees/<branch-name>");
assert("bareBranch strips refs", bareBranch("refs/heads/feat/x") === "feat/x");
assert(
  "canonicalWorktreePath",
  canonicalWorktreePath(root, "feat/a-b") === `${root}/.worktrees/feat/a-b`,
);
assert("worktreeBasePath", worktreeBasePath(root) === `${root}/.worktrees`);
assert("isPathInside child", isPathInside(`${root}/.worktrees/feat/x`, `${root}/.worktrees`));
assert("isPathInside self", isPathInside(root, root));
assert("isPathInside outside", !isPathInside("/tmp/x", root));
assert("isMainWorkspaceTopLevel true", isMainWorkspaceTopLevel(root, root));
assert(
  "isMainWorkspaceTopLevel false",
  !isMainWorkspaceTopLevel(root, `${root}/.worktrees/feat/x`),
);
assert(
  "resolveMainProjectRoot from worktree hooks path",
  resolveMainProjectRoot(`${root}/.worktrees/feat/x/.claude/hooks`) === root,
);
assert(
  "resolveMainProjectRoot from main",
  resolveMainProjectRoot(`${root}/.claude/hooks`) === `${root}/.claude/hooks` ||
    resolveMainProjectRoot(root) === root,
);
assert("resolveMainProjectRoot main root", resolveMainProjectRoot(root) === root);

// evaluateEditPath
{
  const notIgnored = () => false;
  const yesIgnored = () => true;

  const denyMain = evaluateEditPath({
    projectRoot: root,
    filePath: `${root}/crates/foo/src/lib.rs`,
    isIgnored: notIgnored,
  });
  assert("deny main checkout edit", !denyMain.allowed, denyMain.reason);

  const denyRelative = evaluateEditPath({
    projectRoot: root,
    filePath: "CLAUDE.md",
    isIgnored: notIgnored,
  });
  assert("deny relative main path", !denyRelative.allowed);

  const allowWt = evaluateEditPath({
    projectRoot: root,
    filePath: `${root}/.worktrees/feat/x/CLAUDE.md`,
    isIgnored: notIgnored,
  });
  assert("allow worktree path", allowWt.allowed);

  const allowOutside = evaluateEditPath({
    projectRoot: root,
    filePath: "/tmp/scratch.txt",
    isIgnored: notIgnored,
  });
  assert("allow outside repo", allowOutside.allowed);

  const allowBypass = evaluateEditPath({
    projectRoot: root,
    filePath: "CLAUDE.md",
    bypass: true,
  });
  assert("allow with bypass", allowBypass.allowed);

  const allowGitignored = evaluateEditPath({
    projectRoot: root,
    filePath: `${root}/.beads/issues.jsonl`,
    isIgnored: yesIgnored,
  });
  assert(
    "allow gitignored path",
    allowGitignored.allowed && allowGitignored.reason === "gitignored",
  );

  const denyTrackedDespiteCallback = evaluateEditPath({
    projectRoot: root,
    filePath: `${root}/README.md`,
    isIgnored: notIgnored,
  });
  assert("deny tracked path when not ignored", !denyTrackedDespiteCallback.allowed);
}

// evaluateMainWorkspaceGitCommand
{
  assert(
    "block checkout -b",
    evaluateMainWorkspaceGitCommand("git checkout -b feat/x").blocked,
  );
  assert(
    "block switch -c",
    evaluateMainWorkspaceGitCommand("git switch -c fix/y").blocked,
  );
  assert(
    "block switch feature",
    evaluateMainWorkspaceGitCommand("git switch feat/x").blocked,
  );
  assert(
    "allow switch main",
    !evaluateMainWorkspaceGitCommand("git switch main").blocked,
  );
  assert(
    "allow worktree add",
    !evaluateMainWorkspaceGitCommand(
      "git worktree add .worktrees/feat/x -b feat/x origin/main",
    ).blocked,
  );
  assert(
    "allow status",
    !evaluateMainWorkspaceGitCommand("git status -sb").blocked,
  );
}

// evaluateCommitOnMain
{
  assert(
    "block commit on main",
    evaluateCommitOnMain("main", "git commit -m 'x'").blocked,
  );
  assert(
    "allow commit on feature",
    !evaluateCommitOnMain("feat/x", "git commit -m 'x'").blocked,
  );
}

// bypass env
assert("bypass off", !isWorktreeBypassEnabled({}));
assert("bypass on", isWorktreeBypassEnabled({ INFRA_WORKTREE_BYPASS: "1" }));

// describeBranchWorktreePath
{
  const d = describeBranchWorktreePath({
    root,
    branchName: "feat/x",
    actualPath: `${root}/.worktrees/feat/x`,
  });
  assert("compliant path", d.compliant);
  const bad = describeBranchWorktreePath({
    root,
    branchName: "feat/x",
    actualPath: root,
  });
  assert("root is not compliant feature path", !bad.compliant && bad.isRootCheckout);
}

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nall passed");
