"""Calendar corrections confirmed in October 2026 (Eurosport and fantaski.it calendars), applied to the built page's
state for races that have no results yet. Usage: python3 patch_calendar.py (after merge_live.py)."""
import json, re, pathlib
p = pathlib.Path(__file__).resolve().parent / 'fanta-ski.html'
PAT = re.compile(r'(<script type="application/json" id="fs-state">)(.*?)(</script>)', re.S)
html = p.read_text(encoding='utf-8')
st = json.loads(PAT.search(html).group(2))
fix = {'f13': {'note': None}, 'f14': {'v': 'Courchevel', 'c': 'FRA', 'note': None},
       'f19': {'v': 'Val di Fassa', 'c': 'ITA', 'note': None}, 'f20': {'v': 'Val di Fassa', 'c': 'ITA', 'note': None},
       'f31': {'note': None}}
n = 0
for r in st['races']:
    if r['id'] in fix and r['id'] not in st.get('results', {}):
        for k, v in fix[r['id']].items():
            if v is None:
                n += k in r
                r.pop(k, None)
            elif r.get(k) != v:
                r[k] = v; n += 1
blob = json.dumps(st, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c')
p.write_text(PAT.sub(lambda m: m.group(1) + blob + m.group(3), html, count=1), encoding='utf-8')
print('calendar fields changed:', n)
