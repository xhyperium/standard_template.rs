#!/usr/bin/env node
/**
 * Git hook 组合健康检查。
 *
 * 只做静态、无副作用检查，避免 Harness 健康检查实际触发 push 通知或外部服务。
 */
import { existsSync } from "fs";

const BEADS_BEGIN = "--- BEGIN BEADS INTEGRATION";

/** 提取 `source` / `.` 后不含变量的字面量路径。 */
export function literalSourceTargets(script) {
    const targets = [];
    for (const line of script.split("\n")) {
        // `source /optional || source /fallback` 是显式降级链，不把单个缺失项判为坏引用。
        if (line.includes("||")) continue;
        const match = line.match(
            /^\s*(?:source|\.)\s+(?:"([^"]+)"|'([^']+)'|([^\s#;&|]+))/,
        );
        const target = match?.[1] || match?.[2] || match?.[3] || "";
        if (!target || /[$`]/.test(target)) continue;
        targets.push(target);
    }
    return targets;
}

/** 顶层独立 `exit 0`；忽略常见 shell 条件、循环、case 与函数块。 */
export function standaloneExitZeroLines(script) {
    const exits = [];
    let depth = 0;
    for (const [index, line] of script.split("\n").entries()) {
        const text = line.trim();
        if (/^(?:fi|done|esac|})\b/.test(text) || text === "}") {
            depth = Math.max(0, depth - 1);
        }
        if (depth === 0 && /^exit\s+0\s*(?:#.*)?$/.test(text)) {
            exits.push({ line: index + 1, text: line });
        }
        if (
            /^(?:if|for|while|until|select)\b.*(?:;\s*)?(?:then|do)\s*$/.test(
                text,
            ) ||
            /^case\b.*\bin\s*$/.test(text) ||
            /^(?:function\s+)?[A-Za-z_][A-Za-z0-9_]*\s*\(\)\s*{\s*$/.test(text)
        ) {
            depth += 1;
        }
    }
    return exits;
}

/**
 * 检查活动 pre-push hook 的失效字面量引用，以及 Beads managed block 前的
 * 独立 `exit 0`。
 */
export function inspectPrePushHook(script, { sourceExists = existsSync } = {}) {
    const lines = script.split("\n");
    const beadsIndex = lines.findIndex((line) => line.includes(BEADS_BEGIN));
    const missingSources = literalSourceTargets(script).filter(
        (target) => target.startsWith("/") && !sourceExists(target),
    );
    const earlyExitZeroLines = standaloneExitZeroLines(
        beadsIndex >= 0 ? lines.slice(0, beadsIndex).join("\n") : "",
    );

    return {
        ok: missingSources.length === 0 && earlyExitZeroLines.length === 0,
        hasBeadsIntegration: beadsIndex >= 0,
        missingSources,
        earlyExitZeroLines: earlyExitZeroLines.map(({ line }) => line),
    };
}

/** 生成适合 Harness 输出的中文失败原因。 */
export function describePrePushHookFailure(result) {
    const reasons = [];
    if (result.missingSources.length > 0) {
        reasons.push(`缺失 source: ${result.missingSources.join(", ")}`);
    }
    if (result.earlyExitZeroLines.length > 0) {
        reasons.push(
            `Beads block 前存在独立 exit 0（行 ${result.earlyExitZeroLines.join(", ")}）`,
        );
    }
    return reasons.join("；");
}
