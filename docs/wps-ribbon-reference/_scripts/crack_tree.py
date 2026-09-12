#!/usr/bin/env python3
"""Crack qres tree layout by correlating known blob offsets (ico.rcc ground truth)."""
import struct, re, zlib

P = '/Applications/wpsoffice.app/Contents/Resources/office6/mui/default/ico.rcc'
data = open(P, 'rb').read()
size = len(data)
f1, f2, f3, f4, f5 = struct.unpack_from('>5I', data, 8)

def parse_names(data, f3, f1):
    names, pos = [], f3
    while pos + 6 <= f1:
        ln, = struct.unpack_from('>H', data, pos)
        h, = struct.unpack_from('>I', data, pos+2)
        raw = data[pos+6:pos+6+ln*2]
        try:
            name = raw.decode('utf-16-be')
        except Exception:
            name = raw.decode('utf-16-be', 'replace')
        if ln > 200: break
        names.append((h, name))
        pos += 6 + ln*2
    return names, pos

names, consumed = parse_names(data, f3, f1)
print(f'ico.rcc names: {len(names)} consumed={consumed-f3}/{f1-f3}')
print('first 12 names:', [n for _, n in names[:12]])

# walk blobs
SIGS = (b'\x78\x01', b'\x78\x5e', b'\x78\x9c', b'\x78\xda')
blobs, cur = [], 28
while cur < size:
    cand = [i for i in (data.find(s, cur) for s in SIGS) if i >= 0]
    if not cand: break
    m = min(cand)
    d = zlib.decompressobj()
    try:
        payload = d.decompress(data[m:])
    except Exception:
        cur = m + 1; continue
    end = size - len(d.unused_data)
    blobs.append((m, end - m, len(payload)))
    cur = end
print(f'blobs: {len(blobs)}')

# search blob offsets in tree region as u32 BE and LE
tree = data[f1:size]
print(f'tree region: {f1:#x}..{size:#x} ({size-f1}B)')
hits_be, hits_le = [], []
for off, clen, ulen in blobs:
    i = tree.find(struct.pack('>I', off))
    j = tree.find(struct.pack('<I', off))
    hits_be.append(i); hits_le.append(j)
print('BE hits found:', sum(1 for x in hits_be if x >= 0), '/', len(blobs))
print('LE hits found:', sum(1 for x in hits_le if x >= 0), '/', len(blobs))
ok = [ (blobs[k][0], hits_be[k]) for k in range(len(blobs)) if hits_be[k] >= 0 ]
if len(ok) > 5:
    offs = [h for _, h in ok]
    deltas = [offs[i+1]-offs[i] for i in range(len(offs)-1)]
    print('first hit positions:', offs[:8], 'deltas:', deltas[:8])
    # print one record hex around first hit
    p = offs[0]
    print('record context:', tree[max(0,p-24):p+24].hex(), '(hit at +24)')
