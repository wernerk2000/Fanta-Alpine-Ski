// A small in-browser stand-in for the parts of Firebase (app, auth, firestore) that site/src/db.js uses, with a
// JavaScript port of site/firestore.rules, so the real db.js can be exercised end to end in the browser tests.
// Served in place of https://www.gstatic.com/firebasejs/10.12.2/firebase-{app,auth,firestore}.js.
const SK = 'fakefire-v1';

export class Timestamp {
  constructor(ms) { this._ms = ms; }
  static fromMillis(ms) { return new Timestamp(ms); }
  static now() { return new Timestamp(Date.now()); }
  toMillis() { return this._ms; }
  toDate() { return new Date(this._ms); }
  isEqual(o) { return o instanceof Timestamp && o._ms === this._ms; }
}
class Sentinel { constructor(s, v) { this.s = s; this.v = v; } }
const SENT = { st: new Sentinel('st'), del: new Sentinel('del') };
export function serverTimestamp() { return SENT.st; }
export function deleteField() { return SENT.del; }
export function arrayUnion(...v) { return new Sentinel('au', v); }
export function arrayRemove(...v) { return new Sentinel('ar', v); }
let NOW = 0;   // the time of the write being committed: server timestamps and request.time

// ---------- store (survives reloads in sessionStorage, like the real database and login)
function enc(v) {
  if (v instanceof Timestamp) return { __ts: v._ms };
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { o[k] = enc(v[k]); }); return o; }
  return v;
}
function dec(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && '__ts' in v) return new Timestamp(v.__ts);
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(k => { o[k] = dec(v[k]); }); return o; }
  return v;
}
function clone(v) { return dec(enc(v)); }
// db.js imports this file under three names (app, auth, firestore): the state is shared through window
const kept = (() => { try { return JSON.parse(sessionStorage.getItem(SK)); } catch (e) { return null; } })();
const F = window.__fake = window.__fake || (() => {
  const f = { docs: {}, accounts: {}, uid: null, reads: 0, writes: 0, log: [], listeners: [], authListeners: [] };
  if (kept) { f.docs = dec(kept.docs); f.accounts = kept.accounts; f.uid = kept.uid; f.reads = kept.reads || 0; f.writes = kept.writes || 0; }
  return f;
})();
function save() { try { sessionStorage.setItem(SK, JSON.stringify({ docs: enc(F.docs), accounts: F.accounts, uid: F.uid, reads: F.reads, writes: F.writes })); } catch (e) { } }
function fail(code) { const e = new Error(code); e.code = code; return e; }
function isMap(v) { return !!v && typeof v === 'object' && v.constructor === Object; }
function same(a, b) { return JSON.stringify(enc(a)) === JSON.stringify(enc(b)); }

// ---------- app & auth
export function initializeApp(cfg) { return { cfg }; }
const authListeners = F.authListeners;
const auth = F.auth = F.auth || { currentUser: null, languageCode: null };
function userOf(uid) { if (!uid) return null; const a = Object.values(F.accounts).find(x => x.uid === uid); return a ? { uid: a.uid, email: a.email, displayName: a.displayName || null } : null; }
auth.currentUser = userOf(F.uid);
export function getAuth() { return auth; }
function fireAuth() { auth.currentUser = userOf(F.uid); save(); authListeners.forEach(cb => setTimeout(() => cb(auth.currentUser), 0)); }
export function onAuthStateChanged(a, cb) { authListeners.push(cb); setTimeout(() => cb(auth.currentUser), 0); return () => { }; }
export async function createUserWithEmailAndPassword(a, email, pw) {
  email = String(email || '').toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail('auth/invalid-email');
  if (String(pw || '').length < 6) throw fail('auth/weak-password');
  if (F.accounts[email]) throw fail('auth/email-already-in-use');
  const uid = 'U' + Math.random().toString(36).slice(2, 10);
  F.accounts[email] = { uid, email, pw, displayName: null };
  F.uid = uid; fireAuth();
  return { user: auth.currentUser };
}
export async function signInWithEmailAndPassword(a, email, pw) {
  const acc = F.accounts[String(email || '').toLowerCase()];
  if (!acc || acc.pw !== pw) throw fail('auth/invalid-credential');
  F.uid = acc.uid; fireAuth();
  return { user: auth.currentUser };
}
export async function signOut() { F.uid = null; fireAuth(); }
export async function sendPasswordResetEmail(a, email) { F.resetFor = email; }
export async function updateProfile(user, p) {
  const acc = Object.values(F.accounts).find(x => x.uid === user.uid);
  if (acc && p.displayName != null) acc.displayName = p.displayName;
  auth.currentUser = userOf(F.uid); save();
}

// ---------- references
export function getFirestore() { return {}; }
export function doc(db, ...seg) { const path = seg.join('/'); return { type: 'doc', path, id: seg[seg.length - 1] }; }
export function collection(db, ...seg) { return { type: 'col', path: seg.join('/') }; }
function parentOf(path) { return path.split('/').slice(0, -1).join('/'); }
function childrenOf(col) { return Object.keys(F.docs).filter(p => parentOf(p) === col).sort(); }

// ---------- rules: a port of site/firestore.rules
function rules(method, path, ctx) {
  const me = ctx.uid, signedIn = !!me, seg = path.split('/');
  const T = (f) => { try { return !!f(); } catch (e) { return false; } };
  const pre = p => (p in ctx.pre ? ctx.pre[p] : null), post = p => (p in ctx.post ? ctx.post[p] : null);
  const gadmin = () => signedIn && !!pre('config/admins') && (pre('config/admins').uids || []).indexOf(me) >= 0;
  const openLeagues = () => signedIn && !!pre('config/site') && pre('config/site').openLeagues === true;
  const myName = () => { const u = post('users/' + me); if (!u) throw fail('rules-error'); return u.name == null ? '' : u.name; };
  const leagueDoc = lid => { const d = pre('leagues/' + lid); if (!d) throw fail('rules-error'); return d; };
  const ladmin = lid => signedIn && (T(() => leagueDoc(lid).admin === me) || T(gadmin));
  const member = lid => signedIn && !!pre('leagues/' + lid + '/members/' + me);
  const inLeague = lid => { try { if (ladmin(lid)) return true; } catch (e) { } return member(lid); };
  const owns = (lid, tid) => { const t = pre('leagues/' + lid + '/teams/' + tid); if (!t) throw fail('rules-error'); return t.uid === me; };
  const nd = ctx.newData, od = ctx.oldData, read = method === 'get' || method === 'list', write = !read;
  const diff = () => { const k = new Set(Object.keys(nd || {}).concat(Object.keys(od || {}))); return [...k].filter(x => !same((nd || {})[x], (od || {})[x])); };
  const only = (ks, allowed) => ks.every(k => allowed.indexOf(k) >= 0);
  const isTime = v => v instanceof Timestamp && v._ms === ctx.time;
  if (seg[0] === 'config' && seg[1] === 'admins' && seg.length === 2) {
    if (read) return signedIn;
    if (method === 'create') return signedIn && same(nd.uids, [me]);
    if (method === 'update') return T(gadmin);
    return false;
  }
  if (seg[0] === 'config' && seg[1] === 'site' && seg.length === 2) {
    if (read) return signedIn;
    return T(gadmin);
  }
  if (seg[0] === 'users' && seg.length === 2) {
    if (!(signedIn && seg[1] === me)) return false;
    if (read) return true;
    if (method === 'delete') return false;
    // the username must be reserved for this account in usernames/
    return !('name' in nd) || (!!od && (od.name == null ? null : od.name) === nd.name)
      || T(() => typeof nd.name === 'string' && post('usernames/' + nd.name.toLowerCase()).uid === me);
  }
  if (seg[0] === 'usernames' && seg.length === 2) {
    const key = seg[1];
    if (method === 'get') return signedIn;
    if (method === 'create') return signedIn && nd.uid === me && /^[a-z0-9._-]{3,20}$/.test(key) && T(() => String(myName()).toLowerCase() === key);
    if (method === 'delete') return signedIn && !!od && od.uid === me;
    return false;
  }
  if (seg[0] === 'codes' && seg.length === 2) {
    if (method === 'get') return signedIn;
    if (method === 'create') return signedIn && (T(() => post('leagues/' + nd.lid).admin === me) || T(gadmin));
    if (method === 'delete') return signedIn && (T(() => leagueDoc(od.lid).admin === me) || T(gadmin));
    return false;
  }
  if (seg[0] === 'leagues') {
    const lid = seg[1];
    if (seg.length === 2) {
      if (method === 'list') return T(gadmin);
      if (read) return T(() => inLeague(lid));
      if (method === 'create') return (T(gadmin) || T(openLeagues)) && nd.admin === me;
      if (method === 'update') return T(() => ladmin(lid)) && nd.admin === od.admin;
      if (method === 'delete') return T(() => ladmin(lid));
    }
    if (seg[2] === 'members' && seg.length === 4) {
      const uid = seg[3];
      if (read) return T(() => inLeague(lid));
      if (method === 'create') return signedIn && uid === me && T(() => nd.code === leagueDoc(lid).code) && nd.team === null && T(() => nd.name === myName());
      if (method === 'update') return T(() => ladmin(lid))
        || (uid === me && only(diff(), ['name']) && T(() => nd.name === myName()))
        || (uid === me && od.team === null && only(diff(), ['team']) && T(() => post('leagues/' + lid + '/teams/' + nd.team).uid === me));
      if (method === 'delete') return T(() => ladmin(lid)) || uid === me;
    }
    if (seg[2] === 'teams' && seg.length === 4) {
      const tid = seg[3];
      if (read) return T(() => inLeague(lid));
      if (method === 'create' || method === 'delete') return T(() => ladmin(lid));
      if (method === 'update') return T(() => ladmin(lid))
        || (member(lid) && od.uid == null && nd.uid === me && only(diff(), ['uid', 'owner'])
          && T(() => pre('leagues/' + lid + '/members/' + me).team == null) && T(() => post('leagues/' + lid + '/members/' + me).team === tid))
        || (member(lid) && od.uid === me && only(diff(), ['name']) && typeof nd.name === 'string' && nd.name.trim().length > 0 && nd.name.length <= 30);
    }
    if (seg[2] === 'pending' && seg.length === 4) {
      const tid = seg[3];
      if (method === 'list') return T(() => ladmin(lid));
      return T(() => ladmin(lid)) || (member(lid) && T(() => owns(lid, tid)));
    }
    if (seg[2] === 'races' && seg[4] === 'lineups' && seg.length === 6) {
      const rid = seg[3], tid = seg[5];
      const lock = () => { const l = (leagueDoc(lid).locks || {})[rid]; if (!(l instanceof Timestamp)) throw fail('rules-error'); return l._ms; };
      if (method === 'list') return T(() => ladmin(lid)) || (member(lid) && T(() => ctx.time > lock()));
      if (method === 'get') return T(() => ladmin(lid)) || (member(lid) && (T(() => ctx.time > lock()) || T(() => owns(lid, tid))));
      if (method === 'create' || method === 'update') return signedIn && isTime(nd.at)
        && (T(() => ladmin(lid)) || (member(lid) && T(() => owns(lid, tid)) && nd.uid === me && T(() => ctx.time < lock())));
      if (method === 'delete') return T(() => ladmin(lid));
    }
    return false;
  }
  if ((seg[0] === 'results' || seg[0] === 'races' || seg[0] === 'athletes') && seg.length === 2) {
    if (read) return signedIn;
    return T(gadmin);
  }
  return false;
}
function canRead(method, path) {
  // a query is checked as a read of any document of the collection (rules that need the document's id fail)
  if (method === 'list') path = path + '/*';
  const ok = rules(method, path, { uid: F.uid, pre: F.docs, post: F.docs, time: Date.now(), newData: null, oldData: F.docs[path] || null });
  if (!ok) F.log.push('DENY ' + method + ' ' + path);
  return ok;
}

// ---------- reads
function docSnap(path) {
  const d = F.docs[path];
  return { id: path.split('/').pop(), exists: () => !!d, data: () => (d ? clone(d) : undefined), ref: { path } };
}
function colSnap(path) {
  const docs = childrenOf(path).map(docSnap);
  return { docs, size: docs.length, empty: !docs.length, forEach: cb => docs.forEach(cb) };
}
export async function getDoc(ref) {
  if (!canRead('get', ref.path)) throw fail('permission-denied');
  F.reads++; return docSnap(ref.path);
}
export async function getDocs(ref) {
  if (!canRead('list', ref.path)) throw fail('permission-denied');
  const s = colSnap(ref.path); F.reads += Math.max(1, s.size); return s;
}
export const getDocsFromServer = getDocs;
const listeners = F.listeners;
export function onSnapshot(ref, next, error) {
  const L = { ref, next, error: error || (() => { }), alive: true, last: null };
  listeners.push(L);
  setTimeout(() => deliver(L, true), 0);
  return () => { L.alive = false; };
}
function deliver(L, first) {
  if (!L.alive) return;
  const method = L.ref.type === 'doc' ? 'get' : 'list';
  if (!canRead(method, L.ref.path)) { L.alive = false; L.error(fail('permission-denied')); return; }
  const snap = L.ref.type === 'doc' ? docSnap(L.ref.path) : colSnap(L.ref.path);
  const sig = JSON.stringify(enc(L.ref.type === 'doc' ? F.docs[L.ref.path] || null : childrenOf(L.ref.path).map(p => [p, F.docs[p]])));
  if (!first && sig === L.last) return;
  F.reads += L.ref.type === 'doc' ? 1 : Math.max(1, snap.size);
  L.last = sig;
  L.next(snap);
}
function notify() { listeners.forEach(L => { if (L.alive) setTimeout(() => deliver(L, false), 0); }); }

// ---------- writes
function resolve(v, old) {
  if (v === SENT.st) return new Timestamp(NOW);
  if (v instanceof Sentinel && v.s === 'au') { const a = Array.isArray(old) ? old.slice() : []; v.v.forEach(x => { if (!a.some(y => same(x, y))) a.push(x); }); return a; }
  if (v instanceof Sentinel && v.s === 'ar') return (Array.isArray(old) ? old : []).filter(y => !v.v.some(x => same(x, y)));
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map(x => resolve(x));
  if (isMap(v)) { const o = {}; Object.keys(v).forEach(k => { if (v[k] !== SENT.del) o[k] = resolve(v[k], old && old[k]); }); return o; }
  if (v === undefined) throw fail('invalid-argument');
  return v;
}
function mergeInto(base, v) {
  const o = isMap(base) ? clone(base) : {};
  Object.keys(v).forEach(k => {
    if (v[k] === SENT.del) delete o[k];
    else if (isMap(v[k]) && isMap(o[k])) o[k] = mergeInto(o[k], v[k]);
    else o[k] = resolve(v[k], o[k]);
  });
  return o;
}
function setPath(o, fp, v) {
  const ks = fp.split('.');
  let cur = o;
  for (let i = 0; i < ks.length - 1; i++) { if (!isMap(cur[ks[i]])) cur[ks[i]] = {}; cur = cur[ks[i]]; }
  const last = ks[ks.length - 1];
  if (v === SENT.del) delete cur[last]; else cur[last] = resolve(v, cur[last]);
}
async function commit(ops) {
  const now = NOW = Date.now(), post = Object.assign({}, F.docs), methods = [];
  ops.forEach(o => {
    const p = o.ref.path, before = post[p] || null;
    if (o.t === 'delete') { methods.push([p, 'delete']); delete post[p]; return; }
    if (o.t === 'update' && !before) throw fail('not-found');
    let after;
    if (o.t === 'set') after = o.opts && o.opts.merge ? mergeInto(before, o.data) : resolve(o.data);
    else { after = clone(before); Object.keys(o.data).forEach(fp => setPath(after, fp, o.data[fp])); }
    methods.push([p, F.docs[p] ? 'update' : 'create']);
    post[p] = after;
  });
  for (const [p, m] of methods) {
    const ok = rules(m, p, { uid: F.uid, pre: F.docs, post: post, time: now, newData: post[p] || null, oldData: F.docs[p] || null });
    if (!ok) { F.log.push('DENY ' + m + ' ' + p); throw fail('permission-denied'); }
  }
  F.docs = post; F.writes += ops.length; save(); notify();
}
export function setDoc(ref, data, opts) { return commit([{ t: 'set', ref, data, opts }]); }
export function updateDoc(ref, data) { return commit([{ t: 'update', ref, data }]); }
export function deleteDoc(ref) { return commit([{ t: 'delete', ref }]); }
export function writeBatch() {
  const ops = [];
  const b = {
    set(ref, data, opts) { ops.push({ t: 'set', ref, data, opts }); return b; },
    update(ref, data) { ops.push({ t: 'update', ref, data }); return b; },
    delete(ref) { ops.push({ t: 'delete', ref }); return b; },
    commit() { return commit(ops); }
  };
  return b;
}
