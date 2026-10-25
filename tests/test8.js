// Maluses by start number. DNF (out of the race): −10 up to bib 30, nothing from 31.
// DNQ (not qualified for run 2, giant slalom and slalom): −10 up to bib 15, −5 from 16 to 30, nothing from 31.
const FS = require('/home/claude/fantaski/src/core.js');
const S0 = FS.view(FS.migrate(JSON.parse(require('fs').readFileSync('/home/claude/fantaski/build/state.json', 'utf8'))));
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const L = S0.league;
const race = id => S0.races.find(r => r.id === id);
const GS = race('m01'), SL = race('m02'), DH = race('m06'), GSx = race('m21');
const sc = (e, r, m, LL) => FS.scoreOf(Object.assign({ rank: 0, bib: 0, r1: 0, r2: 0 }, e), r || GS, LL || L, 5, null, m || 1);

ok(JSON.stringify(L.malusOut) === '{"dnf":[10,10,0],"dnq":[10,5,0]}', 'default settings: DNF 10/10/0, DNQ 10/5/0');
// DNF
ok(sc({ st: 'dnf', bib: 1 }).v === -10 && sc({ st: 'dnf', bib: 16 }).v === -10 && sc({ st: 'dnf', bib: 30 }).v === -10, 'DNF with bib 1, 16, 30: −10');
ok(sc({ st: 'dnf', bib: 31 }).v === 0 && sc({ st: 'dnf', bib: 58 }, DH).v === 0, 'DNF with bib 31 (also downhill) or 58: no malus');
ok(sc({ st: 'dnf', bib: 0 }).v === -10, 'DNF, bib unknown: −10');
ok(sc({ st: 'dnf', bib: 12 }, GSx, 1.5).v === -15, 'DNF in an event race: −15');
ok(sc({ st: 'dnf', bib: 2, r1: 1 }).v === -10 && sc({ st: 'dnf', bib: 2, r1: 1 }).mLead === 0, 'run-1 leader out in run 2: only the DNF malus');
// DNQ
const nq = (bib, r, m) => sc({ st: 'nq', bib: bib }, r || GS, m);
ok(nq(9).v === -10 && nq(9).mDnq === -10 && nq(15, SL).v === -10, 'DNQ with bib 9 and 15 (slalom): −10');
ok(nq(16).v === -5 && nq(30, SL).v === -5, 'DNQ with bib 16 and 30: −5');
ok(nq(31).v === 0 && nq(45).v === 0, 'DNQ with bib 31 and 45: no malus');
ok(nq(0).v === 0, 'DNQ, bib unknown: no malus');
ok(nq(3).v === -10 && nq(3).mDnq === -10 && nq(3).mTop === 0, 'first group (bib 3) not qualified: one malus, −10 (DNQ)');
ok(nq(20, GSx, 1.5).v === -7.5, 'DNQ bib 20 in an event race: −7,5');
ok(sc({ st: 'nq', bib: 25 }, DH).v === 0, 'no DNQ in downhill');
// the other two, unchanged
ok(sc({ rank: 16, bib: 4 }).mTop === -10 && sc({ rank: 7, bib: 33, r1: 1 }).mLead === -10 && sc({ rank: 18, bib: 7 }, DH).mTop === -10, 'first group out of the 15 and run-1 leader out of the 5: −10, as before');
// settings
const own = Object.assign({}, L, { malusOut: { dnf: [12, 8, 2], dnq: [6, 3, 1] } });
ok(sc({ st: 'dnf', bib: 20 }, GS, 1, own).v === -8 && sc({ st: 'nq', bib: 40 }, GS, 1, own).v === -1, 'the league can set its own values');
const old = Object.assign({}, L, { malusDnfLate: 5 }); delete old.malusOut;
ok(sc({ st: 'dnf', bib: 40 }, GS, 1, old).v === 0 && sc({ st: 'nq', bib: 20 }, GS, 1, old).v === -5, 'a league saved with the older settings follows the new rule');

// in a race: dnf as plain ids (old results) and as [id, bib]; nc in giant slalom = DNQ
let S = FS.clone(S0);
S.league = Object.assign({}, L);
S.teams = [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }];
['m-marco-odermatt', 'm-loic-meillard', 'm-henrik-kristoffersen'].forEach((a, i) => S.purchases.push({ id: 'p' + i, a, t: 't1', price: 10, from: L.seasonStart }));
['m-alex-vinatzer', 'm-zan-kranjec', 'm-river-radamus'].forEach((a, i) => S.purchases.push({ id: 'q' + i, a, t: 't2', price: 10, from: L.seasonStart }));
S.lineups = { m01: { t1: { t: ['m-marco-odermatt', 'm-loic-meillard'], r: 'm-henrik-kristoffersen' }, t2: { t: ['m-alex-vinatzer', 'm-zan-kranjec'], r: 'm-river-radamus' } } };
S.results = { m01: { list: [['m-atle-lie-mcgrath', 1, 3]], dns: [], dnf: ['m-marco-odermatt', ['m-loic-meillard', 34]], nc: [['m-alex-vinatzer', 18], ['m-zan-kranjec', 12]] } };
let C = FS.compute(S);
const it = t => C.raceRes.m01.teams[t].items, v = (t, a) => it(t).find(x => x.a === a).v;
ok(v('t1', 'm-marco-odermatt') === -10 && v('t1', 'm-loic-meillard') === 0, 'DNF: old format (no bib) −10, [id, 34] nothing');
ok(C.raceRes.m01.out['m-loic-meillard'].bib === 34 && it('t1').find(x => x.a === 'm-loic-meillard').bib === 34, 'the bib of the DNF is kept for the race page');
ok(v('t2', 'm-alex-vinatzer') === -5 && v('t2', 'm-zan-kranjec') === -10 && it('t2').find(x => x.a === 'm-zan-kranjec').nq, 'DNQ: bib 18 −5, bib 12 −10, marked as not qualified');
ok(C.T.t1.total === -10 && C.T.t2.total === -15, 'team totals −10 and −15');
