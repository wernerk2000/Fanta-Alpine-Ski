const FS = require('/home/claude/fantaski/src/core.js');
const S0 = FS.view(FS.migrate(JSON.parse(require('fs').readFileSync('/home/claude/fantaski/build/state.json', 'utf8'))));
// these tests use Adelboden (m21 GS, m22 SL) as a ×1.5 race, whatever the league's calendar says
S0.races.forEach(r => { if (r.id === 'm21' || r.id === 'm22') r.x = 1.5; });
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const L = S0.league;
const race = id => S0.races.find(r => r.id === id);
const GS = race('m01'), DH = race('m06'), SLx = race('m22'), GSfin = race('m42');

// ---- start-number bonus
ok(FS.bibBonus(4, 16, GS, L, 5) === 15, 'GS bib 16, 4th: +15');
ok(FS.bibBonus(3, 16, GS, L, 5) === 25 && FS.bibBonus(1, 16, GS, L, 5) === 40, 'GS bib 16: podium +25, win +40');
ok(FS.bibBonus(6, 16, GS, L, 5) === 0, 'GS bib 16, 6th: no bonus');
ok(FS.bibBonus(1, 15, GS, L, 5) === 0, 'GS bib 15 wins: no bonus');
ok(FS.bibBonus(1, 18, DH, L, 5) === 0 && FS.bibBonus(2, 21, DH, L, 5) === 25, 'DH: bib 18 none, bib 21 2nd +25');
ok([30, 12, 4, 2, 1].map(k => FS.bibBonus(k, 31, GS, L, 5)).join() === '10,20,35,50,75', 'bib 31+: 10/20/35/50/75');
ok(FS.bibBonus(31, 40, GS, L, 5) === 0, 'outside the 30: nothing');
const Lq = Object.assign({}, L, { bibMaxQ: 20 });
ok(FS.bibBonus(1, 40, GS, Lq, 25) === 0 && FS.bibBonus(1, 40, GS, Lq, 10) === 75, 'quotation cap');

// ---- second-run bonuses and full score
let s = FS.scoreOf({ rank: 6, bib: 34, r1: 18, r2: 1 }, GS, L, 5, null, 1);
ok(s.base === 40 && s.bBib === 20 && s.bGain === 12 && s.bBest === 10 && s.v === 82, 'GS 6th, bib 34, 18th after run 1, best run 2 = 82 (got ' + s.v + ')');
s = FS.scoreOf({ rank: 6, bib: 34, r1: 18, r2: 1 }, SLx, L, 5, null, 1.5);
ok(s.v === 123 && s.bGain === 18 && s.bBest === 15, 'same in Adelboden SL x1.5 = 123 (got ' + s.v + ')');
s = FS.scoreOf({ rank: 6, bib: 34, r1: 18, r2: 1 }, DH, L, 5, null, 1);
ok(s.bGain === 0 && s.bBest === 0 && s.v === 60, 'downhill ignores run data (got ' + s.v + ')');
s = FS.scoreOf({ rank: 5, bib: 0, r1: 3, r2: 2 }, GS, L, 5, null, 1);
ok(s.bGain === 0 && s.v === 45, 'losing places gives no malus');
ok(FS.scoreOf({ rank: 31, bib: 45, r1: 40, r2: 1 }, GS, L, 5, null, 1).v === 0, 'outside the points: no bonus at all');
ok(FS.scoreOf({ rank: 16, bib: 45, r1: 20, r2: 1 }, GSfin, L, 5, null, 1.5).v === 0, 'finals: 16th scores nothing');
ok(FS.streakBonus({ p: 2, w: 1 }, L).v === 10 && FS.streakBonus({ p: 3, w: 2 }, L).v === 20 && FS.streakBonus({ p: 1, w: 1 }, L).v === 0, 'streak: podium +10, win +20, single none');
ok(FS.pack('a', 3, 0, 0, 0).length === 2 && FS.pack('a', 3, 0, 5, 0).join() === 'a,3,0,5', 'entries drop trailing zeros');

// ---- streaks in the season
let S = FS.clone(S0);
S.purchases.push({ id: 'p1', a: 'm-marco-odermatt', t: 't1', price: 150, from: L.seasonStart });
S.purchases.push({ id: 'p2', a: 'm-loic-meillard', t: 't1', price: 50, from: L.seasonStart });
const res = (r, list) => FS.apply(S, { k: 'res', r, list, dns: [], src: 't', at: 'x' });
res('m01', [['m-marco-odermatt', 1], ['m-loic-meillard', 2]]);
res('m02', [['m-loic-meillard', 1]]);                    // slalom in between: no effect on GS streaks
res('m05', [['m-marco-odermatt', 1], ['m-loic-meillard', 3]]);
res('m09', [['m-marco-odermatt', 2], ['m-loic-meillard', 9]]);
res('m10', [['m-marco-odermatt', 5]]);
res('m14', [['m-marco-odermatt', 1]]);
FS.apply(S, { k: 'raceSet', r: 'm19', f: { st: 'canc' } });
res('m21', [['m-marco-odermatt', 3]]);
let C = FS.compute(S);
const P = (r, a) => C.raceRes[r].pts[a].s;
ok(P('m01', 'm-marco-odermatt').bSer === 0, 'first win: no streak');
ok(P('m05', 'm-marco-odermatt').bSer === 20 && P('m05', 'm-marco-odermatt').v === 120, '2nd GS win in a row: +20 (got ' + P('m05', 'm-marco-odermatt').v + ')');
ok(P('m05', 'm-loic-meillard').bSer === 10 && P('m05', 'm-loic-meillard').serN === 2, 'Meillard 2nd then 3rd: 2nd podium in a row +10');
ok(P('m09', 'm-marco-odermatt').bSer === 10 && P('m09', 'm-marco-odermatt').serK === 'p' && P('m09', 'm-marco-odermatt').serN === 3, 'win streak ends, podium streak goes on: +10');
ok(P('m10', 'm-marco-odermatt').bSer === 0, '5th place: no bonus');
ok(P('m14', 'm-marco-odermatt').bSer === 0, 'streak restarts after a race without podium');
ok(P('m21', 'm-marco-odermatt').bSer === 15 && P('m21', 'm-marco-odermatt').v === 105, 'cancelled race skipped, Adelboden x1.5: 60*1.5 + 10*1.5 = 105 (got ' + P('m21', 'm-marco-odermatt').v + ')');
const t1 = C.raceRes.m05.teams.t1;
ok(t1.score === 120 + 60 + 10, 't1 at Copper GS: Odermatt 120 + Meillard 70 (got ' + t1.score + ')');
ok(t1.items[0].s && t1.items[0].s.bonus === 20, 'items carry the breakdown');

// ---- parser with run times
const paste = `Rank Bib FIS Code Name Year Nation Run 1 Run 2 Total Time Diff. FIS Points Cup Points
1 3 512269 ODERMATT Marco 1997 SUI 1:07.12 1:08.21 2:15.33 0.00 100
2 34 6190558 NEWMAN Pierre 2004 FRA 1:08.50 1:06.90 2:15.40 +0.07 1.10 80
3 7 512182 MEILLARD Loic 1996 SUI 1:07.40 1:08.10 2:15.50 +0.17 2.65 60
4 1 422304 KRISTOFFERSEN Henrik 1994 NOR 1:07.30 1:08.30 2:15.60 +0.27 4.20 50
Did not finish 2nd run
12 54320 FASTGUY Some 1999 AUT 1:07.00
Did not start 1st run
44 512124 TUMLER Thomas 1989 SUI`;
const men = S0.athletes.filter(a => a.g === 'M');
let pr = FS.parseResults(paste, men, { runs: true });
const E = id => pr.list.find(x => x[0] === id);
ok(pr.matched === 3 && pr.runs === 3, 'three athletes, run times for all (' + pr.matched + '/' + pr.runs + ')');
ok(E('m-marco-odermatt').join() === 'm-marco-odermatt,1,3,2,3', 'Odermatt: 1st, bib 3, 2nd after run 1 (the DNF counts), 3rd time in run 2 → ' + E('m-marco-odermatt').join());
ok(E('m-loic-meillard').join() === 'm-loic-meillard,3,7,4,2', 'Meillard: 3rd, bib 7, 4th after run 1, 2nd time in run 2 → ' + E('m-loic-meillard').join());
ok(E('m-henrik-kristoffersen').join() === 'm-henrik-kristoffersen,4,1,3,4', 'Kristoffersen: 4th, bib 1, 3rd after run 1 → ' + E('m-henrik-kristoffersen').join());
ok(pr.dnsSeen.indexOf('m-thomas-tumler') >= 0, 'DNS section still recognised');
pr = FS.parseResults(paste, men, { runs: false });
ok(pr.list.every(x => x.length <= 3), 'without runs option: only rank and bib');
const dhPaste = `1 5 512269 ODERMATT Marco 1997 SUI 1:52.34 100
2 9 512182 MEILLARD Loic 1996 SUI 1:52.80 +0.46 80`;
pr = FS.parseResults(dhPaste, men, { runs: true });
ok(pr.runs === 0 && pr.list.length === 2 && pr.list[0].join() === 'm-marco-odermatt,1,5', 'single-run race: no run data → ' + JSON.stringify(pr.list));
// times with comma decimals and run ranks in brackets
const itPaste = `1 3 512269 Marco Odermatt SUI 1:07,12 (2) 1:08,21 (3) 2:15,33
2 7 512182 Loïc Meillard SUI 1:07,40 (4) 1:08,10 (2) 2:15,50 +0,17`;
pr = FS.parseResults(itPaste, men, { runs: true });
ok(pr.runs === 2 && pr.list[1].join() === 'm-loic-meillard,2,7,2,1', 'comma decimals and bracketed run ranks → ' + JSON.stringify(pr.list));
