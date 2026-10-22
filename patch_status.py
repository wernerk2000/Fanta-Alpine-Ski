"""Apply data/status.json (injuries, notes, retirements, athletes added) to the page or to the site's athletes file.

Usage: python3 patch_status.py [page.html | docs/data/athletes.json]   (default fanta-ski.html, rewritten in place)
For every athlete named in "athletes": sets "note" and "inj" ("out" = misses the season, "long" = injured, return
uncertain, "short" = misses the first races, "doubt" = may miss the first races); an entry without "inj" clears it (to
mark a recovery, keep the athlete in the file with the new note and no "inj"). Athletes not named are left as they are,
so changes made in Gestione stay. Retired athletes leave the listone for the "excluded" list, unless a team already
owns them. Athletes in "added" (back from injury, no points in 2025/26) join the listone if missing; quotation =
points / 20, as in build.py. Idempotent.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
PAT = re.compile(r'(<script type="application/json" id="fs-state">)(.*?)(</script>)', re.S)
path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'fanta-ski.html'
is_json = path.suffix == '.json'
text = path.read_text(encoding='utf-8')
S = json.loads(text) if is_json else json.loads(PAT.search(text).group(2))
ST = json.loads((ROOT / 'data' / 'status.json').read_text(encoding='utf-8'))
info = ST['athletes']
owned = {p['a'] for lg in S.get('leagues', []) for p in lg.get('purchases', [])}
changed, gone, added = 0, [], []
keep = []
for a in S['athletes']:
    if a['n'] in ST['retired'].get(a['g'], []) and a['id'] not in owned:
        gone.append(a['n'])
        continue
    before = (a.get('note'), a.get('inj'))
    if a['n'] in info:
        st = info[a['n']]
        a['note'] = st['note']
        if st.get('inj'):
            a['inj'] = st['inj']
        else:
            a.pop('inj', None)
    if (a.get('note'), a.get('inj')) != before:
        changed += 1
    keep.append(a)
ids = {a['id'] for a in keep}
for x in ST.get('added', []):
    if x['id'] in ids:
        continue
    tp = sum(x['p'])
    a = {'id': x['id'], 'n': x['n'], 'c': x['c'], 'g': x['g'], 'p': x['p'], 'tp': tp, 'q': max(1, int(tp / 20 + 0.5))}
    for k in ('tpy', 'note', 'inj'):
        if x.get(k):
            a[k] = x[k]
    keep.append(a)
    added.append(x['n'])
S['athletes'] = keep
ex = S.setdefault('excluded', [])
for n in gone:
    if n + ' (ritiro)' not in ex:
        ex.append(n + ' (ritiro)')
missing = [n for n in info if not any(a['n'] == n for a in keep)]
if is_json:
    path.write_text(json.dumps(S, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
else:
    blob = json.dumps(S, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
    path.write_text(PAT.sub(lambda m: m.group(1) + blob + m.group(3), text, count=1), encoding='utf-8')
print('athletes changed', changed, '· added:', added, '· retired out of the listone:', gone, '· not in the listone:', missing)
