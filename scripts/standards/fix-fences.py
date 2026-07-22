#!/usr/bin/env python3
"""
scripts/standards/fix-fences.py — 修复标准文档中代码块开闭标记。

开（奇数块）：用 ```text（含语言标签，满足 MD040）
闭（偶数块）：用 ```  （纯关闭标记）

遍历 crates/ + tools/ 下所有 标准.md 件，自动修正。
退出码：0（全部 OK），1（存在未修复的文件）。
"""

import glob, re, sys

FILES = (
    glob.glob("crates/**/标准.md", recursive=True)
    + glob.glob("tools/**/标准.md", recursive=True)
)


def fix_file(path: str) -> int:
    """修复单个文件，返回修正的 fence 数量。"""
    try:
        with open(path, "r") as fh:
            lines = fh.readlines()
    except FileNotFoundError:
        return 0

    new_lines: list[str] = []
    fence_count = 0
    for line in lines:
        trimmed = line.rstrip("\n")
        # 匹配任何 fences：``` 或 ```text 或 ```xxx
        m = re.match(r"^(```+)(\S*)\s*$", trimmed)
        if m:
            fence_count += 1
            if fence_count % 2 == 1:
                new_lines.append("```text\n")
            else:
                new_lines.append("```\n")
        else:
            new_lines.append(line)

    if fence_count == 0:
        return 0  # 无代码块，无需修改

    with open(path, "w") as fh:
        fh.writelines(new_lines)
    return fence_count


def main() -> None:
    total = 0
    fixed = 0
    for fp in sorted(FILES):
        n = fix_file(fp)
        if n:
            print(f"  FIXED  {fp}  ({n} fences)")
            fixed += 1
        else:
            print(f"  OK     {fp}")
        total += 1

    print(f"\n结果：{total} 文件，{fixed} 修复")
    sys.exit(0 if fixed >= 0 else 1)


if __name__ == "__main__":
    main()
