#!/usr/bin/env python3
"""Deliver ~/Desktop/WPS-icon/: full extraction of every mui/default/*.rcc, one folder per source."""
import struct, zlib, os, glob

SIGS = (b'\x78\x01', b'\x78\x5e', b'\x78\x9c', b'\x78\xda')
SRC_DIR = '/Applications/wpsoffice.app/Contents/Resources/office6/mui/default'
OUT = os.path.expanduser('~/Desktop/WPS-icon')

def walk_chunks(data):
    chunks, cur, n = [], 28, len(data)
    while cur < n:
        cand = [i for i in (data.find(s, cur) for s in SIGS) if i >= 0]
        if not cand: break
        m = min(cand)
        d = zlib.decompressobj()
        try:
            payload = d.decompress(data[m:])
        except Exception:
            cur = m + 1; continue
        end = n - len(d.unused_data)
        chunks.append((m, payload))
        cur = end
    return chunks

def deep_decompress(payload, rounds=3):
    for _ in range(rounds):
        if payload[:2] in (b'\x78\x01', b'\x78\x5e', b'\x78\x9c', b'\x78\xda'):
            try:
                payload = zlib.decompress(payload); continue
            except Exception: pass
        break
    return payload

def sniff(payload):
    if payload[:4] == b'\x00\x00\x01\x00': return 'ico'
    if payload[:8] == b'\x89PNG\r\n\x1a\n': return 'png'
    if payload[:2] in (b'\x42\x4d',): return 'bmp'
    if payload[:4] == b'RIFF' and payload[8:12] == b'WEBP': return 'webp'
    head = payload.lstrip()[:200]
    if head[:5] == b'<?xml' or b'<svg' in head: return 'svg'
    if head[:1] in (b'{', b'['): return 'json'
    if head.startswith(b'<'): return 'xml'
    if all(32 <= b < 127 or b in (9, 10, 13) for b in head[:64]) and head: return 'txt'
    return 'bin'

def parse_names(data, f3, f1):
    names, pos = [], f3
    while pos + 6 <= f1:
        ln, = struct.unpack_from('>H', data, pos)
        h, = struct.unpack_from('>I', data, pos+2)
        name = data[pos+6:pos+6+ln*2].decode('utf-16-be', 'replace')
        names.append((h, name)); pos += 6 + ln*2
    return names

def main(path, outdir):
    os.makedirs(outdir, exist_ok=True)
    data = open(path, 'rb').read()
    size = len(data)
    f1, f2, f3, f4, f5 = struct.unpack_from('>5I', data, 8)
    names = parse_names(data, f3, f1)
    with open(os.path.join(outdir, 'names.txt'), 'w') as w:
        w.write('# 真实名表（来自 qres 名字区，顺序=存储区顺序，与文件编号的对应待定）\n')
        for h, n in names:
            w.write(f'{n}\t#{h:08x}\n')
    chunks = walk_chunks(data)
    kinds = {}
    manifest = []
    for i, (off, payload) in enumerate(chunks):
        content = deep_decompress(payload)
        kind = sniff(content)
        kinds[kind] = kinds.get(kind, 0) + 1
        fn = f'{i:04d}_{kind}.{ "ico" if kind=="ico" else (kind if kind in ("png","svg","bmp","webp","json","xml","txt") else "bin") }'
        with open(os.path.join(outdir, fn), 'wb') as w:
            w.write(content)
        manifest.append(f'{fn}\tfileoff={off:#x}\trawlen={len(payload)}')
    with open(os.path.join(outdir, '_manifest.txt'), 'w') as w:
        w.write('\n'.join(manifest))
    readme = (f'来源: {path}\n'
              f'WPS 版本: 12.1.28492 (macOS)\n'
              f'文件块数: {len(chunks)}  类型分布: {kinds}\n'
              f'名字表条目: {len(names)} (见 names.txt)\n'
              f'说明: qres 容器 = 28字节头 + 顺序zlib块 + 尾部UTF-16BE名字表。\n'
              f'每块即一个资源文件（部分为双层zlib，已递归解压）；文件按存储顺序编号。\n'
              f'文件<->名字的最终对应关系待树索引哈希规则破解后回填（见 names.txt 名单）。\n')
    open(os.path.join(outdir, 'README.txt'), 'w').write(readme)
    return len(chunks), kinds, len(names)

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    summary = []
    for path in sorted(glob.glob(os.path.join(SRC_DIR, '*.rcc'))):
        name = os.path.basename(path).replace('_res.rcc', '').replace('.rcc', '')
        try:
            n, kinds, nn = main(path, os.path.join(OUT, name))
            summary.append(f'{name}: chunks={n} kinds={kinds} names={nn}')
            print(summary[-1])
        except Exception as e:
            print(name, 'FAIL', e)
    open(os.path.join(OUT, 'README.txt'), 'w').write(
        'WPS 功能区图标全量提取（2026-09-10，仅作风格参考，禁止随产品分发）\n'
        '来源: /Applications/wpsoffice.app v12.1.28492, office6/mui/default/*.rcc (qres 容器)\n'
        '每个子目录 = 一个 rcc 来源；names.txt = 该来源真实资源名清单；_manifest.txt = 编号对照。\n\n'
        + '\n'.join(summary) + '\n')
    print('DONE ->', OUT)
