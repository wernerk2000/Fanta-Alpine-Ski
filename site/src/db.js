// Fanta Alpine Ski — data layer on Firebase (Authentication + Firestore).
// Global data (athletes, calendar, results) comes from the JSON files published with the site, with the
// administrators' corrections from Firestore on top. Accounts:
//   users/{uid}                              name (the username), leagues [lid]
//   usernames/{lowercase name}               uid: one account per username
//   config/admins                            uids of the site's administrators; config/site: openLeagues
// Every league lives in Firestore:
//   leagues/{lid}                            name, admin, code, settings, created,
//                                            locks {race: deadline}, market {purchase id: purchase},
//                                            archive {race: {team: lineup}} for the races already closed
//   leagues/{lid}/teams/{tid}                name, owner, uid, ord
//   leagues/{lid}/members/{uid}              name, code, team
//   leagues/{lid}/pending/{tid}              {race: lineup}: the team's lineups, seen by the team and the administrator
//   leagues/{lid}/races/{rid}/lineups/{tid}  the lineup that counts, accepted only before the race's deadline
// Reads stay low (the free plan allows 50,000 a day): one document carries the market, the deadlines and the
// lineups of the closed races, which the administrator's browser copies there a few minutes after each deadline.
// Exposes window.DB with the same interface as the in-memory mock used by the tests.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, collection, getDoc, getDocs, getDocsFromServer, setDoc, updateDoc, onSnapshot, writeBatch,
  serverTimestamp, deleteField, Timestamp, arrayUnion, arrayRemove
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const CFG = (window.FS_CONFIG || {}).firebase;
const FS = window.FS;

function err(code, message) { const e = new Error(message || code); e.code = code; return e; }
function rid(p) { return (p || '') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}
function ms(v) { return v && typeof v.toMillis === 'function' ? v.toMillis() : (typeof v === 'number' ? v : 0); }
function luOf(v) { return { t: (v && v.t) || [], r: (v && v.r) || null }; }
const ARCHIVE_AFTER = 5 * 60000;   // the administrator copies a race's lineups this long after its deadline

if (!CFG || !CFG.apiKey) {
  window.DB = { missingConfig: true, start(cb) { cb({ phase: 'noconfig' }); } };
  window.dispatchEvent(new Event('fs-db-ready'));
} else {
  const app = initializeApp(CFG);
  const auth = getAuth(app);
  auth.languageCode = 'it';
  const db = getFirestore(app);

  // ---------- state handed to the page
  const st = {
    phase: 'loading', user: null, profileReady: false, gadmin: false, adminsExist: true, site: { openLeagues: false }, error: null,
    base: { athletes: [], races: [], results: {}, excluded: [] }, baseReady: false,
    ovr: { athletes: {}, races: {}, results: {} },
    myLids: [], leagueDocs: {}, open: null, data: {}
  };
  let onState = null, emitT = 0, subs = [], leagueSubs = {}, openSubs = [], pendUnsub = null, timer = 0;

  function merged() {
    const A = st.base.athletes.map(a => Object.assign({}, a, st.ovr.athletes[a.id] || {}));
    const ids = new Set(A.map(a => a.id));
    Object.keys(st.ovr.athletes).forEach(k => { if (!ids.has(k) && st.ovr.athletes[k].n) A.push(Object.assign({ id: k }, st.ovr.athletes[k])); });
    const R = st.base.races.map(r => Object.assign({}, r, st.ovr.races[r.id] || {}));
    const rids = new Set(R.map(r => r.id));
    Object.keys(st.ovr.races).forEach(k => { if (!rids.has(k) && st.ovr.races[k].d) R.push(Object.assign({ id: k }, st.ovr.races[k])); });
    const res = Object.assign({}, st.base.results);
    Object.keys(st.ovr.results).forEach(k => {
      const o = st.ovr.results[k];
      if (o.deleted) delete res[k];
      else if (o.json) { try { res[k] = JSON.parse(o.json); } catch (e) { /* ignore a broken correction */ } }
    });
    return { athletes: A, races: R.filter(r => !r.removed), results: res, excluded: st.base.excluded || [] };
  }
  function marketOf(d) {
    const m = d.market || {};
    return Object.keys(m).sort((a, b) => ms(m[a].at) - ms(m[b].at) || (a < b ? -1 : 1)).map(id => {
      const p = Object.assign({ id: id }, m[id]);
      delete p.at;
      return p;
    });
  }
  function closed(d, r) { const l = ms((d.locks || {})[r]); return !!l && Date.now() > l; }
  // lineups the page can see: the team's own (or all, for the administrator) for the coming races; everybody's for closed ones
  function lineupsOf(lid) {
    const d = st.leagueDocs[lid] || {}, x = st.data[lid], arch = d.archive || {}, out = {};
    const put = (r, t, v) => { (out[r] = out[r] || {})[t] = luOf(v); };
    if (x) Object.keys(x.pend).forEach(t => { const m = x.pend[t] || {}; Object.keys(m).forEach(r => put(r, t, m[r])); });
    Object.keys(arch).forEach(r => { if (!closed(d, r)) return; out[r] = {}; const m = arch[r] || {}; Object.keys(m).forEach(t => put(r, t, m[t])); });
    if (x) Object.keys(x.lineups).forEach(r => { if (arch[r] || !closed(d, r)) return; out[r] = {}; const m = x.lineups[r]; Object.keys(m).forEach(t => put(r, t, m[t])); });
    return out;
  }
  function leagueEntry(lid) {
    const d = st.leagueDocs[lid];
    if (!d) return null;
    const x = st.data[lid], ready = !!(x && x.ready);
    return {
      id: lid, admin: d.admin, code: d.code, league: Object.assign({}, d.settings || {}, { name: d.name }),
      teams: ready ? x.teams : [], purchases: ready ? marketOf(d) : [], lineups: ready ? lineupsOf(lid) : {}, members: ready ? x.members : [],
      loaded: ready
    };
  }
  function snapshot() {
    if (st.phase !== 'ready') return { phase: st.phase, error: st.error };
    if (!st.profileReady) return { phase: 'loading', error: st.error };
    const g = merged();
    return {
      phase: st.baseReady ? 'ready' : 'loading', user: st.user, needName: !st.user.name, gadmin: st.gadmin, adminsExist: st.adminsExist,
      site: st.site, canCreate: st.gadmin || !!st.site.openLeagues, error: st.error,
      leagues: st.myLids.map(leagueEntry).filter(Boolean), openId: st.open,
      athletes: g.athletes, races: g.races, results: g.results, excluded: g.excluded
    };
  }
  function emit() {
    if (emitT) return;
    emitT = setTimeout(() => { emitT = 0; afterChange(); if (onState) onState(snapshot()); }, 0);
  }

  // ---------- global data: files published with the site + corrections
  async function loadBase() {
    const get = async (f) => { const r = await fetch('data/' + f + '?v=' + Date.now(), { cache: 'no-store' }); if (!r.ok) throw err('base', f); return r.json(); };
    try {
      const [a, r, s] = await Promise.all([get('athletes.json'), get('races.json'), get('results.json')]);
      st.base = { athletes: a.athletes || [], excluded: a.excluded || [], races: r.races || r, results: s.results || s };
      st.baseReady = true;
    } catch (e) { st.error = 'I dati delle gare non si caricano: ricarica la pagina.'; st.baseReady = true; }
    emit();
  }
  function watchOverrides() {
    ['athletes', 'races', 'results'].forEach(k => {
      subs.push(onSnapshot(collection(db, k), snap => {
        const o = {};
        snap.forEach(d => { o[d.id] = d.data(); });
        st.ovr[k] = o; emit();
      }, () => { }));
    });
  }

  // ---------- leagues
  function watchUser(uid) {
    subs.push(onSnapshot(doc(db, 'users', uid), d => {
      const u = d.exists() ? d.data() : {};
      const lids = u.leagues || [];
      st.user = Object.assign({}, st.user, { name: u.name || null });
      st.profileReady = true;
      st.myLids = lids;
      Object.keys(leagueSubs).forEach(lid => { if (lids.indexOf(lid) < 0) { leagueSubs[lid](); delete leagueSubs[lid]; delete st.leagueDocs[lid]; } });
      lids.forEach(lid => {
        if (leagueSubs[lid]) return;
        leagueSubs[lid] = onSnapshot(doc(db, 'leagues', lid), ld => {
          if (ld.exists()) st.leagueDocs[lid] = ld.data({ serverTimestamps: 'estimate' }); else delete st.leagueDocs[lid];
          emit();
        }, () => { delete st.leagueDocs[lid]; emit(); });
      });
      emit();
    }, () => { st.myLids = []; st.profileReady = true; emit(); }));
    subs.push(onSnapshot(doc(db, 'config', 'admins'), d => {
      st.adminsExist = d.exists();
      st.gadmin = !!(d.exists() && (d.data().uids || []).indexOf(uid) >= 0);
      emit();
    }, () => { }));
    subs.push(onSnapshot(doc(db, 'config', 'site'), d => {
      st.site = { openLeagues: !!(d.exists() && d.data().openLeagues) };
      emit();
    }, () => { }));
  }
  function closeOpen() { openSubs.forEach(u => u()); openSubs = []; if (pendUnsub) { pendUnsub(); pendUnsub = null; } }
  function open(lid) {
    if (st.open === lid) return;
    closeOpen();
    st.open = lid || null;
    if (!lid) { emit(); return; }
    const x = st.data[lid] = { teams: [], members: [], pend: {}, pendKey: '', lineups: {}, full: {}, got: {}, ready: false };
    const part = (name, fn) => openSubs.push(onSnapshot(collection(db, 'leagues', lid, name), snap => {
      fn(snap); x.got[name] = true;
      x.ready = !!(x.got.teams && x.got.members);
      emit();
    }, e => { st.error = 'Non riesco a leggere la lega: ' + (e.code || e.message); emit(); }));
    part('teams', snap => { x.teams = []; snap.forEach(d => x.teams.push(Object.assign({ id: d.id }, d.data()))); x.teams.sort((a, b) => (a.ord || 0) - (b.ord || 0) || a.name.localeCompare(b.name)); });
    part('members', snap => { x.members = []; snap.forEach(d => x.members.push(Object.assign({ uid: d.id }, d.data()))); });
    emit();
  }
  // the lineups for the coming races: of all teams for the administrator, of the own team for the others
  function watchPending(lid, x, admin, my) {
    const key = admin ? '*' : (my || '');
    if (x.pendKey === key) return;
    if (pendUnsub) { pendUnsub(); pendUnsub = null; }
    x.pendKey = key; x.pend = {};
    if (!key) return;
    if (admin) {
      pendUnsub = onSnapshot(collection(db, 'leagues', lid, 'pending'), snap => {
        const p = {};
        snap.forEach(d => { p[d.id] = d.data(); });
        x.pend = p; emit();
      }, () => { });
    } else {
      pendUnsub = onSnapshot(doc(db, 'leagues', lid, 'pending', my), d => { x.pend = d.exists() ? { [my]: d.data() } : {}; emit(); }, () => { });
    }
  }

  // The database closes lineups at the deadline stored for each race in the league document (start time minus the
  // league's margin). The administrator's browser keeps those deadlines in step with the calendar, for every league
  // they run; a race moved later is reopened, so its copied lineups are dropped.
  let lockBusy = false;
  function syncLocks() {
    if (lockBusy || !st.user || !st.baseReady || st.error) return;
    const uid = st.user.uid, races = merged().races, now = Date.now(), jobs = [];
    if (!races.length) return;
    st.myLids.forEach(lid => {
      const d = st.leagueDocs[lid];
      if (!d || (d.admin !== uid && !st.gadmin)) return;
      const V = { league: d.settings || {} }, have = d.locks || {}, arch = d.archive || {}, f = {};
      let n = 0;
      races.forEach(r => {
        const want = FS.lockOf(V, r);
        if (ms(have[r.id]) === want) return;
        f['locks.' + r.id] = Timestamp.fromMillis(want); n++;
        if (want > now && arch[r.id]) f['archive.' + r.id] = deleteField();
      });
      if (n) jobs.push(updateDoc(doc(db, 'leagues', lid), f));
    });
    if (!jobs.length) return;
    lockBusy = true;
    Promise.all(jobs).then(() => { lockBusy = false; }, () => { lockBusy = false; });
  }
  // a few minutes after a deadline the administrator's browser copies that race's lineups into the league document
  let archBusy = false;
  function archive(lid, d) {
    if (archBusy) return;
    const locks = d.locks || {}, arch = d.archive || {}, now = Date.now();
    const todo = Object.keys(locks).filter(r => !arch[r] && ms(locks[r]) + ARCHIVE_AFTER < now).slice(0, 12);
    if (!todo.length) return;
    archBusy = true;
    (async () => {
      const f = {};
      for (const r of todo) {
        const snap = await getDocsFromServer(collection(db, 'leagues', lid, 'races', r, 'lineups'));
        const m = {};
        snap.forEach(dd => { m[dd.id] = luOf(dd.data()); });
        f['archive.' + r] = m;
      }
      await updateDoc(doc(db, 'leagues', lid), f);
    })().then(() => { archBusy = false; }, () => { archBusy = false; });
  }

  // after every change: deadlines, copies of closed races, lineups to read
  function afterChange() {
    syncLocks();
    const lid = st.open, x = lid && st.data[lid], d = lid && st.leagueDocs[lid];
    if (!x || !x.ready || !d || !st.baseReady || !st.user) return;
    const uid = st.user.uid, admin = d.admin === uid || st.gadmin;
    const my = (x.teams.find(t => t.uid === uid) || {}).id || '';
    watchPending(lid, x, admin, my);
    const arch = d.archive || {};
    Object.keys(d.locks || {}).forEach(r => {
      if (!closed(d, r)) { if (x.full[r]) { delete x.full[r]; delete x.lineups[r]; } return; }
      if (arch[r] || x.full[r]) return;
      x.full[r] = 'loading';
      getDocs(collection(db, 'leagues', lid, 'races', r, 'lineups')).then(snap => {
        const m = {};
        snap.forEach(dd => { m[dd.id] = luOf(dd.data()); });
        x.lineups[r] = m; x.full[r] = 'final'; emit();
      }, () => { x.full[r] = false; });
    });
    if (admin) archive(lid, d);
  }

  // ---------- auth
  function start(cb) {
    onState = cb;
    onAuthStateChanged(auth, user => {
      subs.forEach(u => u()); subs = [];
      Object.keys(leagueSubs).forEach(k => leagueSubs[k]()); leagueSubs = {};
      closeOpen();
      st.open = null; st.data = {}; st.leagueDocs = {}; st.myLids = []; st.error = null;
      st.profileReady = false; st.gadmin = false; st.adminsExist = true; st.site = { openLeagues: false };
      if (!user) { st.user = null; st.phase = 'signedout'; emit(); return; }
      // the username comes from users/{uid}; until it is chosen the page asks for it
      st.user = { uid: user.uid, email: user.email, name: null };
      st.phase = 'ready';
      if (!st.baseReady) loadBase();
      watchOverrides();
      watchUser(user.uid);
      emit();
    });
    clearInterval(timer);
    timer = setInterval(emit, 60000);
  }
  // the account first (email and password), then the username
  async function register(email, password) {
    const c = await createUserWithEmailAndPassword(auth, email, password);
    try { await setDoc(doc(db, 'users', c.user.uid), { leagues: [] }, { merge: true }); } catch (e) { /* created again with the username */ }
  }
  async function login(email, password) { await signInWithEmailAndPassword(auth, email, password); }
  async function logout() { await signOut(auth); }
  async function reset(email) { await sendPasswordResetEmail(auth, email); }
  // usernames: 3–20 letters, digits, dot, dash or underscore; one account each, whatever the case
  const NAME_RE = /^[A-Za-z0-9._-]{3,20}$/;
  async function setName(raw) {
    const name = String(raw || '').trim();
    if (!NAME_RE.test(name)) throw err('fs/bad-name');
    const uid = st.user.uid, key = name.toLowerCase(), old = st.user.name, oldKey = old ? old.toLowerCase() : null;
    const b = writeBatch(db);
    if (key !== oldKey) {
      const ex = await getDoc(doc(db, 'usernames', key));
      if (ex.exists() && ex.data().uid !== uid) throw err('fs/name-taken');
      if (!ex.exists()) b.set(doc(db, 'usernames', key), { uid: uid });
      if (oldKey) b.delete(doc(db, 'usernames', oldKey));
    }
    b.set(doc(db, 'users', uid), { name: name }, { merge: true });
    try { await b.commit(); }
    catch (e) {
      // someone took it in the meantime
      const ex = await getDoc(doc(db, 'usernames', key)).catch(() => null);
      if (ex && ex.exists() && ex.data().uid !== uid) throw err('fs/name-taken');
      throw e;
    }
    st.user = Object.assign({}, st.user, { name: name });
    try { await updateProfile(auth.currentUser, { displayName: name }); } catch (e) { /* only cosmetic */ }
    // the name the other members see, in every league
    await Promise.all(st.myLids.map(lid => updateDoc(doc(db, 'leagues', lid, 'members', uid), { name: name }).catch(() => null)));
    emit();
  }
  async function claimAdmin() { await setDoc(doc(db, 'config', 'admins'), { uids: [st.user.uid] }); }
  async function setSite(f) { await setDoc(doc(db, 'config', 'site'), f, { merge: true }); }
  // every league of the site, for its administrator
  async function allLeagues() {
    const snap = await getDocs(collection(db, 'leagues'));
    const out = [];
    snap.forEach(d => { const v = d.data(); out.push({ id: d.id, name: v.name || 'Lega', code: v.code || '', admin: v.admin, mine: st.myLids.indexOf(d.id) >= 0 }); });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function join(code, name) {
    code = String(code || '').trim().toUpperCase();
    if (!code) throw err('fs/bad-code');
    const c = await getDoc(doc(db, 'codes', code));
    if (!c.exists()) throw err('fs/bad-code');
    const lid = c.data().lid, uid = st.user.uid;
    // already inside? (a member removed by the administrator can come back with the code)
    let inside = false;
    try { inside = (await getDoc(doc(db, 'leagues', lid, 'members', uid))).exists(); } catch (e) { inside = false; }
    if (!inside) await setDoc(doc(db, 'leagues', lid, 'members', uid), { name: name || st.user.name, code: code, team: null, at: serverTimestamp() });
    if (st.myLids.indexOf(lid) < 0) await setDoc(doc(db, 'users', uid), { leagues: arrayUnion(lid) }, { merge: true });
    return lid;
  }
  function locksFor(settings) {
    const V = { league: settings || {} }, out = {};
    merged().races.forEach(r => { out[r.id] = Timestamp.fromMillis(FS.lockOf(V, r)); });
    return out;
  }
  async function commitAll(writes) {
    for (let i = 0; i < writes.length; i += 400) {
      const b = writeBatch(db);
      writes.slice(i, i + 400).forEach(w => w(b));
      await b.commit();
    }
  }
  async function createLeague(name, nTeams, settings) {
    const uid = st.user.uid, lid = rid('l'), code = makeCode();
    await setDoc(doc(db, 'leagues', lid), { name: name, admin: uid, code: code, settings: settings, created: serverTimestamp(), locks: locksFor(settings), market: {}, archive: {} });
    const b = writeBatch(db);
    b.set(doc(db, 'codes', code), { lid: lid });
    for (let i = 1; i <= nTeams; i++) b.set(doc(db, 'leagues', lid, 'teams', rid('t')), { name: 'Squadra ' + i, owner: '', uid: null, ord: i });
    b.set(doc(db, 'leagues', lid, 'members', uid), { name: st.user.name, code: code, team: null, at: serverTimestamp() });
    b.set(doc(db, 'users', uid), { leagues: arrayUnion(lid) }, { merge: true });
    await b.commit();
    return lid;
  }
  // a league of the old page (one entry of its "leagues"): teams, auction and lineups; participants then join with the code
  async function importLeague(src) {
    const uid = st.user.uid, lid = rid('l'), code = makeCode();
    const settings = Object.assign({}, src.league || {});
    const name = settings.name || 'Lega';
    delete settings.name;
    const locks = locksFor(settings), now = Date.now(), t0 = now - 86400000;
    const market = {};
    (src.purchases || []).forEach((p, i) => {
      const o = Object.assign({}, p);
      delete o.id;
      Object.keys(o).forEach(k => { if (o[k] === undefined) delete o[k]; });
      o.at = Timestamp.fromMillis(t0 + i * 1000);
      market[p.id] = o;
    });
    const archive = {}, pending = {}, open = [];
    Object.keys(src.lineups || {}).forEach(r => {
      if (!locks[r]) return;
      const shut = locks[r].toMillis() <= now;
      Object.keys(src.lineups[r] || {}).forEach(t => {
        const v = luOf(src.lineups[r][t]);
        if (shut) (archive[r] = archive[r] || {})[t] = v;
        else { (pending[t] = pending[t] || {})[r] = v; open.push([r, t, v]); }
      });
    });
    await setDoc(doc(db, 'leagues', lid), { name: name, admin: uid, code: code, settings: settings, created: serverTimestamp(), locks: locks, market: market, archive: archive });
    const w = [];
    w.push(b => b.set(doc(db, 'codes', code), { lid: lid }));
    (src.teams || []).forEach((t, i) => w.push(b => b.set(doc(db, 'leagues', lid, 'teams', t.id), { name: t.name || ('Squadra ' + (i + 1)), owner: t.owner || '', uid: null, ord: i + 1 })));
    Object.keys(pending).forEach(t => w.push(b => b.set(doc(db, 'leagues', lid, 'pending', t), pending[t])));
    open.forEach(([r, t, v]) => w.push(b => b.set(doc(db, 'leagues', lid, 'races', r, 'lineups', t), Object.assign({ uid: null, at: serverTimestamp() }, v))));
    w.push(b => b.set(doc(db, 'leagues', lid, 'members', uid), { name: st.user.name, code: code, team: null, at: serverTimestamp() }));
    w.push(b => b.set(doc(db, 'users', uid), { leagues: arrayUnion(lid) }, { merge: true }));
    await commitAll(w);
    return lid;
  }
  async function regenCode(lid) {
    const d = st.leagueDocs[lid], code = makeCode(), b = writeBatch(db);
    if (d && d.code) b.delete(doc(db, 'codes', d.code));
    b.set(doc(db, 'codes', code), { lid: lid });
    b.update(doc(db, 'leagues', lid), { code: code });
    await b.commit();
    return code;
  }
  async function claimTeam(lid, tid) {
    const uid = st.user.uid, b = writeBatch(db);
    b.update(doc(db, 'leagues', lid, 'teams', tid), { uid: uid, owner: st.user.name });
    b.update(doc(db, 'leagues', lid, 'members', uid), { team: tid });
    await b.commit();
  }
  async function removeMember(lid, uid) {
    const x = st.data[lid], m = x && x.members.find(mm => mm.uid === uid), b = writeBatch(db);
    if (m && m.team) b.update(doc(db, 'leagues', lid, 'teams', m.team), { uid: null });
    b.delete(doc(db, 'leagues', lid, 'members', uid));
    await b.commit();
  }

  // ---------- every change made from the page
  async function op(o) {
    const lid = o.lg || st.open, uid = st.user && st.user.uid;
    const LD = () => doc(db, 'leagues', lid);
    const L = (...p) => doc(db, 'leagues', lid, ...p);
    const x = st.data[lid], d = st.leagueDocs[lid] || {};
    switch (o.k) {
      case 'buy': return updateDoc(LD(), { ['market.' + o.id]: { a: o.a, t: o.t, price: o.price, from: o.from, at: serverTimestamp() } });
      case 'unbuy': return updateDoc(LD(), { ['market.' + o.id]: deleteField() });
      case 'release': return updateDoc(LD(), { ['market.' + o.id + '.to']: o.ts, ['market.' + o.id + '.refund']: o.refund });
      case 'teamAdd': return setDoc(L('teams', o.id), { name: o.name, owner: o.owner || '', uid: null, ord: (x ? x.teams.length : 0) + 1 });
      case 'teamDel': {
        const b = writeBatch(db);
        b.delete(L('teams', o.id)); b.delete(L('pending', o.id));
        return b.commit();
      }
      case 'teamSet': {
        const f = {};
        if (o.name != null) f.name = o.name;
        if (o.owner != null) f.owner = o.owner;
        if (o.uid != null && !o.uid) {
          const b = writeBatch(db), t = x && x.teams.find(tt => tt.id === o.id);
          f.uid = null;
          b.update(L('teams', o.id), f);
          if (t && t.uid && x.members.some(m => m.uid === t.uid)) b.update(L('members', t.uid), { team: null });
          return b.commit();
        }
        return updateDoc(L('teams', o.id), f);
      }
      case 'claim': return claimTeam(lid, o.t);
      // the organiser links a team to a member, or frees it; the member leaves any other team
      case 'assign': {
        const t = x && x.teams.find(tt => tt.id === o.t);
        if (!t) throw err('fs/no-team');
        const mem = u => x.members.find(m => m.uid === u), b = writeBatch(db);
        if (t.uid && t.uid !== o.uid && mem(t.uid)) b.update(L('members', t.uid), { team: null });
        if (o.uid) {
          const m = mem(o.uid);
          x.teams.forEach(tt => { if (tt.uid === o.uid && tt.id !== o.t) b.update(L('teams', tt.id), { uid: null, owner: '' }); });
          if (m) b.update(L('members', o.uid), { team: o.t });
          b.update(L('teams', o.t), { uid: o.uid, owner: o.owner != null ? o.owner : (m ? m.name : (t.owner || '')) });
        } else b.update(L('teams', o.t), { uid: null, owner: '' });
        return b.commit();
      }
      case 'lu': {
        const t = x && x.teams.find(tt => tt.id === o.t), v = luOf(o.lu), b = writeBatch(db);
        b.set(L('races', o.r, 'lineups', o.t), Object.assign({ uid: (t && t.uid) || uid, at: serverTimestamp() }, v));
        b.set(L('pending', o.t), { [o.r]: v }, { merge: true });
        if (d.admin === uid && (d.archive || {})[o.r]) b.update(LD(), { ['archive.' + o.r + '.' + o.t]: v });
        await b.commit();
        if (x && x.lineups[o.r]) { x.lineups[o.r][o.t] = v; emit(); }
        return;
      }
      case 'set': {
        const f = {};
        Object.keys(o.f).forEach(k => { if (k === 'name') f.name = o.f[k]; else f['settings.' + k] = o.f[k]; });
        return updateDoc(LD(), f);
      }
      case 'res': return setDoc(doc(db, 'results', o.r), { json: JSON.stringify({ list: o.list, dns: o.dns || [], dnf: o.dnf || [], nc: o.nc || [], src: o.src || 'manuale', at: o.at }), by: uid, at: serverTimestamp() });
      case 'resDel': return setDoc(doc(db, 'results', o.r), { deleted: true, by: uid, at: serverTimestamp() });
      case 'raceSet': return setDoc(doc(db, 'races', o.r), o.f, { merge: true });
      case 'raceAdd': return setDoc(doc(db, 'races', o.race.id), o.race);
      case 'athSet': return setDoc(doc(db, 'athletes', o.a), o.f, { merge: true });
      case 'athAdd': return setDoc(doc(db, 'athletes', o.ath.id), o.ath);
      case 'lgDel': {
        const D = st.leagueDocs[o.id] || {}, y = st.data[o.id];
        const ids = async (name) => (await getDocs(collection(db, 'leagues', o.id, name))).docs.map(dd => dd.id);
        const teams = y && y.ready ? y.teams.map(t => t.id) : await ids('teams');
        const members = y && y.ready ? y.members.map(m => m.uid) : await ids('members');
        const w = [];
        Object.keys(D.locks || {}).forEach(r => teams.forEach(t => w.push(b => b.delete(doc(db, 'leagues', o.id, 'races', r, 'lineups', t)))));
        teams.forEach(t => { w.push(b => b.delete(doc(db, 'leagues', o.id, 'teams', t))); w.push(b => b.delete(doc(db, 'leagues', o.id, 'pending', t))); });
        members.forEach(m => w.push(b => b.delete(doc(db, 'leagues', o.id, 'members', m))));
        await commitAll(w);
        const b = writeBatch(db);
        if (D.code) b.delete(doc(db, 'codes', D.code));
        b.delete(doc(db, 'leagues', o.id));
        b.set(doc(db, 'users', uid), { leagues: arrayRemove(o.id) }, { merge: true });
        return b.commit();
      }
    }
    throw err('fs/unknown-op', o.k);
  }

  window.DB = { start, register, login, logout, reset, setName, rename: setName, claimAdmin, setSite, allLeagues, join, createLeague, importLeague, regenCode, claimTeam, removeMember, open, op };
  window.dispatchEvent(new Event('fs-db-ready'));
}
