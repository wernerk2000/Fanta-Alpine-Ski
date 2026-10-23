// Malus for not finishing by start number: −10 up to bib 30, −5 from bib 31; results may list DNF with the bib
const FS = require('/home/claude/fantaski/src/core.js');
const S0 = FS.view(FS.migrate(JSON.parse(require('fs').readFileSync('/home/claude/fantaski/build/state.json', 'utf8'))));
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const L = S0.league;
const race = id => S0.races.find(r => r.id === id);
const GS = race('m01'), DH = race('m06'), GSx = race('m21');
const sc = (e, r, m, LL) => FS.scoreOf(Object.assign({ rank: 0, bib: 0, r1: 0, r2: 0 }, e), r || GS, LL || L, 5, null, m || 1);

ok(L.malusDnf === 10 && L.malusDnfLate === 5, 'default settings: −10, and −5 from bib 31');
ok(sc({ st: 'dnf', bib: 1 }).v === -10 && sc({ st: 'dnf', bib: 30 }).v === -10, 'bibs 1 and 30 out: −10');
ok(sc({ st: 'dnf', bib: 31 }).v === -5 && sc({ st: 'dnf', bib: 58 }, DH).v === -5, 'bib 31 out (also in downhill), bib 58: −5');
ok(sc({ st: 'dnf', bib: 0 }).v === -10, 'bib unknown: the full malus');
ok(sc({ st: 'dnf', bib: 40 }, GSx, 1.5).v === -7.5, 'bib 40 out in an event race: −7,5');
const old = Object.assign({}, L); delete old.malusDnfLate;
ok(sc({ st: 'dnf', bib: 45 }, GS, 1, old).v === -5, 'league saved before this rule: −5 from bib 31 too');
ok(sc({ st: 'dnf', bib: 45 }, GS, 1, Object.assign({}, old, { malusDnf: 3 })).v === -3, 'without the setting it is never heavier than the full malus');
ok(sc({ st: 'dnf', bib: 45 }, GS, 1, Object.assign({}, L, { malusDnfLate: 0 })).v === 0, 'set to 0: no malus from bib 31');
ok(sc({ rank: 16, bib: 4 }).mTop === -10 && sc({ rank: 7, bib: 33, r1: 1 }).mLead === -10, 'the other two maluses are unchanged: first group out of the 15, run-1 leader out of the 5');

// in a race: dnf as plain ids (old results) and as [id, bib]
let S = FS.clone(S0);
S.league = Object.assign({}, L);
S.teams = [{ id: 't1', name: 'A' }];
['m-marco-odermatt', 'm-loic-meillard', 'm-henrik-kristoffersen'].forEach((a, i) => S.purchases.push({ id: 'p' + i, a, t: 't1', price: 10, from: L.seasonStart }));
S.lineups = { m01: { t1: { t: ['m-marco-odermatt', 'm-loic-meillard'], r: 'm-henrik-kristoffersen' } } };
S.results = { m01: { list: [['m-atle-lie-mcgrath', 1, 3]], dns: [], dnf: ['m-marco-odermatt', ['m-loic-meillard', 34]], nc: [] } };
let C = FS.compute(S), it = C.raceRes.m01.teams.t1.items;
const v = a => it.find(x => x.a === a).v;
ok(v('m-marco-odermatt') === -10 && v('m-loic-meillard') === -5, 'old format (no bib) −10, [id, 34] −5');
ok(C.raceRes.m01.out['m-loic-meillard'].bib === 34 && it.find(x => x.a === 'm-loic-meillard').bib === 34, 'the bib of the DNF is kept for the race page');
ok(C.T.t1.total === -15, 'team total −15');
