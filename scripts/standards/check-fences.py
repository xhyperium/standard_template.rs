#!/usr/bin/env python3
"""
scripts/standards/check-fences.py — 检测标准文档中代码块开闭标记是否交替正确。

规则：
  开（奇数块）：```text  （含语言标签）
  闭（偶数块）：```     （纯关闭标记）

退出码：
  0 = 全部文件符合规范
  1 = 存在不符合规范的文件
"""

import glob, re, sys

FILES = (
    glob.glob("crates/**/标准.md", recursive=True)
    + glob.glob("tools/**/标准.md", recursive=True)
)


def check_file(path: str) -> list[str]:
    """检查单文件，返回错误信息列表（空 = 合规）。"""
    try:
        with open(path, "r") as fh:
            lines = fh.readlines()
    except FileNotFoundError:
        return [f"文件不存在: {path}"]

    errors: list[str] = []
    fence_idx = 0  # 1-based 代码块编号

    for lineno, line in enumerate(lines, start=1):
        m = re.match(r"^(```+)(\S*)\s*$", line)
        if not m:
            continue

        backticks = m.group(1)
        info = m.group(2)
        fence_idx += 1

        if fence_idx % 2 == 1:  # 预期奇数块 = 开
            if not info:
                errors.append(
                    f"  L{lineno}: 第{fence_idx}个代码块（开）缺少语言标签，应为 ```text"
                )
            elif info != "text":
                errors.append(
                    f"  L{lineno}: 第{fence_idx}个代码块（开）语言标签为'{info}'，应为 'text'"
                )
        else:  # 预期偶数块 = 闭
            if info:
                errors.append(
                    f"  L{lineno}: 第{fence_idx}个代码块（闭）含多余语言标签'{info}'，应为纯 ```"
                )

    if fence_idx % 2 != 0:
        errors.append(f"  文件末尾: 代码块未闭合（奇数个 {fence_idx} 个代码块）")

    return errors


def main() -> None:
    all_passed = True
    ok_count = 0
    broken_count = 0

    for fp in sorted(FILES):
        errors = check_file(fp)
        if errors:
            print(f"BROKEN  {fp}")
            for err in errors:
                print(err)
            broken_count += 1
            all_passed = False
        else:
            print(f"OK      {fp}")
            ok_count += 1

    total = ok_count + broken_count
    print(f"\n结果：{total} 文件，{ok_count} OK，{broken_count} BROKEN")
    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
