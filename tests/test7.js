// The organiser assigns teams to people: 'assign' moves a person to a team, frees the old one, frees a team
const FS = require('/home/claude/fantaski/src/core.js');
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const R = FS.migrate({ leagues: [{ id: 'l1', league: {}, teams: [{ id: 't1', name: 'Squadra 1', owner: '' }, { id: 't2', name: 'Squadra 2', owner: '' }, { id: 't3', name: 'Squadra 3', owner: 'Anna' }], purchases: [], lineups: {} }], athletes: [], races: [], results: {} });
let r = FS.applyAll(R, [{ k: 'claim', lg: 'l1', t: 't1', uid: 'u1' }]);
ok(!r.dropped && r.S.leagues[0].teams[0].uid === 'u1', 'a player claims a free team');
r = FS.applyAll(r.S, [{ k: 'claim', lg: 'l1', t: 't2', uid: 'u1' }]);
ok(r.dropped === 1, 'a second team cannot be claimed');
r = FS.applyAll(r.S, [{ k: 'assign', lg: 'l1', t: 't2', uid: 'u1', owner: 'Nico' }]);
let T = r.S.leagues[0].teams;
ok(!r.dropped && T[1].uid === 'u1' && T[1].owner === 'Nico' && !T[0].uid && T[0].owner === '', 'the organiser moves the player: old team freed and unnamed');
r = FS.applyAll(r.S, [{ k: 'assign', lg: 'l1', t: 't2', uid: '' }]);
T = r.S.leagues[0].teams;
ok(!r.dropped && !T[1].uid && T[1].owner === '', 'the organiser frees a team');
r = FS.applyAll(r.S, [{ k: 'assign', lg: 'l1', t: 'tx', uid: 'u1' }]);
ok(r.dropped === 1, 'an unknown team is refused');
ok(r.S.leagues[0].teams[2].owner === 'Anna', 'other teams untouched');
