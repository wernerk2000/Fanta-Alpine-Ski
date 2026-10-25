var FS = (function () {
  'use strict';
  var PTS = [100, 80, 60, 50, 45, 40, 36, 32, 29, 26, 24, 22, 20, 18, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  var CAT = { GS: 'T', SL: 'T', DH: 'V', SG: 'V' };
  var DIDX = { DH: 0, SG: 1, GS: 2, SL: 3 };
  var GENDERS = ['M', 'F'];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function rid(p) { return (p || '') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
  function r1(x) { return Math.round(x * 10) / 10; }

  // ---- Europe/Rome time (EU summer time: last Sunday of March -> last Sunday of October, 01:00 UTC)
  function lastSundayUTC(y, m) {
    var d = new Date(Date.UTC(y, m + 1, 0));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.getTime() + 3600e3;
  }
  function romeTime(ds, hour, min) {
    var y = +ds.slice(0, 4), mo = +ds.slice(5, 7) - 1, da = +ds.slice(8, 10);
    var guess = Date.UTC(y, mo, da, hour - 1, min || 0);
    var off = (guess >= lastSundayUTC(y, 2) && guess < lastSundayUTC(y, 9)) ? 2 : 1;
    return Date.UTC(y, mo, da, hour - off, min || 0);
  }
  function weekKey(ds) {
    var d = new Date(Date.UTC(+ds.slice(0, 4), +ds.slice(5, 7) - 1, +ds.slice(8, 10)));
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return 'w' + d.toISOString().slice(0, 10);
  }
  function cmpRace(a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.g < b.g ? -1 : a.g > b.g ? 1 : (a.id < b.id ? -1 : 1)); }
  // start of the race (first run), Italian time "HH:MM"; null when not known yet
  function startOf(r) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(r.h || '');
    return m ? romeTime(r.d, +m[1], +m[2]) : null;
  }
  // lineups close a set time before the start (default one hour); at lockHour on race day while the start is unknown
  function lockOf(S, r) {
    var st = startOf(r), L = S.league || {};
    return st != null ? st - (L.lockBefore != null ? L.lockBefore : 60) * 60000 : romeTime(r.d, L.lockHour || 9);
  }

  function giornate(S) {
    var by = {};
    S.races.forEach(function (r) { var k = weekKey(r.d); (by[k] = by[k] || []).push(r); });
    return Object.keys(by).sort().map(function (k, i) {
      var rs = by[k].slice().sort(cmpRace);
      return { k: k, n: i + 1, races: rs, from: rs[0].d, to: rs[rs.length - 1].d };
    });
  }

  // official World Cup points (what the FIS awards)
  function cupPts(rank, race) {
    if (!rank || rank < 1 || rank > 30) return 0;
    if (race.fin && rank > 15) return 0;
    return PTS[rank - 1];
  }
  // fanta points: the league's scale (World Cup table or linear 30..1) plus a flat bonus for every finish in the points
  function scalePts(rank, L) { return (L && L.scale === 'lin') ? 31 - rank : PTS[rank - 1]; }
  // start-number bonus: only the highest tier counts; in DH/SG the first 20 bibs belong to the top 20 of the start list
  var TIERS = [1, 3, 5, 15, 30];
  function bibGroup(bib, race, L) {
    if (!bib || !L || !L.bib) return null;
    if (bib > (L.bibLate || 30)) return 'late';
    if (bib > (CAT[race.t] === 'V' ? (L.bibMidSpeed || 20) : (L.bibMid || 15))) return 'mid';
    return null;
  }
  function bibBonus(rank, bib, race, L, q) {
    var grp = bibGroup(bib, race, L);
    if (!grp || !rank) return 0;
    if (L.bibMaxQ && q > L.bibMaxQ) return 0;
    var tbl = L.bib[grp] || {};
    for (var i = 0; i < TIERS.length; i++) if (rank <= TIERS[i] && tbl[TIERS[i]]) return tbl[TIERS[i]];
    return 0;
  }
  function fantaPts(rank, race, L, bib, q) {
    if (!cupPts(rank, race)) return 0;
    return scalePts(rank, L) + ((L && L.bonus30) || 0) + bibBonus(rank, bib, race, L, q);
  }
  // result entry: [athlete, rank, bib, place after run 1, place of the run-2 time]; 0 = unknown, trailing zeros dropped
  function entry(x) { return { a: x[0], rank: x[1], bib: x[2] || 0, r1: x[3] || 0, r2: x[4] || 0 }; }
  function pack(a, rank, bib, p1, p2) {
    var x = [a, rank, +bib || 0, +p1 || 0, +p2 || 0];
    while (x.length > 2 && !x[x.length - 1]) x.pop();
    return x;
  }
  // second-run bonuses, giant slalom and slalom only: best run-2 time, and every place gained on the run-1 standing
  function runBonus(e, race, L) {
    var b = { gain: 0, best: 0 };
    if (!L || CAT[race.t] !== 'T') return b;
    if (L.run2Gain && e.r1 > e.rank) b.gain = (e.r1 - e.rank) * L.run2Gain;
    if (L.run2Best && e.r2 === 1) b.best = L.run2Best;
    return b;
  }
  // streak bonus: podiums or wins in consecutive races of the same discipline, from the second in a row; the higher one counts
  function streakBonus(sk, L) {
    var w = sk && sk.w >= 2 ? ((L && L.streakWin) || 0) : 0, p = sk && sk.p >= 2 ? ((L && L.streakPod) || 0) : 0;
    if (!w && !p) return { v: 0, k: null, n: 0 };
    return w >= p ? { v: w, k: 'w', n: sk.w } : { v: p, k: 'p', n: sk.p };
  }
  // first seed group: bibs 1-7 in giant slalom and slalom; in downhill and super-G the top 10 of the start list choose the odd bibs 1-19
  function firstGroup(bib, race, L) {
    if (!bib) return false;
    if (CAT[race.t] === 'V') return bib <= 19 && bib % 2 === 1;
    return bib <= ((L && L.topGroup) || 7);
  }
  // maluses by start number, in three bands: bibs 1-15, 16-30, from 31 (bibMid, bibLate).
  // dnf: out of the race (fell, disqualified, did not start run 2); dnq: not qualified for run 2 (giant slalom and slalom).
  // league setting malusOut {dnf: [..3], dnq: [..3]}; without it, the rule of 2026/27: dnf 10/10/0, dnq 10/5/0
  // (a league saved earlier keeps its own DNF malus for bibs 1-30; with none, it has no DNQ malus either)
  var MALUS_OUT = { dnf: [10, 10, 0], dnq: [10, 5, 0] };
  function outBands(L, k) {
    var m = L && L.malusOut && L.malusOut[k];
    if (m && m.length === 3) return m;
    var md = L && L.malusDnf != null ? L.malusDnf : 10;
    return k === 'dnf' ? [md, md, 0] : md ? MALUS_OUT.dnq : [0, 0, 0];
  }
  // an unknown bib (0): the first band for who went out, nothing for who did not qualify
  function outMalus(k, bib, L) {
    var b = outBands(L, k), mid = (L && L.bibMid) || 15, late = (L && L.bibLate) || 30;
    if (!bib) return k === 'dnf' ? b[0] : 0;
    return bib > late ? b[2] : bib > mid ? b[1] : b[0];
  }
  function dnfMalus(bib, L) { return outMalus('dnf', bib, L); }
  // full fanta score of one athlete in one race, multiplier included.
  // Bonuses need a finish in the points. Maluses: not finishing (and then nothing else), not qualifying for run 2
  // (st 'nq'), a first-group athlete outside the top 15, the run-1 leader outside the top 5; only the heaviest counts.
  function scoreOf(e, race, L, q, sk, mult) {
    var m = mult || 1, o = { base: 0, bBib: 0, bGain: 0, bBest: 0, bSer: 0, serK: null, serN: 0, bonus: 0, mDnf: 0, mDnq: 0, mTop: 0, mLead: 0, malus: 0, v: 0 };
    L = L || {};
    if (e.st === 'dnf') {
      o.mDnf = r1(-outMalus('dnf', e.bib, L) * m);
      o.malus = o.v = o.mDnf;
      return o;
    }
    if (cupPts(e.rank, race)) {
      var rb = runBonus(e, race, L), sb = streakBonus(sk, L);
      o.base = r1((scalePts(e.rank, L) + (L.bonus30 || 0)) * m);
      o.bBib = r1(bibBonus(e.rank, e.bib, race, L, q) * m);
      o.bGain = r1(rb.gain * m);
      o.bBest = r1(rb.best * m);
      o.bSer = r1(sb.v * m); o.serK = sb.k; o.serN = sb.n;
      o.bonus = r1(o.bBib + o.bGain + o.bBest + o.bSer);
    }
    var top = L.malusTop && firstGroup(e.bib, race, L) && !(e.rank >= 1 && e.rank <= 15) ? L.malusTop : 0;
    var lead = L.malusLead && CAT[race.t] === 'T' && e.r1 === 1 && !(e.rank >= 1 && e.rank <= 5) ? L.malusLead : 0;
    var nq = e.st === 'nq' && CAT[race.t] === 'T' ? outMalus('dnq', e.bib, L) : 0;
    if (nq && nq >= top && nq >= lead) o.mDnq = r1(-nq * m);
    else if (top || lead) { if (top >= lead) o.mTop = r1(-top * m); else o.mLead = r1(-lead * m); }
    o.malus = r1(o.mTop + o.mLead + o.mDnq);
    o.v = r1(o.base + o.bonus + o.malus);
    return o;
  }

  function findBy(arr, id) { for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i]; return null; }

  function credits(S, tid) {
    var c = S.league.budget;
    S.purchases.forEach(function (p) { if (p.t === tid) { c -= p.price; if (p.to) c += (p.refund || 0); } });
    return c;
  }

  function teamState(S, tid) {
    var roster = S.purchases.filter(function (p) { return p.t === tid && !p.to; });
    var slots = { M: 0, F: 0 };
    roster.forEach(function (p) { var a = findBy(S.athletes, p.a); if (a) slots[a.g] = (slots[a.g] || 0) + 1; });
    var per = S.league.perGender || 6, max = per * 2, cr = credits(S, tid), empty = max - roster.length;
    return { roster: roster, slots: slots, per: per, size: roster.length, max: max, credits: cr, empty: empty, maxBid: empty > 0 ? cr - (empty - 1) : 0 };
  }

  function ownerNow(S, aid) {
    for (var i = 0; i < S.purchases.length; i++) { var p = S.purchases[i]; if (p.a === aid && !p.to) return p; }
    return null;
  }

  function canBuy(S, tid, aid, price) {
    var a = findBy(S.athletes, aid);
    if (!a) return { ok: false, why: 'Atleta non trovato' };
    if (!findBy(S.teams, tid)) return { ok: false, why: 'Squadra non trovata' };
    if (ownerNow(S, aid)) return { ok: false, why: 'È già in una squadra' };
    var ts = teamState(S, tid);
    if ((ts.slots[a.g] || 0) >= ts.per) return { ok: false, why: 'Questa squadra ha già ' + ts.per + (a.g === 'M' ? ' uomini' : ' donne') };
    if (!(price >= 1) || Math.floor(price) !== price) return { ok: false, why: 'Il prezzo minimo è 1 credito' };
    if (price > ts.maxBid) return { ok: false, why: 'Offerta massima per questa squadra: ' + ts.maxBid };
    return { ok: true };
  }

  // athletes of a team, of one gender, owned at a given moment
  function rosterAt(S, tid, g, ms) {
    var out = [];
    S.purchases.forEach(function (p) {
      if (p.t !== tid) return;
      var a = findBy(S.athletes, p.a);
      if (!a || a.g !== g) return;
      var f = Date.parse(p.from), to = p.to ? Date.parse(p.to) : Infinity;
      if (f < ms && to > ms) out.push(p.a);
    });
    return out;
  }

  // a lineup may use the athletes the team has when the race closes: the same roster the scores use,
  // also when the organiser corrects a race that is already closed
  function checkLineup(S, r, tid, lu) {
    if (!lu) return true;
    var starters = S.league.starters || 2;
    var t = (lu.t || []).filter(Boolean), res = lu.r || null;
    if (t.length > starters) return false;
    var all = t.concat(res ? [res] : []);
    if (new Set(all).size !== all.length) return false;
    var ro = rosterAt(S, tid, r.g, lockOf(S, r));
    return all.every(function (a) { return ro.indexOf(a) >= 0; });
  }

  // ---- operations (the only way the league state changes)
  function apply(S, op) {
    var t, a, r, p, n;
    switch (op.k) {
      case 'teamAdd':
        if (findBy(S.teams, op.id)) return false;
        S.teams.push({ id: op.id, name: op.name || 'Nuova squadra', owner: op.owner || '' }); return true;
      case 'teamSet':
        t = findBy(S.teams, op.id); if (!t) return false;
        if (op.name != null) t.name = op.name;
        if (op.owner != null) t.owner = op.owner;
        if (op.uid != null) { if (op.uid) t.uid = op.uid; else delete t.uid; }
        return true;
      case 'claim':
        t = findBy(S.teams, op.t); if (!t || !op.uid) return false;
        if (t.uid && t.uid !== op.uid) return false;
        if (S.teams.some(function (x) { return x.uid === op.uid && x.id !== op.t; })) return false;
        t.uid = op.uid; return true;
      // the organiser links a team to a person (uid) or frees it (no uid); the person leaves any other team
      case 'assign':
        t = findBy(S.teams, op.t); if (!t) return false;
        if (op.uid) S.teams.forEach(function (x) { if (x.uid === op.uid && x.id !== op.t) { delete x.uid; x.owner = ''; } });
        if (op.uid) t.uid = op.uid; else { delete t.uid; t.owner = ''; }
        if (op.owner != null) t.owner = op.owner;
        return true;
      case 'teamDel':
        if (S.purchases.some(function (x) { return x.t === op.id; })) return false;
        n = S.teams.length; S.teams = S.teams.filter(function (x) { return x.id !== op.id; }); return S.teams.length < n;
      case 'buy':
        if (!canBuy(S, op.t, op.a, op.price).ok) return false;
        S.purchases.push({ id: op.id, a: op.a, t: op.t, price: op.price, from: op.from }); return true;
      case 'unbuy':
        n = S.purchases.length; S.purchases = S.purchases.filter(function (x) { return x.id !== op.id; }); return S.purchases.length < n;
      case 'release':
        p = findBy(S.purchases, op.id); if (!p || p.to) return false;
        p.to = op.ts; p.refund = op.refund; return true;
      case 'lu':
        r = findBy(S.races, op.r); if (!r || !findBy(S.teams, op.t)) return false;
        if (!checkLineup(S, r, op.t, op.lu)) return false;
        S.lineups[op.r] = S.lineups[op.r] || {};
        if (op.lu) S.lineups[op.r][op.t] = { t: (op.lu.t || []).filter(Boolean), r: op.lu.r || null };
        else delete S.lineups[op.r][op.t];
        return true;
      case 'res':
        r = findBy(S.races, op.r); if (!r) return false;
        S.results[op.r] = { list: op.list, dns: op.dns || [], dnf: op.dnf || [], nc: op.nc || [], src: op.src || 'manuale', at: op.at };
        if (r.st === 'canc') r.st = 'sched';
        return true;
      case 'resDel':
        if (!S.results[op.r]) return false; delete S.results[op.r]; return true;
      case 'raceSet':
        r = findBy(S.races, op.r); if (!r) return false;
        Object.keys(op.f).forEach(function (k) { r[k] = op.f[k]; }); return true;
      case 'raceAdd':
        if (findBy(S.races, op.race.id)) return false; S.races.push(op.race); return true;
      case 'athSet':
        a = findBy(S.athletes, op.a); if (!a) return false;
        Object.keys(op.f).forEach(function (k) { a[k] = op.f[k]; }); return true;
      case 'athAdd':
        if (findBy(S.athletes, op.ath.id)) return false; S.athletes.push(op.ath); return true;
      case 'set':
        Object.keys(op.f).forEach(function (k) { S.league[k] = op.f[k]; }); return true;
    }
    return false;
  }

  // ---- several leagues in one page: calendar, athletes and results are shared;
  // every league has its own settings, teams, purchases and lineups
  var LEAGUE_OPS = { teamAdd: 1, teamSet: 1, claim: 1, assign: 1, teamDel: 1, buy: 1, unbuy: 1, release: 1, lu: 1, set: 1 };
  function migrate(S) {
    if (!S.leagues) {
      S.leagues = [{ id: 'l1', league: S.league || {}, teams: S.teams || [], purchases: S.purchases || [], lineups: S.lineups || {} }];
      delete S.league; delete S.teams; delete S.purchases; delete S.lineups;
    }
    S.leagues.forEach(function (lg) { lg.league = lg.league || {}; lg.teams = lg.teams || []; lg.purchases = lg.purchases || []; lg.lineups = lg.lineups || {}; });
    S.results = S.results || {}; S.athletes = S.athletes || []; S.races = S.races || []; S.excluded = S.excluded || [];
    return S;
  }
  // one league seen as a single-league state: the engine works on this
  function view(S, lid) {
    var lg = findBy(S.leagues, lid) || S.leagues[0];
    return { lid: lg.id, league: lg.league, teams: lg.teams, purchases: lg.purchases, lineups: lg.lineups, athletes: S.athletes, races: S.races, results: S.results, excluded: S.excluded };
  }
  function applyOp(S, op) {
    var lg;
    if (op.k === 'lgAdd') {
      if (!op.item || !op.item.id || findBy(S.leagues, op.item.id)) return false;
      S.leagues.push(op.item); return true;
    }
    if (op.k === 'lgDel') {
      lg = findBy(S.leagues, op.id);
      if (!lg || S.leagues.length < 2 || lg.purchases.length) return false;
      S.leagues = S.leagues.filter(function (x) { return x.id !== op.id; }); return true;
    }
    lg = LEAGUE_OPS[op.k] && op.lg ? findBy(S.leagues, op.lg) : S.leagues[0];
    if (!lg) return false;
    var V = view(S, lg.id);
    if (!apply(V, op)) return false;
    lg.teams = V.teams; lg.purchases = V.purchases; lg.lineups = V.lineups; lg.league = V.league;
    return true;
  }
  function applyAll(base, ops) {
    var S = clone(base), kept = [], dropped = 0, root = !!S.leagues;
    (ops || []).forEach(function (op) { if (root ? applyOp(S, op) : apply(S, op)) kept.push(op); else dropped++; });
    return { S: S, kept: kept, dropped: dropped };
  }

  // automatic lineup: the athletes with most points last season in that discipline, then by price tag
  function autoLineup(S, A, ro, r) {
    var di = DIDX[r.t], starters = S.league.starters || 2;
    var arr = ro.slice().sort(function (x, y) {
      var ax = A[x], ay = A[y];
      return ((ay.p ? ay.p[di] : 0) - (ax.p ? ax.p[di] : 0)) || (ay.q - ax.q) || (x < y ? -1 : 1);
    });
    return { t: arr.slice(0, starters), r: arr[starters] || null };
  }

  // ---- scoring
  function compute(S) {
    var G = giornate(S), A = {}, T = {}, raceG = {}, raceRes = {}, ath = {}, eff = {}, locks = {};
    var starters = S.league.starters || 2;
    S.athletes.forEach(function (a) { A[a.id] = a; });
    S.teams.forEach(function (t) { T[t.id] = { id: t.id, total: 0, byG: {}, byD: { DH: 0, SG: 0, GS: 0, SL: 0 }, byC: { T: 0, V: 0 }, byGC: {}, byA: {} }; });
    G.forEach(function (g) { g.races.forEach(function (r) { raceG[r.id] = g.k; }); });
    var lastD = {}, lastG = {}, podS = {}, winS = {};
    S.races.slice().sort(cmpRace).forEach(function (r) {
      var lock = lockOf(S, r);
      locks[r.id] = lock;
      eff[r.id] = {};
      S.teams.forEach(function (t) {
        var ro = rosterAt(S, t.id, r.g, lock);
        var ex = S.lineups[r.id] && S.lineups[r.id][t.id];
        var kD = r.g + r.t, src = 'scelta', lu = ex;
        lastD[t.id] = lastD[t.id] || {}; lastG[t.id] = lastG[t.id] || {};
        if (!lu && lastD[t.id][kD]) { lu = lastD[t.id][kD]; src = 'ultima'; }
        if (!lu && lastG[t.id][r.g]) { lu = lastG[t.id][r.g]; src = 'ultima'; }
        if (ex) { lastD[t.id][kD] = ex; lastG[t.id][r.g] = ex; }
        var tit, res;
        if (lu) {
          tit = (lu.t || []).filter(function (a) { return ro.indexOf(a) >= 0; }).slice(0, starters);
          res = lu.r && ro.indexOf(lu.r) >= 0 && tit.indexOf(lu.r) < 0 ? lu.r : null;
          if (!tit.length && !res && ro.length) { lu = null; }
        }
        if (!lu) { var au = autoLineup(S, A, ro, r); tit = au.t; res = au.r; src = ro.length ? 'automatica' : 'nessuna'; }
        eff[r.id][t.id] = { t: tit, r: res, src: src, roster: ro };
      });
      var R = S.results[r.id];
      if (r.st === 'canc' || !R || !R.list || !R.list.length) return;
      var rank = {}, bibs = {}, dns = {}, mult = r.x || 1, out = {}, L = S.league, P = {};
      // streaks run over the races of the same gender and discipline that have results, in calendar order
      var key = r.g + r.t, pp = podS[key] || {}, pw = winS[key] || {}, np = {}, nw = {};
      R.list.forEach(function (x) {
        var e = entry(x);
        rank[e.a] = e.rank; if (e.bib) bibs[e.a] = e.bib;
        if (e.rank >= 1 && e.rank <= 3) np[e.a] = (pp[e.a] || 0) + 1;
        if (e.rank === 1) nw[e.a] = (pw[e.a] || 0) + 1;
        var pt = cupPts(e.rank, r); if (pt) ath[e.a] = (ath[e.a] || 0) + pt;
      });
      podS[key] = np; winS[key] = nw;
      R.list.forEach(function (x) {
        var e = entry(x);
        P[e.a] = { e: e, s: scoreOf(e, r, L, A[e.a] ? A[e.a].q : 0, { p: np[e.a] || 0, w: nw[e.a] || 0 }, mult) };
      });
      var dnf = {}, ncb = {}, dnfb = {};
      (R.dns || []).forEach(function (a) { dns[a] = 1; });
      // out of the race: athlete id, or [athlete id, bib] (the bib sets the malus)
      (R.dnf || []).forEach(function (x) { var a = Array.isArray(x) ? x[0] : x; if (!P[a]) { dnf[a] = 1; dnfb[a] = Array.isArray(x) ? +x[1] || 0 : 0; } });
      (R.nc || []).forEach(function (x) { ncb[x[0]] = x[1] || 0; });
      // results that list every athlete of the race (all: true): whoever is missing did not start
      if (R.all) Object.keys(A).forEach(function (a) { if (A[a].g === r.g && !P[a] && !dnf[a] && !(a in ncb)) dns[a] = 1; });
      // athletes without a place: out of the race (malus), or classified outside the list / not qualified (malus if first group)
      var X = {};
      Object.keys(dnf).forEach(function (a) { X[a] = { st: 'dnf', bib: dnfb[a], s: scoreOf({ rank: 0, bib: dnfb[a], r1: 0, r2: 0, st: 'dnf' }, r, L, 0, null, mult) }; });
      // in giant slalom and slalom, no place = not qualified for run 2 (DNQ); in downhill and super-G, beyond the 30th
      var nqk = CAT[r.t] === 'T' ? 'nq' : 'nc';
      Object.keys(ncb).forEach(function (a) { if (!P[a] && !X[a]) X[a] = { st: nqk, bib: ncb[a], s: scoreOf({ rank: 0, bib: ncb[a], r1: 0, r2: 0, st: nqk }, r, L, 0, null, mult) }; });
      function item(a, role, on) {
        var p = P[a], s = null;
        if (on) s = p ? p.s : X[a] ? X[a].s : scoreOf({ rank: 0, bib: 0, r1: 0, r2: 0 }, r, L, 0, null, mult);
        return { a: a, role: role, rank: rank[a] || null, bib: bibs[a] || ncb[a] || dnfb[a] || null, r1: p ? p.e.r1 || null : null, r2: p ? p.e.r2 || null : null, s: s,
          bonus: s ? s.bonus : 0, malus: s ? s.malus : 0, dnf: !!dnf[a], dns: !!dns[a], nq: !!(X[a] && X[a].st === 'nq'), v: s ? s.v : 0, counted: on };
      }
      S.teams.forEach(function (t) {
        var e = eff[r.id][t.id], items = [], playing = 0;
        e.t.forEach(function (a) {
          items.push(item(a, 'T', !dns[a]));
          if (!dns[a]) playing++;
        });
        var subIn = !!(e.r && playing < starters && !dns[e.r]);
        if (e.r) items.push(item(e.r, 'R', subIn));
        var score = 0;
        items.forEach(function (it) { if (it.counted) score += it.v; });
        score = r1(score);
        out[t.id] = { score: score, items: items, subIn: subIn, src: e.src };
        var tt = T[t.id];
        tt.total = r1(tt.total + score);
        tt.byG[raceG[r.id]] = r1((tt.byG[raceG[r.id]] || 0) + score);
        tt.byD[r.t] = r1(tt.byD[r.t] + score);
        var cat = CAT[r.t], gk = raceG[r.id];
        tt.byC[cat] = r1(tt.byC[cat] + score);
        tt.byGC[gk] = tt.byGC[gk] || { T: 0, V: 0 };
        tt.byGC[gk][cat] = r1(tt.byGC[gk][cat] + score);
        items.forEach(function (it) { if (it.counted && it.v) tt.byA[it.a] = r1((tt.byA[it.a] || 0) + it.v); });
      });
      raceRes[r.id] = { teams: out, rank: rank, bibs: bibs, dns: dns, dnf: dnf, pts: P, out: X };
    });
    return { G: G, A: A, T: T, raceG: raceG, raceRes: raceRes, ath: ath, eff: eff, locks: locks };
  }

  // ---- results parser (text pasted from the FIS results page or any results list)
  function norm(s) {
    return String(s).toLowerCase()
      .replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/đ/g, 'd').replace(/ł/g, 'l').replace(/ı/g, 'i')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/ue/g, 'u').replace(/ae/g, 'a').replace(/oe/g, 'o');
  }
  function words(s) { return norm(s).split(/[^a-z0-9]+/).filter(Boolean); }
  function isInt(t) { return /^\d+$/.test(t); }
  function tokens(s) { return norm(s).match(/[a-z]+|\d+(?:[.:,]\d+)*/g) || []; }
  function locate(toks, a) {
    var w = words(a.n), need = {};
    w.forEach(function (x) { need[x] = 1; });
    var size = Object.keys(need).length;
    if (!size) return -1;
    for (var i = 0; i < toks.length; i++) {
      if (!need[toks[i]]) continue;
      var end = Math.min(toks.length, i + w.length + 3), seen = {}, cnt = 0;
      for (var j = i; j < end; j++) if (need[toks[j]] && !seen[toks[j]]) { seen[toks[j]] = 1; cnt++; }
      if (cnt === size) return i;
    }
    return -1;
  }
  // run times: m:ss.cc or ss.cc
  var TIME = /^(?:(\d{1,2}):)?(\d{1,2})[.,](\d{2})$/;
  function secs(t) { var m = TIME.exec(t); return m ? (m[1] ? +m[1] * 60 : 0) + +m[2] + +m[3] / 100 : null; }
  // a finisher of a two-run race shows run 1, run 2 and total time close together, with run 1 + run 2 = total
  function runTriples(toks) {
    var ts = [], list = [], used = {};
    toks.forEach(function (t, i) { var x = secs(t); if (x != null) ts.push({ i: i, s: x }); });
    for (var k = 0; k + 2 < ts.length; k++) {
      var a = ts[k], b = ts[k + 1], c = ts[k + 2];
      if (c.i - a.i <= 6 && a.s >= 20 && b.s >= 20 && Math.abs(a.s + b.s - c.s) < 0.015) {
        list.push({ i: a.i, t1: a.s, t2: b.s });
        used[a.i] = used[b.i] = used[c.i] = 1;
        k += 2;
      }
    }
    return { list: list, ts: ts, used: used };
  }
  var SECTION = /did not start|did not finish|did not qualify|disqualified|non partit|non arrivat|non qualificat|squalificat|ritirat|\bdnf\d?\b|\bdsq\d?\b|\bdns\d?\b|\bdnq\d?\b/gi;
  var NOSTART = /did not start|non partit|\bdns\d?\b/i;
  var NOQUAL = /did not qualify|non qualificat|\bdnq\d?\b/i;
  var SECOND = /^\w{0,2}\W{1,3}(?:in\s+|nella\s+|the\s+|for\s+)?(?:2nd|second|2ª|2a|2°|seconda)/i;
  // 'ns' did not start the race, 'nq' did not qualify for run 2, 'nf' out of the race (did not finish, disqualified, did not start run 2)
  function sectionKind(m, after) {
    if (NOQUAL.test(m)) return 'nq';
    if (NOSTART.test(m)) return /2$/.test(m) || SECOND.test(after) ? 'nf' : 'ns';
    return 'nf';
  }
  // bib of a row without a place: the number right before the FIS code, or the number right before the name
  function bibBefore(toks, pos) {
    var run = [], k = pos - 1;
    while (k >= 0 && isInt(toks[k]) && run.length < 3) { run.unshift(+toks[k]); k--; }
    for (var q = run.length - 1; q >= 0; q--) if (run[q] >= 1000) return q >= 1 && run[q - 1] <= 999 ? run[q - 1] : 0;
    return run.length && run[run.length - 1] <= 999 ? run[run.length - 1] : 0;
  }

  function parseResults(text, athletes, opts) {
    text = String(text || '');
    var marks = [], m;
    SECTION.lastIndex = 0;
    while ((m = SECTION.exec(text))) marks.push({ i: m.index, k: sectionKind(m[0], text.slice(m.index + m[0].length, m.index + m[0].length + 24)) });
    var body = marks.length ? text.slice(0, marks[0].i) : text;
    var segs = { nf: '', nq: '', ns: '' }, secText = '';
    marks.forEach(function (mk, k) {
      var seg = text.slice(mk.i, k + 1 < marks.length ? marks[k + 1].i : text.length);
      secText += '\n' + seg;
      segs[mk.k] += '\n' + seg;
    });
    var toks = tokens(body), T = { nf: tokens(segs.nf), nq: tokens(segs.nq), ns: tokens(segs.ns) };
    var found = [], seen = [], K = { nf: [], nq: [], ns: [] }, sbib = {};
    athletes.forEach(function (a) {
      var pos = locate(toks, a);
      if (pos >= 0) { found.push({ a: a, pos: pos }); seen.push(a.id); return; }
      ['nf', 'nq', 'ns'].some(function (k) {
        var at = locate(T[k], a);
        if (at < 0) return false;
        K[k].push(a.id);
        if (k !== 'ns') seen.push(a.id);
        var b = bibBefore(T[k], at);
        if (b) sbib[a.id] = b;
        return true;
      });
    });
    found.sort(function (x, y) { return x.pos - y.pos; });
    // two-run races: run-1 places from every run-1 time (also of whoever went out in run 2), run-2 places among the finishers
    var runs = !!(opts && opts.runs), RT = runs ? runTriples(toks) : null, pool1 = [], pool2 = [];
    if (runs) {
      var ST = runTriples(tokens(secText));
      RT.list.forEach(function (x) { pool1.push(x.t1); pool2.push(x.t2); });
      ST.list.forEach(function (x) { pool1.push(x.t1); });
      ST.ts.forEach(function (x) { if (!ST.used[x.i] && x.s >= 20) pool1.push(x.s); });
    }
    function tripleOf(f, lim) {
      if (!RT) return null;
      for (var z = 0; z < RT.list.length; z++) {
        var tr = RT.list[z];
        if (tr.i <= f.pos) continue;
        if (tr.i >= lim || tr.i - f.pos > 9) return null;
        for (var j = f.pos + 1; j < tr.i; j++) if (isInt(toks[j]) && +toks[j] >= 10000) return null;
        return tr;
      }
      return null;
    }
    function placeIn(pool, t) { var n = 1; pool.forEach(function (x) { if (x < t - 0.001) n++; }); return n; }
    var out = [], last = 0, sure = true, nRuns = 0;
    found.forEach(function (f, fi) {
      var run = [], k = f.pos - 1;
      while (k >= 0 && isInt(toks[k]) && run.length < 4) { run.unshift(+toks[k]); k--; }
      var rank = null, bib = null, ci = -1;
      for (var q = run.length - 1; q >= 0; q--) if (run[q] >= 1000) { ci = q; break; }
      if (ci >= 2 && run[ci - 2] <= 99) { rank = run[ci - 2]; bib = run[ci - 1] <= 999 ? run[ci - 1] : null; }
      else if (ci === 1 && run[0] <= 99) rank = run[0];
      else {
        var cands = run.filter(function (x) { return x >= 1 && x <= 99 && x >= last; });
        if (cands.length) {
          rank = cands.reduce(function (b, x) { return Math.abs(x - (last + 1)) < Math.abs(b - (last + 1)) ? x : b; }, cands[0]);
          var at = run.lastIndexOf(rank);
          if (at >= 0 && at === run.length - 2 && run[at + 1] <= 999) bib = run[at + 1];
          if (run.filter(function (x) { return x >= 1 && x <= 99; }).length > 1) sure = false;
        }
      }
      if (rank != null) {
        if (rank < last) sure = false; else last = rank;
        var tr = tripleOf(f, fi + 1 < found.length ? found[fi + 1].pos : toks.length);
        if (tr) nRuns++;
        out.push(pack(f.a.id, rank, bib, tr ? placeIn(pool1, tr.t1) : 0, tr ? placeIn(pool2, tr.t2) : 0));
      }
    });
    return { list: out, sure: sure, matched: out.length, runs: nRuns, seen: seen, nf: K.nf, nq: K.nq, ns: K.ns, dnsSeen: K.ns, sbib: sbib };
  }

  return {
    PTS: PTS, CAT: CAT, DIDX: DIDX, GENDERS: GENDERS, clone: clone, rid: rid, r1: r1, romeTime: romeTime, weekKey: weekKey, lockOf: lockOf, startOf: startOf,
    giornate: giornate, cupPts: cupPts, scalePts: scalePts, fantaPts: fantaPts, bibBonus: bibBonus, bibGroup: bibGroup, TIERS: TIERS,
    entry: entry, pack: pack, runBonus: runBonus, dnfMalus: dnfMalus, outMalus: outMalus, outBands: outBands, MALUS_OUT: MALUS_OUT, streakBonus: streakBonus, scoreOf: scoreOf, firstGroup: firstGroup, secs: secs, findBy: findBy, credits: credits, teamState: teamState, ownerNow: ownerNow, rosterAt: rosterAt,
    canBuy: canBuy, checkLineup: checkLineup, apply: apply, applyAll: applyAll, applyOp: applyOp, migrate: migrate, view: view, LEAGUE_OPS: LEAGUE_OPS, compute: compute, norm: norm, words: words, parseResults: parseResults
  };
})();
if (typeof module !== 'undefined') module.exports = FS;
