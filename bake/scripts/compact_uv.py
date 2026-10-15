# lightmap_uv.bin -> lightmap_uv2.bin.gz: 16-bit vertex maps and indices where they fit, gzipped (the browser unpacks it
# with DecompressionStream). Header gains "format": 2 and per-unit "x16" / "i16" flags.
import sys, json, struct, gzip, numpy as np
src, dst = sys.argv[1], sys.argv[2]
buf = open(src, 'rb').read(); n = struct.unpack('<I', buf[:4])[0]; h = json.loads(buf[4:4 + n]); base = 4 + n
chunks = []; off = 0
for u in h['units']:
    o = base + u['off']
    x = np.frombuffer(buf, np.uint32, u['nv'], o); o += u['nv'] * 4
    i = np.frombuffer(buf, np.uint32, u['ni'], o); o += u['ni'] * 4
    uv = np.frombuffer(buf, np.uint16, u['nv'] * 2, o)
    u['x16'] = bool(u['vc'] <= 65536); u['i16'] = bool(u['nv'] <= 65536)
    parts = [x.astype(np.uint16) if u['x16'] else x, i.astype(np.uint16) if u['i16'] else i, uv]
    u['off'] = off
    for p in parts: b = p.tobytes(); chunks.append(b); off += len(b)
h['format'] = 2
hj = json.dumps(h).encode(); raw = struct.pack('<I', len(hj)) + hj + b''.join(chunks)
open(dst, 'wb').write(gzip.compress(raw, 9))
print(f'{len(buf)/1e6:.1f} MB -> {len(raw)/1e6:.1f} MB raw -> {len(gzip.compress(raw, 9))/1e6:.1f} MB gzipped; units 16-bit: {sum(u["x16"] for u in h["units"])}/{len(h["units"])}')
