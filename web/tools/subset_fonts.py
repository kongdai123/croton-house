# Subset Noto Serif SC to the CJK characters the site actually uses (full weights are ~15 MB each).
# Re-run after adding Chinese text: python tools/subset_fonts.py [path/to/Noto_Serif_SC/static]
import glob, os, re, subprocess, sys

WEB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/Downloads/Google_Sans,Noto_Sans_JP,Noto_Sans_SC,Noto_Serif_SC/Noto_Serif_SC/static')
OUT = os.path.join(WEB, 'assets', 'fonts')
CJK = re.compile(r'[\u2e80-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef\u2010-\u206f\u00b7]')

chars = set()
for pat in ('src/**/*.js', 'index.html', 'data/*.json', 'style.css'):
    for f in glob.glob(os.path.join(WEB, pat), recursive=True):
        chars.update(CJK.findall(open(f, encoding='utf-8', errors='ignore').read()))
text = ''.join(sorted(chars))
print(len(chars), 'characters')
for weight in ('Regular', 'SemiBold'):
    out = os.path.join(OUT, f'NotoSerifSC-{weight}.sub.woff2')
    subprocess.run([sys.executable, '-m', 'fontTools.subset', os.path.join(SRC, f'NotoSerifSC-{weight}.ttf'), f'--text={text}',
                    '--flavor=woff2', '--layout-features=*', '--no-hinting', f'--output-file={out}'], check=True)
    print(out, os.path.getsize(out) // 1024, 'KB')
