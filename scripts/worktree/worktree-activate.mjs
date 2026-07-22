#!/usr/bin/env node
/**
 * worktree-activate.mjs — Shell 集成（替代 worktree-activate.mjs）
 *
 * 职责: 输出 shell 代码供 source/eval 加载：wt 函数 + tab 补全 + PROMPT 注入。
 *
 * 用法:
 *   eval "$(node scripts/worktree/worktree-activate.mjs)"    # 加载到当前 shell
 *
 * SSOT: docs/constitution/06-governance.md §6.0.5 / docs/governance/worktree-policy.md
 * 替代: scripts/worktree/worktree-activate.mjs (已迁移)
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const WT_SCRIPT = resolve(__dirname, "worktree.mjs");

const output = `
# ── infra.rs Worktree Shell 集成 ──────────

WT_SCRIPT="${WT_SCRIPT}"
WT_ROOT="${ROOT}"

wt() {
  local target="\$1"

  if [ -z "\$target" ]; then
    node "\$WT_SCRIPT" list
    echo ""
    echo "用法: wt <branch-name>"
    return
  fi

  if [ "\$target" = "main" ]; then
    cd "\$WT_ROOT" || return 1
    echo "→ main"
    return
  fi

  local wt_path
  wt_path=\$(node "\$WT_SCRIPT" go "\$target" 2>/dev/null)
  if [ -n "\$wt_path" ] && [ -d "\$wt_path" ]; then
    cd "\$wt_path" || return 1
    echo "→ \$target  (\$(git branch --show-current 2>/dev/null))"
  else
    echo "wt: worktree '\$target' 不存在"
    echo "  创建并切换: node \$WT_SCRIPT create \$target && cd .worktrees/\$target"
    return 1
  fi
}

_wt_complete() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=(\$(compgen -W "\$(ls "\$WT_ROOT/.worktrees/" 2>/dev/null)" -- "\$cur"))
}
complete -F _wt_complete wt 2>/dev/null || true

# ── PROMPT ──────────────────────────────────

__wt_prompt() {
  local toplevel
  toplevel=\$(git rev-parse --show-toplevel 2>/dev/null) || return
  [[ "\$toplevel" == "$ROOT" ]] || return

  local wt_info=""
  local pwd="\$PWD"

  if [[ "\$pwd" == "$ROOT/.worktrees/"* ]]; then
    local rel="\${pwd#$ROOT/.worktrees/}"
    wt_info="wt:\${rel%%/*}"
  else
    wt_info="main"
  fi

  if [[ "\$PS1" != *"__wt_marker__"* ]]; then
    local marker="\\[\\\\033[36m\\\\][\\\${wt_info}]\\\\[\\\\033[0m\\\\] "
    PS1="\${marker}\${PS1}"
  fi
}

PROMPT_COMMAND="__wt_prompt; \${PROMPT_COMMAND:-:}"
`;

console.log(output);
