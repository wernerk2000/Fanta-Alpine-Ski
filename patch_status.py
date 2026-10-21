"""Apply data/status.json (injuries, notes, retirements) to the athletes of the page fanta-ski.html.

Usage: python3 patch_status.py [page.html]   (default fanta-ski.html, rewritten in place)
For every athlete named in status.json: sets "note" and "inj" ("out" = misses the season, "long" = injured, return
uncertain, "short" = misses the first races, "doubt" = may miss the first races); an entry without "inj" clears it (to
mark a recovery, keep the athlete in the file with the new note and no "inj"). Athletes not named are left as they are,
so changes made in Gestione stay. Retired athletes leave the listone for the "excluded" list, unless a team already
owns them. Idempotent.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
PAT = re.compile(r'(<script type="application/json" id="fs-state">)(.*?)(</script>)', re.S)
path = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'fanta-ski.html'
html = path.read_text(encoding='utf-8')
S = json.loads(PAT.search(html).group(2))
ST = json.loads((ROOT / 'data' / 'status.json').read_text(encoding='utf-8'))
info = ST['athletes']
owned = {p['a'] for lg in S.get('leagues', []) for p in lg.get('purchases', [])}
changed, gone = 0, []
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
S['athletes'] = keep
ex = S.setdefault('excluded', [])
for n in gone:
    if n + ' (ritiro)' not in ex:
        ex.append(n + ' (ritiro)')
missing = [n for n in info if not any(a['n'] == n for a in keep)]
blob = json.dumps(S, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
path.write_text(PAT.sub(lambda m: m.group(1) + blob + m.group(3), html, count=1), encoding='utf-8')
print('athletes changed', changed, '· retired out of the listone:', gone, '· not in the listone:', missing)
