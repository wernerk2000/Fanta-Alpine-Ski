const FS = require('/home/claude/fantaski/src/core.js');
const S0 = FS.view(FS.migrate(JSON.parse(require('fs').readFileSync('/home/claude/fantaski/build/state.json', 'utf8'))));
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const L = S0.league;
const race = id => S0.races.find(r => r.id === id);
const GS = race('m01'), DH = race('m06'), GSx = race('m21');
const sc = (e, r, m) => FS.scoreOf(Object.assign({ rank: 0, bib: 0, r1: 0, r2: 0 }, e), r || GS, L, 5, null, m || 1);

// ---- single scores
ok(sc({ st: 'dnf' }).v === -10, 'did not finish: −10');
ok(sc({ st: 'dnf' }, GSx, 1.5).v === -15, 'did not finish in Adelboden: −15');
ok(sc({ st: 'dnf', bib: 2, r1: 1 }).v === -10, 'run-1 leader out in run 2: only the DNF malus');
ok(sc({ rank: 17, bib: 5 }).v === 14 - 10 && sc({ rank: 17, bib: 5 }).mTop === -10, 'first group (bib 5) 17th: 14 − 10 = 4');
ok(sc({ rank: 15, bib: 5 }).malus === 0, 'first group 15th: no malus');
ok(sc({ rank: 17, bib: 8 }).malus === 0, 'bib 8 is not first group');
ok(sc({ rank: 0, bib: 3 }).v === -10, 'first group not qualified / outside the 30: −10');
ok(sc({ rank: 0, bib: 0 }).v === 0, 'unplaced without bib: 0');
ok(sc({ rank: 18, bib: 7 }, DH).malus === -10 && sc({ rank: 18, bib: 8 }, DH).malus === 0 && sc({ rank: 18, bib: 21 }, DH).malus === 0, 'speed first group = odd bibs up to 19');
ok(sc({ rank: 6, bib: 12, r1: 1 }).v === 40 - 10 && sc({ rank: 6, bib: 12, r1: 1 }).mLead === -10, 'run-1 leader 6th: 40 − 10');
ok(sc({ rank: 5, bib: 12, r1: 1 }).malus === 0, 'run-1 leader 5th: no malus');
ok(sc({ rank: 16, bib: 2, r1: 1 }).malus === -10, 'leader and first group 16th: one malus only (−10)');
ok(sc({ rank: 9, r1: 1 }, DH).malus === 0, 'no leader malus in downhill');
const L2 = Object.assign({}, L, { malusLead: 15 });
const s2 = FS.scoreOf({ rank: 16, bib: 2, r1: 1, r2: 0 }, GS, L2, 5, null, 1);
ok(s2.mLead === -15 && s2.mTop === 0 && s2.v === 0, 'the heavier malus wins (−15 leader beats −10 first group)');
ok(sc({ rank: 18, bib: 3, r1: 25 }).v === 13 + 7 - 10, 'bonus and malus add up: 18th from 25th, bib 3 → 13 + 7 − 10');
ok(sc({ rank: 30, bib: 2 }).v > sc({ st: 'dnf' }).v, 'finishing 30th as first group still beats going out');

// ---- in a season: reserve rule and team scores
let S = FS.clone(S0);
[['m-marco-odermatt', 't1'], ['m-loic-meillard', 't1'], ['m-henrik-kristoffersen', 't1']].forEach(([a, t], i) => S.purchases.push({ id: 'p' + i, a, t, price: 10, from: L.seasonStart }));
FS.apply(S, { k: 'lu', r: 'm01', t: 't1', lu: { t: ['m-marco-odermatt', 'm-loic-meillard'], r: 'm-henrik-kristoffersen' } });
FS.apply(S, { k: 'res', r: 'm01', list: [['m-loic-meillard', 17, 4]], dns: [], dnf: ['m-marco-odermatt'], nc: [], src: 't', at: 'x' });
let C = FS.compute(S);
let T = C.raceRes.m01.teams.t1;
ok(T.score === -10 + 4 && !T.subIn, 'Odermatt out (−10) + Meillard first group 17th (4), reserve stays out (got ' + T.score + ')');
ok(T.items[0].dnf && T.items[0].v === -10, 'item flagged as out');
FS.apply(S, { k: 'res', r: 'm01', list: [['m-loic-meillard', 2, 4]], dns: ['m-marco-odermatt'], dnf: ['m-henrik-kristoffersen'], src: 't', at: 'x' });
C = FS.compute(S); T = C.raceRes.m01.teams.t1;
ok(T.subIn && T.score === 80 - 10, 'Odermatt did not start → reserve Kristoffersen in, he goes out: 80 − 10 (got ' + T.score + ')');
FS.apply(S, { k: 'res', r: 'm01', list: [['m-loic-meillard', 2, 4]], dns: [], nc: [['m-marco-odermatt', 6]], src: 't', at: 'x' });
C = FS.compute(S); T = C.raceRes.m01.teams.t1;
ok(T.score === 80 - 10 && C.raceRes.m01.out['m-marco-odermatt'].st === 'nc', 'Odermatt bib 6 not qualified: −10');
ok(C.T.t1.total === 70, 'season total can include maluses (got ' + C.T.t1.total + ')');

// ---- parser: sections and bibs
const men = S0.athletes.filter(a => a.g === 'M');
const paste = `1 3 512269 ODERMATT Marco 1997 SUI 1:07.12 1:08.21 2:15.33 100
2 7 512182 MEILLARD Loic 1996 SUI 1:07.40 1:08.10 2:15.50 +0.17 80
Did not qualify for 2nd run
45 422304 KRISTOFFERSEN Henrik 1994 NOR 1:10.12
Did not finish 2nd run
5 422729 HAUGAN Timon 1996 NOR 1:07.20
Did not start 2nd run
11 6190558 SARRAZIN Cyprien 1994 FRA 1:08.01
Disqualified 1st run
22 380335 ZUBCIC Filip 1993 CRO
Did not start 1st run
33 512124 TUMLER Thomas 1989 SUI`;
const pr = FS.parseResults(paste, men, { runs: true });
ok(pr.list.length === 2, 'two placed');
ok(pr.nq.join() === 'm-henrik-kristoffersen' && pr.sbib['m-henrik-kristoffersen'] === 45, 'not qualified, bib 45 → ' + pr.nq + ' / ' + pr.sbib['m-henrik-kristoffersen']);
ok(['m-timon-haugan', 'm-filip-zubcic'].every(id => pr.nf.indexOf(id) >= 0), 'DNF run 2 and DSQ run 1 are out of the race → ' + pr.nf);
const sarr = men.find(a => /Sarrazin/.test(a.n));
ok(!sarr || pr.nf.indexOf(sarr.id) >= 0, 'did not start run 2 counts as out of the race' + (sarr ? '' : ' (athlete not in listone, skipped)'));
ok(pr.ns.indexOf('m-thomas-tumler') >= 0 && pr.nf.indexOf('m-thomas-tumler') < 0, 'did not start run 1 = did not start');
ok(pr.sbib['m-timon-haugan'] === 5 && pr.sbib['m-filip-zubcic'] === 22, 'bibs of the unplaced');
ok(pr.list[1].join() === 'm-loic-meillard,2,7,3,1', 'run-1 places count the athletes out in run 2 → ' + pr.list[1].join());
const it = FS.parseResults(`1 3 512269 Marco Odermatt SUI 2:15.33
Non partiti 2ª manche: Timon Haugan
Non partiti: Thomas Tumler`, men, { runs: true });
ok(it.nf.indexOf('m-timon-haugan') >= 0 && it.ns.indexOf('m-thomas-tumler') >= 0, 'Italian headings: non partiti 2ª manche vs non partiti');
