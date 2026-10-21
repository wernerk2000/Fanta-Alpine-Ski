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

  // ---------- pristine copy of this page's own source, used to publish a new version
  var PRIST = (function () {
    function oh(sel) { var el = D.querySelector(sel); return el ? el.outerHTML : ''; }
    var links = [].slice.call(D.querySelectorAll('link[data-fs]')).map(function (l) { return l.outerHTML; }).join('');
    var reset = '';
    var hs = D.head ? [].slice.call(D.head.querySelectorAll('style')).filter(function (s) { return s.id !== 'fs-style'; }) : [];
    if (hs.length) reset = hs[0].textContent;
    return { title: oh('title'), meta: oh('meta[name="claude:viewport-fit-sides"]'), links: links, style: oh('#fs-style'), code: oh('#fs-code'), reset: reset };
  })();
  var RESET_FALLBACK = ':root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}';
  function buildDoc(state) {
    var json = JSON.stringify(state).replace(/</g, '\\u003c');
    return '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' +
      (PRIST.reset || RESET_FALLBACK) + '</style></head><body>' + PRIST.title + PRIST.meta + PRIST.links + PRIST.style +
      '<div id="app"></div><script type="application/json" id="fs-state">' + json + '<\/script>' + PRIST.code + '</body></html>';
  }

  // ---------- league state: the published copy plus this device's unsaved changes
  var PUB = null;
  try { PUB = JSON.parse(D.getElementById('fs-state').textContent); } catch (e) { PUB = null; }
  if (!PUB || !(PUB.league || PUB.leagues)) { APP.innerHTML = '<main class="wrap"><p>I dati della lega non sono leggibili.</p></main>'; return; }
  FS.migrate(PUB);

  var LSK = 'fs-pending-v2', UIK = 'fs-ui-v2';
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }

  // ROOT: every league with this device's unsaved changes; S: the league on screen, seen as a single league; C: its scores
  var ROOT = null, S = null, C = null, bootNote = '';
  var pend = lsGet(LSK);
  if (!pend || !Array.isArray(pend.ops)) pend = { ops: [], rev: null };
  if (pend.rev && pend.rev === PUB.rev) pend = { ops: [], rev: null };
  pend.rev = null;
  (function () {
    var n = pend.ops.length;
    pend.ops = pend.ops.filter(function (op) {
      if (op.k !== 'lu') return true;
      var r = FS.findBy(PUB.races, op.r);
      return r && FS.lockOf(FS.view(PUB, op.lg), r) > Date.now();
    });
    if (pend.ops.length < n) bootNote = 'Una formazione non salvata è arrivata dopo la scadenza ed è stata scartata.';
  })();
  function persistPend() { lsSet(LSK, pend.ops.length || pend.rev ? pend : null); }
  var ui = { tab: 'classifica', team: null, gf: '', lg: '', ld: '', lfree: false, lq: '', adm: 'asta', lid: '', cl: 'gen' };
  var saved = lsGet(UIK);
  if (saved) Object.keys(ui).forEach(function (k) { if (saved[k] != null && k !== 'lq') ui[k] = saved[k]; });
  var lidChosen = !!(saved && saved.lid);
  var hash = (location.hash || '').slice(1);
  if (['classifica', 'squadre', 'gare', 'listone', 'regole'].indexOf(hash) >= 0) ui.tab = hash;
  function saveUi() { lsSet(UIK, { tab: ui.tab, team: ui.team, gf: ui.gf, lg: ui.lg, ld: ui.ld, lfree: ui.lfree, adm: ui.adm, lid: ui.lid, cl: ui.cl }); }

  function setView() {
    if (!FS.findBy(ROOT.leagues, ui.lid)) ui.lid = ROOT.leagues[0].id;
    S = FS.view(ROOT, ui.lid);
    C = FS.compute(S);
  }
  function rebuild() {
    var r = FS.applyAll(PUB, pend.ops);
    ROOT = r.S;
    if (r.dropped) {
      pend.ops = r.kept;
      bootNote = bootNote || (r.dropped === 1 ? 'Una modifica non salvata non era più valida ed è stata scartata.' : r.dropped + ' modifiche non salvate non erano più valide e sono state scartate.');
    }
    persistPend();
    setView();
  }
  rebuild();
  var tmp = { race: null, scrolled: false, at: null, aq: '', ath: null, price: '', rr: null, parsed: null, paste: '', rel: null, ea: null, eq: '', er: null, lu: null, allRaces: false };

  // ---------- runtime capabilities: publishing needs edit rights; identity links a team to a person
  var ART = null, CAN = false, OWNER = false, ME = null, saving = false, discardArm = false;
  function initCaps() {
    var cl = window.claude;
    if (!cl || typeof cl.use !== 'function') return;
    Promise.all([cl.use('artifact'), cl.use('user')]).then(function (x) {
      ART = x[0];
      var user = x[1];
      if (!ART || !user) return [false, false, null];
      return Promise.all([user.canEdit(), user.isOwner(), user.id()]);
    }).then(function (v) {
      CAN = !!v[0]; OWNER = !!v[1]; ME = v[2] || null;
      if (ME && !lidChosen) {
        var my = ROOT.leagues.filter(function (lg) { return lg.teams.some(function (t) { return t.uid === ME; }); })[0];
        if (my && my.id !== ui.lid) { ui.lid = my.id; setView(); }
      }
      render();
      // lineups and team links are saved at once: if one was left unsaved (two people saving together), send it again
      if (CAN && pend.ops.length && pend.ops.every(function (o) { return o.k === 'lu' || o.k === 'claim'; })) save();
    }).catch(function () { });
  }

  function doOp(op) {
    if (FS.LEAGUE_OPS[op.k] && !op.lg) op.lg = S.lid;
    if (!FS.applyOp(ROOT, op)) { toast('Questa modifica non è possibile.'); return false; }
    pend.ops.push(op); persistPend(); setView(); return true;
  }
  function save() {
    if (!ART || !CAN || saving || !pend.ops.length) return;
    saving = true; renderSaveBar();
    var rev = FS.rid('r');
    var next = FS.clone(ROOT);
    next.rev = rev; next.updated = new Date().toISOString();
    pend.rev = rev; persistPend();
    ART.publish(buildDoc(next)).then(function () {
      // the shell reloads every view to the new version; until it does, show the saved state here
      PUB = next; pend = { ops: [], rev: null }; persistPend(); saving = false; rebuild(); render();
      toast('Salvato. La pagina si aggiorna per tutti.');
    }).catch(function (e) {
      saving = false; pend.rev = null; persistPend();
      var c = e && e.code;
      if (c === 'conflict') toast('Qualcun altro ha salvato nello stesso momento. Le tue modifiche restano qui: ricontrolla e salva di nuovo.');
      else if (c === 'not_writer' || c === 'not_granted' || c === 'consent_required' || c === 'capability_disabled' || c === 'capability_removed' || c === 'not_declared') { CAN = false; toast('Questa pagina per te è in sola lettura.'); render(); }
      else if (c === 'rate_limited') toast('Troppi salvataggi ravvicinati: aspetta qualche secondo e riprova.');
      else if (c === 'too_large') toast('La pagina è diventata troppo grande per essere salvata.');
      else toast('Salvataggio non riuscito. Riprova tra poco.');
      renderSaveBar();
    });
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
  function canLineup(tid) { if (!CAN) return false; if (OWNER || !ME) return true; var t = team(tid); return !!t && t.uid === ME; }
  var DISC = { GS: 'Gigante', SL: 'Slalom', DH: 'Discesa', SG: 'SuperG' };
  var DCODES = ['DH', 'SG', 'GS', 'SL'];
  var GLAB = { M: 'Uomini', F: 'Donne' };
  function best(a) { var b = 0, bi = -1; (a.p || []).forEach(function (v, i) { if (v > b) { b = v; bi = i; } }); return bi >= 0 ? DCODES[bi] : null; }
  function bib(a) { var d = best(a); return '<span class="bib ' + (d ? FS.CAT[d] : 'N') + '" title="' + (d ? 'Specialità: ' + DISC[d] : 'Nessun punto nell\'ultima stagione') + '">' + (d || '–') + '</span>'; }
  function disc(t) { return '<span class="disc ' + FS.CAT[t] + '" title="' + DISC[t] + '">' + t + '</span>'; }
  // injuries and absences (data/status.json, or Gestione → Atleti): out = misses the season, long = injured with an
  // uncertain return, short = misses the first races, doubt = may miss the first races
  var INJ = { out: 'Stagione finita', long: 'Infortunato', short: 'Salta le prime gare', doubt: 'In dubbio' };
  var INJOPT = [['', 'Disponibile'], ['doubt', 'In dubbio per le prime gare'], ['short', 'Salta le prime gare'], ['long', 'Infortunato, rientro incerto'], ['out', 'Fuori per tutta la stagione']];
  function injTag(a) { return a && INJ[a.inj] ? ' <span class="injt ' + a.inj + '" title="' + esc(a.note || '') + '">' + INJ[a.inj] + '</span>' : ''; }
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
      '<span>Ultimo salvataggio: ' + (PUB.updated ? esc(tlab(Date.parse(PUB.updated))) : '—') + '</span></footer>';
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
          (r.t.owner ? '<span class="to">' + esc(r.t.owner) + '</span>' : '') + '</span><span class="last num">' + (st.lg ? fmt(r.last) : '–') + '</span><span class="tot num">' + fmt(r.tot) + '</span></button></li>';
      }).join('') + '</ol>';
    }
    h += '</section>';
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
      h += '<div class="luath">' + bib(a) + '<span class="an">' + esc(a.n) + ' <span class="nat">' + esc(a.c) + '</span>' + injTag(a) + '<span class="lmeta">' + r.t + ' ' + esc(a.tpy || '25/26') + ': <span class="num">' + (a.p ? a.p[di] : 0) + '</span> pt' + (a.inj ? ' · ' + esc(a.note || '') : '') + '</span></span>' +
        '<span class="seg" role="group" aria-label="Scelta per ' + esc(a.n) + '">' + segBtn(aid, 'T', 'Titolare', s) + segBtn(aid, 'R', 'Riserva', s) + segBtn(aid, '', 'Fuori', s) + '</span></div>';
    });
    h += '<div class="acts between"><span class="small muted">Titolari ' + nT + '/' + max + ' · riserva ' + nR + '/1</span><span class="acts"><button type="button" class="btn ghost" data-act="luclose">Annulla</button>' +
      '<button type="button" class="btn red" data-act="lusave"' + (nT ? '' : ' disabled') + '>Salva formazione</button></span></div></div>';
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
    var tid = ui.team && team(ui.team) ? ui.team : (mine ? mine.id : S.teams[0].id);
    var t = team(tid), ts = FS.teamState(S, tid), tt = C.T[tid] || { total: 0, byC: { T: 0, V: 0 }, byA: {} };
    var h = '<section class="sec"><div class="chips scroll">' + S.teams.map(function (x) { return '<button type="button" class="chip' + (x.id === tid ? ' on' : '') + '" data-act="tsel" data-v="' + x.id + '">' + esc(x.name) + (mine && mine.id === x.id ? ' · tu' : '') + '</button>'; }).join('') + '</div>';
    h += '<div class="thead"><div><div class="lbl">' + (mine && mine.id === tid ? 'La tua squadra' : t.owner ? esc(t.owner) : 'Squadra') + '</div><h1 class="h1">' + esc(t.name) + '</h1></div><div class="tstats">' +
      stat('Punti', fmt(tt.total)) + stat('Tecniche', fmt(tt.byC.T)) + stat('Veloci', fmt(tt.byC.V)) + stat('Crediti', ts.credits) + stat('Rosa', ts.size + '/' + ts.max) + '</div></div>';
    if (CAN && ME && !t.uid && !mine) h += '<div class="capbox"><span>È la tua squadra? Collegala al tuo account per scegliere le formazioni.</span><button type="button" class="btn ghost" data-act="claim" data-v="' + tid + '">Sì, è la mia</button></div>';
    FS.GENDERS.forEach(function (g) {
      var rows = ts.roster.filter(function (p) { var a = ath(p.a); return a && a.g === g; });
      h += '<div class="rg"><div class="rgh"><span class="lbl">' + GLAB[g] + '</span><span class="num small muted">' + rows.length + '/' + ts.per + '</span></div>';
      rows.forEach(function (p) {
        var a = ath(p.a);
        h += '<div class="arow">' + bib(a) + '<span class="an">' + esc(a.n) + ' <span class="nat">' + esc(a.c) + '</span>' + injTag(a) + '<span class="lmeta">' + esc(a.tpy || '25/26') + ': ' + dpts(a) + '</span>' +
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
      if (OWNER && r.d <= todayRome()) h += '<div class="acts"><button type="button" class="mini" data-act="gores" data-v="' + r.id + '">Inserisci risultati</button></div>';
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
      return '<div class="lrow">' + bib(a) + '<span><span class="an">' + esc(a.n) + '</span> <span class="nat">' + esc(a.c) + '</span>' + injTag(a) + '<span class="lmeta">' + (a.g === 'M' ? 'Uomo' : 'Donna') + ' · ' + esc(a.tpy || '25/26') + ': ' + dpts(a) +
        (cur ? ' · 26/27: <span class="num">' + cur + '</span> pt' : '') + '</span>' + (a.note ? '<span class="note">' + esc(a.note) + '</span>' : '') +
        (o ? '<span class="own">' + esc(tname(o.t)) + ' · ' + o.price + ' cr</span>' : '<span class="own free">Libero</span>') + '</span><span class="lq num"><small>Quot.</small>' + a.q + '</span></div>';
    }).join('');
    return h;
  }
  function vListone() {
    var h = '<section class="sec"><div class="lbl">Listone</div><h1 class="h1">Atleti e quotazioni</h1><p class="sub">Quotazione = punti di Coppa 2025/26 in tutte le discipline diviso 20, minimo 1. È il prezzo di partenza all\'asta. La sigla colorata è la disciplina in cui l\'atleta ha fatto più punti. Le etichette segnalano infortuni e assenze, con i dettagli sotto il nome.</p>';
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
  // the races with a multiplier, from the calendar: "uomini: Kitzbühel (discesa), …; donne: Cortina (discesa, superG), finali di Sun Valley"
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
      block('Rosa', ['Ogni squadra ha ' + per + ' uomini e ' + per + ' donne, senza vincoli di disciplina: puoi prendere solo slalomisti o solo discesisti.']) +
      block('Asta', ['Ogni squadra ha ' + L.budget + ' crediti e ogni atleta può stare in una sola squadra.',
        'Offerta massima = crediti residui − posti vuoti + 1, così nessuno resta con la rosa incompleta.',
        'La quotazione del listone è il prezzo di partenza: punti di Coppa 2025/26 diviso 20, minimo 1.',
        'Se nessuna squadra può arrivare alla quotazione, o chi può arrivarci rinuncia, l\'atleta riparte da 1, e chi ha rinunciato non può più offrire per lui.']) +
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
    var secs = [['asta', 'Asta e mercato'], ['ris', 'Risultati'], ['squadre', 'Squadre'], ['gare', 'Calendario'], ['atleti', 'Atleti'], ['imp', 'Impostazioni'], ['leghe', 'Leghe']];
    var h = '<section class="sec"><div class="lbl">Gestione</div><h1 class="h1">Pannello della lega</h1><p class="sub">Le modifiche restano su questo dispositivo finché non premi Salva nella barra in basso. Le formazioni invece si salvano subito.</p>';
    h += '<div class="chips scroll">' + chipset('adm', secs, ui.adm) + '</div>';
    if (ROOT.leagues.length > 1 && ['asta', 'squadre', 'imp'].indexOf(ui.adm) >= 0) h += '<p class="small muted">Lega: <b>' + esc(S.league.name || 'Lega') + '</b>. Calendario, atleti e risultati valgono per tutte le leghe.</p>';
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
      return '<button type="button" class="hit' + (full ? ' dis' : '') + '" data-act="apick" data-v="' + a.id + '">' + bib(a) + '<span class="an">' + esc(a.n) + ' <span class="nat">' + esc(a.c) + ' · ' + a.g + '</span>' + injTag(a) +
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
    return '<div class="pick"><div class="pickh">' + bib(a) + '<div><b>' + esc(a.n) + '</b> <span class="nat">' + esc(a.c) + '</span>' + injTag(a) + '<div class="small muted">' + GLAB[a.g] + ' · ' + dpts(a) + ' · quotazione ' + a.q + '</div>' + (a.note ? '<div class="note">' + esc(a.note) + '</div>' : '') + '</div></div>' + reachLine(a) +
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
    var h = '<div class="tlist">' + S.teams.map(function (t) {
      var used = S.purchases.some(function (p) { return p.t === t.id; });
      return '<div class="trow"><input id="tn-' + t.id + '" class="in" value="' + esc(t.name) + '" data-chg="tn" data-v="' + t.id + '" aria-label="Nome squadra"><input id="to-' + t.id + '" class="in owner" value="' + esc(t.owner) + '" placeholder="Partecipante" data-chg="to" data-v="' + t.id + '" aria-label="Partecipante">' +
        '<span class="acts">' + (t.uid ? '<button type="button" class="mini" data-act="unclaim" data-v="' + t.id + '" title="Scollega l\'account che ha preso questa squadra">Scollega</button>' : '<span class="small muted">libera</span>') +
        (used ? '' : '<button type="button" class="mini" data-act="tdel" data-v="' + t.id + '">Togli</button>') + '</span></div>';
    }).join('') + '</div>';
    return h + '<div class="acts gap"><button type="button" class="btn ghost" data-act="tadd">Aggiungi squadra</button><span class="hint">Ogni partecipante, aprendo la pagina, collega la sua squadra al proprio account con "Sì, è la mia" e da lì sceglie le formazioni.</span></div>';
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
    return arr.map(function (a) { return '<button type="button" class="hit" data-act="epick" data-v="' + a.id + '">' + bib(a) + '<span class="an">' + esc(a.n) + ' <span class="nat">' + esc(a.c) + ' · ' + a.g + '</span>' + (a.hide ? ' <span class="small muted">escluso</span>' : '') + injTag(a) + '</span><span class="lq num"><small>Quot.</small>' + a.q + '</span></button>'; }).join('');
  }
  function aAtleti() {
    var h = '<div class="stack"><label class="field" for="eq"><span>Cerca atleta</span><input id="eq" class="in" type="search" autocomplete="off" value="' + esc(tmp.eq) + '" placeholder="Nome o nazione"></label><div id="elist">' + athEditList() + '</div>';
    var a = tmp.ea && ath(tmp.ea);
    if (a) {
      h += '<div class="pick"><div class="pickh">' + bib(a) + '<div><b>' + esc(a.n) + '</b> <span class="nat">' + esc(a.c) + '</span><div class="small muted">' + dpts(a) + '</div></div></div><div class="grid2">' +
        '<label class="field" for="xq"><span>Quotazione</span><input id="xq" class="in" type="number" min="1" value="' + a.q + '"></label>' +
        '<label class="field" for="xc"><span>Nazione</span><input id="xc" class="in" maxlength="3" value="' + esc(a.c) + '"></label></div>' +
        '<label class="field" for="xs"><span>Stato</span><select id="xs" class="in">' + INJOPT.map(function (o) { return '<option value="' + o[0] + '"' + ((a.inj || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
        '<label class="field" for="xn"><span>Nota</span><input id="xn" class="in" value="' + esc(a.note || '') + '" placeholder="es. Infortunio al ginocchio, rientro a gennaio"></label>' +
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
  function aLeghe() {
    var h = '<div class="stack"><p class="small muted">Calendario, atleti e risultati sono uguali per tutte le leghe: i risultati si inseriscono una volta sola. Ogni lega ha le sue squadre, la sua asta, le sue formazioni e le sue regole. Chi apre la pagina vede tutte le leghe e può schierare solo la squadra che ha collegato al suo account.</p><div class="tlist">';
    h += ROOT.leagues.map(function (lg) {
      var on = lg.id === S.lid, n = lg.purchases.filter(function (p) { return !p.to; }).length;
      return '<div class="trow"><input id="ln-' + esc(lg.id) + '" class="in" value="' + esc(lg.league.name || '') + '" data-chg="lgname" data-v="' + esc(lg.id) + '" aria-label="Nome della lega">' +
        '<span class="small muted owner">' + lg.teams.length + ' squadre · ' + n + ' atleti</span><span class="acts">' +
        (on ? '<span class="small muted">aperta</span>' : '<button type="button" class="mini" data-act="lgopen" data-v="' + esc(lg.id) + '">Apri</button>') +
        (ROOT.leagues.length > 1 && !lg.purchases.length ? '<button type="button" class="mini" data-act="lgdel" data-v="' + esc(lg.id) + '">Elimina</button>' : '') + '</span></div>';
    }).join('') + '</div>';
    h += '<div class="panel"><div class="lbl">Nuova lega</div><div class="grid2 gap"><label class="field" for="lgn"><span>Nome</span><input id="lgn" class="in" placeholder="es. Amici"></label>' +
      '<label class="field" for="lgt"><span>Squadre</span><input id="lgt" class="in" type="number" min="2" max="20" value="8"></label></div>' +
      '<p class="hint gap">Parte con le regole, i bonus e i malus della lega aperta ora («' + esc(S.league.name || 'Lega') + '»), che poi puoi cambiare in Impostazioni.</p>' +
      '<div class="acts gap"><button type="button" class="btn ghost" data-act="lgadd">Crea lega</button></div></div>';
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

  // ---------- render
  function view(tab) {
    return ({ classifica: vClassifica, squadre: vSquadre, gare: vGare, listone: vListone, regole: vRegole, gestione: vGestione }[tab] || vClassifica)();
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
    var tab = (!OWNER && ui.tab === 'gestione') ? 'classifica' : ui.tab;
    var nav0 = D.querySelector('.tabs'), navX = nav0 ? nav0.scrollLeft : 0;
    APP.innerHTML = header(tab) + '<main class="wrap" id="main">' + view(tab) + footer() + '</main>';
    keepTabs(navX);
    renderSaveBar();
    if (tab === 'gare' && !tmp.scrolled) {
      tmp.scrolled = true;
      var g = curG(), el = g && D.getElementById('g-' + g.k);
      if (el && g.n > 1) el.scrollIntoView({ block: 'start' });
    }
  }
  function renderSaveBar() {
    var el = D.getElementById('fs-savebar');
    if (!el) return;
    var n = pend.ops.length;
    if (!n) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<div class="sb-in"><span>' + (CAN ? (n === 1 ? '1 modifica da salvare' : n + ' modifiche da salvare') : 'Modifiche su questo dispositivo che il tuo account non può salvare') + '</span><span class="acts">' +
      '<button type="button" class="btn inv ghost" data-act="discard">' + (discardArm ? 'Sì, scarta tutto' : 'Scarta') + '</button>' +
      (CAN ? '<button type="button" class="btn inv" data-act="save"' + (saving ? ' disabled' : '') + '>' + (saving ? 'Salvataggio…' : 'Salva') + '</button>' : '') + '</span></div>';
  }
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
    if (act !== 'discard' && discardArm) { discardArm = false; renderSaveBar(); }
    var a, r, p, price, list, mt;
    switch (act) {
      case 'tab': go(v); break;
      case 'team': ui.team = v; tmp.lu = null; go('squadre'); break;
      case 'tsel': ui.team = v; tmp.rel = null; tmp.lu = null; saveUi(); render(); break;
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
        if (!ME) break;
        if (doOp({ k: 'claim', t: v, uid: ME })) { ui.team = v; saveUi(); toast('Squadra collegata al tuo account.'); render(); save(); }
        break;
      case 'unclaim': if (doOp({ k: 'teamSet', id: v, uid: '' })) render(); break;
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
        if (!tmp.lu) break;
        r = race(tmp.lu.r);
        if (!r || lockOf(r) <= now()) { toast('Per questa gara la formazione è già chiusa.'); tmp.lu = null; render(); break; }
        var s2 = tmp.lu.sel, tit = Object.keys(s2).filter(function (k) { return s2[k] === 'T'; }), rr = Object.keys(s2).filter(function (k) { return s2[k] === 'R'; })[0] || null;
        if (doOp({ k: 'lu', r: r.id, t: tmp.lu.t, lu: { t: tit, r: rr } })) {
          toast('Formazione per ' + r.t + ' ' + r.v + ' salvata.');
          tmp.lu = null; render(); save();
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
        if (doOp({ k: 'release', id: v, ts: new Date().toISOString(), refund: Math.floor(p.price * (S.league.refundPct || 0) / 100) })) { tmp.rel = null; toast('Svincolo pronto: premi Salva per confermarlo.'); render(); }
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
        if (doOp({ k: 'res', r: r.id, list: list, dns: dnsList, dnf: dnfList, nc: ncList, src: tmp.parsed.src || 'manuale', at: new Date().toISOString() })) { tmp.parsed = null; tmp.paste = ''; toast('Risultati pronti: premi Salva per pubblicarli.'); render(); }
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
        if (doOp({ k: 'athSet', a: a.id, f: { q: q >= 1 ? q : a.q, c: val('xc').trim().toUpperCase() || a.c, note: val('xn').trim(), inj: INJ[val('xs')] ? val('xs') : '', hide: !!(D.getElementById('xh') || {}).checked } })) { toast('Atleta aggiornato.'); render(); }
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
          malusDnf: bval('mdf', S.league.malusDnf), malusTop: bval('mtp', S.league.malusTop), malusLead: bval('mld', S.league.malusLead), topGroup: Math.min(30, Math.max(1, parseInt(val('tgp'), 10) || S.league.topGroup || 7)) } })) { toast('Impostazioni aggiornate: premi Salva per applicarle.'); render(); }
        break;
      case 'lgopen': ui.lid = v; saveUi(); tmp.lu = null; tmp.rel = null; setView(); render(); break;
      case 'lgdel':
        if (doOp({ k: 'lgDel', id: v })) { toast('Lega eliminata: premi Salva per confermare.'); render(); }
        break;
      case 'lgadd':
        var lgn = val('lgn').trim(), lgt = parseInt(val('lgt'), 10);
        if (!lgn) { toast('Dai un nome alla nuova lega.'); break; }
        if (!(lgt >= 2 && lgt <= 20)) lgt = 8;
        var base = FS.clone(S.league), lid = FS.rid('l'), tms = [];
        base.name = lgn; base.auctionOpen = true;
        for (var ti = 1; ti <= lgt; ti++) tms.push({ id: FS.rid('t'), name: 'Squadra ' + ti, owner: '' });
        if (doOp({ k: 'lgAdd', item: { id: lid, league: base, teams: tms, purchases: [], lineups: {} } })) {
          ui.lid = lid; saveUi(); setView(); toast('Lega «' + lgn + '» creata: premi Salva per pubblicarla.'); render();
        }
        break;
      case 'save': save(); break;
      case 'discard':
        if (!discardArm) { discardArm = true; renderSaveBar(); break; }
        discardArm = false; pend = { ops: [], rev: null }; persistPend(); rebuild(); tmp.parsed = null; tmp.rel = null; tmp.lu = null; render(); toast('Modifiche scartate.');
        break;
    }
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
    else if (c === 'rsel') { tmp.rr = el.value; tmp.parsed = null; tmp.paste = ''; render(); }
    else if (c === 'esel') { tmp.er = el.value; render(); }
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
  var sb = D.createElement('div'); sb.id = 'fs-savebar'; sb.hidden = true; D.body.appendChild(sb);
  var tt = D.createElement('div'); tt.id = 'fs-toast'; tt.setAttribute('role', 'status'); tt.setAttribute('aria-live', 'polite'); tt.hidden = true; D.body.appendChild(tt);
  render();
  if (bootNote) toast(bootNote);
  initCaps();
})();
