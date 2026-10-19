"""Put the league data of the published page into the freshly built page.

Usage: python3 merge_live.py <published index.html>
Rewrites fanta-ski.html (built by build.py) keeping the code of the new build and the data of the live page:
teams, purchases, lineups, results and settings. Settings added by the new build are filled in with their defaults.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent
PAT = re.compile(r'(<script type="application/json" id="fs-state">)(.*?)(</script>)', re.S)

live_html = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
live = json.loads(PAT.search(live_html).group(2))
built_path = ROOT / 'fanta-ski.html'
built = built_path.read_text(encoding='utf-8')
default = json.loads(PAT.search(built).group(2))
default_league = default['leagues'][0]['league']

if 'leagues' not in live:
    live['leagues'] = [{'id': 'l1', 'league': live.pop('league', {}), 'teams': live.pop('teams', []),
                        'purchases': live.pop('purchases', []), 'lineups': live.pop('lineups', {})}]
for lg in live['leagues']:
    for k, v in default_league.items():
        lg['league'].setdefault(k, v)
for k in ('athletes', 'races', 'excluded'):
    live.setdefault(k, default[k])
# fields added to races by the new build (e.g. start times) fill in where the live race does not have them
dr = {r['id']: r for r in default['races']}
for r in live['races']:
    for k, v in dr.get(r['id'], {}).items():
        r.setdefault(k, v)
live.setdefault('results', {})
live['v'] = 2

blob = json.dumps(live, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
out = PAT.sub(lambda m: m.group(1) + blob + m.group(3), built, count=1)
built_path.write_text(out, encoding='utf-8')
print('leagues', len(live['leagues']), 'purchases', sum(len(l['purchases']) for l in live['leagues']),
      'results', len(live['results']), 'bytes', len(out.encode('utf-8')))
