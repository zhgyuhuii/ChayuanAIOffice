#!/usr/bin/env python3
"""Inventory OUR apps' ribbon groups: scan renderer component files for
`ribbon-group-label">{t('key')}` (docs/slides pattern) and bucket matches by
enclosing top-level function/const (tab component or render helper), then
resolve keys to zh strings from the app's i18n dict.

Usage: python3 inventory_ours.py apps/docs/src/renderer apps/docs/src/renderer/i18n/app/zh.ts
"""
import re
import sys
from pathlib import Path

GROUP_RE = re.compile(r"""ribbon-group-label"\s*>\s*\{\s*t\('([A-Za-z0-9]+)'\)""")
SECTION_RE = re.compile(r"""^\s{0,4}(?:export\s+)?(?:function|const)\s+([A-Za-z0-9_]+)""")


def load_i18n(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    pairs = re.findall(r"([A-Za-z0-9]+):\s*'([^']*)'", text)
    return dict(pairs)


def scan(src_dir: Path, i18n: dict) -> dict:
    result = {}
    for path in sorted(src_dir.rglob("*.tsx")):
        name = path.name
        if not ("ribbon" in name or "Ribbon" in name or name == "ExcelShell.tsx"):
            continue
        current = name
        found = []
        for line in path.read_text(encoding="utf-8").splitlines():
            m = SECTION_RE.match(line)
            if m:
                current = m.group(1)
            for g in GROUP_RE.finditer(line):
                found.append((current, g.group(1)))
        if found:
            for section, key in found:
                result.setdefault(f"{name}::{section}", []).append(key)
    return result


def main() -> None:
    src_dir = Path(sys.argv[1])
    i18n = load_i18n(Path(sys.argv[2]))
    inventory = scan(src_dir, i18n)
    for section in sorted(inventory):
        keys = inventory[section]
        labels = [i18n.get(k, f"?{k}") for k in keys]
        print(f"{section} ({len(keys)}): {' | '.join(labels)}")


if __name__ == "__main__":
    main()
