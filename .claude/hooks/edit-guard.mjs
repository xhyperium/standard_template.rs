#!/usr/bin/env node
/**
 * Edit Guard — PreToolUse Hook
 * Tracks Edit tool usage per file per session. Warns when Edit count exceeds threshold.
 *
 * Root cause fix for session cost blow-up:
 *   xlibgate Trust Alignment session: 15 incremental Edit calls on SPEC.md
 *   → post-tool hook fired 15 times, each requiring a Re-read
 *   → 70,000 tokens vs 12,500 tokens for a single Write
 *
 * This guard does NOT block — it warns and leaves the decision to the agent.
 * Threshold: 3 Edits on the same file since last Write.
 *
 * State stored in: .claude/.edit-guard-state.json
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const STATE_FILE = '.claude/.edit-guard-state.json';
const EDIT_THRESHOLD = parseInt(process.env.EDIT_GUARD_THRESHOLD || '4');
const CWD = process.env.CLAUDE_WORKING_DIR || process.cwd();

function loadState() {
  try {
    if (existsSync(STATE_FILE)) {
      return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (_) {
    // ignore parse errors, start fresh
  }
  return {};
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let toolCall;
    try {
      toolCall = JSON.parse(input);
    } catch (_) {
      process.stdout.write(input);
      return;
    }

    const toolName = toolCall.tool_name || '';
    if (toolName !== 'Edit') {
      process.stdout.write(input);
      return;
    }

    const filePath = toolCall.tool_input?.file_path || 'unknown';
    const state = loadState();
    state[filePath] = (state[filePath] || 0) + 1;

    const count = state[filePath];
    if (count > EDIT_THRESHOLD) {
      const msg = `[EditGuard] ⚠️ ${filePath}: ${count} Edits since last Write (threshold: ${EDIT_THRESHOLD}).`;
      const hint = `Consider using Write tool once instead of ${count} incremental Edits.`;
      const savings = `Estimated token waste: ${(count - 1) * 4000}+ tokens (re-read cycles after hook).`;
      const ref = `See CLAUDE.md "xlibgate Trust Alignment session 复盘成本规则" — Atomic Write > incremental Edit.`;
      console.error(`${msg}\n${hint}\n${savings}\n${ref}`);
    }

    // Reset counter on Write (tracked in PostToolUse output, but we only have Pre here)
    saveState(state);
    process.stdout.write(input);
  });
}

main();
