"""Write the leagues of the published page to a file the website can import.

Usage: python3 export_leagues.py <published index.html> [out.json]
The file keeps only what the website needs: each league's settings, teams, purchases and lineups.
Teams lose the page's account links (people take their team again on the website with the invite link).
"""
import json
import pathlib
import re
import sys

PAT = re.compile(r'<script type="application/json" id="fs-state">(.*?)</script>', re.S)
html = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
S = json.loads(PAT.search(html).group(1))
if 'leagues' not in S:
    S['leagues'] = [{'id': 'l1', 'league': S.get('league', {}), 'teams': S.get('teams', []),
                     'purchases': S.get('purchases', []), 'lineups': S.get('lineups', {})}]
out = {'v': 2, 'source': 'Fanta Alpine Ski, pagina Claude', 'exported': S.get('updated'), 'leagues': []}
for lg in S['leagues']:
    out['leagues'].append({
        'id': lg['id'], 'league': lg['league'],
        'teams': [{'id': t['id'], 'name': t['name'], 'owner': t.get('owner', '')} for t in lg['teams']],
        'purchases': lg['purchases'],
        'lineups': {r: {t: {'t': v.get('t', []), 'r': v.get('r')} for t, v in m.items()} for r, m in lg['lineups'].items()},
    })
dest = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else 'fanta-ski-leghe.json')
dest.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
print(dest, ', '.join('%s: %d squadre, %d acquisti' % (l['league'].get('name'), len(l['teams']), len(l['purchases'])) for l in out['leagues']))
