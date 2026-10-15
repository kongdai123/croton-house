# Pack the two 3D LUTs of Blender 4.5's AgX view (datafiles/colormanagement/luts) for src/agx.js.
# usage: python3 tools/agx_lut.py <blender colormanagement dir> -> assets/agx/agx_lut.bin.gz
# Layout: luminance_compensation_bt2020.cube (37^3) then AgX_Base_sRGB.cube (57^3), red fastest, RGB, as 16-bit
# value * 64000 stored as differences along red (mod 2^16), gzipped.
import sys, gzip, numpy as np
def cube(path):
    n, rows = None, []
    for line in open(path):
        t = line.split()
        if not t or t[0].startswith('#'): continue
        if t[0] == 'LUT_3D_SIZE': n = int(t[1])
        elif len(t) == 3 and t[0][0] in '-.0123456789': rows.append([float(v) for v in t])
    return np.array(rows).reshape(n, n, n, 3)
out = b''
for name in ('luminance_compensation_bt2020', 'AgX_Base_sRGB'):
    u = np.round(np.clip(cube(f'{sys.argv[1]}/luts/{name}.cube'), 0, None) * 64000).astype(np.int64)
    out += (np.diff(u, axis=2, prepend=0) % 65536).astype('<u2').tobytes()
open('assets/agx/agx_lut.bin.gz', 'wb').write(gzip.compress(out, 9, mtime=0))
