#!/usr/bin/env python3
"""Full qres extractor: 22B tree records + names table join + chunk splitting."""
import struct, zlib, os, sys

SIGS = (b'\x78\x01', b'\x78\x5e', b'\x78\x9c', b'\x78\xda')

def parse_names(data, f3, f1):
    names, pos = [], f3
    while pos + 6 <= f1:
        ln, = struct.unpack_from('>H', data, pos)
        h, = struct.unpack_from('>I', data, pos+2)
        name = data[pos+6:pos+6+ln*2].decode('utf-16-be', 'replace')
        names.append((ln, h, name))
        pos += 6 + ln*2
    return names

def hash16(name, h32):
    # discover: is tree hash16 low16 or high16 of names-table u32 hash?
    return (h32 & 0xffff, h32 >> 16)

def parse_records(tree):
    # find first record: u16 flag==1 followed by sane namelen (4..100) and u32 0x000001a0 at +6
    start = None
    for p in range(0, max(1, len(tree) - 22)):
        if p+22 <= len(tree):
            flag, = struct.unpack_from('>H', tree, p)
            nlen, = struct.unpack_from('>H', tree, p+2)
            magic, = struct.unpack_from('>I', tree, p+6)
            if flag == 1 and 2 <= nlen <= 120 and magic == 0x000001a0:
                start = p; break
    if start is None:
        return [], None
    recs, p = [], start
    while p + 22 <= len(tree):
        flag, = struct.unpack_from('>H', tree, p)
        nlen, = struct.unpack_from('>H', tree, p+2)
        h16, = struct.unpack_from('>H', tree, p+4)
        magic, = struct.unpack_from('>I', tree, p+6)
        mtime, = struct.unpack_from('>I', tree, p+10)
        size, = struct.unpack_from('>I', tree, p+14)
        t1, = struct.unpack_from('>H', tree, p+18)
        t2, = struct.unpack_from('>H', tree, p+20)
        if flag != 1 or magic != 0x000001a0:
            break
        recs.append((nlen, h16, mtime, size, t1, t2))
        p += 22
    return recs, start

def walk_chunks(data):
    chunks, cur = [], 28
    n = len(data)
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

def main(path):
    data = open(path, 'rb').read()
    size = len(data)
    f1, f2, f3, f4, f5 = struct.unpack_from('>5I', data, 8)
    names = parse_names(data, f3, f1)
    tree = data[f1:size]
    recs, rstart = parse_records(tree)
    print(f'names={len(names)} records={len(recs)} recstart={rstart}')
    # join: record (nlen,h16) <-> name (len==nlen and (h32&0xffff)==h16 or (h32>>16)==h16)
    by_low = {}
    by_high = {}
    for ln, h32, name in names:
        by_low.setdefault((ln, h32 & 0xffff), []).append(name)
        by_high.setdefault((ln, h32 >> 16), []).append(name)
    joined, low_hits, high_hits = [], 0, 0
    for nlen, h16, mtime, size, t1, t2 in recs:
        if (nlen, h16) in by_low: low_hits += 1; joined.append(by_low[(nlen, h16)][0])
        elif (nlen, h16) in by_high: high_hits += 1; joined.append(by_high[(nlen, h16)][0])
        else: joined.append(None)
    print(f'join: low16={low_hits} high16={high_hits} miss={len(recs)-low_hits-high_hits}')
    if low_hits == 0 and high_hits == 0:
        # try positional join ignoring 'icons'-like dirs
        joined = [n for _, _, n in names][:len(recs)]
        print('fallback: positional join')
    chunks = walk_chunks(data)
    print(f'chunks={len(chunks)} total_chunk_ulen={sum(len(p) for _, p in chunks)} total_rec_size={sum(r[3] for r in recs)}')
    return data, names, recs, joined, chunks

if __name__ == '__main__':
    import glob
    for path in glob.glob('/Applications/wpsoffice.app/Contents/Resources/office6/mui/default/*.rcc'):
        import os
        print('==', os.path.basename(path))
        try:
            main(path)
        except Exception as e:
            print('  FAIL', e)
