#!/usr/bin/env python3
"""Batch-insert i18n keys into every language shard of a docs i18n group.

Usage: python3 tools/i18n-insert.py <batch.py>
where <batch.py> defines GROUP ('app' | 'ribbon' | 'ai') and
KEYS = {lang: [(key, value), ...], ...}. All 21 shards must get every key
(LangDicts compile-time contract); the script asserts absence, inserts before
the closing brace, and never reformats existing lines.
"""
import importlib.util
import json
import pathlib
import re
import sys

ROOT = pathlib.Path('/Users/zyh/work/chayuan-office/apps/docs/src/renderer/i18n')
LANGS = ['zh', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'it', 'pt', 'nl',
         'pl', 'cs', 'ru', 'ar', 'he', 'hi', 'th', 'id', 'ms']


def quote(value: str) -> str:
    # single quotes, JSON-escape style for the inner text (keeps CJK intact)
    body = json.dumps(value, ensure_ascii=False)[1:-1]
    if "'" in body:
        return '"' + body + '"'
    return "'" + body + "'"


def main() -> None:
    spec = importlib.util.spec_from_file_location('batch', sys.argv[1])
    batch = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(batch)
    group, keys = batch.GROUP, batch.KEYS

    missing = [l for l in LANGS if l not in keys]
    if missing:
        sys.exit(f'missing translations for: {missing}')

    for lang in LANGS:
        path = ROOT / group / f'{lang}.ts'
        src = path.read_text()
        entries = keys[lang]
        present = [k for k, _ in entries if f'{k}:' in src]
        if present:
            sys.exit(f'{path.name}: keys already present: {present}')
        lines = ''.join(
            f"  {'.' if k.isidentifier() else repr(k)}: {quote(v)},\n" if k.isidentifier()
            else f"  {quote(k).replace(chr(39), chr(39))}: {quote(v)},\n"
            for k, v in entries
        )
        lines = ''.join(
            f'  {k if k.isidentifier() else quote(k)}: {quote(v)},\n' for k, v in entries
        )
        stripped = src.rstrip()
        # shards end with `} satisfies Record<keyof typeof zh, string>` (or plain })
        m = re.search(r'\n\}(\s+satisfies[^\n]*)?\s*$', stripped)
        if not m:
            sys.exit(f'{path.name}: cannot find closing brace')
        suffix = m.group(1) or ''
        body = stripped[: m.start() + 1]
        path.write_text(body + '\n' + lines + '}' + suffix + '\n')
        print(f'{path.name}: +{len(entries)}')


main()
