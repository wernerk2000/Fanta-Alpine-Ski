"""Write the league file the import tests read (pw_import.js, pw_fire.js flow B): the shape export_leagues.py produces.

Usage: python3 tests/make_leghe_test.py [out.json]
League «Fanta Ski PROVA»: 7 teams (Squadra Nico, Squadra Werner, Squadra Pietro, Squadra 4-7), 18 purchases from the
start of the season, and a Sölden lineup (m01) for Squadra Pietro (t3).
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else
                   '/tmp/claude-0/-home-claude/fc963d46-bd1f-52ac-bbc1-9c85f5597a3b/scratchpad/leghe_test.json')
state = json.loads((ROOT / 'build' / 'state.json').read_text(encoding='utf-8'))
league = dict(state['leagues'][0]['league'] if 'leagues' in state else state['league'])
league['name'] = 'Fanta Ski PROVA'
ids = {a['id'] for a in state['athletes']}
teams = [{'id': 't1', 'name': 'Squadra Nico', 'owner': 'Nico'}, {'id': 't2', 'name': 'Squadra Werner', 'owner': 'Werner'},
         {'id': 't3', 'name': 'Squadra Pietro', 'owner': 'Pietro'}] + \
        [{'id': 't%d' % i, 'name': 'Squadra %d' % i, 'owner': ''} for i in range(4, 8)]
rosters = {
    't1': ['m-lucas-pinheiro-braathen', 'm-loic-meillard', 'm-henrik-kristoffersen', 'f-zrinka-ljutic'],
    't2': ['m-marco-odermatt', 'f-mikaela-shiffrin', 'f-camille-rast'],
    't3': ['m-alex-vinatzer', 'm-atle-lie-mcgrath', 'm-zan-kranjec', 'f-wendy-holdener'],
    't4': ['m-stefan-brennsteiner', 'f-emma-aicher'],
    't5': ['m-thomas-tumler', 'f-sofia-goggia'],
    't6': ['m-filip-zubcic', 'm-clement-noel'],
    't7': ['m-timon-haugan'],
}
purchases = []
for t, ath in rosters.items():
    for a in ath:
        assert a in ids, a
        purchases.append({'id': 'p%d' % (len(purchases) + 1), 'a': a, 't': t, 'price': 10, 'from': league['seasonStart']})
assert len(purchases) == 18
lineups = {'m01': {'t3': {'t': ['m-alex-vinatzer', 'm-atle-lie-mcgrath'], 'r': 'm-zan-kranjec'}}}
out = {'v': 2, 'source': 'prova', 'exported': None,
       'leagues': [{'id': 'l1', 'league': league, 'teams': teams, 'purchases': purchases, 'lineups': lineups}]}
OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
print(OUT, len(teams), 'teams,', len(purchases), 'purchases')
