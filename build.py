#!/usr/bin/env python3
"""Builds the Fanta Alpine Ski page: listone from 2025/26 final standings, 2026/27 calendar, initial league state."""
import json, re, unicodedata, datetime, pathlib

ROOT = pathlib.Path(__file__).parent

RETIRED = {
    'M': {'Alexis Pinturault', 'Adrien Théaux', 'Dave Ryding', 'Niels Hintermann', 'Jared Goldberg', 'Marc Rochat', 'Riley Seger'},
    'F': {'Lara Gut-Behrami', 'Ilka Štuhec', 'Joana Hählen', 'Christina Ager', 'Clara Direz', 'Ana Bucik Jogan', 'Asa Ando'},
}
OUT_SEASON = {'F': {'Lindsey Vonn'}}

def slug(s):
    s = s.lower().replace('ß', 'ss').replace('ø', 'o').replace('æ', 'ae').replace('đ', 'd').replace('ł', 'l')
    s = unicodedata.normalize('NFD', s)
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')

def quot(points):
    return max(1, int(points / 20 + 0.5))

def make(g, nat, name, dh, sg, gs, sl, note=None, tp=None, tpy=None):
    total = tp if tp is not None else dh + sg + gs + sl
    a = {'id': ('m-' if g == 'M' else 'f-') + slug(name), 'n': name, 'c': nat, 'g': g,
         'p': [dh, sg, gs, sl], 'tp': total, 'q': quot(total)}
    if tpy:
        a['tpy'] = tpy
    if note:
        a['note'] = note
    return a

athletes, excluded = [], []
for g, fn in (('M', 'men.tsv'), ('F', 'women.tsv')):
    for line in (ROOT / 'data' / fn).read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        rank, nat, name, dh, sg, gs, sl = line.split('\t')
        dh, sg, gs, sl = int(dh), int(sg), int(gs), int(sl)
        if name in RETIRED[g]:
            excluded.append(name + ' (ritiro)')
            continue
        if name in OUT_SEASON.get(g, set()):
            excluded.append(name + ' (ferma tutta la stagione)')
            continue
        if name == 'Federica Brignone':
            athletes.append(make(g, nat, name, 384, 630, 580, 0,
                                 'Punti del 2024/25: il 2025/26 è stato quasi tutto saltato per infortunio', tpy='24/25'))
            continue
        note = 'Rientro dopo due stagioni condizionate dagli infortuni' if name == 'Aleksander Aamodt Kilde' else None
        athletes.append(make(g, nat, name, dh, sg, gs, sl, note))

# additions not in the 2025/26 standings
athletes.append(make('F', 'USA', 'Lauren Macuga', 230, 279, 16, 0,
                     'Punti del 2024/25: ferma nel 2025/26 per la rottura del crociato', tpy='24/25'))
athletes.append(make('M', 'NED', 'Marcel Hirscher', 0, 0, 0, 0, 'Possibile rientro con wild card'))

# injuries, notes, late retirements and athletes back from injury who scored nothing in 2025/26
# (data/status.json, also applied to the live page and to the site's athletes.json by patch_status.py)
STATUS = json.loads((ROOT / 'data' / 'status.json').read_text(encoding='utf-8'))
for x in STATUS.get('added', []):
    a = make(x['g'], x['c'], x['n'], *x['p'], x.get('note'), tpy=x.get('tpy'))
    assert a['id'] == x['id'], (a['id'], x['id'])
    if x.get('inj'):
        a['inj'] = x['inj']
    athletes.append(a)
for a in list(athletes):
    if a['n'] in STATUS['retired'].get(a['g'], []):
        athletes.remove(a)
        excluded.append(a['n'] + ' (ritiro)')
        continue
    st = STATUS['athletes'].get(a['n'])
    if st:
        a['note'] = st['note']
        if st.get('inj'):
            a['inj'] = st['inj']

ids = [a['id'] for a in athletes]
assert len(ids) == len(set(ids)), 'duplicate athlete ids'

CLASSIC = 1.5
men = [
    ('2026-10-25', 'Sölden', 'AUT', 'GS'), ('2026-11-15', 'Levi', 'FIN', 'SL'), ('2026-11-22', 'Gurgl', 'AUT', 'SL'),
    ('2026-11-28', 'Copper Mountain', 'USA', 'SG'), ('2026-11-29', 'Copper Mountain', 'USA', 'GS'),
    ('2026-12-03', 'Beaver Creek', 'USA', 'DH'), ('2026-12-04', 'Beaver Creek', 'USA', 'DH'),
    ('2026-12-05', 'Beaver Creek', 'USA', 'SG'), ('2026-12-06', 'Beaver Creek', 'USA', 'GS'),
    ('2026-12-12', "Val d'Isère", 'FRA', 'GS'), ('2026-12-13', "Val d'Isère", 'FRA', 'SL'),
    ('2026-12-18', 'Val Gardena', 'ITA', 'DH'), ('2026-12-19', 'Val Gardena', 'ITA', 'SG'),
    ('2026-12-20', 'Alta Badia', 'ITA', 'GS', CLASSIC), ('2026-12-21', 'Alta Badia', 'ITA', 'SL'),
    ('2026-12-23', 'Madonna di Campiglio', 'ITA', 'SL'),
    ('2026-12-28', 'Bormio', 'ITA', 'DH'), ('2026-12-29', 'Bormio', 'ITA', 'SG'),
    ('2027-01-02', 'Kranjska Gora', 'SLO', 'GS'), ('2027-01-03', 'Kranjska Gora', 'SLO', 'SL'),
    ('2027-01-09', 'Adelboden', 'SUI', 'GS'), ('2027-01-10', 'Adelboden', 'SUI', 'SL'),
    ('2027-01-15', 'Wengen', 'SUI', 'SG', CLASSIC), ('2027-01-16', 'Wengen', 'SUI', 'DH'),
    ('2027-01-17', 'Wengen', 'SUI', 'SL'),
    ('2027-01-22', 'Kitzbühel', 'AUT', 'SG'), ('2027-01-23', 'Kitzbühel', 'AUT', 'DH', CLASSIC),
    ('2027-01-24', 'Kitzbühel', 'AUT', 'SL'),
    ('2027-01-26', 'Schladming', 'AUT', 'GS'), ('2027-01-27', 'Schladming', 'AUT', 'SL', CLASSIC),
    ('2027-01-30', 'Chamonix', 'FRA', 'SL'),
    ('2027-02-20', 'Garmisch-Partenkirchen', 'GER', 'DH'), ('2027-02-21', 'Garmisch-Partenkirchen', 'GER', 'SG'),
    ('2027-02-27', 'Saalbach', 'AUT', 'DH'), ('2027-02-28', 'Saalbach', 'AUT', 'SG'),
    ('2027-03-06', 'Kvitfjell', 'NOR', 'DH'), ('2027-03-07', 'Kvitfjell', 'NOR', 'SG'),
    ('2027-03-13', 'Åre', 'SWE', 'GS'), ('2027-03-14', 'Åre', 'SWE', 'SL'),
    ('2027-03-20', 'Sun Valley', 'USA', 'DH', 1, True), ('2027-03-21', 'Sun Valley', 'USA', 'SG', 1, True),
    ('2027-03-24', 'Sun Valley', 'USA', 'GS', 1, True), ('2027-03-25', 'Sun Valley', 'USA', 'SL', 1, True),
]
women = [
    ('2026-10-24', 'Sölden', 'AUT', 'GS'), ('2026-11-14', 'Levi', 'FIN', 'SL'), ('2026-11-21', 'Gurgl', 'AUT', 'SL'),
    ('2026-11-28', 'Killington', 'USA', 'GS'), ('2026-11-29', 'Killington', 'USA', 'SL'),
    ('2026-12-05', 'Tremblant', 'CAN', 'GS'), ('2026-12-06', 'Tremblant', 'CAN', 'GS'),
    ('2026-12-11', 'Beaver Creek', 'USA', 'DH'), ('2026-12-12', 'Beaver Creek', 'USA', 'DH'),
    ('2026-12-13', 'Beaver Creek', 'USA', 'SG'),
    ('2026-12-18', 'St. Moritz', 'SUI', 'SG', CLASSIC), ('2026-12-19', 'St. Moritz', 'SUI', 'SG'),
    ('2026-12-20', 'St. Moritz', 'SUI', 'GS'),
    ('2026-12-22', 'Courchevel', 'FRA', 'SL'),
    ('2026-12-28', 'Gosau', 'AUT', 'GS'), ('2026-12-29', 'Gosau', 'AUT', 'SL'),
    ('2027-01-04', 'Flachau', 'AUT', 'GS'), ('2027-01-05', 'Flachau', 'AUT', 'SL', CLASSIC),
    ('2027-01-09', 'Val di Fassa', 'ITA', 'DH'),
    ('2027-01-10', 'Val di Fassa', 'ITA', 'SG'),
    ('2027-01-15', "Cortina d'Ampezzo", 'ITA', 'DH', CLASSIC), ('2027-01-16', "Cortina d'Ampezzo", 'ITA', 'DH'),
    ('2027-01-17', "Cortina d'Ampezzo", 'ITA', 'SG'),
    ('2027-01-19', 'Kronplatz', 'ITA', 'GS', CLASSIC),
    ('2027-01-23', 'Jasná', 'SVK', 'GS'), ('2027-01-24', 'Jasná', 'SVK', 'SL'),
    ('2027-01-29', 'Kranjska Gora', 'SLO', 'GS'), ('2027-01-30', 'Kranjska Gora', 'SLO', 'SL'),
    ('2027-02-20', 'Lenzerheide', 'SUI', 'SG'), ('2027-02-21', 'Lenzerheide', 'SUI', 'SG'),
    ('2027-02-27', 'Garmisch-Partenkirchen', 'GER', 'DH'),
    ('2027-02-28', 'Garmisch-Partenkirchen', 'GER', 'DH'),
    ('2027-03-06', 'Soldeu', 'AND', 'GS'), ('2027-03-07', 'Soldeu', 'AND', 'SL'),
    ('2027-03-12', 'Narvik', 'NOR', 'DH'), ('2027-03-13', 'Narvik', 'NOR', 'SG'),
    ('2027-03-20', 'Sun Valley', 'USA', 'DH', 1, True), ('2027-03-21', 'Sun Valley', 'USA', 'SG', 1, True),
    ('2027-03-23', 'Sun Valley', 'USA', 'GS', 1, True), ('2027-03-25', 'Sun Valley', 'USA', 'SL', 1, True),
]
assert len(men) == 43 and len(women) == 40

races = []
for g, lst in (('M', men), ('F', women)):
    for i, row in enumerate(lst, 1):
        d, v, c, t = row[:4]
        x = row[4] if len(row) > 4 else 1
        fin = row[5] if len(row) > 5 else False
        r = {'id': ('m' if g == 'M' else 'f') + '%02d' % i, 'g': g, 'd': d, 'v': v, 'c': c, 't': t, 'x': x, 'st': 'sched'}
        if fin:
            r['fin'] = True
        if len(row) > 6:
            r['note'] = row[6]
        races.append(r)

# start of the first run, Italian time (fantaski.it calendar, October 2026); the weekly calendar check keeps them up to date
START = {
    'm01': '10:00', 'm02': '10:15', 'm03': '10:30', 'm04': '19:00', 'm05': '18:00', 'm06': '19:00', 'm07': '19:00',
    'm08': '19:15', 'm09': '18:00', 'm10': '09:30', 'm11': '09:30', 'm12': '11:45', 'm13': '11:45', 'm14': '10:00',
    'm15': '18:15', 'm16': '18:00', 'm17': '11:30', 'm18': '11:30', 'm19': '09:30', 'm20': '09:30', 'm21': '10:30',
    'm22': '10:30', 'm23': '12:30', 'm24': '12:30', 'm25': '10:30', 'm26': '11:30', 'm27': '11:30', 'm28': '10:30',
    'm29': '17:45', 'm30': '17:45', 'm31': '09:30', 'm32': '11:15', 'm33': '11:15', 'm34': '11:30', 'm35': '11:30',
    'm36': '10:30', 'm37': '10:30', 'm38': '10:00', 'm39': '10:00', 'm40': '19:00', 'm41': '19:00', 'm42': '17:00',
    'm43': '17:00',
    'f01': '10:00', 'f02': '10:00', 'f03': '10:30', 'f04': '16:00', 'f05': '16:00', 'f06': '16:00', 'f07': '16:00',
    'f08': '18:00', 'f09': '18:00', 'f10': '18:00', 'f11': '10:45', 'f12': '10:45', 'f13': '10:00', 'f14': '17:45',
    'f15': '10:00', 'f16': '10:00', 'f17': '18:00', 'f18': '18:00', 'f19': '10:45', 'f20': '10:45', 'f21': '11:00',
    'f22': '10:30', 'f23': '10:30', 'f24': '10:30', 'f25': '09:30', 'f26': '09:30', 'f27': '09:30', 'f28': '09:30',
    'f29': '11:00', 'f30': '11:00', 'f31': '11:00', 'f32': '11:00', 'f33': '10:15', 'f34': '10:15', 'f35': '10:30',
    'f36': '10:30', 'f37': '16:00', 'f38': '16:00', 'f39': '16:00', 'f40': '16:00',
}
for r in races:
    if r['id'] in START:
        r['h'] = START[r['id']]

league = {
    'id': 'l1',
    'rev': 'init',
    'updated': datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z'),
    'league': {'name': 'Fanta Alpine Ski', 'season': '2026/27', 'budget': 500, 'perGender': 6, 'starters': 2, 'reserves': 1,
               'refundPct': 50, 'lockHour': 9, 'auctionOpen': True, 'seasonStart': '2026-10-01T00:00:00Z',
               'scale': 'fis', 'bonus30': 0,
               'bib': {'mid': {'5': 15, '3': 25, '1': 40}, 'late': {'30': 10, '15': 20, '5': 35, '3': 50, '1': 75}},
               'bibMid': 15, 'bibMidSpeed': 20, 'bibLate': 30, 'bibMaxQ': 0,
               'run2Best': 10, 'run2Gain': 1, 'streakPod': 10, 'streakWin': 20,
               'malusDnf': 10, 'malusOut': {'dnf': [10, 10, 0], 'dnq': [10, 5, 0]}, 'malusTop': 10, 'malusLead': 10, 'topGroup': 7, 'lockBefore': 60},
    'teams': [{'id': 't%d' % i, 'name': 'Squadra %d' % i, 'owner': ''} for i in range(1, 9)],
    'purchases': [],
    'lineups': {},
}
state = {
    'v': 2,
    'rev': league.pop('rev'),
    'updated': league.pop('updated'),
    'athletes': athletes,
    'races': races,
    'results': {},
    'excluded': excluded,
    'leagues': [league],
}

(ROOT / 'build').mkdir(exist_ok=True)
(ROOT / 'build' / 'state.json').write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding='utf-8')

style = (ROOT / 'src' / 'style.css').read_text(encoding='utf-8')
core = (ROOT / 'src' / 'core.js').read_text(encoding='utf-8')
app = (ROOT / 'src' / 'app.js').read_text(encoding='utf-8')
code = core + '\n' + app
assert '</script' not in code.lower(), 'code must not contain a closing script tag'
blob = json.dumps(state, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')

page = (
    '<title>Fanta Alpine Ski 2026/27</title>\n'
    '<meta name="claude:viewport-fit-sides" content="cover">\n'
    '<link data-fs rel="preconnect" href="https://fonts.googleapis.com">\n'
    '<link data-fs rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    '<link data-fs rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=JetBrains+Mono:wght@500;600&display=swap">\n'
    '<style id="fs-style">\n' + style + '</style>\n'
    '<div id="app"></div>\n'
    '<script type="application/json" id="fs-state">' + blob + '</script>\n'
    '<script id="fs-code">\n' + code + '</script>\n'
)
(ROOT / 'fanta-ski.html').write_text(page, encoding='utf-8')
print('athletes', len(athletes), 'races', len(races), 'excluded', len(excluded), 'page bytes', len(page.encode('utf-8')))
top = sorted(athletes, key=lambda a: -a['q'])[:12]
print([(a['n'], a['g'], a['q']) for a in top])
