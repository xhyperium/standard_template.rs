#!/usr/bin/env node
/**
 * Edit Guard Reset — PostToolUse Hook for Write
 * Resets the per-file Edit counter when a Write operation completes.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';

const STATE_FILE = '.claude/.edit-guard-state.json';

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    let result;
    try {
      result = JSON.parse(input);
    } catch (_) {
      process.stdout.write(input);
      return;
    }

    const toolName = result.tool_name || '';
    if (toolName !== 'Write') {
      process.stdout.write(input);
      return;
    }

    const filePath = result.tool_input?.file_path;
    if (!filePath) {
      process.stdout.write(input);
      return;
    }

    try {
      if (existsSync(STATE_FILE)) {
        const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
        if (state[filePath]) {
          delete state[filePath];
          writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        }
      }
    } catch (_) {
      // state file may not exist yet — fine
    }

    process.stdout.write(input);
  });
}

main();
