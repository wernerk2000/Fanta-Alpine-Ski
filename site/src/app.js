(function () {
  'use strict';
  var D = document;
  var APP = D.getElementById('app');

  // ---------- small utilities
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { n = Math.round((+n || 0) * 10) / 10; var a = Math.abs(n); return (n < 0 ? '−' : '') + (a % 1 ? a.toFixed(1) : String(a)).replace('.', ','); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
  var GGS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
  function dobj(ds) { return new Date(ds + 'T12:00:00Z'); }
  function dlab(ds, wd) { var d = dobj(ds); return (wd ? GGS[d.getUTCDay()] + ' ' : '') + d.getUTCDate() + ' ' + MESI[d.getUTCMonth()]; }
  function drange(a, b) {
    if (a === b) return dlab(a, true);
    var x = dobj(a), y = dobj(b);
    return x.getUTCMonth() === y.getUTCMonth() ? x.getUTCDate() + '–' + y.getUTCDate() + ' ' + MESI[y.getUTCMonth()] : dlab(a) + ' – ' + dlab(b);
  }
  var TF = null;
  try { TF = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { TF = null; }
  function tlab(ms) { try { return TF.format(new Date(ms)); } catch (e) { return new Date(ms).toLocaleString('it-IT'); } }
  function todayRome() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function slugify(s) { return String(s).toLowerCase().replace(/ß/g, 'ss').replace(/ø/g, 'o').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function val(id) { var el = D.getElementById(id); return el ? el.value : ''; }

  // ---------- state: the backend (Firebase, or the in-memory stand-in of the tests) hands over everything
  var DBX = null, STATE = null;
  var UIK = 'fs-site-ui-v1';
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }

  // ROOT: my leagues with the shared calendar, athletes and results; S: the open league seen as a single league; C: its scores
  var ROOT = null, S = null, C = null, bootNote = '';
  var ui = { tab: 'classifica', team: null, gf: '', lg: '', ld: '', lfree: false, lq: '', adm: 'asta', lid: '', cl: 'gen' };
  var saved = lsGet(UIK);
  if (saved) Object.keys(ui).forEach(function (k) { if (saved[k] != null && k !== 'lq') ui[k] = saved[k]; });
  var hash = (location.hash || '').slice(1);
  if (['classifica', 'squadre', 'gare', 'listone', 'regole', 'profilo'].indexOf(hash) >= 0) ui.tab = hash;
  // invite link (?invito=CODICE): the code is kept until the account is inside the league
  var INVK = 'fs-site-invite';
  var invite = (function () {
    var m = /[?&#]invito=([A-Za-z0-9]{4,12})/.exec(location.search + location.hash);
    if (m) { lsSet(INVK, m[1].toUpperCase()); try { history.replaceState(null, '', location.pathname); } catch (e) { } }
    return lsGet(INVK);
  })();
  function saveUi() { lsSet(UIK, { tab: ui.tab, team: ui.team, gf: ui.gf, lg: ui.lg, ld: ui.ld, lfree: ui.lfree, adm: ui.adm, lid: ui.lid, cl: ui.cl }); }
  var tmp = { race: null, scrolled: false, at: null, aq: '', ath: null, price: '', rr: null, parsed: null, paste: '', rel: null, ea: null, eq: '', er: null, lu: null, allRaces: false,
    auth: invite ? 'register' : 'login', joining: false, authErr: '', authOk: '', busy: false, joinErr: '', mrem: null, lgdel: null,
    nameErr: '', pickT: null, skipPick: {}, all: null };

  // who is looking: CAN = signed in, OWNER = organiser of the open league (or the site's administrator), GADMIN = administrator of the site
  var CAN = false, OWNER = false, GADMIN = false, ME = null, discardArm = false;
  function entryOf(lid) { return ROOT ? FS.findBy(ROOT.leagues, lid) : null; }
  function setView() {
    S = null; C = null; OWNER = false;
    if (!ROOT || !ROOT.leagues.length) return;
    if (tmp.wantLid && entryOf(tmp.wantLid)) tmp.wantLid = null;
    // a league just created or joined reaches the list a moment later: wait for it instead of opening another one
    if (!entryOf(ui.lid)) { if (tmp.wantLid && tmp.wantLid === ui.lid) return; ui.lid = ROOT.leagues[0].id; }
    if (STATE.openId !== ui.lid) { DBX.open(ui.lid); return; }
    var e = entryOf(ui.lid);
    if (!e.loaded) return;
    S = FS.view(ROOT, ui.lid);
    C = FS.compute(S);
    OWNER = e.admin === ME || GADMIN;
  }
  function onState(st) {
    if (st.phase === 'signedout' && (!STATE || STATE.phase !== 'signedout')) {
      tmp.auth = invite ? 'register' : 'login'; tmp.authOk = ''; tmp.joinErr = ''; tmp.lu = null; tmp.all = null; tmp.skipPick = {}; tmp.pickT = null;
      var tt0 = D.getElementById('fs-toast'); if (tt0) tt0.hidden = true;
    }
    if (st.phase === 'ready' && STATE && STATE.phase === 'signedout') { tmp.authErr = ''; tmp.authOk = ''; ui.team = null; ui.tab = 'classifica'; saveUi(); }
    STATE = st;
    ME = st.user ? st.user.uid : null; CAN = !!ME; GADMIN = !!st.gadmin;
    ROOT = st.phase === 'ready' ? { leagues: st.leagues || [], athletes: st.athletes || [], races: st.races || [], results: st.results || {}, excluded: st.excluded || [] } : null;
    setView();
    render();
    if (st.phase === 'ready' && !st.needName && invite && !tmp.joining) acceptInvite();
  }
  function acceptInvite() {
    var code = invite;
    tmp.joining = true; render();
    function end() { invite = null; lsSet(INVK, null); tmp.joining = false; }
    DBX.join(code, STATE.user.name).then(function (lid) {
      end(); enterLeague(lid);
    }, function (e) {
      end();
      tmp.joinErr = e && e.code === 'fs/bad-code' ? 'Il link di invito non vale più: chiedi il codice nuovo a chi organizza la lega.' : errText(e);
      if (ROOT && ROOT.leagues.length) toast(tmp.joinErr);
      render();
    });
  }
  // just inside a league: its page opens, and who has no team yet is asked which one is theirs
  function expect(lid) {
    tmp.wantLid = lid;
    setTimeout(function () { if (tmp.wantLid === lid) { tmp.wantLid = null; setView(); render(); } }, 8000);
  }
  function enterLeague(lid) {
    expect(lid);
    ui.lid = lid; ui.tab = 'classifica'; ui.team = null; tmp.skipPick[lid] = false; tmp.pickT = null; saveUi(); setView(); render(); window.scrollTo(0, 0);
  }
  function inviteLink(code) { return location.origin + location.pathname.replace(/index\.html$/, '') + '?invito=' + code; }
  var ERR = {
    'auth/email-already-in-use': 'Esiste già un account con questa email: accedi.',
    'auth/invalid-email': 'L\'email non è valida.',
    'auth/missing-email': 'Scrivi l\'email.',
    'auth/weak-password': 'La password deve avere almeno 6 caratteri.',
    'auth/missing-password': 'Scrivi la password.',
    'auth/invalid-credential': 'Email o password sbagliate.',
    'auth/wrong-password': 'Email o password sbagliate.',
    'auth/user-not-found': 'Non c\'è un account con questa email.',
    'auth/too-many-requests': 'Troppi tentativi: riprova tra qualche minuto.',
    'auth/network-request-failed': 'Connessione assente: riprova.',
    'fs/bad-code': 'Codice non valido: controllalo con chi organizza la lega.',
    'fs/bad-name': 'Lo username va da 3 a 20 caratteri: lettere, numeri, punto, trattino o trattino basso, senza spazi.',
    'fs/name-taken': 'Questo username è già preso: scegline un altro.',
    'permission-denied': 'Operazione non permessa: la formazione potrebbe essere già chiusa, o non hai i permessi.',
    'unavailable': 'Connessione assente: riprova tra poco.'
  };
  function errText(e) { var c = e && e.code; return ERR[c] || ('Operazione non riuscita' + (c ? ' (' + c + ')' : '') + '.'); }
  // checks the change on a copy, then sends it; returns false if refused here, else a promise of whether the database accepted it
  function doOp(op, errMsg) {
    if (!S || !CAN) return false;
    if (FS.LEAGUE_OPS[op.k] && !op.lg) op.lg = S.lid;
    if (!FS.applyOp(FS.clone(ROOT), op)) { toast('Questa modifica non è possibile.'); return false; }
    return DBX.op(op).then(function () { return true; }, function (e) { toast((errMsg && errMsg[e && e.code]) || errText(e)); return false; });
  }

  // ---------- derived helpers
  function now() { return Date.now(); }
  function ath(id) { return C.A[id]; }
  function team(id) { return FS.findBy(S.teams, id); }
  function tname(id) { var t = team(id); return t ? t.name : '—'; }
  function race(id) { return FS.findBy(S.races, id); }
  function hasRes(r) { return !!C.raceRes[r.id]; }
  function lockOf(r) { return C.locks[r.id]; }
  function byDate(a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : (a.g < b.g ? -1 : 1); }
  function upcoming() { return S.races.filter(function (r) { return r.st !== 'canc' && lockOf(r) > now(); }).sort(byDate); }
  function curG() { var d = todayRome(); for (var i = 0; i < C.G.length; i++) if (C.G[i].to >= d) return C.G[i]; return C.G[C.G.length - 1] || null; }
  function lastDoneG() { var g = null; C.G.forEach(function (x) { if (x.races.some(hasRes)) g = x; }); return g; }
  function myTeam() { if (!ME) return null; for (var i = 0; i < S.teams.length; i++) if (S.teams[i].uid === ME) return S.teams[i]; return null; }
  // for someone without a team: the free team the organiser named after them, else the first free one
  function freeTeam() {
    var free = S.teams.filter(function (t) { return !t.uid; }), nm = FS.norm(STATE && STATE.user ? STATE.user.name : '');
    return free.filter(function (t) { return nm && (FS.norm(t.owner) === nm || FS.norm(t.name).indexOf(nm) >= 0); })[0] || free[0] || null;
  }
  function canLineup(tid) { if (!CAN || !ME) return false; if (OWNER) return true; var t = team(tid); return !!t && t.uid === ME; }
  function members() { var e = S && entryOf(S.lid); return (e && e.members) || []; }
  function memberOf(uid) { return members().filter(function (m) { return m.uid === uid; })[0] || null; }
  // who plays a team: the username of the linked account, else the name the organiser wrote
  function ownerName(t) { var m = t.uid ? memberOf(t.uid) : null; return m ? m.name : (t.owner || ''); }
  // a participant without a team is first asked which team is theirs
  function needPick() { return !!(S && !OWNER && !myTeam() && S.teams.length && !tmp.skipPick[S.lid]); }
  var DISC = { GS: 'Gigante', SL: 'Slalom', DH: 'Discesa', SG: 'SuperG' };
  var DCODES = ['DH', 'SG', 'GS', 'SL'];
  var GLAB = { M: 'Uomini', F: 'Donne' };
  function best(a) { var b = 0, bi = -1; (a.p || []).forEach(function (v, i) { if (v > b) { b = v; bi = i; } }); return bi >= 0 ? DCODES[bi] : null; }
  function bib(a) { var d = best(a); return '<span class="bib ' + (d ? FS.CAT[d] : 'N') + '" title="' + (d ? 'Specialità: ' + DISC[d] : 'Nessun punto nell\'ultima stagione') + '">' + (d || '–') + '</span>'; }
  function disc(t) { return '<span class="disc ' + FS.CAT[t] + '" title="' + DISC[t] + '">' + t + '</span>'; }
  function dpts(a) { var s = DCODES.map(function (d, i) { return a.p && a.p[i] ? d + ' ' + a.p[i] : ''; }).filter(Boolean).join(' · '); return s || 'nessun punto'; }
  function short(a) { var p = a.n.split(' '); return p.length > 1 ? p.slice(1).join(' ') : a.n; }
  function stat(k, v) { return '<div class="stat"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>'; }
  function chipset(act, opts, cur) { return opts.map(function (o) { return '<button type="button" class="chip' + (cur === o[0] ? ' on' : '') + '" data-act="' + act + '" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join(''); }
  function matchQ(a, q) {
    if (!q || !q.trim()) return true;
    var n = FS.norm(a.n + ' ' + a.c);
    return FS.words(q).every(function (w) { return n.indexOf(w) >= 0; });
  }
  var CUPS = { gen: { lbl: 'Classifica generale', h: 'Sfera di cristallo', short: 'Generale' },
    T: { lbl: 'Tecniche · gigante e slalom', h: 'Coppa delle tecniche', short: 'Tecniche', d: ['GS', 'SL'] },
    V: { lbl: 'Veloci · discesa e superG', h: 'Coppa delle veloci', short: 'Veloci', d: ['DH', 'SG'] } };
  function standings(kind) {
    var lg = lastDoneG();
    kind = CUPS[kind] ? kind : 'gen';
    var rows = S.teams.map(function (t) {
      var x = C.T[t.id];
      if (!x) return { t: t, tot: 0, last: 0 };
      if (kind === 'gen') return { t: t, tot: x.total, last: lg ? (x.byG[lg.k] || 0) : 0 };
      return { t: t, tot: x.byC[kind], last: lg && x.byGC[lg.k] ? x.byGC[lg.k][kind] : 0 };
    });
    rows.sort(function (a, b) { return b.tot - a.tot || b.last - a.last || a.t.name.localeCompare(b.t.name); });
    var pos = 0, prev = null;
    rows.forEach(function (r, i) { if (prev === null || r.tot !== prev) pos = i + 1; r.pos = pos; prev = r.tot; });
    return { rows: rows, lg: lg };
  }
  function raceOptions(sel) {
    return C.G.map(function (g) {
      return '<optgroup label="G' + g.n + ' · ' + drange(g.from, g.to) + '">' + g.races.map(function (x) {
        return '<option value="' + x.id + '"' + (x.id === sel ? ' selected' : '') + '>' + dlab(x.d, true) + ' · ' + x.g + ' ' + x.t + ' ' + esc(x.v) + (S.results[x.id] ? ' ✓' : x.st === 'canc' ? ' (annullata)' : '') + '</option>';
      }).join('') + '</optgroup>';
    }).join('');
  }
  function raceHead(r) {
    return '<span class="rd num">' + dlab(r.d, true) + '</span><span class="sx" title="' + GLAB[r.g] + '">' + r.g + '</span>' + disc(r.t) +
      '<span class="rv">' + esc(r.v) + (r.c ? ' <span class="nat">' + esc(r.c) + '</span>' : '') + (r.x && r.x !== 1 ? '<span class="gx">×' + fmt(r.x) + '</span>' : '') + (r.fin ? '<span class="gx">Finali</span>' : '') + '</span>';
  }
  var SRC = { scelta: '', ultima: 'come l\'ultima', automatica: 'automatica', nessuna: '' };
  function lockText(L) {
    var b = L.lockBefore != null ? L.lockBefore : 60;
    return (b === 60 ? 'un\'ora' : b % 60 === 0 && b ? (b / 60) + ' ore' : b + ' minuti') + ' prima della partenza della gara (ora italiana), o alle ' + pad(L.lockHour || 9) + ':00 del giorno di gara finché l\'orario non è noto';
  }
  function luText(e) {
    if (!e.roster.length) return '<span class="muted">nessun atleta in rosa</span>';
    var t = e.t.map(function (a) { return esc(short(ath(a))); }).join(', ');
    return (t ? '<b>' + t + '</b>' : '<span class="muted">nessun titolare</span>') + (e.r ? ' · riserva ' + esc(short(ath(e.r))) : '') + (SRC[e.src] ? ' <span class="gx">' + SRC[e.src] + '</span>' : '');
  }

  // ---------- header & footer
  var BRAND = 'Fanta Alpine Ski', LOGO = 'Fanta <b>Alpine Ski</b>';
  function header(tab) {
    var up = upcoming(), nx;
    if (up.length) nx = '<span class="gtag">' + up[0].g + ' ' + up[0].t + '</span>' + esc(up[0].v) + ' · formazione entro <b>' + esc(tlab(lockOf(up[0]))) + '</b>';
    else nx = 'Stagione conclusa';
    var tabs = [['classifica', 'Classifica'], ['squadre', 'Squadre'], ['gare', 'Gare'], ['listone', 'Listone'], ['regole', 'Regole']];
    if (OWNER) tabs.push(['gestione', 'Gestione']);
    tabs.push(['profilo', 'Profilo']);
    var multi = ROOT.leagues.length > 1, name = multi ? BRAND : (S.league.name || BRAND);
    var logo = name.indexOf(BRAND) === 0 ? LOGO + esc(name.slice(BRAND.length)) : esc(name);
    var sub = multi ? '<select id="lgsel" class="lgsel" data-chg="lgsel" aria-label="Lega">' + ROOT.leagues.map(function (lg) {
      return '<option value="' + esc(lg.id) + '"' + (lg.id === S.lid ? ' selected' : '') + '>' + esc(lg.league.name || 'Lega') + '</option>';
    }).join('') + '</select>' : '<span class="season">' + esc(S.league.season || '') + '</span>';
    return '<header class="hdr"><div class="hdr-in"><div class="brandrow"><div class="brand"><span class="logo">' + logo + '</span>' + sub + '</div><div class="nextg">' + nx + '</div></div>' +
      '<nav class="tabs" aria-label="Sezioni">' + tabs.map(function (t) {
        var on = tab === t[0];
        return '<button type="button" id="tab-' + t[0] + '" class="tab' + (on ? ' on' : '') + '" data-act="tab" data-v="' + t[0] + '"' + (on ? ' aria-current="page"' : '') + '>' + t[1] + '</button>';
      }).join('') + '</nav></div></header>';
  }
  function footer() {
    return '<footer class="foot"><span>Punti di Coppa del Mondo FIS. Listone dalle classifiche finali 2025/26; calendario 2026/27 provvisorio, con alcune date e località ancora da confermare.</span>' +
      '<span>Connesso come ' + esc(STATE.user.name) + ' · <button type="button" class="linkb" data-act="logout">Esci</button></span></footer>';
  }

  // ---------- Classifica
  function vClassifica() {
    var kind = CUPS[ui.cl] ? ui.cl : 'gen', cup = CUPS[kind];
    var inCup = function (r) { return r.st !== 'canc' && (!cup.d || cup.d.indexOf(r.t) >= 0); };
    var st = standings(kind), nDone = S.races.filter(function (r) { return inCup(r) && hasRes(r); }).length, nTot = S.races.filter(inCup).length;
    var first = S.races.filter(inCup).sort(byDate)[0], DART = { GS: 'il gigante', SL: 'lo slalom', DH: 'la discesa', SG: 'il superG' };
    var h = '<section class="sec"><div class="chips">' + chipset('cl', [['gen', 'Generale'], ['T', 'Tecniche'], ['V', 'Veloci']], kind) + '</div>' +
      '<div class="lbl">' + cup.lbl + '</div><h1 class="h1">' + cup.h + '</h1><p class="sub">';
    if (kind !== 'gen') h += (kind === 'T' ? 'Punti di gigante e slalom' : 'Punti di discesa e superG') + ', uomini e donne insieme. ';
    if (nDone) h += 'Dopo ' + nDone + ' gare su ' + nTot + (st.lg ? ' · ultima giornata G' + st.lg.n + ', ' + drange(st.lg.from, st.lg.to) : '') + '.';
    else if (first) h += 'Nessuna gara ancora corsa. Si parte ' + dlab(first.d, true) + ' a ' + esc(first.v) + ' con ' + DART[first.t] + '.';
    h += '</p>';
    if (!S.teams.length) h += '<p class="muted">Nessuna squadra.</p>';
    else {
      var mine = myTeam();
      h += '<div class="colh" aria-hidden="true"><span>Pos</span><span>Squadra</span><span>' + (st.lg ? 'G' + st.lg.n : 'Ult.') + '</span><span>Tot</span></div><ol class="stand">';
      h += st.rows.map(function (r) {
        return '<li><button type="button" class="srow" data-act="team" data-v="' + r.t.id + '"><span class="pos' + (r.pos === 1 && r.tot > 0 ? ' lead' : '') + '">' + r.pos + '</span><span class="who"><span class="tn">' + esc(r.t.name) + (mine && mine.id === r.t.id ? ' <span class="gx">tu</span>' : '') + '</span>' +
          (ownerName(r.t) ? '<span class="to">' + esc(ownerName(r.t)) + '</span>' : '') + '</span><span class="last num">' + (st.lg ? fmt(r.last) : '–') + '</span><span class="tot num">' + fmt(r.tot) + '</span></button></li>';
      }).join('') + '</ol>';
    }
    h += '</section>';
    if (!myTeam() && freeTeam()) h += '<section class="sec"><div class="capbox"><span>Non hai ancora una squadra in questa lega.</span><button type="button" class="btn ghost" data-act="' + (OWNER ? 'team' : 'repick') + '" data-v="' + freeTeam().id + '">Scegli la tua squadra</button></div></section>';
    var owned = S.purchases.filter(function (p) { return !p.to; }).length, need = S.teams.length * 2 * (S.league.perGender || 6);
    if (owned < need) {
      h += '<section class="sec"><div class="lbl">Rose</div><div class="panel gap"><div class="acts between"><span><b class="num">' + owned + '</b> atleti assegnati su <b class="num">' + need + '</b></span>' +
        (OWNER ? '<button type="button" class="mini" data-act="goadm" data-v="asta">Vai all\'asta</button>' : '') + '</div><div class="prog"><i style="width:' + Math.round(100 * owned / Math.max(1, need)) + '%"></i></div>' +
        (owned === 0 ? '<p class="hint gap">Le rose si riempiono con l\'asta. ' + (OWNER ? 'Prima rinomina le squadre in Gestione → Squadre.' : 'Appena l\'asta è fatta, qui trovi la classifica.') + '</p>' : '') + '</div></section>';
    }
    var up = upcoming().slice(0, 4);
    if (up.length) {
      var mt = myTeam();
      h += '<section class="sec"><div class="lbl">Prossime gare</div><div class="gap">' + up.map(function (r) {
        var line = mt ? '<div class="lusum small">La tua formazione: ' + luText(C.eff[r.id][mt.id]) + '</div>' : '';
        return '<button type="button" class="race" data-act="golu" data-v="' + r.id + '">' + raceHead(r) + '<span class="rs">entro ' + esc(tlab(lockOf(r))) + '</span></button>' + line;
      }).join('') + '</div></section>';
    }
    h += '<section class="sec"><div class="lbl">Le coppe</div><div class="cups two">' + ['T', 'V'].map(function (k) {
      var b = standings(k).rows[0], c = CUPS[k];
      return '<button type="button" class="cup" data-act="cl" data-v="' + k + '"><div class="d">' + c.d.map(disc).join('') + c.short + '</div>' +
        (b && b.tot > 0 ? '<div class="w">' + esc(b.t.name) + '</div><div class="p num">' + fmt(b.tot) + ' pt</div>' : '<div class="w muted">—</div><div class="p">nessun punto</div>') + '</button>';
    }).join('') + '</div></section>';
    return h;
  }

  // ---------- Squadre & formazioni
  function segBtn(aid, v, label, cur) { return '<button type="button" class="segb' + (cur === v ? ' on' : '') + '" data-act="lusel" data-v="' + aid + '|' + v + '" aria-pressed="' + (cur === v) + '">' + label + '</button>'; }
  function luCount(sel, v) { return Object.keys(sel).filter(function (k) { return sel[k] === v; }).length; }
  function lineupEditor(r, tid) {
    var e = C.eff[r.id][tid], sel = tmp.lu.sel, di = FS.DIDX[r.t];
    var nT = luCount(sel, 'T'), nR = luCount(sel, 'R'), max = S.league.starters || 2;
    var h = '<div class="lued"><p class="small muted">' + GLAB[r.g] + ' · ' + DISC[r.t] + ' ' + esc(r.v) + '. Accanto al nome, i punti fatti in questa disciplina nell\'ultima stagione.</p>';
    e.roster.slice().sort(function (x, y) { return (ath(y).p[di] - ath(x).p[di]) || (ath(y).q - ath(x).q); }).forEach(function (aid) {
      var a = ath(aid), s = sel[aid] || '';
      h += '<div class="luath">' + bib(a) + '<span class="an">' + esc(a.n) + ' <span class="nat">' + esc(a.c) + '</span><span class="lmeta">' + r.t + ' ' + esc(a.tpy || '25/26') + ': <span class="num">' + (a.p ? a.p[di] : 0) + '</span> pt</span></span>' +
        '<span class="seg" role="group" aria-label="Scelta per ' + esc(a.n) + '">' + segBtn(aid, 'T', 'Titolare', s) + segBtn(aid, 'R', 'Riserva', s) + segBtn(aid, '', 'Fuori', s) + '</span></div>';
    });
    h += '<div class="acts between"><span class="small muted">Titolari ' + nT + '/' + max + ' · riserva ' + nR + '/1</span><span class="acts"><button type="button" class="btn ghost" data-act="luclose">Annulla</button>' +
      '<button type="button" class="btn red" data-act="lusave"' + (nT && !tmp.lu.busy ? '' : ' disabled') + '>' + (tmp.lu.busy ? 'Salvo…' : 'Salva formazione') + '</button></span></div></div>';
    return h;
  }
  function lineupSection(tid) {
    var ups = upcoming(), t = team(tid), mine = myTeam();
    var h = '<div class="rg"><div class="rgh"><span class="lbl">Formazioni</span><span class="small muted">' + (S.league.starters || 2) + ' titolari + 1 riserva per gara</span></div>';
    if (!ups.length) return h + '<p class="muted small gap">Nessuna gara in arrivo.</p></div>';
    var see = canLineup(tid) || (mine && mine.id === tid);
    if (!see) return h + '<p class="muted small gap">Le formazioni di ' + esc(t.name) + ' si vedono nella pagina Gare quando si chiudono, ' + lockText(S.league) + '.</p></div>';
    (tmp.allRaces ? ups : ups.slice(0, 6)).forEach(function (r) {
      var e = C.eff[r.id][tid];
      var editing = tmp.lu && tmp.lu.r === r.id && tmp.lu.t === tid;
      h += '<div class="lurow"><div class="lutop">' + raceHead(r) + (canLineup(tid) && e.roster.length && !editing ? '<button type="button" class="mini" data-act="luopen" data-v="' + r.id + '">Formazione</button>' : '<span></span>') + '</div>' +
        '<div class="lusum small">' + luText(e) + ' <span class="muted">· entro ' + esc(tlab(lockOf(r))) + '</span></div></div>';
      if (editing) h += lineupEditor(r, tid);
    });
    if (ups.length > 6) h += '<div class="acts gap"><button type="button" class="mini" data-act="allraces">' + (tmp.allRaces ? 'Mostra solo le prossime 6' : 'Mostra tutte le ' + ups.length + ' gare') + '</button></div>';
    return h + '<p class="hint gap">Se non scegli, vale l\'ultima formazione della stessa disciplina, se no l\'ultima di quel genere; all\'inizio è automatica, con chi ha fatto più punti in quella disciplina.</p></div>';
  }
  function vSquadre() {
    if (!S.teams.length) return '<section class="sec"><p class="muted">Nessuna squadra.</p></section>';
    var mine = myTeam();
    var tid = ui.team && team(ui.team) ? ui.team : (mine ? mine.id : (freeTeam() || S.teams[0]).id);
    var t = team(tid), ts = FS.teamState(S, tid), tt = C.T[tid] || { total: 0, byA: {}, byC: { T: 0, V: 0 } };
    var h = '<section class="sec"><div class="chips scroll">' + S.teams.map(function (x) { return '<button type="button" class="chip' + (x.id === tid ? ' on' : '') + '" data-act="tsel" data-v="' + x.id + '">' + esc(x.name) + (mine && mine.id === x.id ? ' · tu' : !mine && CAN && !x.uid ? ' · libera' : '') + '</button>'; }).join('') + '</div>';
    h += '<div class="thead"><div><div class="lbl">' + (mine && mine.id === tid ? 'La tua squadra' : ownerName(t) ? esc(ownerName(t)) : 'Squadra') + '</div><h1 class="h1">' + esc(t.name) + '</h1></div><div class="tstats">' +
      stat('Punti', fmt(tt.total)) + stat('Tecniche', fmt(tt.byC.T)) + stat('Veloci', fmt(tt.byC.V)) + stat('Crediti', ts.credits) + stat('Rosa', ts.size + '/' + ts.max) + '</div></div>';
    if (OWNER || (mine && mine.id === tid)) {
      if (tmp.ren === tid) h += '<form class="renbox" data-form="tname" novalidate><label class="field" for="trn"><span>Nome della squadra, al massimo 30 caratteri</span><input id="trn" class="in" maxlength="30" autocomplete="off" value="' + esc(t.name) + '"></label>' +
        '<div class="acts"><button type="submit" class="btn red"' + (tmp.busy ? ' disabled' : '') + '>Salva il nome</button><button type="button" class="btn ghost" data-act="renno">Annulla</button></div></form>';
      else h += '<div class="acts renrow"><button type="button" class="mini" data-act="ren" data-v="' + tid + '">Rinomina la squadra</button></div>';
    }
    if (CAN && ME && !t.uid && !mine) h += '<div class="capbox"><span>Squadra libera. È la tua? Prendila per scegliere le formazioni: si fa una volta sola.</span><button type="button" class="btn ghost" data-act="claim" data-v="' + tid + '">Sì, è la mia</button></div>';
    FS.GENDERS.forEach(function (g) {
      var rows = ts.roster.filter(function (p) { var a = ath(p.a); return a && a.g === g; });
      h += '<div class="rg"><div class="rgh"><span class="lbl">' + GLAB[g] + '</span><span class="num small muted">' + rows.length + '/' + ts.per + '</span></div>';
      rows.forEach(function (p) {
        var a = ath(p.a);
        h += '<div class="arow">' + bib(a) + '<span class="an">' + esc(a.n) + ' <span class="nat">' + esc(a.c) + '</span><span class="lmeta">' + esc(a.tpy || '25/26') + ': ' + dpts(a) + '</span>' +
          (OWNER && tmp.rel !== p.id ? '<button type="button" class="mini" data-act="rel" data-v="' + p.id + '">Svincola</button>' : '') + '</span><span class="ap num">' + p.price + ' cr</span><span class="apt num">' + fmt(tt.byA[a.id] || 0) + '</span>';
        if (OWNER && tmp.rel === p.id) {
          var ref = Math.floor(p.price * (S.league.refundPct || 0) / 100);
          h += '<div class="confirm"><span>Svincoli ' + esc(a.n) + ' e recuperi ' + ref + ' crediti.</span><button type="button" class="btn red" data-act="relok" data-v="' + p.id + '">Svincola</button><button type="button" class="btn ghost" data-act="relno">Annulla</button></div>';
        }
        h += '</div>';
      });
      for (var i = rows.length; i < ts.per; i++) h += '<div class="arow empty"><span class="slot" aria-hidden="true"></span><span>Posto libero</span></div>';
      h += '</div>';
    });
    var gone = S.purchases.filter(function (p) { return p.t === tid && p.to; });
    if (gone.length) {
      h += '<div class="rg"><div class="rgh"><span class="lbl">Svincolati</span></div>' + gone.map(function (p) {
        var a = ath(p.a);
        return a ? '<div class="arow">' + bib(a) + '<span class="an">' + esc(a.n) + ' <span class="nat">' + esc(a.c) + '</span></span><span class="ap num">+' + (p.refund || 0) + ' cr</span><span class="apt num">' + fmt(tt.byA[a.id] || 0) + '</span></div>' : '';
      }).join('') + '</div>';
    }
    if (ts.size) h += lineupSection(tid);
    h += '<p class="hint gap">Per ogni atleta: prezzo pagato e punti portati alla squadra da titolare o da riserva entrata.</p></section>';
    return h;
  }

  // ---------- Gare
  function gstatus(g) {
    var live = g.races.filter(function (r) { return r.st !== 'canc'; });
    if (live.length && live.every(hasRes)) return '<span class="pill done">Conclusa</span>';
    if (live.some(function (r) { return lockOf(r) <= now(); })) return '<span class="pill">In corso</span>';
    return live.length ? '<span class="pill open">Prima formazione entro ' + esc(tlab(lockOf(live[0]))) + '</span>' : '<span class="pill">Annullata</span>';
  }
  function raceRow(r) {
    var st = r.st === 'canc' ? '<span class="rs no">Annullata</span>' : hasRes(r) ? '<span class="rs ok">Risultati</span>' : '<span class="rs">' + (r.d <= todayRome() ? 'In attesa' : '') + '</span>';
    return '<button type="button" class="race" data-act="race" data-v="' + r.id + '" aria-expanded="' + (tmp.race === r.id) + '">' + raceHead(r) + st + '</button>';
  }
  function gioBlock(g) {
    var rs = g.races.filter(function (r) { return !ui.gf || r.g === ui.gf; });
    if (!rs.length) return '';
    var h = '<div class="gio" id="g-' + g.k + '"><div class="gioh"><span class="gnum">G' + g.n + '</span><span class="gdates">' + drange(g.from, g.to) + '</span>' + gstatus(g) + '</div>';
    rs.forEach(function (r) { h += raceRow(r); if (tmp.race === r.id) h += raceDetail(r); });
    if (g.races.some(hasRes)) {
      var arr = S.teams.map(function (t) { return { t: t, v: (C.T[t.id] && C.T[t.id].byG[g.k]) || 0 }; }).sort(function (a, b) { return b.v - a.v; });
      h += '<div class="gsum"><span class="lbl">Punti giornata</span>' + arr.map(function (x) { return '<span>' + esc(x.t.name) + ' <b>' + fmt(x.v) + '</b></span>'; }).join('') + '</div>';
    }
    return h + '</div>';
  }
  function parts(s) {
    var p = [];
    if (s.bBib) p.push(['+', 'pettorale', s.bBib]);
    if (s.bGain) p.push(['+', 'rimonta', s.bGain]);
    if (s.bBest) p.push(['+', 'miglior 2ª manche', s.bBest]);
    if (s.bSer) p.push(['+', s.serK === 'w' ? s.serN + 'ª vittoria di fila' : s.serN + '° podio di fila', s.bSer]);
    if (s.mTop) p.push(['−', 'malus primo gruppo', -s.mTop]);
    if (s.mLead) p.push(['−', 'malus primo dopo la 1ª', -s.mLead]);
    return p;
  }
  function partsText(s) {
    var p = parts(s);
    if (!p.length) return '';
    if (!s.base) return '(' + p.map(function (x) { return x[1]; }).join(', ') + ')';
    return '= ' + fmt(s.base) + ' ' + p.map(function (x) { return x[0] + ' ' + x[1] + ' ' + fmt(x[2]); }).join(' ');
  }
  function itemText(it, r) {
    var a = ath(it.a), nm = esc(a ? short(a) : it.a);
    var st = it.dns ? 'non partito' : it.dnf ? 'uscito · ' + fmt(it.v) : it.rank ? it.rank + '° · ' + fmt(it.v) : 'fuori dai 30' + (it.v ? ' · ' + fmt(it.v) : '');
    var pt = it.s && !it.dnf ? partsText(it.s) : '', bx = pt ? ' <span class="bx">' + esc(pt) + '</span>' : '';
    if (it.role === 'R') return '<span class="' + (it.counted ? 'cnt' : 'out') + '">riserva ' + nm + (it.counted ? ' entrata · ' + st + bx : ' non entrata') + '</span>';
    return '<span class="' + (it.counted ? 'cnt' : 'out') + '">' + nm + ' · ' + st + bx + '</span>';
  }
  function raceDetail(r) {
    var h = '<div class="rdet">', st0 = FS.startOf(r);
    if (r.st !== 'canc') h += '<p class="small muted">' + (st0 != null ? 'Partenza ' + esc(r.h) + ' ora italiana · formazioni entro ' + esc(tlab(lockOf(r))) : 'Orario di partenza non ancora noto · formazioni entro ' + esc(tlab(lockOf(r)))) + '</p>';
    if (r.note) h += '<p class="small muted">' + esc(r.note) + '</p>';
    if (r.st === 'canc') return h + '<p class="muted">Gara annullata: nessun punto.</p></div>';
    var rr = C.raceRes[r.id], locked = lockOf(r) <= now(), mine = myTeam();
    if (!rr) {
      h += '<p class="muted">' + (r.d <= todayRome() ? 'Risultati non ancora inseriti.' : 'Si corre ' + dlab(r.d, true) + '.') + '</p>';
      var vis = S.teams.filter(function (t) { return locked || canLineup(t.id) && OWNER || (mine && mine.id === t.id); });
      if (vis.length) h += '<div class="tw"><table class="rtab"><thead><tr><th>Squadra</th><th>Formazione</th></tr></thead><tbody>' + vis.map(function (t) { return '<tr><td>' + esc(t.name) + '</td><td class="small">' + luText(C.eff[r.id][t.id]) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      if (!locked) h += '<p class="small muted">Le formazioni di tutte le squadre si vedono dalle ' + esc(tlab(lockOf(r))) + '.</p>';
      if (GADMIN && r.d <= todayRome()) h += '<div class="acts"><button type="button" class="mini" data-act="gores" data-v="' + r.id + '">Inserisci risultati</button></div>';
      return h + '</div>';
    }
    var res = S.results[r.id], tech = FS.CAT[r.t] === 'T';
    var list = res.list.slice().sort(function (a, b) { return a[1] - b[1]; });
    var own = {};
    S.teams.forEach(function (t) { C.eff[r.id][t.id].roster.forEach(function (aid) { own[aid] = t.name; }); });
    var body = '', lastI = -1;
    list.forEach(function (x, i) {
      if (i >= 15 && !own[x[0]]) return;
      if (i > lastI + 1) body += '<tr><td colspan="4" class="small muted">…</td></tr>';
      lastI = i;
      var a = ath(x[0]), e = FS.entry(x), p = rr.pts[x[0]], sc = p ? p.s : null, meta = [];
      if (e.bib) meta.push('pett. ' + e.bib);
      if (tech && e.r1) meta.push(e.r1 + '° dopo la 1ª');
      if (tech && e.r2 === 1) meta.push('miglior 2ª manche');
      body += '<tr><td class="num">' + e.rank + '</td><td>' + (a ? esc(a.n) + ' <span class="nat">' + esc(a.c) + '</span>' : esc(x[0])) + (meta.length ? '<span class="rmeta">' + meta.join(' · ') + '</span>' : '') + '</td>' +
        '<td class="small">' + (own[x[0]] ? esc(own[x[0]]) : '<span class="muted">—</span>') + '</td><td class="r num">' + (sc ? fmt(sc.v) : '0') +
        (sc && sc.bonus ? '<span class="rmeta">bonus ' + fmt(sc.bonus) + '</span>' : '') + (sc && sc.malus ? '<span class="rmeta">malus ' + fmt(sc.malus) + '</span>' : '') + '</td></tr>';
    });
    var placed = {};
    list.forEach(function (x) { placed[x[0]] = 1; });
    var unpl = Object.keys(own).filter(function (aid) { return !placed[aid]; }).sort(function (x, y) { return own[x].localeCompare(own[y]); });
    if (unpl.length) {
      body += '<tr><td colspan="4" class="small muted">In rosa, senza posizione</td></tr>';
      unpl.forEach(function (aid) {
        var a = ath(aid), o = rr.out[aid], stt = rr.dns[aid] ? 'non partito' : o && o.st === 'dnf' ? 'uscito' : o ? 'fuori classifica' : 'fuori dai 30';
        body += '<tr><td class="num">–</td><td>' + (a ? esc(a.n) + ' <span class="nat">' + esc(a.c) + '</span>' : esc(aid)) + '<span class="rmeta">' + stt + (o && o.bib ? ' · pett. ' + o.bib : '') + '</span></td>' +
          '<td class="small">' + esc(own[aid]) + '</td><td class="r num">' + (o ? fmt(o.s.v) : rr.dns[aid] ? '–' : '0') + '</td></tr>';
      });
    }
    h += '<div class="tw"><table class="rtab"><thead><tr><th>Pos</th><th>Atleta</th><th>Squadra</th><th class="r">Fanta</th></tr></thead><tbody>' + body + '</tbody></table></div>';
    if (list.length > 15) h += '<p class="small muted">Dopo il 15° posto sono elencati solo gli atleti in rosa.</p>';
    var teams = S.teams.map(function (t) { return { t: t, x: rr.teams[t.id] || { score: 0, items: [] } }; }).sort(function (a, b) { return b.x.score - a.x.score; });
    h += '<div class="tw"><table class="rtab"><thead><tr><th>Squadra</th><th>Titolari e riserva</th><th class="r">Pt</th></tr></thead><tbody>' + teams.map(function (o) {
      var its = o.x.items.length ? o.x.items.map(function (it) { return itemText(it, r); }).join('<br>') : '<span class="out">nessun atleta schierato</span>';
      return '<tr><td>' + esc(o.t.name) + '</td><td class="small">' + its + '</td><td class="r num">' + fmt(o.x.score) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
    h += '<p class="small muted">Fonte: ' + esc(res.src || '—') + (res.at ? ' · ' + esc(tlab(Date.parse(res.at))) : '') + '</p>';
    return h + '</div>';
  }
  function vGare() {
    var h = '<section class="sec"><div class="lbl">Calendario ' + esc(S.league.season || '') + '</div><h1 class="h1">Gare e giornate</h1><p class="sub">Le gare sono raggruppate per settimana. Tocca una gara per vedere formazioni, classifica e punti delle squadre.</p>';
    h += '<div class="chips">' + chipset('gf', [['', 'Tutte'], ['M', 'Uomini'], ['F', 'Donne']], ui.gf) + '</div>';
    C.G.forEach(function (g, i) {
      if (i > 0 && C.G[i - 1].to < '2027-02-01' && g.from > '2027-02-01') h += '<div class="panel gap small muted">Mondiali di Crans-Montana, 1–14 febbraio 2027: non danno punti.</div>';
      h += gioBlock(g);
    });
    return h + '</section>';
  }

  // ---------- Listone
  function listRows() {
    var di = ui.ld ? FS.DIDX[ui.ld] : -1;
    var arr = S.athletes.filter(function (a) {
      if (a.hide) return false;
      if (ui.lg && a.g !== ui.lg) return false;
      if (di >= 0 && !(a.p && a.p[di] > 0)) return false;
      if (ui.lfree && FS.ownerNow(S, a.id)) return false;
      return matchQ(a, ui.lq);
    });
    arr.sort(function (a, b) { return (di >= 0 ? b.p[di] - a.p[di] : 0) || b.q - a.q || b.tp - a.tp || a.n.localeCompare(b.n); });
    var h = '<p class="small muted">' + arr.length + (arr.length === 1 ? ' atleta' : ' atleti') + '</p>';
    h += arr.map(function (a) {
      var o = FS.ownerNow(S, a.id), cur = C.ath[a.id];
      return '<div class="lrow">' + bib(a) + '<span><span class="an">' + esc(a.n) + '</span> <span class="nat">' + esc(a.c) + '</span><span class="lmeta">' + (a.g === 'M' ? 'Uomo' : 'Donna') + ' · ' + esc(a.tpy || '25/26') + ': ' + dpts(a) +
        (cur ? ' · 26/27: <span class="num">' + cur + '</span> pt' : '') + '</span>' + (a.note ? '<span class="note">' + esc(a.note) + '</span>' : '') +
        (o ? '<span class="own">' + esc(tname(o.t)) + ' · ' + o.price + ' cr</span>' : '<span class="own free">Libero</span>') + '</span><span class="lq num"><small>Quot.</small>' + a.q + '</span></div>';
    }).join('');
    return h;
  }
  function vListone() {
    var h = '<section class="sec"><div class="lbl">Listone</div><h1 class="h1">Atleti e quotazioni</h1><p class="sub">Quotazione = punti di Coppa 2025/26 in tutte le discipline diviso 20, minimo 1. È il prezzo di partenza all\'asta. La sigla colorata è la disciplina in cui l\'atleta ha fatto più punti.</p>';
    h += '<label class="field" for="lq"><span>Cerca</span><input id="lq" class="in" type="search" autocomplete="off" placeholder="Nome o nazione, es. ITA" value="' + esc(ui.lq) + '"></label>';
    h += '<div class="chips">' + chipset('lg', [['', 'Tutti'], ['M', 'Uomini'], ['F', 'Donne']], ui.lg) + '<button type="button" class="chip' + (ui.lfree ? ' on' : '') + '" data-act="lfree" aria-pressed="' + ui.lfree + '">Solo liberi</button></div>';
    h += '<div class="chips">' + chipset('ld', [['', 'Tutte le discipline'], ['DH', 'Discesa'], ['SG', 'SuperG'], ['GS', 'Gigante'], ['SL', 'Slalom']], ui.ld) + '</div>';
    h += '<div id="llist">' + listRows() + '</div>';
    if (S.excluded && S.excluded.length) h += '<p class="hint gap">Non in listone: ' + esc(S.excluded.join(', ')) + '. Gli atleti mancanti si aggiungono da Gestione.</p>';
    return h + '</section>';
  }

  // ---------- Regole
  function block(title, items, extra) {
    return '<div><h2 class="h2">' + title + '</h2><ul>' + items.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' + (extra || '') + '</div>';
  }
  var TIER_LAB = { 1: 'vittoria', 3: 'podio', 5: 'top 5', 15: 'top 15', 30: 'nei 30' };
  function tierList(tbl) { return FS.TIERS.filter(function (k) { return tbl && tbl[k]; }).map(function (k) { return TIER_LAB[k] + ' +' + tbl[k]; }).join(' · '); }
  function bonusBlock(L) {
    if (!L.bib) return '';
    var mid = tierList(L.bib.mid), late = tierList(L.bib.late);
    if (!mid && !late) return '';
    var items = [];
    if (mid) items.push('Pettorale dal ' + ((L.bibMid || 15) + 1) + ' al ' + (L.bibLate || 30) + ' (in discesa e superG dal ' + ((L.bibMidSpeed || 20) + 1) + '): ' + mid + '.');
    if (late) items.push('Pettorale dal ' + ((L.bibLate || 30) + 1) + ' in su: ' + late + '.');
    items.push('Della tabella vale solo il bonus più alto. In discesa e superG la soglia è più alta perché i primi 20 pettorali vanno ai primi 20 della lista di partenza: i primi 10 li scelgono tra i dispari fino al 19.');
    if (L.bibMaxQ) items.push('Il bonus vale solo per gli atleti con quotazione fino a ' + L.bibMaxQ + '.');
    return block('Bonus partenza', items);
  }
  function runBlock(L) {
    var items = [];
    if (L.run2Best) items.push('+' + fmt(L.run2Best) + ' a chi fa il miglior tempo della 2ª manche.');
    if (L.run2Gain) items.push('+' + fmt(L.run2Gain) + ' per ogni posizione recuperata rispetto alla classifica della 1ª manche: chi è 18° dopo la 1ª e chiude 6° prende +' + fmt(12 * L.run2Gain) + '.');
    if (!items.length) return '';
    items.push('Solo in gigante e slalom.');
    return block('Bonus seconda manche', items);
  }
  function serieBlock(L) {
    var items = [];
    if (L.streakPod) items.push('+' + fmt(L.streakPod) + ' per ogni podio consecutivo nella stessa disciplina, dal secondo di fila.');
    if (L.streakWin) items.push('+' + fmt(L.streakWin) + ' per ogni vittoria consecutiva nella stessa disciplina, dalla seconda di fila' + (L.streakPod ? ', al posto del bonus podio.' : '.'));
    if (!items.length) return '';
    items.push('Conta l\'ordine in calendario delle gare di quella disciplina: una gara senza podio interrompe la serie, anche se l\'atleta non parte. Le gare annullate non contano.');
    return block('Bonus serie', items);
  }
  function malusBlock(L) {
    var items = [];
    if (L.malusDnf) items.push('−' + fmt(L.malusDnf) + ' se l\'atleta non arriva al traguardo: uscita, squalifica o non ripartito nella 2ª manche.');
    if (L.malusTop) items.push('−' + fmt(L.malusTop) + ' se un atleta del primo gruppo chiude oltre il 15° posto o non si qualifica per la 2ª manche. Primo gruppo: in gigante e slalom i pettorali dall\'1 al ' + (L.topGroup || 7) + '; in discesa e superG i pettorali dispari fino al 19, che scelgono i primi 10 della lista di partenza.');
    if (L.malusLead) items.push('−' + fmt(L.malusLead) + ' se chi è primo dopo la 1ª manche non chiude nei primi 5 (gigante e slalom).');
    if (!items.length) return '';
    items.push('Per ogni atleta vale un solo malus, il più pesante, e chi non arriva prende solo quello dell\'uscita. Chi non prende il via non ha malus: entra la riserva.');
    return block('Malus', items);
  }
  function anyBonus(L) {
    var b = L.bib || {};
    return !!(FS.TIERS.some(function (k) { return (b.mid && b.mid[k]) || (b.late && b.late[k]); }) || L.run2Best || L.run2Gain || L.streakPod || L.streakWin);
  }
  // the races with a multiplier, from the calendar: "uomini: Kitzbühel (discesa), …; donne: Cortina (discesa del 15 gen), …"
  function eventsText() {
    var DL = { DH: 'discesa', SG: 'superG', GS: 'gigante', SL: 'slalom' }, xs = {}, parts = [];
    var ev = S.races.filter(function (r) { return (r.x || 1) > 1 && r.st !== 'canc'; });
    ev.forEach(function (r) { xs[r.x] = 1; });
    var one = Object.keys(xs).length === 1;
    FS.GENDERS.forEach(function (g) {
      var groups = [], at = {};
      ev.filter(function (r) { return r.g === g; }).sort(byDate).forEach(function (r) {
        var k = r.v + (one ? '' : '|' + r.x);
        if (!(k in at)) { at[k] = groups.length; groups.push({ v: r.v, x: r.x, t: [], fin: true }); }
        var e = groups[at[k]];
        var twin = S.races.some(function (o) { return o !== r && o.g === r.g && o.v === r.v && o.t === r.t && (o.x || 1) !== (r.x || 1); });
        var lab = DL[r.t] + (twin ? ' del ' + dlab(r.d) : '');
        if (e.t.indexOf(lab) < 0) e.t.push(lab);
        if (!r.fin) e.fin = false;
      });
      if (groups.length) parts.push((g === 'M' ? 'uomini' : 'donne') + ': ' + groups.map(function (e) {
        return (e.fin ? 'finali di ' + esc(e.v) : esc(e.v) + ' (' + e.t.join(', ') + ')') + (one ? '' : ' ×' + fmt(e.x));
      }).join(', '));
    });
    if (!parts.length) return 'Nessuna gara con moltiplicatore.';
    return 'Gare-evento' + (one ? ' ×' + fmt(+Object.keys(xs)[0]) : '') + ' — ' + parts.join('; ') + '.';
  }
  function vRegole() {
    var L = S.league, per = L.perGender || 6, st = L.starters || 2;
    var pts = '<div class="ptsrow" aria-label="Punti per posizione">' + FS.PTS.map(function (p, i) { return '<span><i>' + (i + 1) + '°</i>' + (FS.scalePts(i + 1, L) + (L.bonus30 || 0)) + '</span>'; }).join('') + '</div>';
    var scaleTxt = (L.scale === 'lin' ? 'Scala lineare: 30 punti al 1°, 29 al 2° e così via fino a 1 punto al 30°.' : 'Punti di Coppa del Mondo dal 1° al 30° posto.') +
      (L.bonus30 ? ' In più, ' + L.bonus30 + ' punti di bonus per ogni arrivo nei primi 30.' : '');
    return '<section class="sec"><div class="lbl">Regolamento</div><h1 class="h1">Come si gioca</h1><div class="rules gap">' +
      block('Rosa', ['Ogni squadra ha ' + per + ' uomini e ' + per + ' donne, senza vincoli di disciplina: puoi prendere solo slalomisti o solo discesisti.',
        'Il nome della squadra lo scegli tu: lo cambi quando vuoi dalla pagina della tua squadra, con «Rinomina la squadra».']) +
      block('Asta', ['Ogni squadra ha ' + L.budget + ' crediti e ogni atleta può stare in una sola squadra.',
        'Offerta massima = crediti residui − posti vuoti + 1, così nessuno resta con la rosa incompleta.',
        'La quotazione del listone è il prezzo di partenza: punti di Coppa 2025/26 diviso 20, minimo 1.',
        'Se nessuna squadra può arrivare alla quotazione, o chi può arrivarci rinuncia, l\'atleta riparte da 1, e chi ha rinunciato non può più offrire per lui.',
        'L\'asta e l\'assegnazione degli atleti le gestisce chi organizza la lega.']) +
      block('Formazione', ['Per ogni gara scegli ' + st + ' titolari e 1 riserva tra i tuoi ' + per + ' atleti di quel genere.',
        'La formazione si chiude ' + lockText(L) + ': l\'ora esatta è scritta accanto a ogni gara. Prima della chiusura vedi solo la tua formazione; dopo, tutti vedono tutte.',
        'Se non la scegli, vale l\'ultima che hai schierato nella stessa disciplina, poi l\'ultima di quel genere. Se non ne hai ancora nessuna, giocano automaticamente i ' + st + ' atleti con più punti in quella disciplina nell\'ultima stagione, e il terzo fa la riserva.']) +
      block('Riserva', ['La riserva entra solo se un titolare non prende il via: infortunio, rinuncia o atleta svincolato. Se il titolare parte ed esce, o arriva oltre il 30°, la riserva non entra.']) +
      block('Punti', ['Contano solo i titolari, più la riserva quando entra. ' + scaleTxt + ' Alle finali di Sun Valley prendono punti solo i primi 15.',
        eventsText(),
        'Gara annullata: nessun punto. Se viene recuperata in un\'altra data, conta in quella data.'].concat(anyBonus(L) || L.malusDnf || L.malusTop || L.malusLead ? ['I bonus qui sotto valgono solo per chi va a punti e si sommano tra loro. Nelle gare-evento anche bonus e malus valgono ×1,5.'] : []), pts) +
      bonusBlock(L) + runBlock(L) + serieBlock(L) + malusBlock(L) +
      block('Mercato', ['Chi svincoli ti restituisce il ' + L.refundPct + '% del prezzo pagato.',
        'Gli atleti presi dopo l\'asta iniziale possono giocare dalla prima gara che non è ancora chiusa.',
        'I Mondiali di Crans-Montana (1–14 febbraio) non danno punti.']) +
      block('Premi', ['Sfera di cristallo a chi vince la classifica generale.', 'Coppa delle tecniche a chi fa più punti in gigante e slalom, uomini e donne insieme.', 'Coppa delle veloci a chi fa più punti in discesa e superG, uomini e donne insieme.']) +
      '</div></section>';
  }

  // ---------- Gestione (owner)
  function vGestione() {
    var secs = [['asta', 'Asta e mercato'], ['squadre', 'Squadre e partecipanti'], ['imp', 'Impostazioni'], ['leghe', 'Leghe']];
    if (GADMIN) secs.splice(1, 0, ['ris', 'Risultati']), secs.splice(3, 0, ['gare', 'Calendario'], ['atleti', 'Atleti']);
    if (!GADMIN && ['ris', 'gare', 'atleti'].indexOf(ui.adm) >= 0) ui.adm = 'asta';
    var h = '<section class="sec"><div class="lbl">Gestione</div><h1 class="h1">Pannello della lega</h1><p class="sub">Ogni modifica si salva subito e la vedono tutti.</p>';
    h += '<div class="chips scroll">' + chipset('adm', secs, ui.adm) + '</div>';
    if (['asta', 'squadre', 'imp'].indexOf(ui.adm) >= 0) h += '<p class="small muted">Lega: <b>' + esc(S.league.name || 'Lega') + '</b>' + (GADMIN ? '. Calendario, atleti e risultati valgono per tutte le leghe.' : '.') + '</p>';
    h += ({ asta: aAsta, ris: aRis, squadre: aSquadre, gare: aGare, atleti: aAtleti, imp: aImp, leghe: aLeghe }[ui.adm] || aAsta)();
    return h + '</section>';
  }
  function astaList() {
    var q = tmp.aq;
    if (!q || q.trim().length < 2) return '<p class="hint">Scrivi almeno 2 lettere del nome o la nazione.</p>';
    var ts = FS.teamState(S, tmp.at);
    var arr = S.athletes.filter(function (a) { return !a.hide && !FS.ownerNow(S, a.id) && matchQ(a, q); }).sort(function (a, b) { return b.q - a.q; }).slice(0, 8);
    if (!arr.length) return '<p class="hint">Nessun atleta libero con questo nome. Se manca dal listone, aggiungilo da Atleti.</p>';
    return arr.map(function (a) {
      var full = ts.slots[a.g] >= ts.per;
      return '<button type="button" class="hit' + (full ? ' dis' : '') + '" data-act="apick" data-v="' + a.id + '">' + bib(a) + '<span class="an">' + esc(a.n) + ' <span class="nat">' + esc(a.c) + ' · ' + a.g + '</span>' +
        (full ? ' <span class="small muted">' + (a.g === 'M' ? 'uomini' : 'donne') + ' al completo</span>' : '') + '</span><span class="lq num"><small>Quot.</small>' + a.q + '</span></button>';
    }).join('');
  }
  // teams that can still pay an athlete's quotation: a free place for that gender and an offer cap at or above it
  function reachQ(a) {
    return S.teams.filter(function (t) { var x = FS.teamState(S, t.id); return (x.slots[a.g] || 0) < x.per && x.maxBid >= a.q; });
  }
  function astaPick() {
    var a = tmp.ath && ath(tmp.ath);
    if (!a || FS.ownerNow(S, a.id)) return '';
    var price = parseInt(tmp.price, 10);
    if (!(price >= 1)) price = a.q;
    var chk = buyCheck(a, price);
    return '<div class="pick"><div class="pickh">' + bib(a) + '<div><b>' + esc(a.n) + '</b> <span class="nat">' + esc(a.c) + '</span><div class="small muted">' + GLAB[a.g] + ' · ' + dpts(a) + ' · quotazione ' + a.q + '</div></div></div>' + reachLine(a) +
      '<div class="stepper"><button type="button" class="mini" data-act="pstep" data-v="-1">−1</button><input id="aprice" class="in" type="number" inputmode="numeric" min="1" step="1" value="' + price + '" aria-label="Prezzo in crediti">' +
      '<button type="button" class="mini" data-act="pstep" data-v="1">+1</button><button type="button" class="mini" data-act="pstep" data-v="5">+5</button><button type="button" class="mini" data-act="pstep" data-v="10">+10</button></div>' +
      '<div class="acts"><button type="button" class="btn red" id="abuy" data-act="buy"' + (chk.ok ? '' : ' disabled') + '>Aggiudica a ' + esc(tname(tmp.at)) + '</button><button type="button" class="btn ghost" data-act="apickx">Annulla</button><span class="why" id="awhy">' + (chk.ok ? '' : esc(chk.why)) + '</span></div></div>';
  }
  function buyCheck(a, price) {
    var res = FS.canBuy(S, tmp.at, a.id, price);
    if (res.ok && price < a.q && reachQ(a).some(function (t) { return t.id === tmp.at; }))
      return { ok: false, why: tname(tmp.at) + ' poteva arrivare alla quotazione di ' + a.q + ': se ha rinunciato, non può prenderlo a meno.' };
    return res;
  }
  function reachLine(a) {
    if (a.q <= 1) return '';
    var rq = reachQ(a);
    return '<p class="small">' + (rq.length ? 'Alla quotazione di ' + a.q + ' possono arrivare: <b>' + rq.map(function (t) { return esc(t.name); }).join(', ') + '</b>. Se rinunciano, si riparte da 1 senza di loro.' :
      'Nessuna squadra può arrivare alla quotazione di ' + a.q + ': si parte da 1.') + '</p>';
  }
  function updateBuy() {
    var a = tmp.ath && ath(tmp.ath);
    if (!a) return;
    var price = parseInt(tmp.price, 10);
    var chk = buyCheck(a, price >= 1 ? price : 0);
    var b = D.getElementById('abuy'), w = D.getElementById('awhy');
    if (b) b.disabled = !chk.ok;
    if (w) w.textContent = chk.ok ? '' : chk.why;
  }
  function aAsta() {
    if (!S.teams.length) return '<p class="muted">Aggiungi prima le squadre.</p>';
    if (!tmp.at || !team(tmp.at)) tmp.at = S.teams[0].id;
    var ts = FS.teamState(S, tmp.at);
    var h = '<div class="stack"><div class="chips scroll">' + S.teams.map(function (t) {
      var x = FS.teamState(S, t.id);
      return '<button type="button" class="chip' + (t.id === tmp.at ? ' on' : '') + '" data-act="at" data-v="' + t.id + '">' + esc(t.name) + '<span class="num">' + x.credits + ' cr · ' + x.size + '/' + x.max + '</span></button>';
    }).join('') + '</div>';
    h += '<div class="tstats">' + stat('Crediti', ts.credits) + stat('Posti liberi', ts.empty) + stat('Offerta max', ts.empty ? ts.maxBid : '–') + '</div>';
    h += '<p class="small muted">Uomini ' + ts.slots.M + '/' + ts.per + ' · Donne ' + ts.slots.F + '/' + ts.per + '</p>';
    h += '<label class="field" for="aq"><span>Atleta libero</span><input id="aq" class="in" type="search" autocomplete="off" placeholder="Cerca per nome o nazione" value="' + esc(tmp.aq) + '"></label>';
    h += '<div id="alist">' + astaList() + '</div><div id="apick">' + astaPick() + '</div>';
    h += '<div class="panel small"><div class="acts between"><span>' + (S.league.auctionOpen ? '<b>Asta iniziale aperta</b>: gli acquisti possono giocare da Sölden.' : 'Mercato: gli acquisti possono giocare dalla prima gara non ancora chiusa.') +
      '</span><button type="button" class="mini" data-act="auction" data-v="' + (S.league.auctionOpen ? '0' : '1') + '">' + (S.league.auctionOpen ? 'Chiudi asta iniziale' : 'Riapri asta iniziale') + '</button></div></div>';
    var rec = S.purchases.slice().reverse().slice(0, 15);
    if (rec.length) {
      h += '<div><div class="lbl">Ultime assegnazioni</div>' + rec.map(function (p) {
        var a = ath(p.a);
        return '<div class="arow">' + (a ? bib(a) : '<span></span>') + '<span class="an">' + esc(a ? a.n : p.a) + ' <span class="nat">' + esc(tname(p.t)) + '</span>' + (p.to ? ' <span class="small muted">svincolato</span>' : '') + '</span><span class="ap num">' + p.price + ' cr</span>' +
          (!p.to ? '<button type="button" class="mini" data-act="unbuy" data-v="' + p.id + '" title="Annulla l\'assegnazione e restituisce tutti i crediti">Annulla</button>' : '<span></span>') + '</div>';
      }).join('') + '</div>';
    }
    return h + '</div>';
  }
  function defaultRace() {
    var d = todayRome(), sorted = S.races.slice().sort(byDate);
    var past = sorted.filter(function (r) { return r.d <= d && r.st !== 'canc' && !S.results[r.id]; });
    if (past.length) return past[0].id;
    var fut = sorted.filter(function (r) { return r.d >= d; });
    return (fut[0] || sorted[0]).id;
  }
  // athletes in a team of any league when the race locks, with the team names (results are the same for every league)
  function rosteredAll(r) {
    var set = {}, multi = ROOT.leagues.length > 1;
    ROOT.leagues.forEach(function (lg) {
      var V = FS.view(ROOT, lg.id), lock = FS.lockOf(V, r);
      lg.teams.forEach(function (t) {
        FS.rosterAt(V, t.id, r.g, lock).forEach(function (a) {
          var lab = (multi ? (lg.league.name || 'Lega') + ': ' : '') + t.name;
          set[a] = set[a] ? set[a] + ' · ' + lab : lab;
        });
      });
    });
    return set;
  }
  function setX(v, i, n) {
    if (!tmp.parsed) return;
    tmp.parsed.list.forEach(function (x) {
      if (x[0] !== v) return;
      while (x.length <= i) x.push(0);
      x[i] = n;
      while (x.length > 2 && !x[x.length - 1]) x.pop();
    });
  }
  function numIn(id, chg, v, cur, max, label) {
    return '<input id="' + esc(id) + '" class="in" type="number" inputmode="numeric" min="1" max="' + max + '" value="' + (cur || '') + '" placeholder="–" data-chg="' + chg + '" data-v="' + esc(v) + '" aria-label="' + label + '">';
  }
  function stBtn(aid, v, label, cur) { return '<button type="button" class="segb' + (cur === v ? ' on' : '') + '" data-act="pst" data-v="' + esc(aid) + '|' + v + '" aria-pressed="' + (cur === v) + '">' + label + '</button>'; }
  function prevBlock(r) {
    var P = tmp.parsed && tmp.parsed.r === r.id ? tmp.parsed : null;
    if (!P) {
      var sv = S.results[r.id], st0 = {}, nb0 = {};
      if (sv) {
        (sv.dns || []).forEach(function (a) { st0[a] = 'dns'; });
        (sv.dnf || []).forEach(function (a) { st0[a] = 'dnf'; });
        (sv.nc || []).forEach(function (x) { st0[x[0]] = 'nc'; if (x[1]) nb0[x[0]] = x[1]; });
      }
      P = tmp.parsed = { r: r.id, list: sv ? sv.list.map(function (x) { return x.slice(); }) : [], st: st0, nb: nb0, sure: true, src: sv ? sv.src || 'manuale' : 'manuale' };
    }
    var L = S.league, runB = FS.CAT[r.t] === 'T' && !!(L.run2Gain || L.run2Best), ro = rosteredAll(r);
    var inList = {};
    P.list.forEach(function (x) { inList[x[0]] = 1; });
    var cand = S.athletes.filter(function (a) { return a.g === r.g && !a.hide && !inList[a.id]; }).sort(function (a, b) { return a.n.localeCompare(b.n); });
    var rows = P.list.slice().sort(function (a, b) { return a[1] - b[1]; });
    var h = '<div><div class="lbl">Anteprima · ' + rows.length + (rows.length === 1 ? ' atleta' : ' atleti') + '</div>';
    if (!P.sure) h += '<p class="why">Alcune posizioni potrebbero essere sbagliate: controlla i numeri prima di salvare.</p>';
    var noBib = rows.filter(function (x) { return !x[2]; }).length;
    if (L.bib && noBib) h += '<p class="why">' + noBib + (noBib === 1 ? ' atleta senza pettorale' : ' atleti senza pettorale') + ': senza pettorale niente bonus partenza.</p>';
    if (runB && rows.length) {
      var noR1 = rows.filter(function (x) { return !x[3]; }).length;
      if (L.run2Gain && noR1) h += '<p class="why">' + noR1 + (noR1 === 1 ? ' atleta' : ' atleti') + ' senza posizione dopo la 1ª manche: niente bonus rimonta.</p>';
      if (L.run2Best && !rows.some(function (x) { return x[4] === 1; })) h += '<p class="why">Manca il miglior tempo di 2ª manche: scrivi 1 in «Tempo 2ª» di chi l\'ha fatto.</p>';
      h += '<p class="hint">«Dopo la 1ª» è la posizione dopo la prima manche, «Tempo 2ª» la posizione nel tempo della seconda manche: 1 è il miglior tempo.</p>';
    }
    if (rows.length) h += '<div class="prev prevh small muted"><span>Pos.</span><span>Atleta</span><span>Pett.</span><span></span></div>';
    h += rows.map(function (x) {
      var a = ath(x[0]), id = esc(x[0]);
      return '<div class="prev">' + numIn('pr-' + x[0], 'prank', x[0], x[1], 99, 'Posizione') + '<span>' + esc(a ? a.n : x[0]) + ' <span class="nat">' + esc(a ? a.c : '') + '</span>' +
        (ro[x[0]] ? ' <span class="own">' + esc(ro[x[0]]) + '</span>' : '') + '</span>' + numIn('pb-' + x[0], 'pbib', x[0], x[2], 999, 'Pettorale') +
        '<button type="button" class="mini" data-act="prm" data-v="' + id + '">Togli</button>' +
        (runB ? '<div class="prev2"><label for="p1-' + id + '">Dopo la 1ª</label>' + numIn('p1-' + x[0], 'pr1', x[0], x[3], 99, 'Posizione dopo la prima manche') +
          '<label for="p2-' + id + '">Tempo 2ª</label>' + numIn('p2-' + x[0], 'pr2', x[0], x[4], 99, 'Posizione nel tempo della seconda manche') + '</div>' : '') + '</div>';
    }).join('');
    h += '<div class="grid2 gap"><label class="field" for="padd"><span>Aggiungi atleta</span><select id="padd" class="in"><option value="">Scegli…</option>' + cand.map(function (a) { return '<option value="' + a.id + '">' + esc(a.n) + ' (' + esc(a.c) + ')</option>'; }).join('') + '</select></label>' +
      '<label class="field" for="paddr"><span>Posizione</span><input id="paddr" class="in" type="number" min="1" max="99" placeholder="es. 7"></label>' +
      '<label class="field" for="paddb"><span>Pettorale</span><input id="paddb" class="in" type="number" min="1" max="999" placeholder="es. 34"></label></div>';
    h += '<div class="acts gap"><button type="button" class="mini" data-act="padd">Aggiungi alla classifica</button></div>';
    var unranked = Object.keys(ro).filter(function (a) { return !inList[a]; });
    if (unranked.length) {
      h += '<div class="gap"><div class="lbl">In rosa, senza posizione</div><p class="hint">Non partito: non ha preso il via, entra la riserva. Uscito: uscita, squalifica o non ripartito nella 2ª manche, prende il malus. Fuori classifica: oltre il 30° o non qualificato, zero punti e malus solo se era nel primo gruppo, per questo serve il pettorale.</p>' + unranked.map(function (aid) {
        var a = ath(aid), cur = P.st[aid] || 'nc', nm = esc(a ? a.n : aid);
        return '<div class="unr"><span class="un">' + nm + ' <span class="own">' + esc(ro[aid]) + '</span></span><span class="seg" role="group" aria-label="Esito di ' + nm + '">' +
          stBtn(aid, 'dns', 'Non partito', cur) + stBtn(aid, 'dnf', 'Uscito', cur) + stBtn(aid, 'nc', 'Fuori classifica', cur) + '</span>' +
          '<span class="pbx"><label class="small muted" for="pn-' + esc(aid) + '">pett.</label>' + numIn('pn-' + aid, 'pnb', aid, P.nb[aid], 999, 'Pettorale') + '</span></div>';
      }).join('') + '</div>';
    }
    h += '<div class="acts gap"><button type="button" class="btn red" data-act="psave"' + (rows.length ? '' : ' disabled') + '>Usa questi risultati</button></div></div>';
    return h;
  }
  function aRis() {
    if (!tmp.rr || !race(tmp.rr)) tmp.rr = defaultRace();
    var r = race(tmp.rr), res = S.results[r.id];
    var h = '<div class="stack"><label class="field" for="rsel"><span>Gara</span><select id="rsel" class="in" data-chg="rsel">' + raceOptions(r.id) + '</select></label>';
    h += '<div class="panel small"><div class="acts between"><span>' + (r.st === 'canc' ? 'Gara segnata come annullata.' : res ? 'Risultati salvati: ' + res.list.length + ' atleti · fonte ' + esc(res.src || '—') + '.' : 'Nessun risultato per questa gara.') + '</span><span class="acts">' +
      (r.st === 'canc' ? '<button type="button" class="mini" data-act="uncanc">Ripristina gara</button>' : '<button type="button" class="mini" data-act="canc">Segna come annullata</button>') +
      (res ? '<button type="button" class="mini" data-act="resdel">Cancella risultati</button>' : '') + '</span></div></div>';
    if (r.st !== 'canc') {
      h += '<label class="field" for="rpaste"><span>Incolla la classifica completa, dalla pagina dei risultati FIS o da un sito di risultati</span><textarea id="rpaste" class="in" placeholder="1   3   512269   ODERMATT Marco   SUI   1:15.33 …">' + esc(tmp.paste) + '</textarea></label>';
      h += '<div class="acts"><button type="button" class="btn" data-act="parse">Leggi classifica</button><span class="hint">Riconosce gli atleti del listone con posizione, pettorale e tempi di manche, e chi è uscito o non è partito. Controlla l\'anteprima prima di usarla.</span></div>';
      h += prevBlock(r);
    }
    return h + '</div>';
  }
  function aSquadre() {
    var e = entryOf(S.lid), members = (e && e.members) || [], byTeam = {};
    members.forEach(function (m) { if (m.team) byTeam[m.team] = m; });
    var h = '<div class="panel"><div class="lbl">Codice invito</div><div class="acts between gap"><span>Chi ha il codice <b class="num codev">' + esc(e.code || '—') + '</b> entra nella lega e sceglie una squadra libera.</span>' +
      '<button type="button" class="mini" data-act="regen">Nuovo codice</button></div>' +
      (e.code ? '<label class="field gap" for="invlink"><span>Link di invito: chi lo apre si registra ed entra subito</span><input id="invlink" class="in" readonly value="' + esc(inviteLink(e.code)) + '"></label>' +
        '<div class="acts gap"><button type="button" class="mini" data-act="copylink">Copia link</button><a class="mini" href="https://wa.me/?text=' + encodeURIComponent('Ti invito nella lega «' + (S.league.name || BRAND) + '»' + ((S.league.name || BRAND).indexOf(BRAND) < 0 ? ' di ' + BRAND : '') + ', il fantasci della Coppa del Mondo. Apri il link, registrati con email e password e scegli la tua squadra: ' + inviteLink(e.code)) + '" target="_blank" rel="noopener">Invia su WhatsApp</a></div>' : '') +
      '<p class="hint gap">Con un nuovo codice quello vecchio, e il suo link, non valgono più; chi è già dentro resta.</p></div>';
    var byName = function (a, b) { return (a.name || '').localeCompare(b.name || ''); };
    h += '<div class="lbl gap">Squadre</div><p class="hint">Per ogni squadra scegli chi la gioca: se qualcuno ha preso la squadra sbagliata, la cambi da qui. Per chi gioca senza account scrivi il nome a mano: le sue formazioni le metti tu.</p><div class="tlist">' + S.teams.map(function (t) {
      var used = S.purchases.some(function (p) { return p.t === t.id; });
      var opts = '<option value="">' + (t.uid ? '— nessuno: libera la squadra —' : '— nessuno —') + '</option>' + members.slice().sort(byName).map(function (m) {
        var other = m.team && m.team !== t.id ? team(m.team) : null;
        return '<option value="' + esc(m.uid) + '"' + (t.uid === m.uid ? ' selected' : '') + '>' + esc(m.name || 'senza nome') + (other ? ' (ora in ' + esc(other.name) + ')' : '') + '</option>';
      }).join('');
      return '<div class="tcard"><input id="tn-' + t.id + '" class="in" value="' + esc(t.name) + '" data-chg="tn" data-v="' + t.id + '" aria-label="Nome squadra">' +
        '<label class="tline" for="asg-' + t.id + '"><span>Giocatore</span><select id="asg-' + t.id + '" class="in" data-chg="asg" data-v="' + t.id + '">' + opts + '</select></label>' +
        (t.uid ? '' : '<input id="to-' + t.id + '" class="in" value="' + esc(t.owner) + '" placeholder="Oppure il nome di chi gioca senza account" data-chg="to" data-v="' + t.id + '" aria-label="Nome di chi gioca senza account">') +
        (used ? '' : '<div class="acts"><button type="button" class="mini" data-act="tdel" data-v="' + t.id + '" title="Elimina la squadra: si può solo finché non ha atleti">Elimina squadra</button></div>') + '</div>';
    }).join('') + '</div>';
    h += '<div class="acts gap"><button type="button" class="btn ghost" data-act="tadd">Aggiungi squadra</button></div>';
    h += '<div class="lbl gap">Partecipanti · ' + members.length + '</div><div class="tlist">' + (members.length ? members.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (m) {
      var tm = m.team ? team(m.team) : null;
      return '<div class="mrow"><span><b>' + esc(m.name) + '</b>' + (m.uid === ME ? ' <span class="gx">tu</span>' : '') + '<span class="lmeta">' + (tm ? esc(tm.name) : 'senza squadra') + '</span></span>' +
        (m.uid === ME ? '<span></span>' : tmp.mrem === m.uid ? '<span class="acts"><button type="button" class="btn red" data-act="mremok" data-v="' + esc(m.uid) + '">Togli dalla lega</button><button type="button" class="btn ghost" data-act="mremno">Annulla</button></span>' :
          '<button type="button" class="mini" data-act="mrem" data-v="' + esc(m.uid) + '">Togli</button>') + '</div>';
    }).join('') : '<p class="muted small">Ancora nessuno.</p>') + '</div>';
    return h + '<p class="hint gap">Chi si registra sul sito entra con il codice e prende una squadra libera. Se qualcuno non vuole registrarsi, scrivi il suo nome nella squadra e le formazioni le metti tu.</p>';
  }
  function aGare() {
    if (!tmp.er || !race(tmp.er)) tmp.er = defaultRace();
    var r = race(tmp.er);
    var h = '<div class="stack"><label class="field" for="esel"><span>Gara</span><select id="esel" class="in" data-chg="esel">' + raceOptions(r.id) + '</select></label>';
    h += '<div class="grid2"><label class="field" for="ed"><span>Data</span><input id="ed" class="in" type="date" value="' + r.d + '"></label><label class="field" for="ev"><span>Località</span><input id="ev" class="in" value="' + esc(r.v) + '"></label>' +
      '<label class="field" for="ec"><span>Nazione</span><input id="ec" class="in" maxlength="3" value="' + esc(r.c) + '"></label><label class="field" for="ex"><span>Moltiplicatore</span><select id="ex" class="in">' +
      [1, 1.5, 2].map(function (x) { return '<option value="' + x + '"' + ((r.x || 1) === x ? ' selected' : '') + '>×' + fmt(x) + '</option>'; }).join('') + '</select></label></div>';
    h += '<label class="field" for="eh"><span>Partenza, ora italiana (vuoto se non è nota)</span><input id="eh" class="in" type="time" value="' + esc(r.h || '') + '"></label>';
    h += '<label class="field" for="en"><span>Nota</span><input id="en" class="in" value="' + esc(r.note || '') + '"></label>';
    h += '<label class="acts small" for="ef"><input id="ef" type="checkbox"' + (r.fin ? ' checked' : '') + '> Finali: punti solo ai primi 15</label>';
    h += '<div class="acts"><button type="button" class="btn" data-act="rsave">Aggiorna gara</button></div>';
    h += '<div class="panel"><div class="lbl">Nuova gara</div><div class="grid2 gap"><label class="field" for="ng"><span>Genere</span><select id="ng" class="in"><option value="M">Uomini</option><option value="F">Donne</option></select></label>' +
      '<label class="field" for="nt"><span>Disciplina</span><select id="nt" class="in"><option value="GS">Gigante</option><option value="SL">Slalom</option><option value="DH">Discesa</option><option value="SG">SuperG</option></select></label>' +
      '<label class="field" for="nd"><span>Data</span><input id="nd" class="in" type="date"></label><label class="field" for="nv"><span>Località</span><input id="nv" class="in"></label><label class="field" for="nc"><span>Nazione</span><input id="nc" class="in" maxlength="3"></label>' +
      '<label class="field" for="nh"><span>Partenza, ora italiana</span><input id="nh" class="in" type="time"></label></div>' +
      '<div class="acts gap"><button type="button" class="btn ghost" data-act="radd">Aggiungi gara</button></div></div>';
    return h + '</div>';
  }
  function athEditList() {
    var q = tmp.eq;
    if (!q || q.trim().length < 2) return '<p class="hint">Scrivi almeno 2 lettere.</p>';
    var arr = S.athletes.filter(function (a) { return matchQ(a, q); }).slice(0, 8);
    if (!arr.length) return '<p class="hint">Nessun atleta trovato.</p>';
    return arr.map(function (a) { return '<button type="button" class="hit" data-act="epick" data-v="' + a.id + '">' + bib(a) + '<span class="an">' + esc(a.n) + ' <span class="nat">' + esc(a.c) + ' · ' + a.g + '</span>' + (a.hide ? ' <span class="small muted">escluso</span>' : '') + '</span><span class="lq num"><small>Quot.</small>' + a.q + '</span></button>'; }).join('');
  }
  function aAtleti() {
    var h = '<div class="stack"><label class="field" for="eq"><span>Cerca atleta</span><input id="eq" class="in" type="search" autocomplete="off" value="' + esc(tmp.eq) + '" placeholder="Nome o nazione"></label><div id="elist">' + athEditList() + '</div>';
    var a = tmp.ea && ath(tmp.ea);
    if (a) {
      h += '<div class="pick"><div class="pickh">' + bib(a) + '<div><b>' + esc(a.n) + '</b> <span class="nat">' + esc(a.c) + '</span><div class="small muted">' + dpts(a) + '</div></div></div><div class="grid2">' +
        '<label class="field" for="xq"><span>Quotazione</span><input id="xq" class="in" type="number" min="1" value="' + a.q + '"></label>' +
        '<label class="field" for="xc"><span>Nazione</span><input id="xc" class="in" maxlength="3" value="' + esc(a.c) + '"></label></div>' +
        '<label class="field" for="xn"><span>Nota</span><input id="xn" class="in" value="' + esc(a.note || '') + '"></label>' +
        '<label class="acts small" for="xh"><input id="xh" type="checkbox"' + (a.hide ? ' checked' : '') + '> Escludi dal listone</label>' +
        '<div class="acts"><button type="button" class="btn" data-act="asave">Aggiorna atleta</button></div></div>';
    }
    h += '<div class="panel"><div class="lbl">Nuovo atleta</div><div class="grid2 gap"><label class="field" for="nan"><span>Nome e cognome</span><input id="nan" class="in" placeholder="es. Mario Rossi"></label>' +
      '<label class="field" for="nac"><span>Nazione</span><input id="nac" class="in" maxlength="3" placeholder="ITA"></label>' +
      '<label class="field" for="nag"><span>Genere</span><select id="nag" class="in"><option value="M">Uomo</option><option value="F">Donna</option></select></label>' +
      '<label class="field" for="naq"><span>Quotazione</span><input id="naq" class="in" type="number" min="1" value="1"></label></div>' +
      '<div class="acts gap"><button type="button" class="btn ghost" data-act="aadd">Aggiungi atleta</button></div></div>';
    return h + '</div>';
  }
  // a league from the old page: the file I send has the page's data (one or more leagues)
  function importBox() {
    var h = '<div class="panel"><div class="lbl">Importa dalla vecchia pagina</div><p class="small muted gap">Scegli il file della lega (.json): squadre, asta e formazioni passano qui. Poi i partecipanti entrano con il link di invito e prendono la loro squadra.</p>' +
      '<label class="field gap" for="impf"><span>File</span><input id="impf" class="in" type="file" accept=".json,application/json" data-chg="impf"></label>';
    if (tmp.imp && tmp.imp.err) h += '<p class="why gap">' + esc(tmp.imp.err) + '</p>';
    else if (tmp.imp) h += '<div class="tlist gap">' + tmp.imp.leagues.map(function (lg, i) {
      return '<div class="mrow"><span><b>' + esc(lg.league.name || 'Lega') + '</b><span class="lmeta">' + lg.teams.length + ' squadre · ' + lg.purchases.length + ' acquisti · formazioni per ' + Object.keys(lg.lineups || {}).length + ' gare</span></span>' +
        '<button type="button" class="btn ghost" data-act="impgo" data-v="' + i + '"' + (tmp.busy ? ' disabled' : '') + '>Importa</button></div>';
    }).join('') + '</div>';
    return h + '</div>';
  }
  function aLeghe() {
    var mine = ROOT.leagues.filter(function (lg) { return lg.admin === ME; });
    var h = '<div class="stack"><p class="small muted">Calendario, atleti e risultati sono uguali per tutte le leghe. Ogni lega ha il suo codice invito, le sue squadre, la sua asta, le sue formazioni e le sue regole.</p><div class="tlist">';
    h += mine.map(function (lg) {
      var on = lg.id === S.lid;
      return '<div class="trow"><input id="ln-' + esc(lg.id) + '" class="in" value="' + esc(lg.league.name || '') + '" data-chg="lgname" data-v="' + esc(lg.id) + '" aria-label="Nome della lega">' +
        '<span class="small muted owner">codice ' + esc(lg.code || '—') + '</span><span class="acts">' +
        (on ? (tmp.lgdel === lg.id ? '<button type="button" class="btn red" data-act="lgdelok" data-v="' + esc(lg.id) + '">Elimina davvero</button><button type="button" class="btn ghost" data-act="lgdelno">Annulla</button>' :
          '<span class="small muted">aperta</span>' + (!S.purchases.length ? '<button type="button" class="mini" data-act="lgdel" data-v="' + esc(lg.id) + '">Elimina</button>' : '')) :
          '<button type="button" class="mini" data-act="lgopen" data-v="' + esc(lg.id) + '">Apri</button>') + '</span></div>';
    }).join('') + '</div>';
    if (GADMIN) {
      var open = !!(STATE.site && STATE.site.openLeagues);
      h += '<div class="panel"><div class="lbl">Chi può creare leghe</div><div class="seg gap" role="group" aria-label="Chi può creare leghe">' +
        '<button type="button" class="segb' + (open ? '' : ' on') + '" data-act="siteopen" data-v="0" aria-pressed="' + !open + '">Solo gli amministratori</button>' +
        '<button type="button" class="segb' + (open ? ' on' : '') + '" data-act="siteopen" data-v="1" aria-pressed="' + open + '">Tutti gli iscritti</button></div>' +
        '<p class="hint gap">' + (open ? 'Chi ha un account può creare una lega e la organizza lui; tu le vedi e le puoi gestire tutte.' : 'Per ora le leghe le crei solo tu: gli altri entrano con il codice.') + '</p></div>';
      h += '<div class="panel"><div class="lbl">Tutte le leghe del sito</div>' + (tmp.all ? '<div class="tlist gap">' + (tmp.all.length ? tmp.all.map(function (lg) {
        return '<div class="mrow"><span><b>' + esc(lg.name) + '</b><span class="lmeta">codice ' + esc(lg.code || '—') + '</span></span>' +
          (lg.mine ? '<span class="small muted">ci sei</span>' : '<button type="button" class="mini" data-act="lgjoin" data-v="' + esc(lg.code) + '">Entra</button>') + '</div>';
      }).join('') : '<p class="muted small">Nessuna lega.</p>') + '</div>' : '<div class="acts gap"><button type="button" class="mini" data-act="allload">Mostra l\'elenco</button></div>') + '</div>';
    }
    if (STATE.canCreate) h += '<div class="panel"><div class="lbl">Nuova lega</div><div class="grid2 gap"><label class="field" for="lgn"><span>Nome</span><input id="lgn" class="in" placeholder="es. Amici"></label>' +
      '<label class="field" for="lgt"><span>Squadre</span><input id="lgt" class="in" type="number" min="2" max="20" value="8"></label></div>' +
      '<p class="hint gap">Parte con le regole, i bonus e i malus della lega aperta ora («' + esc(S.league.name || 'Lega') + '»), che poi puoi cambiare in Impostazioni. Riceve un suo codice invito.</p>' +
      '<div class="acts gap"><button type="button" class="btn ghost" data-act="lgadd">Crea lega</button></div></div>';
    if (GADMIN) h += importBox();
    return h + '</div>';
  }
  function aImp() {
    var L = S.league;
    return '<div class="stack"><div class="grid2"><label class="field" for="sb"><span>Crediti per squadra</span><input id="sb" class="in" type="number" min="12" value="' + L.budget + '"></label>' +
      '<label class="field" for="srf"><span>Rimborso allo svincolo (%)</span><input id="srf" class="in" type="number" min="0" max="100" value="' + L.refundPct + '"></label>' +
      '<label class="field" for="sn"><span>Nome della lega</span><input id="sn" class="in" value="' + esc(L.name) + '"></label>' +
      '<label class="field" for="ssc"><span>Scala dei punti</span><select id="ssc" class="in"><option value="fis"' + (L.scale !== 'lin' ? ' selected' : '') + '>Coppa del Mondo: 100, 80, 60…</option><option value="lin"' + (L.scale === 'lin' ? ' selected' : '') + '>Lineare: 30, 29, 28…</option></select></label>' +
      '<label class="field" for="sbn"><span>Bonus per ogni arrivo nei primi 30</span><input id="sbn" class="in" type="number" min="0" max="100" value="' + (L.bonus30 || 0) + '"></label>' +
      '<label class="field" for="slb"><span>Formazioni chiuse quanti minuti prima della partenza</span><input id="slb" class="in" type="number" min="0" max="600" step="15" value="' + (L.lockBefore != null ? L.lockBefore : 60) + '"></label></div>' +
      '<p class="small muted">Oggi valgono, senza bonus: ' + [1, 5, 10, 15, 20, 30].map(function (k) { return k + '° <b class="num">' + (FS.scalePts(k, L) + (L.bonus30 || 0)) + '</b>'; }).join(' · ') + '</p>' +
      '<div class="panel"><div class="lbl">Bonus partenza · vale solo il più alto</div>' +
      '<p class="small muted gap">Pettorale dal ' + ((L.bibMid || 15) + 1) + ' al ' + (L.bibLate || 30) + ' (in discesa e superG dal ' + ((L.bibMidSpeed || 20) + 1) + ')</p><div class="grid2">' +
      [5, 3, 1].map(function (k) { return '<label class="field" for="bm' + k + '"><span>' + TIER_LAB[k] + '</span><input id="bm' + k + '" class="in" type="number" min="0" max="200" value="' + ((L.bib && L.bib.mid && L.bib.mid[k]) || 0) + '"></label>'; }).join('') + '</div>' +
      '<p class="small muted gap">Pettorale dal ' + ((L.bibLate || 30) + 1) + ' in su</p><div class="grid2">' +
      [30, 15, 5, 3, 1].map(function (k) { return '<label class="field" for="bl' + k + '"><span>' + TIER_LAB[k] + '</span><input id="bl' + k + '" class="in" type="number" min="0" max="200" value="' + ((L.bib && L.bib.late && L.bib.late[k]) || 0) + '"></label>'; }).join('') + '</div>' +
      '<label class="field gap" for="bq"><span>Bonus solo per atleti con quotazione fino a (0 = tutti)</span><input id="bq" class="in" type="number" min="0" max="200" value="' + (L.bibMaxQ || 0) + '"></label></div>' +
      '<div class="panel"><div class="lbl">Bonus seconda manche e serie</div><p class="small muted gap">Seconda manche: solo gigante e slalom. Serie: gare consecutive della stessa disciplina.</p><div class="grid2">' +
      [['r2b', 'Miglior tempo 2ª manche', L.run2Best, 1], ['r2g', 'Per ogni posizione recuperata in 2ª manche', L.run2Gain, 0.5], ['skp', 'Podio consecutivo', L.streakPod, 1], ['skw', 'Vittoria consecutiva', L.streakWin, 1]].map(function (f) {
        return '<label class="field" for="' + f[0] + '"><span>' + f[1] + '</span><input id="' + f[0] + '" class="in" type="number" min="0" max="200" step="' + f[3] + '" value="' + (f[2] || 0) + '"></label>';
      }).join('') + '</div></div>' +
      '<div class="panel"><div class="lbl">Malus · punti tolti</div><div class="grid2 gap">' +
      [['mdf', 'Non arriva al traguardo', L.malusDnf, 1], ['mtp', 'Primo gruppo oltre il 15°', L.malusTop, 1], ['mld', 'Primo dopo la 1ª manche oltre il 5°', L.malusLead, 1], ['tgp', 'Primo gruppo in gigante e slalom: pettorali fino al', L.topGroup || 7, 1]].map(function (f) {
        return '<label class="field" for="' + f[0] + '"><span>' + f[1] + '</span><input id="' + f[0] + '" class="in" type="number" min="0" max="200" step="' + f[3] + '" value="' + (f[2] || 0) + '"></label>';
      }).join('') + '</div><p class="hint gap">Tieni il malus per l\'uscita almeno pari agli altri: così arrivare non vale mai meno che uscire.</p></div>' +
      '<div class="acts"><button type="button" class="btn" data-act="impsave">Aggiorna impostazioni</button></div>' +
      '<p class="hint">Fissi per questa stagione: ' + (L.perGender || 6) + ' uomini e ' + (L.perGender || 6) + ' donne per squadra, ' + (L.starters || 2) + ' titolari e 1 riserva per gara, formazione chiusa ' + lockText(L) + '.</p></div>';
  }

  // ---------- screens before the league: loading, sign in, joining a league
  function brandHead(sub) {
    return '<header class="hdr"><div class="hdr-in"><div class="brandrow"><div class="brand"><span class="logo">' + LOGO + '</span><span class="season">2026/27</span></div>' +
      (sub ? '<div class="nextg">' + sub + '</div>' : '') + '</div></div></header>';
  }
  function vLoading(msg) { return brandHead('') + '<main class="wrap"><section class="sec"><p class="muted">' + esc(msg || 'Caricamento…') + '</p></section></main>'; }
  function vAuth() {
    var m = tmp.auth, h = brandHead('Il fantasci della Coppa del Mondo') + '<main class="wrap"><section class="sec authbox">';
    if (invite) h += '<p class="ok">Ti hanno invitato in una lega. Registrati, o accedi se hai già un account: entri subito nella lega e scegli la tua squadra.</p>';
    else if (m !== 'reset') h += '<p class="sub">Asta, formazioni e classifica della Coppa del Mondo di sci alpino, tra amici.</p>';
    h += '<div class="chips">' + chipset('authtab', [['login', 'Accedi'], ['register', 'Registrati']], m === 'reset' ? 'login' : m) + '</div>';
    if (m === 'register') {
      h += '<h1 class="h1">Crea il tuo account</h1><form class="stack" data-form="register" novalidate>' +
        '<label class="field" for="re"><span>Email</span><input id="re" class="in" type="email" autocomplete="email" required></label>' +
        '<label class="field" for="rp"><span>Password, almeno 6 caratteri</span><input id="rp" class="in" type="password" autocomplete="new-password" required></label>' +
        '<button type="submit" class="btn red"' + (tmp.busy ? ' disabled' : '') + '>Registrati</button></form>' +
        '<p class="hint gap">Subito dopo scegli il tuo username: è il nome che vedono gli altri giocatori.</p>';
    } else if (m === 'reset') {
      h += '<h1 class="h1">Password dimenticata</h1><form class="stack" data-form="reset" novalidate><p class="small muted">Ti mandiamo un\'email con il link per sceglierne una nuova.</p>' +
        '<label class="field" for="xe"><span>Email</span><input id="xe" class="in" type="email" autocomplete="email" required></label>' +
        '<button type="submit" class="btn red"' + (tmp.busy ? ' disabled' : '') + '>Mandami il link</button></form>' +
        '<div class="acts gap"><button type="button" class="linkb" data-act="authtab" data-v="login">Torna all\'accesso</button></div>';
    } else {
      h += '<h1 class="h1">Accedi</h1><form class="stack" data-form="login" novalidate>' +
        '<label class="field" for="le"><span>Email</span><input id="le" class="in" type="email" autocomplete="email" required></label>' +
        '<label class="field" for="lp"><span>Password</span><input id="lp" class="in" type="password" autocomplete="current-password" required></label>' +
        '<button type="submit" class="btn red"' + (tmp.busy ? ' disabled' : '') + '>Accedi</button></form>' +
        '<div class="acts gap"><button type="button" class="linkb" data-act="authtab" data-v="reset">Password dimenticata?</button></div>';
    }
    if (tmp.authErr) h += '<p class="why gap" role="alert">' + esc(tmp.authErr) + '</p>';
    if (tmp.authOk) h += '<p class="ok gap" role="status">' + esc(tmp.authOk) + '</p>';
    return h + '</section></main>';
  }
  function vName() {
    return brandHead('') + '<main class="wrap"><section class="sec authbox"><div class="lbl">Ultimo passo</div><h1 class="h1">Scegli il tuo username</h1>' +
      '<p class="sub">È il nome con cui ti vedono gli altri giocatori. Da 3 a 20 caratteri: lettere, numeri, punto, trattino o trattino basso, senza spazi.</p>' +
      '<form class="stack" data-form="uname" novalidate><label class="field" for="un"><span>Username</span><input id="un" class="in" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" required placeholder="es. marco.rossi" value="' + esc(tmp.unameVal || '') + '"></label>' +
      '<button type="submit" class="btn red"' + (tmp.busy ? ' disabled' : '') + '>Continua</button></form>' +
      (tmp.nameErr ? '<p class="why gap" role="alert">' + esc(tmp.nameErr) + '</p>' : '') +
      '<p class="small muted gap">Account: ' + esc(STATE.user.email) + ' · <button type="button" class="linkb" data-act="logout">Esci</button></p></section></main>';
  }
  function joinForm() {
    return '<form class="stack" data-form="join" novalidate><label class="field" for="jc"><span>Codice della lega</span><input id="jc" class="in codein" autocomplete="off" autocapitalize="characters" placeholder="es. K7PX2Q" required></label>' +
      '<button type="submit" class="btn red"' + (tmp.busy ? ' disabled' : '') + '>Entra nella lega</button></form>' + (tmp.joinErr ? '<p class="why gap" role="alert">' + esc(tmp.joinErr) + '</p>' : '');
  }
  function createForm() {
    return '<form class="stack" data-form="create" novalidate><div class="grid2"><label class="field" for="lgn"><span>Nome della lega</span><input id="lgn" class="in" placeholder="es. Amici" required></label>' +
      '<label class="field" for="lgt"><span>Squadre</span><input id="lgt" class="in" type="number" min="2" max="20" value="8"></label></div>' +
      '<button type="submit" class="btn ghost"' + (tmp.busy ? ' disabled' : '') + '>Crea lega</button></form>';
  }
  function createOpt() {
    return '<div class="opt' + (STATE.canCreate ? '' : ' locked') + '"><div class="lbl">Crea una lega</div>' + (STATE.canCreate ? createForm() :
      '<p class="small muted gap">Per ora le leghe le crea solo l\'amministratore del sito. Se vuoi organizzarne una, chiedi a lui.</p><div class="acts gap"><button type="button" class="btn ghost" disabled>Crea una lega</button></div>') + '</div>';
  }
  function joinOpt() {
    return '<div class="opt"><div class="lbl">Entra con un codice</div><p class="small muted gap">Il codice della lega te lo dà chi la organizza.</p>' + joinForm() + '</div>';
  }
  // signed in, in no league yet: create one (only the administrator, for now) or enter one with its code
  function vHome() {
    if (tmp.joining) return vLoading('Entro nella lega…');
    var h = brandHead('Ciao <b>' + esc(STATE.user.name) + '</b>') + '<main class="wrap"><section class="sec authbox"><h1 class="h1">Come vuoi giocare?</h1><p class="sub">Crea una lega, o entra in quella dei tuoi amici con il suo codice.</p>' +
      '<div class="opts">' + createOpt() + joinOpt() + '</div></section>';
    if (GADMIN) h += '<section class="sec authbox">' + importBox() + '</section>';
    else if (!STATE.adminsExist) h += '<section class="sec authbox"><div class="lbl">Primo accesso</div><p class="small">Nessuno amministra ancora il sito. Se sei l\'organizzatore, diventa amministratore: potrai creare le leghe e gestire calendario e risultati.</p><div class="acts gap"><button type="button" class="btn ghost" data-act="claimadmin">Diventa amministratore</button></div></section>';
    return h + '<section class="sec"><p class="small muted">Connesso come ' + esc(STATE.user.email) + ' · <button type="button" class="linkb" data-act="logout">Esci</button></p></section></main>';
  }
  // just inside the league: which team is yours? (the organiser can change it later)
  function vPick() {
    var lgName = S.league.name || 'Lega', free = S.teams.filter(function (t) { return !t.uid; });
    var h = brandHead(esc(lgName)) + '<main class="wrap"><section class="sec authbox"><div class="lbl">' + esc(lgName) + '</div><h1 class="h1">Quale squadra sei?</h1>' +
      '<p class="sub">' + (free.length ? 'Scegli la tua squadra: la tieni per tutta la stagione. Se sbagli, chi organizza la lega la può cambiare.' : 'Tutte le squadre sono già prese: chiedi a chi organizza la lega di assegnartene una.') + '</p><div class="picks">';
    var guess = freeTeam(), named = guess && FS.norm(STATE.user.name) && (FS.norm(guess.owner) === FS.norm(STATE.user.name) || FS.norm(guess.name).indexOf(FS.norm(STATE.user.name)) >= 0);
    h += S.teams.map(function (t) {
      var who = ownerName(t);
      if (named && guess.id === t.id) who = (who ? who + ' · ' : '') + 'forse sei tu';
      if (t.uid) return '<div class="pickrow taken"><span class="tn">' + esc(t.name) + '</span><span class="to">' + (who ? 'di ' + esc(who) : 'presa') + '</span></div>';
      if (tmp.pickT === t.id) return '<div class="pickrow on"><span class="tn">' + esc(t.name) + '</span><span class="to">' + (who ? esc(who) : 'libera') + '</span>' +
        '<div class="confirm"><span>Confermi? Sei <b>' + esc(t.name) + '</b>.</span><button type="button" class="btn red" data-act="pickok" data-v="' + t.id + '"' + (tmp.busy ? ' disabled' : '') + '>Sì, sono io</button><button type="button" class="btn ghost" data-act="pickno">No</button></div></div>';
      return '<button type="button" class="pickrow" data-act="pick" data-v="' + t.id + '"><span class="tn">' + esc(t.name) + '</span><span class="to">' + (who ? esc(who) : 'libera') + '</span></button>';
    }).join('');
    return h + '</div><div class="acts gap"><button type="button" class="linkb" data-act="pickskip">' + (free.length ? 'Scelgo più tardi' : 'Entra nella lega') + '</button></div></section></main>';
  }
  function vProfilo() {
    var u = STATE.user;
    var h = '<section class="sec"><div class="lbl">Profilo</div><h1 class="h1">' + esc(u.name) + '</h1><p class="sub">' + esc(u.email) + (GADMIN ? ' · amministratore del sito' : '') + '</p>' +
      '<form class="stack" data-form="rename" novalidate><label class="field" for="pn"><span>Username</span><input id="pn" class="in" value="' + esc(u.name) + '" autocapitalize="none" spellcheck="false" maxlength="20"></label><button type="submit" class="btn ghost">Cambia username</button></form></section>';
    h += '<section class="sec"><div class="lbl">Le tue leghe</div><div class="tlist gap">' + ROOT.leagues.map(function (lg) {
      return '<div class="mrow"><span><b>' + esc(lg.league.name || 'Lega') + '</b>' + (lg.admin === ME ? ' <span class="gx">organizzi tu</span>' : '') + '</span>' +
        (lg.id === S.lid ? '<span class="small muted">aperta</span>' : '<button type="button" class="mini" data-act="lgopen" data-v="' + esc(lg.id) + '">Apri</button>') + '</div>';
    }).join('') + '</div></section><section class="sec"><div class="opts">' + joinOpt() + createOpt() + '</div></section>';
    return h + '<section class="sec"><button type="button" class="btn ghost" data-act="logout">Esci</button></section>';
  }

  // ---------- render
  function view(tab) {
    return ({ classifica: vClassifica, squadre: vSquadre, gare: vGare, listone: vListone, regole: vRegole, gestione: vGestione, profilo: vProfilo }[tab] || vClassifica)();
  }
  // the tab bar scrolls sideways on phones: keep its position across renders and bring the open tab into view
  function keepTabs(x) {
    var nav = D.querySelector('.tabs'), on = nav && nav.querySelector('.tab.on');
    if (!nav) return;
    nav.scrollLeft = x;
    if (!on) return;
    var nb = nav.getBoundingClientRect(), tb = on.getBoundingClientRect();
    if (tb.left < nb.left) nav.scrollLeft -= nb.left - tb.left + 12;
    else if (tb.right > nb.right) nav.scrollLeft += tb.right - nb.right + 12;
  }
  function render() {
    if (!STATE || STATE.phase === 'loading') { APP.innerHTML = vLoading(); return; }
    if (STATE.phase === 'noconfig') { APP.innerHTML = vLoading('Il sito non è ancora collegato al database.'); return; }
    if (STATE.phase === 'signedout') { APP.innerHTML = vAuth(); return; }
    if (STATE.error && !ROOT) { APP.innerHTML = vLoading(STATE.error); return; }
    if (STATE.needName) { APP.innerHTML = vName(); return; }
    if (!ROOT || !ROOT.leagues.length) { APP.innerHTML = vHome(); return; }
    if (!S) { APP.innerHTML = vLoading('Apro la lega…'); return; }
    if (needPick()) { APP.innerHTML = vPick(); return; }
    var tab = (!OWNER && ui.tab === 'gestione') ? 'classifica' : ui.tab;
    var nav0 = D.querySelector('.tabs'), navX = nav0 ? nav0.scrollLeft : 0;
    APP.innerHTML = header(tab) + '<main class="wrap" id="main">' + (STATE.error ? '<p class="why">' + esc(STATE.error) + '</p>' : '') + view(tab) + footer() + '</main>';
    keepTabs(navX);
    if (tab === 'gare' && !tmp.scrolled) {
      tmp.scrolled = true;
      var g = curG(), el = g && D.getElementById('g-' + g.k);
      if (el && g.n > 1) el.scrollIntoView({ block: 'start' });
    }
  }
  function renderSaveBar() { }
  var toastT = null;
  function toast(msg) {
    var el = D.getElementById('fs-toast');
    if (!el) return;
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.hidden = true; }, 4200);
  }
  function go(tab) { ui.tab = tab; saveUi(); render(); window.scrollTo(0, 0); }
  function openLineup(rid, tid) {
    var r = race(rid);
    if (!r || lockOf(r) <= now()) { toast('Per questa gara la formazione è già chiusa.'); return false; }
    var e = C.eff[rid][tid], sel = {};
    e.t.forEach(function (a) { sel[a] = 'T'; });
    if (e.r) sel[e.r] = 'R';
    tmp.lu = { r: rid, t: tid, sel: sel };
    return true;
  }

  // ---------- events
  D.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act'), v = el.getAttribute('data-v');
    var a, r, p, price, list, mt;
    switch (act) {
      case 'tab': go(v); break;
      case 'team': ui.team = v; tmp.lu = null; go('squadre'); break;
      case 'tsel': ui.team = v; tmp.rel = null; tmp.lu = null; tmp.ren = null; saveUi(); render(); break;
      case 'ren': tmp.ren = v; render(); var ri = D.getElementById('trn'); if (ri) { ri.focus(); ri.select(); } break;
      case 'renno': tmp.ren = null; render(); break;
      case 'gf': ui.gf = v; saveUi(); render(); break;
      case 'cl': ui.cl = v; saveUi(); render(); if (el.classList.contains('cup')) window.scrollTo(0, 0); break;
      case 'race': tmp.race = tmp.race === v ? null : v; render(); break;
      case 'golu':
        mt = myTeam();
        if (mt && canLineup(mt.id)) { ui.team = mt.id; openLineup(v, mt.id); go('squadre'); }
        else { tmp.race = v; tmp.scrolled = true; go('gare'); var ge = D.getElementById('g-' + C.raceG[v]); if (ge) ge.scrollIntoView({ block: 'start' }); }
        break;
      case 'gores': tmp.rr = v; tmp.parsed = null; tmp.paste = ''; ui.adm = 'ris'; go('gestione'); break;
      case 'goadm': ui.adm = v; go('gestione'); break;
      case 'lg': ui.lg = v; saveUi(); render(); break;
      case 'ld': ui.ld = v; saveUi(); render(); break;
      case 'lfree': ui.lfree = !ui.lfree; saveUi(); render(); break;
      case 'adm': ui.adm = v; saveUi(); render(); break;
      case 'allraces': tmp.allRaces = !tmp.allRaces; render(); break;
      case 'claim':
        if (!ME || !S) break;
        DBX.claimTeam(S.lid, v).then(function () { ui.team = v; saveUi(); toast('La squadra adesso è tua: puoi scegliere le formazioni.'); }, function (e) { toast(errText(e)); });
        break;
      case 'unclaim': if (doOp({ k: 'teamSet', id: v, uid: '' })) render(); break;
      case 'pick': tmp.pickT = v; render(); break;
      case 'pickno': tmp.pickT = null; render(); break;
      case 'pickskip': if (S) tmp.skipPick[S.lid] = true; tmp.pickT = null; render(); window.scrollTo(0, 0); break;
      case 'repick': if (S) tmp.skipPick[S.lid] = false; tmp.pickT = null; render(); window.scrollTo(0, 0); break;
      case 'pickok':
        if (!S || tmp.busy) break;
        var pt = team(v);
        tmp.busy = true; render();
        DBX.claimTeam(S.lid, v).then(function () {
          tmp.busy = false; tmp.pickT = null; ui.team = v; ui.tab = 'squadre'; saveUi(); render(); window.scrollTo(0, 0);
          toast('Fatto: sei «' + (pt ? pt.name : 'la tua squadra') + '». Qui scegli la formazione per ogni gara e puoi dare un nome alla squadra.');
        }, function (e) { tmp.busy = false; tmp.pickT = null; toast(e && e.code === 'permission-denied' ? 'Questa squadra non è più libera: scegline un\'altra.' : errText(e)); render(); });
        break;
      case 'allload': DBX.allLeagues().then(function (list) { tmp.all = list; render(); }, function (e) { toast(errText(e)); }); break;
      case 'lgjoin':
        DBX.join(v, STATE.user.name).then(function (lid) { tmp.all = null; enterLeague(lid); toast('Sei nella lega.'); }, function (e) { toast(errText(e)); });
        break;
      case 'siteopen':
        DBX.setSite({ openLeagues: v === '1' }).then(function () { toast(v === '1' ? 'Adesso tutti gli iscritti possono creare una lega.' : 'Adesso le leghe le crei solo tu.'); }, function (e) { toast(errText(e)); });
        break;
      case 'luopen': if (openLineup(v, ui.team && team(ui.team) ? ui.team : (myTeam() || S.teams[0]).id)) render(); break;
      case 'luclose': tmp.lu = null; render(); break;
      case 'lusel':
        if (!tmp.lu) break;
        var parts = v.split('|'), aid = parts[0], want = parts[1], sel = tmp.lu.sel, max = S.league.starters || 2;
        if (want === 'T' && sel[aid] !== 'T' && luCount(sel, 'T') >= max) { toast('Hai già ' + max + ' titolari: mettine prima uno in riserva o fuori.'); break; }
        if (want === 'R') Object.keys(sel).forEach(function (k) { if (sel[k] === 'R' && k !== aid) sel[k] = ''; });
        sel[aid] = want;
        render();
        break;
      case 'lusave':
        if (!tmp.lu || tmp.lu.busy) break;
        r = race(tmp.lu.r);
        if (!r || lockOf(r) <= now()) { toast('Per questa gara la formazione è già chiusa.'); tmp.lu = null; render(); break; }
        var luNow = tmp.lu, s2 = luNow.sel, tit = Object.keys(s2).filter(function (k) { return s2[k] === 'T'; }), rr = Object.keys(s2).filter(function (k) { return s2[k] === 'R'; })[0] || null;
        var pr = doOp({ k: 'lu', r: r.id, t: luNow.t, lu: { t: tit, r: rr } }, { 'permission-denied': 'Il database non ha accettato la formazione: per questa gara risulta già chiusa. Se l\'orario della gara è appena cambiato, avvisa chi organizza la lega.' });
        if (pr) {
          luNow.busy = true; render();
          pr.then(function (ok) {
            luNow.busy = false;
            if (ok) { if (tmp.lu === luNow) tmp.lu = null; toast('Formazione per ' + r.t + ' ' + r.v + ' salvata.'); }
            render();
          });
        }
        break;
      case 'at': tmp.at = v; tmp.ath = null; tmp.price = ''; render(); break;
      case 'apick':
        if (el.classList.contains('dis')) { toast('Questa squadra ha già ' + (S.league.perGender || 6) + ' atleti di quel genere.'); break; }
        tmp.ath = v; tmp.price = String(reachQ(ath(v)).length ? ath(v).q : 1); render();
        var pi = D.getElementById('aprice'); if (pi) { pi.focus(); pi.select(); }
        break;
      case 'apickx': tmp.ath = null; tmp.price = ''; render(); break;
      case 'pstep':
        a = ath(tmp.ath); if (!a) break;
        price = parseInt(val('aprice'), 10); if (!(price >= 1)) price = a.q;
        price = Math.max(1, price + parseInt(v, 10));
        tmp.price = String(price);
        var inp = D.getElementById('aprice'); if (inp) inp.value = price;
        updateBuy();
        break;
      case 'buy':
        a = ath(tmp.ath); if (!a) break;
        price = parseInt(val('aprice') || tmp.price, 10); if (!(price >= 1)) price = a.q;
        var bc = buyCheck(a, price);
        if (!bc.ok) { toast(bc.why); break; }
        if (doOp({ k: 'buy', id: FS.rid('p'), a: a.id, t: tmp.at, price: price, from: S.league.auctionOpen ? S.league.seasonStart : new Date().toISOString() })) {
          toast(a.n + ' a ' + tname(tmp.at) + ' per ' + price + ' crediti.');
          tmp.ath = null; tmp.price = ''; tmp.aq = '';
          render();
          var aq = D.getElementById('aq'); if (aq) aq.focus();
        }
        break;
      case 'unbuy': if (doOp({ k: 'unbuy', id: v })) { toast('Assegnazione annullata, crediti restituiti.'); render(); } break;
      case 'auction': if (doOp({ k: 'set', f: { auctionOpen: v === '1' } })) render(); break;
      case 'rel': tmp.rel = v; render(); break;
      case 'relno': tmp.rel = null; render(); break;
      case 'relok':
        p = FS.findBy(S.purchases, v); if (!p) break;
        if (doOp({ k: 'release', id: v, ts: new Date().toISOString(), refund: Math.floor(p.price * (S.league.refundPct || 0) / 100) })) { tmp.rel = null; toast('Atleta svincolato.'); render(); }
        break;
      case 'parse':
        r = race(tmp.rr); if (!r) break;
        tmp.paste = val('rpaste');
        var tech = FS.CAT[r.t] === 'T';
        var pr = FS.parseResults(tmp.paste, S.athletes.filter(function (x) { return x.g === r.g && !x.hide; }), { runs: tech });
        var ranked = {}, ro = rosteredAll(r), stt = {}, nbs = {}, pasted = !!tmp.paste.trim();
        pr.list.forEach(function (x) { ranked[x[0]] = 1; });
        Object.keys(ro).forEach(function (aid) {
          if (ranked[aid]) return;
          stt[aid] = pr.nf.indexOf(aid) >= 0 ? 'dnf' : pr.nq.indexOf(aid) >= 0 ? 'nc' : pasted && (pr.ns.indexOf(aid) >= 0 || pr.seen.indexOf(aid) < 0) ? 'dns' : 'nc';
          if (pr.sbib[aid]) nbs[aid] = pr.sbib[aid];
        });
        tmp.parsed = { r: r.id, list: pr.list, st: stt, nb: nbs, sure: pr.sure, src: 'incollati' };
        toast(pr.matched ? pr.matched + ' atleti riconosciuti' + (tech ? (pr.runs ? ', tempi di manche per ' + pr.runs : ', tempi di manche non trovati') : '') + '.' : 'Nessun atleta riconosciuto: controlla di aver incollato la classifica di questa gara.');
        render();
        break;
      case 'pst':
        if (tmp.parsed) { var sp = v.split('|'); tmp.parsed.st[sp[0]] = sp[1]; render(); }
        break;
      case 'prm': if (tmp.parsed) { tmp.parsed.list = tmp.parsed.list.filter(function (x) { return x[0] !== v; }); render(); } break;
      case 'padd':
        var pid = val('padd'), rk = parseInt(val('paddr'), 10);
        if (!pid || !(rk >= 1 && rk <= 99)) { toast('Scegli un atleta e una posizione da 1 a 99.'); break; }
        if (!tmp.parsed) break;
        var bk = parseInt(val('paddb'), 10);
        tmp.parsed.list.push(FS.pack(pid, rk, bk >= 1 && bk <= 999 ? bk : 0)); delete tmp.parsed.st[pid]; delete tmp.parsed.nb[pid]; render();
        break;
      case 'psave':
        r = race(tmp.rr); if (!r || !tmp.parsed) break;
        var twoRuns = FS.CAT[r.t] === 'T';
        list = tmp.parsed.list.filter(function (x) { return x[1] >= 1 && x[1] <= 99; }).sort(function (x, y) { return x[1] - y[1]; })
          .map(function (x) { return FS.pack(x[0], x[1], x[2], twoRuns ? x[3] : 0, twoRuns ? x[4] : 0); });
        var inL = {}, dnsList = [], dnfList = [], ncList = [];
        list.forEach(function (x) { inL[x[0]] = 1; });
        Object.keys(rosteredAll(r)).forEach(function (k) {
          if (inL[k]) return;
          var sk = tmp.parsed.st[k] || 'nc';
          if (sk === 'dns') dnsList.push(k);
          else if (sk === 'dnf') dnfList.push(k);
          else if (tmp.parsed.nb[k]) ncList.push([k, tmp.parsed.nb[k]]);
        });
        if (doOp({ k: 'res', r: r.id, list: list, dns: dnsList, dnf: dnfList, nc: ncList, src: tmp.parsed.src || 'manuale', at: new Date().toISOString() })) { tmp.parsed = null; tmp.paste = ''; toast('Risultati salvati.'); render(); }
        break;
      case 'canc': if (doOp({ k: 'raceSet', r: tmp.rr, f: { st: 'canc' } })) render(); break;
      case 'uncanc': if (doOp({ k: 'raceSet', r: tmp.rr, f: { st: 'sched' } })) render(); break;
      case 'resdel': if (doOp({ k: 'resDel', r: tmp.rr })) { tmp.parsed = null; render(); } break;
      case 'tadd': if (doOp({ k: 'teamAdd', id: FS.rid('t'), name: 'Squadra ' + (S.teams.length + 1), owner: '' })) render(); break;
      case 'tdel': if (doOp({ k: 'teamDel', id: v })) render(); break;
      case 'rsave':
        r = race(tmp.er); if (!r) break;
        var nd = val('ed');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(nd)) { toast('Data non valida.'); break; }
        var eh = val('eh');
        if (doOp({ k: 'raceSet', r: r.id, f: { d: nd, h: /^\d{1,2}:\d{2}$/.test(eh) ? eh : '', v: val('ev').trim() || r.v, c: val('ec').trim().toUpperCase(), x: parseFloat(val('ex')) || 1, fin: !!(D.getElementById('ef') || {}).checked, note: val('en').trim() } })) { toast('Gara aggiornata.'); render(); }
        break;
      case 'radd':
        var dd = val('nd'), vv = val('nv').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dd) || !vv) { toast('Servono almeno data e località.'); break; }
        var g = val('ng') === 'F' ? 'F' : 'M';
        var nh = val('nh');
        if (doOp({ k: 'raceAdd', race: { id: (g === 'M' ? 'm' : 'f') + 'x' + FS.rid(''), g: g, d: dd, h: /^\d{1,2}:\d{2}$/.test(nh) ? nh : '', v: vv, c: val('nc').trim().toUpperCase(), t: val('nt') || 'GS', x: 1, st: 'sched' } })) { toast('Gara aggiunta al calendario.'); render(); }
        break;
      case 'epick': tmp.ea = v; render(); break;
      case 'asave':
        a = ath(tmp.ea); if (!a) break;
        var q = parseInt(val('xq'), 10);
        if (doOp({ k: 'athSet', a: a.id, f: { q: q >= 1 ? q : a.q, c: val('xc').trim().toUpperCase() || a.c, note: val('xn').trim(), hide: !!(D.getElementById('xh') || {}).checked } })) { toast('Atleta aggiornato.'); render(); }
        break;
      case 'aadd':
        var nm = val('nan').trim();
        if (nm.length < 3) { toast('Scrivi nome e cognome.'); break; }
        var gg = val('nag') === 'F' ? 'F' : 'M', nid = (gg === 'M' ? 'm-' : 'f-') + slugify(nm);
        if (ath(nid)) { toast('Questo atleta è già nel listone.'); break; }
        var qq = parseInt(val('naq'), 10);
        if (doOp({ k: 'athAdd', ath: { id: nid, n: nm, c: val('nac').trim().toUpperCase(), g: gg, p: [0, 0, 0, 0], tp: 0, q: qq >= 1 ? qq : 1, note: 'Aggiunto in Gestione' } })) { toast(nm + ' aggiunto al listone.'); render(); }
        break;
      case 'impsave':
        var b = parseInt(val('sb'), 10), rf = parseInt(val('srf'), 10);
        var bn = parseInt(val('sbn'), 10), bqv = parseInt(val('bq'), 10), bib = { mid: {}, late: {} };
        [5, 3, 1].forEach(function (k) { var x = parseInt(val('bm' + k), 10); if (x > 0) bib.mid[k] = x; });
        [30, 15, 5, 3, 1].forEach(function (k) { var x = parseInt(val('bl' + k), 10); if (x > 0) bib.late[k] = x; });
        function bval(id, cur) { var x = Math.round(parseFloat(String(val(id)).replace(',', '.')) * 10) / 10; return x >= 0 && x <= 200 ? x : (cur || 0); }
        if (doOp({ k: 'set', f: { budget: b >= 12 ? b : S.league.budget, refundPct: rf >= 0 && rf <= 100 ? rf : S.league.refundPct, name: val('sn').trim() || S.league.name, scale: val('ssc') === 'lin' ? 'lin' : 'fis', bonus30: bn >= 0 && bn <= 100 ? bn : (S.league.bonus30 || 0), bib: bib, bibMaxQ: bqv >= 0 ? bqv : 0, run2Best: bval('r2b', S.league.run2Best), run2Gain: bval('r2g', S.league.run2Gain), streakPod: bval('skp', S.league.streakPod), streakWin: bval('skw', S.league.streakWin),
          lockBefore: Math.min(600, Math.max(0, parseInt(val('slb'), 10) >= 0 ? parseInt(val('slb'), 10) : (S.league.lockBefore != null ? S.league.lockBefore : 60))),
          malusDnf: bval('mdf', S.league.malusDnf), malusTop: bval('mtp', S.league.malusTop), malusLead: bval('mld', S.league.malusLead), topGroup: Math.min(30, Math.max(1, parseInt(val('tgp'), 10) || S.league.topGroup || 7)) } })) { toast('Impostazioni aggiornate.'); render(); }
        break;
      case 'lgopen': ui.lid = v; saveUi(); tmp.lu = null; tmp.rel = null; tmp.parsed = null; setView(); go('classifica'); break;
      case 'lgdel': tmp.lgdel = v; render(); break;
      case 'lgdelno': tmp.lgdel = null; render(); break;
      case 'lgdelok':
        tmp.lgdel = null;
        DBX.op({ k: 'lgDel', id: v }).then(function () { toast('Lega eliminata.'); ui.lid = ''; saveUi(); }, function (e) { toast(errText(e)); });
        break;
      case 'lgadd': createLeague(val('lgn').trim(), parseInt(val('lgt'), 10)); break;
      case 'copylink':
        var il = D.getElementById('invlink');
        if (!il) break;
        (navigator.clipboard ? navigator.clipboard.writeText(il.value) : Promise.reject()).then(function () { toast('Link copiato: incollalo nel gruppo.'); },
          function () { il.focus(); il.select(); toast('Tieni premuto sul link per copiarlo.'); });
        break;
      case 'impgo':
        var src = tmp.imp && tmp.imp.leagues && tmp.imp.leagues[+v];
        if (!src || tmp.busy) break;
        tmp.busy = true; render();
        DBX.importLeague(src).then(function (lid) {
          tmp.busy = false; tmp.imp = null; expect(lid); ui.lid = lid; ui.tab = 'gestione'; ui.adm = 'squadre'; saveUi(); setView(); render();
          toast('Lega «' + (src.league.name || 'Lega') + '» importata: manda il link di invito ai partecipanti.');
        }, function (e) { tmp.busy = false; toast(errText(e)); render(); });
        break;
      case 'regen':
        DBX.regenCode(S.lid).then(function (c) { toast('Nuovo codice: ' + c + '.'); }, function (e) { toast(errText(e)); });
        break;
      case 'mrem': tmp.mrem = v; render(); break;
      case 'mremno': tmp.mrem = null; render(); break;
      case 'mremok':
        tmp.mrem = null;
        DBX.removeMember(S.lid, v).then(function () { toast('Partecipante tolto dalla lega.'); }, function (e) { toast(errText(e)); });
        break;
      case 'authtab': tmp.auth = v; tmp.authErr = ''; tmp.authOk = ''; render(); break;
      case 'logout': DBX.logout().then(null, function (e) { toast(errText(e)); }); break;
      case 'claimadmin':
        DBX.claimAdmin().then(function () { toast('Adesso sei l\'amministratore del sito.'); }, function (e) { toast(errText(e)); });
        break;
    }
  });
  function createLeague(name, n) {
    if (!name) { toast('Dai un nome alla nuova lega.'); return; }
    if (!(n >= 2 && n <= 20)) n = 8;
    var base = S ? FS.clone(S.league) : FS.clone(window.FS_DEFAULTS || {});
    delete base.name; base.auctionOpen = true;
    tmp.busy = true; render();
    DBX.createLeague(name, n, base).then(function (lid) {
      tmp.busy = false; expect(lid); ui.lid = lid; ui.tab = 'gestione'; ui.adm = 'squadre'; saveUi(); toast('Lega «' + name + '» creata: trovi il codice invito qui sotto.'); setView(); render();
    }, function (e) { tmp.busy = false; toast(errText(e)); render(); });
  }
  D.addEventListener('submit', function (e) {
    var f = e.target.closest('form[data-form]');
    if (!f) return;
    e.preventDefault();
    var k = f.getAttribute('data-form');
    function busy(p, okMsg) {
      tmp.busy = true; tmp.authErr = ''; tmp.authOk = ''; tmp.joinErr = ''; render();
      p.then(function () { tmp.busy = false; if (okMsg) tmp.authOk = okMsg; render(); },
        function (er) { tmp.busy = false; if (k === 'join') tmp.joinErr = errText(er); else tmp.authErr = errText(er); render(); });
    }
    if (k === 'login') busy(DBX.login(val('le').trim(), val('lp')));
    else if (k === 'register') busy(DBX.register(val('re').trim(), val('rp')));
    else if (k === 'tname') {
      var tr = tmp.ren && team(tmp.ren), nn = val('trn').replace(/\s+/g, ' ').trim();
      if (!tr) return;
      if (!nn) { toast('Scrivi un nome per la squadra.'); return; }
      if (nn.length > 30) { toast('Il nome può avere al massimo 30 caratteri.'); return; }
      if (nn === tr.name) { tmp.ren = null; render(); return; }
      var pn = doOp({ k: 'teamSet', id: tr.id, name: nn });
      if (pn) {
        tmp.busy = true; render();
        pn.then(function (ok) { tmp.busy = false; if (ok) { tmp.ren = null; toast('La squadra adesso si chiama «' + nn + '».'); } render(); });
      }
    }
    else if (k === 'uname') {
      tmp.unameVal = val('un').trim(); tmp.busy = true; tmp.nameErr = ''; render();
      DBX.setName(tmp.unameVal).then(function () { tmp.busy = false; tmp.unameVal = ''; render(); },
        function (er) { tmp.busy = false; tmp.nameErr = errText(er); render(); var u = D.getElementById('un'); if (u) u.focus(); });
    }
    else if (k === 'reset') busy(DBX.reset(val('xe').trim()), 'Fatto: controlla la posta, anche nello spam.');
    else if (k === 'join') busy(DBX.join(val('jc'), STATE.user.name).then(function (lid) { enterLeague(lid); }));
    else if (k === 'create') createLeague(val('lgn').trim(), parseInt(val('lgt'), 10));
    else if (k === 'rename') { var n2 = val('pn').trim(); if (n2 && n2 !== STATE.user.name) DBX.setName(n2).then(function () { toast('Username aggiornato.'); render(); }, function (er) { toast(errText(er)); }); }
  });
  D.addEventListener('input', function (e) {
    var id = e.target.id, box;
    if (id === 'lq') { ui.lq = e.target.value; box = D.getElementById('llist'); if (box) box.innerHTML = listRows(); }
    else if (id === 'aq') { tmp.aq = e.target.value; box = D.getElementById('alist'); if (box) box.innerHTML = astaList(); }
    else if (id === 'eq') { tmp.eq = e.target.value; box = D.getElementById('elist'); if (box) box.innerHTML = athEditList(); }
    else if (id === 'rpaste') tmp.paste = e.target.value;
    else if (id === 'aprice') { tmp.price = e.target.value; updateBuy(); }
  });
  D.addEventListener('change', function (e) {
    var el = e.target, c = el.getAttribute && el.getAttribute('data-chg');
    if (!c) return;
    var v = el.getAttribute('data-v');
    if (c === 'tn') { if (el.value.trim()) doOp({ k: 'teamSet', id: v, name: el.value.trim() }); render(); }
    else if (c === 'to') { doOp({ k: 'teamSet', id: v, owner: el.value.trim() }); render(); }
    else if (c === 'asg') {
      var tm2 = team(v), who = el.value ? memberOf(el.value) : null, pa = doOp({ k: 'assign', t: v, uid: el.value });
      if (pa) pa.then(function (ok) { if (ok) toast(who ? (tm2 ? tm2.name : 'La squadra') + ' adesso è di ' + who.name + '.' : (tm2 ? tm2.name : 'La squadra') + ' adesso è libera.'); render(); });
      else render();
    }
    else if (c === 'rsel') { tmp.rr = el.value; tmp.parsed = null; tmp.paste = ''; render(); }
    else if (c === 'esel') { tmp.er = el.value; render(); }
    else if (c === 'impf') {
      var file = el.files && el.files[0];
      if (!file) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var data = FS.migrate(JSON.parse(String(fr.result)));
          var lgs = (data.leagues || []).filter(function (lg) { return lg && lg.teams && lg.teams.length; });
          tmp.imp = lgs.length ? { leagues: lgs } : { err: 'Nel file non trovo nessuna lega con squadre.' };
        } catch (er) { tmp.imp = { err: 'Questo non è il file della lega: deve essere il .json che ti ho mandato.' }; }
        render();
      };
      fr.onerror = function () { tmp.imp = { err: 'Non riesco a leggere il file.' }; render(); };
      fr.readAsText(file);
    }
    else if (c === 'lgsel') { ui.lid = el.value; saveUi(); tmp.lu = null; tmp.rel = null; setView(); render(); window.scrollTo(0, 0); }
    else if (c === 'lgname') { if (el.value.trim()) doOp({ k: 'set', lg: v, f: { name: el.value.trim() } }); render(); }
    else if (c === 'pnb' && tmp.parsed) {
      var nb2 = parseInt(el.value, 10);
      if (nb2 >= 1 && nb2 <= 999) tmp.parsed.nb[v] = nb2; else delete tmp.parsed.nb[v];
    }
    else if (c === 'pbib' || c === 'pr1' || c === 'pr2') {
      var nn = parseInt(el.value, 10), mx = c === 'pbib' ? 999 : 99;
      setX(v, { pbib: 2, pr1: 3, pr2: 4 }[c], nn >= 1 && nn <= mx ? nn : 0);
    }
    else if (c === 'prank' && tmp.parsed) {
      var n = parseInt(el.value, 10);
      tmp.parsed.list.forEach(function (x) { if (x[0] === v && n >= 1 && n <= 99) x[1] = n; });
      render();
    }
  });

  // ---------- boot
  var tt = D.createElement('div'); tt.id = 'fs-toast'; tt.setAttribute('role', 'status'); tt.setAttribute('aria-live', 'polite'); tt.hidden = true; D.body.appendChild(tt);
  render();
  function boot() { if (DBX || !window.DB) return; DBX = window.DB; DBX.start(onState); }
  if (window.DB) boot(); else window.addEventListener('fs-db-ready', boot);
})();
