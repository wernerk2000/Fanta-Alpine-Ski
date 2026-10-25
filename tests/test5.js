const FS = require('/home/claude/fantaski/src/core.js');
const fs = require('fs');
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const ROOT0 = FS.migrate(JSON.parse(fs.readFileSync('/home/claude/fantaski/build/state.json', 'utf8')));

// ---- migration of a single-league page (the format published so far)
const V0 = FS.view(ROOT0, 'l1');
const old = { rev: 'x', league: V0.league, teams: V0.teams, purchases: [{ id: 'p0', a: 'm-marco-odermatt', t: 't1', price: 100, from: V0.league.seasonStart }], lineups: {}, athletes: V0.athletes, races: V0.races, results: {}, excluded: [] };
const mig = FS.migrate(FS.clone(old));
ok(mig.leagues.length === 1 && mig.leagues[0].purchases.length === 1 && !mig.league && !mig.teams, 'old page becomes one league, nothing lost');
ok(FS.view(mig, 'l1').purchases[0].a === 'm-marco-odermatt', 'the view of that league sees its purchases');

// ---- several leagues
let R = FS.clone(ROOT0);
const st = V0.league.seasonStart;
const base = FS.clone(V0.league); base.name = 'Ski team'; base.malusDnf = 0; base.malusOut = { dnf: [0, 0, 0], dnq: [0, 0, 0] };
ok(FS.applyOp(R, { k: 'lgAdd', item: { id: 'l2', league: base, teams: [{ id: 'x1', name: 'Rossi', owner: '' }, { id: 'x2', name: 'Bianchi', owner: '' }], purchases: [], lineups: {} } }), 'second league created');
ok(!FS.applyOp(R, { k: 'lgAdd', item: { id: 'l2', league: base, teams: [], purchases: [], lineups: {} } }), 'league ids are unique');
ok(FS.applyOp(R, { k: 'buy', lg: 'l1', id: 'b1', a: 'm-marco-odermatt', t: 't1', price: 150, from: st }), 'Odermatt to Squadra 1 in league 1');
ok(FS.applyOp(R, { k: 'buy', lg: 'l2', id: 'b2', a: 'm-marco-odermatt', t: 'x1', price: 90, from: st }), 'the same athlete can be bought in another league');
ok(!FS.applyOp(R, { k: 'buy', lg: 'l2', id: 'b3', a: 'm-marco-odermatt', t: 'x2', price: 10, from: st }), 'but only once per league');
ok(!FS.applyOp(R, { k: 'buy', lg: 'l2', id: 'b4', a: 'm-loic-meillard', t: 't1', price: 10, from: st }), 'a team of league 1 cannot buy in league 2');
ok(FS.applyOp(R, { k: 'buy', id: 'b5', a: 'm-loic-meillard', t: 't2', price: 40, from: st }) && R.leagues[0].purchases.length === 2, 'an op without league goes to the first league');
ok(FS.applyOp(R, { k: 'claim', lg: 'l1', t: 't1', uid: 'u1' }) && FS.applyOp(R, { k: 'claim', lg: 'l2', t: 'x1', uid: 'u1' }), 'one person can have a team in each league');
ok(!FS.applyOp(R, { k: 'claim', lg: 'l2', t: 'x2', uid: 'u1' }), 'but one team per league');
ok(FS.applyOp(R, { k: 'unbuy', lg: 'l1', id: 'b5' }) && R.leagues[0].purchases.length === 1, 'removing a purchase sticks in the right league');
ok(FS.applyOp(R, { k: 'teamDel', lg: 'l2', id: 'x2' }) && R.leagues[1].teams.length === 1, 'removing a team sticks in the right league');
ok(FS.applyOp(R, { k: 'set', lg: 'l2', f: { budget: 300 } }) && R.leagues[1].league.budget === 300 && R.leagues[0].league.budget === 500, 'settings are per league');
ok(!FS.applyOp(R, { k: 'lgDel', id: 'l2' }), 'a league with purchases cannot be deleted');

// shared results, scored with each league's rules
ok(FS.applyOp(R, { k: 'res', r: 'm01', list: [['m-loic-meillard', 2, 4]], dns: [], dnf: ['m-marco-odermatt'], nc: [], src: 't', at: 'x' }), 'results entered once');
const C1 = FS.compute(FS.view(R, 'l1')), C2 = FS.compute(FS.view(R, 'l2'));
ok(C1.raceRes.m01.teams.t1.score === -10, 'league 1: Odermatt out = −10 (got ' + C1.raceRes.m01.teams.t1.score + ')');
ok(C2.raceRes.m01.teams.x1.score === 0, 'league 2 has no DNF malus: 0 (got ' + C2.raceRes.m01.teams.x1.score + ')');
ok(!FS.applyOp(R, { k: 'lgDel', id: 'l9' }), 'unknown league');

// replaying saved ops on the published root
const ops = [{ k: 'lgAdd', item: { id: 'l3', league: base, teams: [{ id: 'y1', name: 'Uno', owner: '' }], purchases: [], lineups: {} } }, { k: 'teamSet', lg: 'l3', id: 'y1', name: 'Primo' }, { k: 'lgDel', id: 'l3' }];
const A = FS.applyAll(ROOT0, ops);
ok(A.dropped === 0 && A.S.leagues.length === 1 && ROOT0.leagues.length === 1, 'applyAll replays league ops on a copy');
