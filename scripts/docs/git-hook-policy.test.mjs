/** Git hook 组合健康检查单元测试（无外部依赖）。 */
import {
    describePrePushHookFailure,
    inspectPrePushHook,
    literalSourceTargets,
    standaloneExitZeroLines,
} from "./git-hook-policy.mjs";

let failed = 0;
const assert = (name, condition, detail = "") => {
    if (condition) {
        console.log(`  ok  ${name}`);
    } else {
        failed += 1;
        console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    }
};

console.log("git-hook-policy tests");

const broken = `#!/bin/bash
source "/opt/notify.sh"
# infra.rs pr-flow validation
source "/repo/infra.rs/.claude/pr-flow/pre-push.sh"
exit 0
# --- BEGIN BEADS INTEGRATION v0.57.0 ---
bd hooks run pre-push "$@"
# --- END BEADS INTEGRATION ---`;

const brokenResult = inspectPrePushHook(broken, {
    sourceExists: (target) => target === "/opt/notify.sh",
});
assert("坏 fixture 被拒绝", !brokenResult.ok);
assert(
    "报告缺失 pr-flow source",
    brokenResult.missingSources.length === 1 &&
        brokenResult.missingSources[0].endsWith("/.claude/pr-flow/pre-push.sh"),
);
assert(
    "报告 Beads 前独立 exit 0",
    brokenResult.earlyExitZeroLines.length === 1,
);
assert(
    "失败说明包含两类根因",
    describePrePushHookFailure(brokenResult).includes("缺失 source") &&
        describePrePushHookFailure(brokenResult).includes("Beads block 前"),
);

const healthy = `#!/bin/bash
source "/opt/notify.sh"
# --- BEGIN BEADS INTEGRATION v0.57.0 ---
bd hooks run pre-push "$@"
# --- END BEADS INTEGRATION ---`;
const healthyResult = inspectPrePushHook(healthy, {
    sourceExists: (target) => target === "/opt/notify.sh",
});
assert("健康组合通过", healthyResult.ok);
assert("识别 Beads integration", healthyResult.hasBeadsIntegration);

const conditional = `source "$HOME/.claude/notify.sh" 2>/dev/null || exit 0
# --- BEGIN BEADS INTEGRATION v0.57.0 ---`;
assert("忽略动态 source", literalSourceTargets(conditional).length === 0);
assert(
    "不把同行条件退出当独立退出",
    standaloneExitZeroLines(conditional).length === 0,
);

const optionalFallback = `source "/optional/missing.sh" || source "$HOME/fallback.sh"
# --- BEGIN BEADS INTEGRATION v0.57.0 ---`;
assert(
    "不把显式 source fallback 的单个缺失项当坏引用",
    inspectPrePushHook(optionalFallback, { sourceExists: () => false }).ok,
);

const conditionalBlock = `if test -z "$TOKEN"; then
  exit 0
fi
while read line; do
  test -n "$line" || exit 0
done
notify() {
  exit 0
}`;
assert(
    "不把条件、循环或函数内退出当顶层退出",
    standaloneExitZeroLines(conditionalBlock).length === 0,
);

if (failed > 0) {
    console.error(`\n${failed} test(s) failed`);
    process.exit(1);
}
console.log("\nall passed");
