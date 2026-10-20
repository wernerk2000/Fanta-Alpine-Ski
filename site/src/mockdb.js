// Fanta Alpine Ski — in-memory stand-in for db.js, used by the browser tests.
// Same interface as window.DB on Firebase; it applies the main permission rules of firestore.rules
// (lineups only by the team's owner and only before the deadline, other teams' lineups hidden until then,
// leagues joined only with the right code, one team per person).
(function () {
  'use strict';
  var FS = window.FS;
  function err(code) { var e = new Error(code); e.code = code; return Promise.reject(e); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var n = 0;
  function rid(p) { n++; return (p || '') + 'k' + n + Math.random().toString(36).slice(2, 6); }
  // the store and the signed-in account survive a page reload (in sessionStorage), like the real database and login
  var SK = 'fs-mock-store';
  function loadStore() { try { return JSON.parse(sessionStorage.getItem(SK)); } catch (e) { return null; } }
  function saveStore() { try { sessionStorage.setItem(SK, JSON.stringify({ store: M, me: me })); } catch (e) { } }
  var W = window.__mock = window.__mock || {};
  var kept = loadStore();
  var M = W.store = W.store || (kept && kept.store) || { users: {}, accounts: {}, usernames: {}, admins: null, site: { openLeagues: false }, codes: {}, leagues: {}, ovr: { athletes: {}, races: {}, results: {} } };
  M.usernames = M.usernames || {}; M.site = M.site || { openLeagues: false };
  var me = null, onState = null, openId = null, base = null, emitT = 0;
  W.signedIn = function () { return me; };

  function merged() {
    var A = base.athletes.map(function (a) { return Object.assign({}, a, M.ovr.athletes[a.id] || {}); });
    Object.keys(M.ovr.athletes).forEach(function (k) { if (!A.some(function (a) { return a.id === k; }) && M.ovr.athletes[k].n) A.push(Object.assign({ id: k }, M.ovr.athletes[k])); });
    var R = base.races.map(function (r) { return Object.assign({}, r, M.ovr.races[r.id] || {}); });
    Object.keys(M.ovr.races).forEach(function (k) { if (!R.some(function (r) { return r.id === k; }) && M.ovr.races[k].d) R.push(Object.assign({ id: k }, M.ovr.races[k])); });
    var res = Object.assign({}, base.results);
    Object.keys(M.ovr.results).forEach(function (k) { var o = M.ovr.results[k]; if (o.deleted) delete res[k]; else res[k] = JSON.parse(o.json); });
    return { athletes: A, races: R, results: res, excluded: base.excluded || [] };
  }
  function gadminNow() { return !!(me && M.admins && M.admins.indexOf(me) >= 0); }
  // the league's organiser, or the site's administrator
  function isAdmin(lid) { return !!(me && M.leagues[lid] && (M.leagues[lid].admin === me || gadminNow())); }
  function isMember(lid) { return !!(me && M.leagues[lid] && M.leagues[lid].members[me]); }
  function lockOf(lid, rid) { return (M.leagues[lid].locks || {})[rid] || 0; }
  function visibleLineups(lid) {
    var L = M.leagues[lid], out = {}, now = Date.now();
    Object.keys(L.lineups).forEach(function (r) {
      Object.keys(L.lineups[r]).forEach(function (t) {
        var v = L.lineups[r][t];
        if (isAdmin(lid) || v.uid === me || now > lockOf(lid, r)) (out[r] = out[r] || {})[t] = clone(v);
      });
    });
    return out;
  }
  function entry(lid) {
    var L = M.leagues[lid];
    if (!L || !(isAdmin(lid) || isMember(lid))) return null;
    var full = lid === openId;
    return {
      id: lid, admin: L.admin, code: L.code, league: Object.assign({}, clone(L.settings), { name: L.name }),
      teams: full ? clone(L.teams) : [], purchases: full ? clone(L.purchases) : [], lineups: full ? visibleLineups(lid) : {},
      members: full ? Object.keys(L.members).map(function (u) { return Object.assign({ uid: u }, L.members[u]); }) : [], loaded: full
    };
  }
  function snapshot() {
    if (!me) return { phase: 'signedout' };
    var g = merged(), u = M.users[me];
    return {
      phase: 'ready', user: { uid: me, email: u.email, name: u.name || null }, needName: !u.name, gadmin: gadminNow(), adminsExist: !!M.admins,
      site: clone(M.site), canCreate: gadminNow() || !!M.site.openLeagues,
      leagues: (u.leagues || []).map(entry).filter(Boolean), openId: openId, athletes: g.athletes, races: g.races, results: g.results, excluded: g.excluded
    };
  }
  // like db.js: the administrator's browser keeps the deadlines of all their leagues in step with the calendar
  function syncLocks() {
    if (!me) return;
    var races = merged().races;
    Object.keys(M.leagues).forEach(function (lid) {
      if (!isAdmin(lid)) return;
      var L = M.leagues[lid], V = { league: L.settings };
      races.forEach(function (r) { L.locks[r.id] = FS.lockOf(V, r); });
    });
  }
  function emit() {
    if (emitT) return;
    emitT = setTimeout(function () { emitT = 0; syncLocks(); saveStore(); if (onState) onState(snapshot()); }, 0);
  }
  function done(v) { emit(); return Promise.resolve(v); }

  function start(cb) {
    onState = cb;
    fetch('data/athletes.json').then(function (r) { return r.json(); }).then(function (a) {
      return Promise.all([fetch('data/races.json').then(function (r) { return r.json(); }), fetch('data/results.json').then(function (r) { return r.json(); })]).then(function (x) {
        base = { athletes: a.athletes, excluded: a.excluded, races: x[0].races, results: x[1].results };
        me = W.autoLogin || (kept && kept.me) || null;
        emit();
      });
    });
  }
  function register(email, password) {
    email = String(email || '').toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err('auth/invalid-email');
    if (String(password || '').length < 6) return err('auth/weak-password');
    if (M.accounts[email]) return err('auth/email-already-in-use');
    var uid = rid('u');
    M.accounts[email] = { uid: uid, password: password };
    M.users[uid] = { email: email, name: null, leagues: [] };
    me = uid; openId = null;
    return done();
  }
  // usernames: 3–20 letters, digits, dot, dash or underscore; one account each, whatever the case
  function setName(raw) {
    var name = String(raw || '').trim(), key = name.toLowerCase(), old = M.users[me].name;
    if (!/^[A-Za-z0-9._-]{3,20}$/.test(name)) return err('fs/bad-name');
    if (M.usernames[key] && M.usernames[key] !== me) return err('fs/name-taken');
    if (old && old.toLowerCase() !== key) delete M.usernames[old.toLowerCase()];
    M.usernames[key] = me; M.users[me].name = name;
    M.users[me].leagues.forEach(function (lid) { var L = M.leagues[lid]; if (L && L.members[me]) L.members[me].name = name; });
    return done();
  }
  function setSite(f) { if (!gadminNow()) return err('permission-denied'); Object.assign(M.site, f); return done(); }
  function allLeagues() {
    if (!gadminNow()) return err('permission-denied');
    return Promise.resolve(Object.keys(M.leagues).map(function (lid) { var L = M.leagues[lid]; return { id: lid, name: L.name, code: L.code, admin: L.admin, mine: M.users[me].leagues.indexOf(lid) >= 0 }; })
      .sort(function (a, b) { return a.name.localeCompare(b.name); }));
  }
  function login(email, password) {
    var a = M.accounts[String(email || '').toLowerCase()];
    if (!a || a.password !== password) return err('auth/invalid-credential');
    me = a.uid; openId = null;
    return done();
  }
  function logout() { me = null; openId = null; return done(); }
  function reset(email) { W.resetFor = email; return Promise.resolve(); }
  function claimAdmin() { if (M.admins) return err('permission-denied'); M.admins = [me]; return done(); }
  function join(code) {
    var lid = M.codes[String(code || '').trim().toUpperCase()];
    if (!lid) return err('fs/bad-code');
    var L = M.leagues[lid];
    if (!L.members[me]) L.members[me] = { name: M.users[me].name, team: null };
    if (M.users[me].leagues.indexOf(lid) < 0) M.users[me].leagues.push(lid);
    return done(lid);
  }
  function createLeague(name, nTeams, settings) {
    if (!(gadminNow() || M.site.openLeagues)) return err('permission-denied');
    var lid = rid('l'), code = 'C' + Math.random().toString(36).slice(2, 7).toUpperCase(), teams = [];
    for (var i = 1; i <= nTeams; i++) teams.push({ id: rid('t'), name: 'Squadra ' + i, owner: '', uid: null, ord: i });
    M.leagues[lid] = { name: name, admin: me, code: code, settings: clone(settings), teams: teams, members: {}, purchases: [], lineups: {}, locks: {} };
    M.leagues[lid].members[me] = { name: M.users[me].name, team: null };
    M.codes[code] = lid;
    M.users[me].leagues.push(lid);
    return done(lid);
  }
  function importLeague(src) {
    if (!(M.admins && M.admins.indexOf(me) >= 0)) return err('permission-denied');
    var lid = rid('l'), code = 'C' + Math.random().toString(36).slice(2, 7).toUpperCase(), settings = clone(src.league || {}), name = settings.name || 'Lega';
    delete settings.name;
    var lineups = {};
    Object.keys(src.lineups || {}).forEach(function (r) { lineups[r] = {}; Object.keys(src.lineups[r]).forEach(function (t) { var v = src.lineups[r][t]; lineups[r][t] = { t: v.t || [], r: v.r || null, uid: null, at: Date.now() }; }); });
    M.leagues[lid] = {
      name: name, admin: me, code: code, settings: settings, members: {}, locks: {}, lineups: lineups,
      teams: (src.teams || []).map(function (t, i) { return { id: t.id, name: t.name, owner: t.owner || '', uid: null, ord: i + 1 }; }),
      purchases: clone(src.purchases || [])
    };
    M.leagues[lid].members[me] = { name: M.users[me].name, team: null };
    M.codes[code] = lid;
    M.users[me].leagues.push(lid);
    return done(lid);
  }
  function regenCode(lid) {
    if (!isAdmin(lid)) return err('permission-denied');
    var L = M.leagues[lid], code = 'C' + Math.random().toString(36).slice(2, 7).toUpperCase();
    delete M.codes[L.code]; L.code = code; M.codes[code] = lid;
    return done(code);
  }
  function claimTeam(lid, tid) {
    var L = M.leagues[lid], t = FS.findBy(L.teams, tid), m = L.members[me];
    if (!t || !m) return err('permission-denied');
    if (!isAdmin(lid) && (t.uid || m.team)) return err('permission-denied');
    t.uid = me; t.owner = M.users[me].name; m.team = tid;
    return done();
  }
  function removeMember(lid, uid) {
    if (!isAdmin(lid)) return err('permission-denied');
    var L = M.leagues[lid], m = L.members[uid];
    if (m && m.team) { var t = FS.findBy(L.teams, m.team); if (t) t.uid = null; }
    delete L.members[uid];
    return done();
  }
  function open(lid) { openId = lid || null; emit(); }
  function op(o) {
    var lid = o.lg || openId, L = M.leagues[lid];
    var admin = isAdmin(lid), gadmin = gadminNow();
    function need(c) { return c ? null : err('permission-denied'); }
    var x;
    switch (o.k) {
      case 'buy': if ((x = need(admin))) return x; L.purchases.push({ id: o.id, a: o.a, t: o.t, price: o.price, from: o.from }); return done();
      case 'unbuy': if ((x = need(admin))) return x; L.purchases = L.purchases.filter(function (p) { return p.id !== o.id; }); return done();
      case 'release': if ((x = need(admin))) return x; var p = FS.findBy(L.purchases, o.id); p.to = o.ts; p.refund = o.refund; return done();
      case 'teamAdd': if ((x = need(admin))) return x; L.teams.push({ id: o.id, name: o.name, owner: o.owner || '', uid: null, ord: L.teams.length + 1 }); return done();
      case 'teamDel': if ((x = need(admin))) return x; L.teams = L.teams.filter(function (t) { return t.id !== o.id; }); return done();
      case 'teamSet':
        var t = FS.findBy(L.teams, o.id);
        if (!t) return err('fs/no-team');
        // the team's player may rename it, nothing else
        if (!admin && !(isMember(lid) && t.uid === me && o.name != null && o.owner == null && o.uid == null && String(o.name).trim() && String(o.name).length <= 30)) return err('permission-denied');
        if (o.name != null) t.name = o.name;
        if (o.owner != null) t.owner = o.owner;
        if (o.uid != null && !o.uid) { if (t.uid && L.members[t.uid]) L.members[t.uid].team = null; t.uid = null; }
        return done();
      case 'claim': return claimTeam(lid, o.t);
      case 'assign':
        if ((x = need(admin))) return x;
        var ta = FS.findBy(L.teams, o.t);
        if (!ta) return err('fs/no-team');
        if (ta.uid && ta.uid !== o.uid && L.members[ta.uid]) L.members[ta.uid].team = null;
        if (o.uid) {
          L.teams.forEach(function (tt) { if (tt.uid === o.uid && tt.id !== o.t) { tt.uid = null; tt.owner = ''; } });
          if (L.members[o.uid]) L.members[o.uid].team = o.t;
          ta.owner = o.owner != null ? o.owner : (L.members[o.uid] ? L.members[o.uid].name : ta.owner);
          ta.uid = o.uid;
        } else { ta.uid = null; ta.owner = ''; }
        return done();
      case 'lu':
        var tm = FS.findBy(L.teams, o.t);
        if (!admin && !(isMember(lid) && tm && tm.uid === me && Date.now() < lockOf(lid, o.r))) return err('permission-denied');
        L.lineups[o.r] = L.lineups[o.r] || {};
        L.lineups[o.r][o.t] = { t: o.lu.t || [], r: o.lu.r || null, uid: (tm && tm.uid) || me, at: Date.now() };
        return done();
      case 'set':
        if ((x = need(admin))) return x;
        Object.keys(o.f).forEach(function (k) { if (k === 'name') L.name = o.f[k]; else L.settings[k] = clone(o.f[k]); });
        return done();
      case 'res': if ((x = need(gadmin))) return x; M.ovr.results[o.r] = { json: JSON.stringify({ list: o.list, dns: o.dns || [], dnf: o.dnf || [], nc: o.nc || [], src: o.src, at: o.at }) }; return done();
      case 'resDel': if ((x = need(gadmin))) return x; M.ovr.results[o.r] = { deleted: true }; return done();
      case 'raceSet': if ((x = need(gadmin))) return x; M.ovr.races[o.r] = Object.assign(M.ovr.races[o.r] || {}, o.f); return done();
      case 'raceAdd': if ((x = need(gadmin))) return x; M.ovr.races[o.race.id] = clone(o.race); return done();
      case 'athSet': if ((x = need(gadmin))) return x; M.ovr.athletes[o.a] = Object.assign(M.ovr.athletes[o.a] || {}, o.f); return done();
      case 'athAdd': if ((x = need(gadmin))) return x; M.ovr.athletes[o.ath.id] = clone(o.ath); return done();
      case 'lgDel':
        if (!isAdmin(o.id)) return err('permission-denied');
        delete M.codes[M.leagues[o.id].code]; delete M.leagues[o.id];
        M.users[me].leagues = M.users[me].leagues.filter(function (l) { return l !== o.id; });
        if (openId === o.id) openId = null;
        return done();
    }
    return err('fs/unknown-op');
  }

  window.DB = { mock: true, start: start, register: register, login: login, logout: logout, reset: reset, setName: setName, rename: setName, claimAdmin: claimAdmin, setSite: setSite, allLeagues: allLeagues, join: join, createLeague: createLeague, importLeague: importLeague, regenCode: regenCode, claimTeam: claimTeam, removeMember: removeMember, open: open, op: op };
  window.dispatchEvent(new Event('fs-db-ready'));
})();
