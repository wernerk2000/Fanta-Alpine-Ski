"""Build the Fanta Alpine Ski website into site/dist (static files for GitHub Pages).

Usage: python3 site/build_site.py [--mock] [--out DIR] [--fresh-data] [--from-page FILE]
  --mock            uses the in-memory database instead of Firebase (for the browser tests)
  --out DIR         writes somewhere else than site/dist (the published repository uses docs/)
  --fresh-data      rewrites data/*.json from the build; otherwise the ones already in DIR are kept,
                    because the scheduled tasks update results and calendar there
  --from-page FILE  athletes, calendar and results from a saved copy of the Claude page (its live data);
                    implies --fresh-data
Needs build/state.json from build.py (athletes, calendar, default league settings).
Firebase settings come from site/firebase.json if present ({"apiKey": ..., "authDomain": ..., "projectId": ..., "appId": ...}).
"""
import json, pathlib, re, shutil, sys, time

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'
mock = '--mock' in sys.argv
DIST = pathlib.Path(sys.argv[sys.argv.index('--out') + 1]).resolve() if '--out' in sys.argv else SITE / 'dist'
state = json.loads((ROOT / 'build' / 'state.json').read_text(encoding='utf-8'))
lg = state['leagues'][0]['league'] if 'leagues' in state else state['league']
defaults = {k: v for k, v in lg.items() if k != 'name'}
live = None
if '--from-page' in sys.argv:
    page = pathlib.Path(sys.argv[sys.argv.index('--from-page') + 1]).read_text(encoding='utf-8')
    live = json.loads(re.search(r'<script type="application/json" id="fs-state">(.*?)</script>', page, re.S).group(1))
    state['athletes'], state['races'], state['excluded'] = live['athletes'], live['races'], live.get('excluded', [])
    sys.argv.append('--fresh-data')

DATA = ('athletes.json', 'races.json', 'results.json')
keep = {}
if DIST.exists():
    if '--fresh-data' not in sys.argv:
        keep = {f: (DIST / 'data' / f).read_text(encoding='utf-8') for f in DATA if (DIST / 'data' / f).exists()}
    shutil.rmtree(DIST)
(DIST / 'data').mkdir(parents=True)
v = str(int(time.time()))

def put(name, text):
    (DIST / name).write_text(text, encoding='utf-8')

put('core.js', (ROOT / 'src' / 'core.js').read_text(encoding='utf-8'))
put('app.js', (SITE / 'src' / 'app.js').read_text(encoding='utf-8'))
put('db.js', (SITE / 'src' / ('mockdb.js' if mock else 'db.js')).read_text(encoding='utf-8'))
put('style.css', (ROOT / 'src' / 'style.css').read_text(encoding='utf-8') + '\n' + (SITE / 'src' / 'site.css').read_text(encoding='utf-8'))
put('defaults.js', 'window.FS_DEFAULTS = ' + json.dumps(defaults, ensure_ascii=False) + ';\n')
fb = SITE / 'firebase.json'
cfg = json.loads(fb.read_text(encoding='utf-8')) if fb.exists() else {}
put('config.js', 'window.FS_CONFIG = ' + json.dumps({'firebase': cfg}, ensure_ascii=False) + ';\n')
put('firestore.rules', (SITE / 'firestore.rules').read_text(encoding='utf-8'))
# the same rules as plain text: browsers show it instead of downloading it (the organiser copies it from there)
put('firestore-rules.txt', (SITE / 'firestore.rules').read_text(encoding='utf-8'))
put('.nojekyll', '')
cname = SITE / 'CNAME'
if cname.exists():
    put('CNAME', cname.read_text(encoding='utf-8'))

# global data: athletes and calendar from the build; results start empty (the results task fills them in)
def data(name, text):
    put('data/' + name, keep.get(name, text))
data('athletes.json', json.dumps({'athletes': state['athletes'], 'excluded': state.get('excluded', [])}, ensure_ascii=False, separators=(',', ':')))
data('races.json', json.dumps({'races': state['races']}, ensure_ascii=False, separators=(',', ':')))
res_file = SITE / 'results.json'
if live is not None:
    data('results.json', json.dumps({'results': live.get('results', {}), 'updated': live.get('updated')}, ensure_ascii=False, separators=(',', ':')))
else:
    data('results.json', res_file.read_text(encoding='utf-8') if res_file.exists() else json.dumps({'results': {}, 'updated': None}))

module = '' if mock else ' type="module"'
put('index.html', f"""<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Fanta Alpine Ski</title>
<meta name="description" content="Il fantasci della Coppa del Mondo di sci alpino: asta, formazioni, bonus e classifica.">
<meta name="theme-color" content="#0E1A28">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23C8102E'/%3E%3Cpath d='M7 23 L25 9' stroke='white' stroke-width='3' stroke-linecap='round'/%3E%3Cpath d='M7 9 L25 23' stroke='white' stroke-width='3' stroke-linecap='round' opacity='.55'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap">
<link rel="stylesheet" href="style.css?v={v}">
</head>
<body>
<div id="app"></div>
<script src="core.js?v={v}"></script>
<script src="defaults.js?v={v}"></script>
<script src="config.js?v={v}"></script>
<script{module} src="db.js?v={v}"></script>
<script src="app.js?v={v}" defer></script>
</body>
</html>
""")
print('built', DIST, 'mock' if mock else ('firebase' if cfg else 'firebase (no config yet)'), '· data kept: ' + ', '.join(sorted(keep)) if keep else '')
