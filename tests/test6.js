// Technical (GS+SL) and speed (DH+SG) standings: per team totals and per giornata
const FS = require('/home/claude/fantaski/src/core.js');
const S0 = FS.view(FS.migrate(JSON.parse(require('fs').readFileSync('/home/claude/fantaski/build/state.json', 'utf8'))));
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
let S = FS.clone(S0);
S.races.forEach(r => { r.x = 1; });
S.teams = [{ id: 't1', name: 'A', owner: '' }, { id: 't2', name: 'B', owner: '' }];
const st = S.league.seasonStart;
const buys = [['m-marco-odermatt', 't1', 100], ['m-loic-meillard', 't1', 50], ['m-franjo-von-allmen', 't2', 60], ['m-vincent-kriechmayr', 't2', 50],
  ['m-henrik-kristoffersen', 't2', 40], ['m-dominik-paris', 't1', 40]];
S = FS.applyAll(S, buys.map(([a, t, price], i) => ({ k: 'buy', id: 'p' + i, a, t, price, from: st }))).S;
const gs = S.races.find(r => r.t === 'GS' && r.g === 'M'), dh = S.races.find(r => r.t === 'DH' && r.g === 'M');
FS.apply(S, { k: 'lu', r: gs.id, t: 't1', lu: { t: ['m-marco-odermatt', 'm-loic-meillard'], r: null } });
FS.apply(S, { k: 'lu', r: gs.id, t: 't2', lu: { t: ['m-henrik-kristoffersen', 'm-vincent-kriechmayr'], r: null } });
FS.apply(S, { k: 'lu', r: dh.id, t: 't1', lu: { t: ['m-marco-odermatt', 'm-dominik-paris'], r: null } });
FS.apply(S, { k: 'lu', r: dh.id, t: 't2', lu: { t: ['m-franjo-von-allmen', 'm-vincent-kriechmayr'], r: null } });
FS.apply(S, { k: 'res', r: gs.id, list: [['m-marco-odermatt', 1, 1, 1, 1], ['m-henrik-kristoffersen', 2, 3, 2, 2], ['m-loic-meillard', 3, 2, 3, 3]], dns: [], src: 't', at: 'x' });
FS.apply(S, { k: 'res', r: dh.id, list: [['m-franjo-von-allmen', 1, 3], ['m-marco-odermatt', 2, 5], ['m-vincent-kriechmayr', 3, 7], ['m-dominik-paris', 4, 9]], dns: [], src: 't', at: 'x' });
const C = FS.compute(S), A = C.T.t1, B = C.T.t2;
ok(A.byC.T === A.byD.GS + A.byD.SL && A.byC.V === A.byD.DH + A.byD.SG, 'team A: technical and speed totals add up the disciplines');
ok(A.byC.T + A.byC.V === A.total && B.byC.T + B.byC.V === B.total, 'technical + speed = overall');
ok(A.byC.T === 170 && B.byC.T === 80, 'GS: A 100 + best 2nd run 10 + 60 = 170, B 80 (got ' + A.byC.T + ', ' + B.byC.T + ')');
ok(A.byC.V === 130 && B.byC.V === 160, 'DH: A 80+50 = 130, B 100+60 = 160 (got ' + A.byC.V + ', ' + B.byC.V + ')');
const gk = C.raceG[gs.id], dk = C.raceG[dh.id];
ok(A.byGC[gk].T === 170 && (gk !== dk || A.byGC[dk].V === 130), 'per giornata split');
