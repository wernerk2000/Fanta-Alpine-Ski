delete require.cache;
const FS = require('/home/claude/fantaski/src/core.js');
const S0 = FS.view(FS.migrate(JSON.parse(require('fs').readFileSync('/home/claude/fantaski/build/state.json', 'utf8'))));
// these tests use Adelboden (m21 GS, m22 SL) as a ×1.5 race, whatever the league's calendar says
S0.races.forEach(r => { if (r.id === 'm21' || r.id === 'm22') r.x = 1.5; });
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
let S = FS.clone(S0);
const st = S.league.seasonStart;
const buys = [['m-marco-odermatt', 't1', 150], ['m-marco-schwarz', 't1', 30], ['m-loic-meillard', 't1', 50], ['m-stefan-brennsteiner', 't1', 25],
  ['m-henrik-kristoffersen', 't1', 40], ['m-timon-haugan', 't1', 35], ['m-alex-vinatzer', 't2', 20], ['m-lucas-pinheiro-braathen', 't2', 90],
  ['f-julia-scheib', 't2', 40], ['m-thomas-tumler', 't1', 5]];
const r = FS.applyAll(S, buys.map(([a, t, price], i) => ({ k: 'buy', id: 'p' + i, a, t, price, from: st })));
S = r.S;
ok(r.dropped === 1 && !S.purchases.some(p => p.a === 'm-thomas-tumler'), '7th man blocked (6 per gender)');
ok(FS.teamState(S, 't1').maxBid === (500 - 330) - (12 - 6 - 1), 'max bid after 6 buys');
// lineups
ok(!FS.apply(S, { k: 'lu', r: 'm01', t: 't1', lu: { t: ['m-alex-vinatzer'], r: null } }), 'cannot field an athlete of another team');
ok(!FS.apply(S, { k: 'lu', r: 'm01', t: 't2', lu: { t: ['f-julia-scheib'], r: null } }), 'cannot field a woman in a men race');
ok(!FS.apply(S, { k: 'lu', r: 'm01', t: 't1', lu: { t: ['m-loic-meillard', 'm-marco-schwarz', 'm-timon-haugan'], r: null } }), 'max 2 starters');
ok(FS.apply(S, { k: 'lu', r: 'm01', t: 't1', lu: { t: ['m-loic-meillard', 'm-marco-schwarz'], r: 'm-stefan-brennsteiner' } }), 'valid lineup accepted');
// results with Meillard not starting -> reserve in
FS.apply(S, { k: 'res', r: 'm01', list: [['m-marco-odermatt', 1], ['m-marco-schwarz', 2], ['m-lucas-pinheiro-braathen', 3], ['m-stefan-brennsteiner', 10], ['m-alex-vinatzer', 12]], dns: ['m-loic-meillard'], src: 't', at: 'x' });
let C = FS.compute(S);
ok(C.raceRes.m01.teams.t1.score === 80 + 26 && C.raceRes.m01.teams.t1.subIn, 't1: Schwarz 80 + reserve Brennsteiner 26 (got ' + C.raceRes.m01.teams.t1.score + ')');
ok(C.eff.m01.t2.src === 'automatica' && C.raceRes.m01.teams.t2.score === 60 + 22, 't2 automatic lineup by GS points: Braathen 60 + Vinatzer 22 (got ' + C.raceRes.m01.teams.t2.score + ')');
ok(C.eff.m05.t1.src === 'ultima' && C.eff.m05.t1.t.join() === 'm-loic-meillard,m-marco-schwarz', 'next GS carries the last GS lineup');
ok(C.eff.m02.t1.src === 'ultima', 'Levi SL falls back to last men lineup');
// no substitution when the starter started but finished outside the points
FS.apply(S, { k: 'res', r: 'm01', list: [['m-marco-schwarz', 2], ['m-stefan-brennsteiner', 10]], dns: [], src: 't', at: 'x' });
C = FS.compute(S);
ok(C.raceRes.m01.teams.t1.score === 80 && !C.raceRes.m01.teams.t1.subIn, 'reserve stays out if starter raced (got ' + C.raceRes.m01.teams.t1.score + ')');
// scale options
const L = { scale: 'lin', bonus30: 20 }, race = S.races.find(x => x.id === 'm01'), fin = S.races.find(x => x.id === 'm42');
ok(FS.fantaPts(1, race, L) === 50 && FS.fantaPts(20, race, L) === 31 && FS.fantaPts(31, race, L) === 0, 'linear + bonus 20');
ok(FS.fantaPts(1, race, { scale: 'fis', bonus30: 20 }) === 120 && FS.fantaPts(16, fin, { bonus30: 20 }) === 0, 'fis + bonus, finals top 15 only');
S.league.bonus30 = 20; C = FS.compute(S);
ok(C.raceRes.m01.teams.t1.score === 100, 'bonus applied in compute: Schwarz 80+20 (got ' + C.raceRes.m01.teams.t1.score + ')');
S.league.bonus30 = 0;
// classics multiplier and released starter replaced by reserve
FS.apply(S, { k: 'lu', r: 'm21', t: 't1', lu: { t: ['m-marco-schwarz', 'm-loic-meillard'], r: 'm-timon-haugan' } });
FS.apply(S, { k: 'release', id: 'p2', ts: '2026-12-01T10:00:00Z', refund: 25 });
FS.apply(S, { k: 'res', r: 'm21', list: [['m-marco-schwarz', 1], ['m-timon-haugan', 4]], dns: [], src: 't', at: 'x' });
C = FS.compute(S);
ok(C.raceRes.m21.teams.t1.score === 150 + 15 + 75, 'Adelboden x1.5, released Meillard replaced by reserve Haugan; Schwarz 2nd podium in a row in GS +15 (got ' + C.raceRes.m21.teams.t1.score + ')');
// parser: started / not started
const men = S0.athletes.filter(a => a.g === 'M');
const txt = `1 3 512269 ODERMATT Marco 1997 SUI 2:36.02
2 8 54320 SCHWARZ Marco 1995 AUT +0.24
Did not finish 1st run
15 512182 MEILLARD Loic SUI
Did not start 1st run
22 422507 HAUGAN Timon NOR`;
const p = FS.parseResults(txt, men);
ok(p.list.length === 2 && p.seen.includes('m-loic-meillard') && p.dnsSeen.includes('m-timon-haugan') && !p.seen.includes('m-timon-haugan'), 'parser separates DNF (started) from DNS');
ok(!p.seen.includes('m-henrik-kristoffersen') && !p.dnsSeen.includes('m-henrik-kristoffersen'), 'absent athlete in neither list');
