// The real site/src/db.js against a stand-in Firebase (fakefire.js, with a port of firestore.rules).
// Build first: python3 site/build_site.py --out <scratchpad>/dist_fire --from-page fanta-ski.html
// Flow A: accounts with usernames, league created on the site, team picker, the organiser moves a player, auction,
//   lineup before and after the deadline, archive, results, postponed race, who may create leagues, invite link.
// Flow B: league imported from the old page, people take their teams, imported lineups reach their owners.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const SP = '/tmp/claude-0/-home-claude/fc963d46-bd1f-52ac-bbc1-9c85f5597a3b/scratchpad/';
const DIST = SP + 'dist_fire';
const FAKE = fs.readFileSync('/home/claude/fantaski/tests/fakefire.js');
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const FSM = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(/.*/, r => r.abort());
  await ctx.route(/^https:\/\/www\.gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: FAKE }));
  await ctx.route(/^http:\/\/site\.test\//, r => {
    let p = new URL(r.request().url()).pathname; if (p === '/') p = '/index.html';
    if (p === '/config.js') return r.fulfill({ contentType: 'text/javascript', body: 'window.FS_CONFIG={firebase:{apiKey:"fake",projectId:"fake"}};' });
    const f = path.join(DIST, p);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'no' });
    r.fulfill({ contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push('console: ' + m.text()); });
  return page;
}
function helpers(page) {
  const H = {
    txt: () => page.textContent('#app'),
    click: s => page.click(s),
    wait: ms => page.waitForTimeout(ms || 80),
    docs: () => page.evaluate(() => JSON.parse(JSON.stringify(window.__fake.docs))),
    uid: email => page.evaluate(e => Object.values(window.__fake.accounts).find(a => a.email === e).uid, email),
    lids: async () => Object.keys(await H.docs()).filter(k => /^leagues\/[^/]+$/.test(k)).map(k => k.split('/')[1]),
    denies: () => page.evaluate(() => window.__fake.log.slice()),
    reads: () => page.evaluate(() => window.__fake.reads),
    // a raw Firestore call as the signed-in account, to check what the rules allow
    raw: (fn, arg) => page.evaluate(([src, a]) => import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js').then(m => (new Function('m', 'a', 'db', src))(m, a, m.getFirestore())).then(() => 'ok', e => e.code), [fn, arg]),
    // email and password, then the username
    async register(name, email, pw) {
      if (!(await page.$('form[data-form="register"]'))) await H.click('[data-act="authtab"][data-v="register"]');
      await page.fill('#re', email); await page.fill('#rp', pw);
      await H.click('form[data-form="register"] button[type="submit"]'); await H.wait(400);
      if (name && await page.$('form[data-form="uname"]')) { await page.fill('#un', name); await H.click('form[data-form="uname"] button[type="submit"]'); await H.wait(400); }
    },
    async login(email, pw) {
      await page.fill('#le', email); await page.fill('#lp', pw);
      await H.click('form[data-form="login"] button[type="submit"]'); await H.wait(400);
    },
    async logout() { await H.click('[data-act="logout"]'); await H.wait(250); },
    async pick(name) { await H.click('button.pickrow:has-text("' + name + '")'); await H.click('[data-act="pickok"]'); await H.wait(400); }
  };
  return H;
}

async function flowA(browser) {
  console.log('--- A: league made on the site');
  const page = await newPage(browser), H = helpers(page);
  await page.clock.setFixedTime(new Date('2026-10-19T10:00:00Z'));
  await page.goto('http://site.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form[data-form="login"]');
  await H.register('', 'werner@example.it', '123');
  ok(/almeno 6 caratteri/.test(await H.txt()), 'short password refused');
  await H.register('', 'werner@example.it', 'segreta1');
  ok(/Scegli il tuo username/.test(await H.txt()), 'account created: the username comes next');
  const wUid = await H.uid('werner@example.it');
  // the rules: a name in the profile only once it is reserved for this account
  ok(await H.raw("return m.setDoc(m.doc(db, 'users', a), { name: 'Werner' }, { merge: true })", wUid) === 'permission-denied', 'rules: a username not reserved cannot go in the profile');
  await page.fill('#un', 'Werner'); await H.click('form[data-form="uname"] button[type="submit"]'); await H.wait(400);
  let D = await H.docs();
  ok(D['usernames/werner'] && D['usernames/werner'].uid === wUid && D['users/' + wUid].name === 'Werner', 'username reserved (usernames/werner) and saved in the profile');
  ok(/Come vuoi giocare/.test(await H.txt()) && await page.$('.opt.locked') && /Diventa amministratore/.test(await H.txt()), 'home: locked creation, first-administrator button');
  await H.click('[data-act="claimadmin"]'); await H.wait(300);
  await page.fill('#lgn', 'Ski Team Paganella'); await page.fill('#lgt', '7');
  await H.click('form[data-form="create"] button[type="submit"]'); await H.wait(500);
  D = await H.docs(); const lid = (await H.lids())[0]; const L0 = D['leagues/' + lid];
  ok(L0 && L0.name === 'Ski Team Paganella' && Object.keys(L0.locks).length === 83 && D['codes/' + L0.code] && Object.keys(D).filter(k => k.startsWith('leagues/' + lid + '/teams/')).length === 7,
    'league document with 83 deadlines, invite code and 7 teams');
  ok(D['leagues/' + lid + '/members/' + wUid].name === 'Werner', 'the organiser is a member under his username');
  ok(/Codice invito/.test(await H.txt()) && (await page.textContent('.codev')).trim() === L0.code, 'Gestione shows the code ' + L0.code);
  const code = L0.code;
  const teamId = n => Object.keys(D).find(k => k.startsWith('leagues/' + lid + '/teams/') && D[k].name === n).split('/').pop();

  // Nico: username taken, creation locked (also in the database), code, team picker
  await H.logout();
  await H.register('werner', 'nico@example.it', 'nicopass');
  ok(/già preso/.test(await H.txt()), 'a username already taken is refused');
  const nUid = await H.uid('nico@example.it');
  ok(await H.raw("const b = m.writeBatch(db); b.set(m.doc(db, 'usernames', 'werner'), { uid: a }); b.set(m.doc(db, 'users', a), { name: 'werner' }, { merge: true }); return b.commit();", nUid) === 'permission-denied', 'rules: nobody can take over a reserved username');
  await page.fill('#un', 'Nico'); await H.click('form[data-form="uname"] button[type="submit"]'); await H.wait(400);
  ok(await page.$('.opt.locked') && !/Diventa amministratore/.test(await H.txt()), 'player home: creation locked, no administrator button');
  const made = await page.evaluate(() => window.DB.createLeague('Pirata', 4, {}).then(() => 'made', e => e.code));
  ok(made === 'permission-denied', 'rules: a player cannot create a league');
  ok(await H.raw("return m.setDoc(m.doc(db, 'config', 'site'), { openLeagues: true })") === 'permission-denied', 'rules: a player cannot open league creation');
  await page.fill('#jc', 'XXXXXX'); await H.click('form[data-form="join"] button[type="submit"]'); await H.wait(300);
  ok(/Codice non valido/.test(await H.txt()), 'wrong code refused');
  await page.fill('#jc', code.toLowerCase()); await H.click('form[data-form="join"] button[type="submit"]'); await H.wait(600);
  ok(/Quale squadra sei/.test(await H.txt()) && (await page.$$('button.pickrow')).length === 7, 'inside: the picker with 7 free teams');
  await H.pick('Squadra 3');
  ok(/La tua squadra/.test(await H.txt()) && !(await page.$('#tab-gestione')), 'Nico took Squadra 3, no Gestione for him');
  D = await H.docs();
  const nicoTeam = teamId('Squadra 3');
  ok(D['leagues/' + lid + '/teams/' + nicoTeam].uid === nUid && D['leagues/' + lid + '/members/' + nUid].team === nicoTeam, 'team and member point to each other');
  const second = await page.evaluate(([l, t]) => window.DB.claimTeam(l, t).then(() => 'taken', e => e.code), [lid, teamId('Squadra 6')]);
  ok(second === 'permission-denied', 'rules: a second team is refused');
  ok(await H.raw("return m.updateDoc(m.doc(db, 'leagues', a, 'members', '" + nUid + "'), { name: 'Werner' })", lid) === 'permission-denied', 'rules: the name in the league must be one\'s own username');

  // Pietro takes the wrong team; Werner moves him
  await H.logout();
  await H.register('Pietro', 'pietro@example.it', 'pietropass');
  await page.fill('#jc', code); await H.click('form[data-form="join"] button[type="submit"]'); await H.wait(600);
  ok(/di Nico/.test(await H.txt()), 'the picker shows Squadra 3 as Nico\'s');
  await H.pick('Squadra 4');
  const pUid = await H.uid('pietro@example.it');
  await H.logout();
  await H.login('werner@example.it', 'sbagliata');
  ok(/Email o password sbagliate/.test(await H.txt()), 'wrong password refused');
  await H.login('werner@example.it', 'segreta1');
  ok(!(await page.$('.picks')), 'no picker for the organiser');
  await H.click('#tab-gestione'); await H.click('[data-act="adm"][data-v="squadre"]'); await H.wait(150);
  await page.selectOption('#asg-' + teamId('Squadra 5'), pUid); await H.wait(500);
  D = await H.docs();
  ok(D['leagues/' + lid + '/teams/' + teamId('Squadra 5')].uid === pUid && D['leagues/' + lid + '/teams/' + teamId('Squadra 4')].uid === null
    && D['leagues/' + lid + '/members/' + pUid].team === teamId('Squadra 5') && !D['leagues/' + lid + '/teams/' + teamId('Squadra 4')].owner, 'Werner moved Pietro from Squadra 4 to Squadra 5');

  // auction
  await H.click('[data-act="adm"][data-v="asta"]');
  await H.click('[data-act="at"][data-v="' + nicoTeam + '"]');
  for (const n of ['Odermatt', 'Meillard', 'Kristoffersen']) {
    await page.fill('#aq', n); await H.click('#alist [data-act="apick"]'); await H.click('#abuy'); await H.wait(150);
  }
  D = await H.docs();
  ok(Object.keys(D['leagues/' + lid].market).length === 3, 'three purchases in the league document');
  ok(Object.values(D['leagues/' + lid].market).find(p => p.a === 'm-marco-odermatt').price === 81, 'Odermatt at his quotation, 81');

  // Nico's lineup
  await H.logout();
  await H.login('nico@example.it', 'nicopass');
  await H.click('#tab-squadre'); await H.wait(150);
  await H.click('[data-act="luopen"][data-v^="m01|"]');
  await H.click('[data-act="lusel"][data-v="m-marco-odermatt|R"]');
  await H.click('[data-act="lusel"][data-v="m-loic-meillard|T"]');
  await H.click('[data-act="lusel"][data-v="m-henrik-kristoffersen|T"]');
  await H.click('[data-act="lusave"]'); await H.wait(400);
  D = await H.docs();
  const lu = D['leagues/' + lid + '/races/m01/lineups/' + nicoTeam], pend = D['leagues/' + lid + '/pending/' + nicoTeam];
  ok(lu && lu.t.join() === 'm-loic-meillard,m-henrik-kristoffersen' && lu.r === 'm-marco-odermatt' && lu.uid === nUid, 'lineup document written');
  ok(pend && pend.m01 && pend.m01.r === 'm-marco-odermatt', 'copy for the team in pending');
  ok(/Formazione per GS Sölden salvata/.test(await page.textContent('#fs-toast')), 'saved message after the database accepted it');
  await page.reload({ waitUntil: 'domcontentloaded' }); await H.wait(500);
  await H.click('#tab-squadre'); await H.wait(150);
  ok(/Meillard, Kristoffersen/.test(await H.txt()), 'after reloading, the saved lineup is shown again');
  const foreign = await page.evaluate(([l, t]) => window.DB.op({ k: 'lu', lg: l, r: 'm02', t: t, lu: { t: [], r: null } }).then(() => 'saved', e => e.code), [lid, teamId('Squadra 5')]);
  ok(foreign === 'permission-denied', 'rules: nobody sets another team\'s lineup');

  await page.clock.setFixedTime(new Date('2026-10-25T08:30:00Z'));
  await H.click('#tab-classifica'); await H.click('#tab-squadre'); await H.wait(150);
  ok(!(await page.$('[data-act="luopen"][data-v^="m01|"]')), 'no editing after the deadline');
  const late = await page.evaluate(([l, t]) => window.DB.op({ k: 'lu', lg: l, r: 'm01', t: t, lu: { t: ['m-marco-odermatt'], r: null } }).then(() => 'saved', e => e.code), [lid, nicoTeam]);
  ok(late === 'permission-denied', 'rules: a late lineup is refused');

  // Werner: archive, results, standings, postponed race
  await H.logout();
  await H.login('werner@example.it', 'segreta1');
  await H.wait(600);
  D = await H.docs();
  const arch = D['leagues/' + lid].archive || {};
  ok(arch.m01 && arch.m01[nicoTeam] && arch.m01[nicoTeam].t.length === 2 && arch.f01 && !arch.m02, 'closed races copied into the league document (m01, f01), open ones not');
  await H.click('#tab-gestione'); await H.click('[data-act="adm"][data-v="ris"]');
  await page.selectOption('#rsel', 'm01');
  await page.fill('#rpaste', `1 3 512269 ODERMATT Marco 1997 SUI 1:07.12 1:08.21 2:15.33 100
2 7 512182 MEILLARD Loic 1996 SUI 1:07.40 1:08.10 2:15.50 +0.17 80
3 9 422304 KRISTOFFERSEN Henrik 1994 NOR 1:07.50 1:08.30 2:15.80 +0.47 60`);
  await H.click('[data-act="parse"]'); await H.click('[data-act="psave"]'); await H.wait(400);
  D = await H.docs();
  ok(D['results/m01'] && JSON.parse(D['results/m01'].json).list.length === 3, 'results saved as a correction document');
  await H.click('#tab-classifica'); await H.wait(150);
  ok(/Squadra 3Nico150150/.test(await H.txt()), 'standings: Nico\'s team 150');
  ok(/TecnicheSquadra 3150 pt/.test(await page.textContent('.cups')), 'technical cup: Squadra 3');
  await H.click('#tab-gare'); await H.click('[data-act="race"][data-v="m01"]'); await H.wait(150);
  ok(/Meillard · 2° · 90 = 80 \+ miglior 2ª manche 10/.test(await page.textContent('.rdet')), 'race detail with the lineup');
  await page.evaluate(() => window.DB.op({ k: 'raceSet', r: 'm01', f: { d: '2026-10-26' } }));
  await H.wait(600);
  D = await H.docs();
  ok(D['leagues/' + lid].locks.m01._ms === Date.UTC(2026, 9, 26, 8, 0) && !D['leagues/' + lid].archive.m01, 'postponed race: new deadline, copy dropped');
  await page.evaluate(() => window.DB.op({ k: 'raceSet', r: 'm01', f: { d: '2026-10-25' } }));
  await H.wait(800);
  D = await H.docs();
  ok(D['leagues/' + lid].locks.m01._ms === Date.UTC(2026, 9, 25, 8, 0) && D['leagues/' + lid].archive.m01 && D['leagues/' + lid].archive.m01[nicoTeam], 'moved back: deadline restored and lineups copied again');

  // who may create leagues: Werner opens it, Nico creates one, Werner manages it too, then closes it again
  await H.click('#tab-gestione'); await H.click('[data-act="adm"][data-v="leghe"]'); await H.wait(100);
  await H.click('[data-act="siteopen"][data-v="1"]'); await H.wait(300);
  ok((await H.docs())['config/site'].openLeagues === true, 'config/site: creation open to everyone');
  await H.logout();
  await H.login('nico@example.it', 'nicopass');
  await H.click('#tab-profilo'); await H.wait(100);
  await page.fill('#lgn', 'Lega di Nico'); await page.fill('#lgt', '4');
  await H.click('form[data-form="create"] button[type="submit"]'); await H.wait(600);
  const nl = (await H.lids()).find(x => x !== lid);
  ok(nl && (await H.docs())['leagues/' + nl].admin === nUid && await page.$('#tab-gestione'), 'Nico created and organises his own league');
  ok(await H.raw("return m.getDocs(m.collection(db, 'leagues'))") === 'permission-denied', 'rules: only the administrator lists every league');
  await H.logout();
  await H.login('werner@example.it', 'segreta1');
  await H.click('#tab-gestione'); await H.click('[data-act="adm"][data-v="leghe"]'); await H.click('[data-act="allload"]'); await H.wait(300);
  ok(/Lega di Nico/.test(await H.txt()), 'Werner sees Nico\'s league in the list');
  await H.click('[data-act="lgjoin"]'); await H.wait(600);
  ok(/LEGA DI NICO/i.test(await page.textContent('header')) && await page.$('#tab-gestione'), 'and can enter and manage it');
  const ren = await page.evaluate(l => window.DB.op({ k: 'set', lg: l, f: { name: 'Lega di Nico (vista da Werner)' } }).then(() => 'ok', e => e.code), nl);
  ok(ren === 'ok', 'rules: the site administrator can change any league');
  await H.click('#tab-gestione'); await H.click('[data-act="adm"][data-v="leghe"]'); await H.click('[data-act="siteopen"][data-v="0"]'); await H.wait(300);
  ok((await H.docs())['config/site'].openLeagues === false, 'creation closed again');

  // Nico renames himself: the league shows the new username
  await H.logout();
  await H.login('nico@example.it', 'nicopass');
  await H.click('#tab-profilo'); await page.fill('#pn', 'Nicola'); await H.click('form[data-form="rename"] button[type="submit"]'); await H.wait(500);
  D = await H.docs();
  ok(D['usernames/nicola'] && !D['usernames/nico'] && D['users/' + nUid].name === 'Nicola' && D['leagues/' + lid + '/members/' + nUid].name === 'Nicola', 'username changed: new one reserved, old one freed, league member renamed');

  // Nico names his own team; the rules allow only that (he is in two leagues: back to Ski Team Paganella first)
  if (await page.$('#lgsel')) { await page.selectOption('#lgsel', lid); await H.wait(300); }
  await H.click('#tab-squadre'); await H.wait(150);
  await H.click('[data-act="ren"]'); await page.fill('#trn', 'I Fulmini');
  await H.click('form[data-form="tname"] button[type="submit"]'); await H.wait(400);
  D = await H.docs();
  ok(D['leagues/' + lid + '/teams/' + nicoTeam].name === 'I Fulmini', 'Nico renamed his team «I Fulmini»');
  const t5 = teamId('Squadra 5');
  ok(await H.raw("return m.updateDoc(m.doc(db, 'leagues', a.l, 'teams', a.t), { name: 'Rubata' })", { l: lid, t: t5 }) === 'permission-denied', 'rules: nobody renames another team');
  ok(await H.raw("return m.updateDoc(m.doc(db, 'leagues', a.l, 'teams', a.t), { name: 'Fulmini 2', owner: 'Werner' })", { l: lid, t: nicoTeam }) === 'permission-denied', 'rules: with the name, nothing else changes');
  ok(await H.raw("return m.updateDoc(m.doc(db, 'leagues', a.l, 'teams', a.t), { name: 'x'.repeat(31) })", { l: lid, t: nicoTeam }) === 'permission-denied', 'rules: at most 30 characters');
  ok(await H.raw("return m.updateDoc(m.doc(db, 'leagues', a.l, 'teams', a.t), { name: '   ' })", { l: lid, t: nicoTeam }) === 'permission-denied', 'rules: not blank');

  // invite link: Dori signs up, picks the username, is asked for her team
  await H.logout();
  await page.goto('http://site.test/?invito=' + code, { waitUntil: 'domcontentloaded' }); await H.wait(400);
  ok(/Ti hanno invitato/.test(await H.txt()), 'invite link: sign-up with a note');
  await H.register('Dori', 'dori@example.it', 'doripass'); await H.wait(500);
  D = await H.docs();
  const dUid = await H.uid('dori@example.it');
  ok(D['leagues/' + lid + '/members/' + dUid] && D['leagues/' + lid + '/members/' + dUid].name === 'Dori' && /Quale squadra sei/.test(await H.txt()), 'Dori is in the league and asked for her team');
  const peek = await H.raw("return m.getDocs(m.collection(db, 'leagues', a, 'races', 'm02', 'lineups'))", lid);
  ok(peek === 'permission-denied', 'lineups of a race still open stay hidden');
  console.log('     reads in flow A:', await H.reads(), '· refused requests:', (await H.denies()).length);
  ok(!page.errors.length, 'no page errors ' + JSON.stringify(page.errors));
  await page.context().close();
}

async function flowB(browser) {
  console.log('--- B: league imported from the old page');
  const src = JSON.parse(fs.readFileSync(SP + 'leghe_test.json', 'utf8'));
  // give Nico's team (t1) a lineup for Sölden too, made of his men
  const t1men = src.leagues[0].purchases.filter(p => p.t === 't1' && p.a.startsWith('m-')).map(p => p.a);
  src.leagues[0].lineups.m01.t1 = { t: t1men.slice(0, 2), r: t1men[2] || null };
  fs.writeFileSync(SP + 'leghe_test_b.json', JSON.stringify(src));
  const page = await newPage(browser), H = helpers(page);
  await page.clock.setFixedTime(new Date('2026-10-19T10:00:00Z'));
  await page.goto('http://site.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form[data-form="login"]');
  await H.register('Werner', 'werner@example.it', 'segreta1');
  await H.click('[data-act="claimadmin"]'); await H.wait(300);
  await page.setInputFiles('#impf', SP + 'leghe_test_b.json'); await H.wait(300);
  ok(/7 squadre · 18 acquisti/.test(await H.txt()), 'import file read');
  await H.click('[data-act="impgo"][data-v="0"]'); await H.wait(800);
  let D = await H.docs(); const lid = (await H.lids())[0], L = D['leagues/' + lid];
  ok(L && Object.keys(L.market).length === 18 && Object.keys(L.locks).length === 83, 'league document with 18 purchases and the deadlines');
  ok(D['leagues/' + lid + '/teams/t3'] && D['leagues/' + lid + '/pending/t3'].m01 && D['leagues/' + lid + '/races/m01/lineups/t3'], 'teams, lineups and their copies imported');
  await H.click('#tab-squadre'); await H.wait(200);
  ok(/Squadra Werner/.test(await page.textContent('.thead')), 'Werner sees Squadra Werner first');
  await H.click('[data-act="claim"]'); await H.wait(400);
  ok(/La tua squadra/.test(await H.txt()), 'Werner took his team');
  const code = (await H.docs())['leagues/' + lid].code;
  await H.logout();
  await page.goto('http://site.test/?invito=' + code, { waitUntil: 'domcontentloaded' }); await H.wait(400);
  await H.register('Nico', 'nico@example.it', 'nicopass'); await H.wait(500);
  ok(/Quale squadra sei/.test(await H.txt()) && /Squadra Nico.*forse sei tu/.test(await H.txt()), 'Nico is asked for his team, Squadra Nico suggested');
  await H.pick('Squadra Nico');
  const t = await H.txt();
  const names = t1men.slice(0, 2).map(a => a.split('-').slice(-1)[0]);
  ok(/La tua squadra/.test(t) && /Pinheiro Braathen/.test(t), 'Nico has his athletes');
  ok(names.every(n => new RegExp(n, 'i').test(t)) && !/automatica/.test(t.split('Sölden')[1] || ''), 'the imported Sölden lineup reaches Nico: ' + names.join(', '));
  await H.click('#tab-classifica'); await H.wait(150);
  ok((await page.$$('.stand li')).length === 7, 'standings list 7 teams');
  console.log('     reads in flow B:', await H.reads(), '· refused requests:', JSON.stringify(await H.denies()));
  ok(!page.errors.length, 'no page errors ' + JSON.stringify(page.errors));
  await page.context().close();
}

// Flow C: the auction is closed and the teams are full. Each player sets only their own lineup; a player without a team
// is told why and what to do; the organiser sees who is not linked, links them, locks the free teams, is warned when the
// published rules are old, and corrects any lineup, also after the deadline.
const SHOTS = '/tmp/claude-0/-home-claude/6a1fd610-285d-5ec3-81bb-63f0103a1bd0/scratchpad/';
async function flowC(browser) {
  console.log('--- C: auction closed, players and organiser');
  const page = await newPage(browser), H = helpers(page);
  const shot = n => page.screenshot({ path: SHOTS + n + '.png', fullPage: true });
  await page.clock.setFixedTime(new Date('2026-10-23T18:00:00Z'));
  await page.goto('http://site.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('form[data-form="login"]');
  await H.register('Werner', 'werner@example.it', 'segreta1');
  await H.click('[data-act="claimadmin"]'); await H.wait(300);
  await page.fill('#lgn', 'Ski Team Paganella'); await page.fill('#lgt', '4');
  await H.click('form[data-form="create"] button[type="submit"]'); await H.wait(500);
  let D = await H.docs();
  const lid = (await H.lids())[0], code = D['leagues/' + lid].code;
  const teamId = n => Object.keys(D).find(k => k.startsWith('leagues/' + lid + '/teams/') && D[k].name === n).split('/').pop();
  const T1 = teamId('Squadra 1'), T2 = teamId('Squadra 2'), T3 = teamId('Squadra 3'), T4 = teamId('Squadra 4');
  const LU = t => D['leagues/' + lid + '/races/f01/lineups/' + t];
  const R = {
    [T1]: ['f-julia-scheib', 'f-camille-rast', 'f-zrinka-ljutic', 'm-loic-meillard', 'm-henrik-kristoffersen'],
    [T2]: ['f-sara-hector', 'f-alice-robinson', 'f-paula-moltzan', 'm-atle-lie-mcgrath', 'm-timon-haugan'],
    [T3]: ['f-mikaela-shiffrin', 'f-thea-louise-stjernesund', 'f-nina-o-brien', 'm-stefan-brennsteiner', 'm-marco-schwarz'],
    [T4]: ['f-lara-della-mea', 'f-lara-colturi', 'f-petra-vlhova', 'm-alex-vinatzer', 'm-river-radamus']
  };
  const bought = await page.evaluate(([l, R]) => {
    let i = 0;
    const jobs = [];
    Object.keys(R).forEach(t => R[t].forEach(a => jobs.push(window.DB.op({ k: 'buy', lg: l, id: 'p' + (i++), a: a, t: t, price: 5, from: '2026-10-01T00:00:00Z' }))));
    return Promise.all(jobs).then(() => 'ok', e => e.code);
  }, [lid, R]);
  ok(bought === 'ok', 'auction: 20 athletes in 4 teams');
  await H.click('#tab-gestione'); await H.click('[data-act="adm"][data-v="asta"]'); await H.wait(100);
  await H.click('[data-act="auction"][data-v="0"]'); await H.wait(300);
  ok((await H.docs())['leagues/' + lid].settings.auctionOpen === false, 'auction closed');

  // Anna and Bruno take their teams; Carla enters and skips the choice
  const enter = async (name, email, pick) => {
    await H.logout();
    await page.goto('http://site.test/?invito=' + code, { waitUntil: 'domcontentloaded' }); await H.wait(300);
    await H.register(name, email, name.toLowerCase() + 'pass'); await H.wait(400);
    if (pick) await H.pick(pick); else { await H.click('[data-act="pickskip"]'); await H.wait(150); }
  };
  await enter('Anna', 'anna@example.it', 'Squadra 1');
  await enter('Bruno', 'bruno@example.it', 'Squadra 2');
  await enter('Carla', 'carla@example.it', null);
  const aUid = await H.uid('anna@example.it'), cUid = await H.uid('carla@example.it');
  ok(/Il tuo account non è collegato a nessuna squadra/.test(await page.textContent('#noteam')) && !(await page.$('#nextlu')), 'Carla, without a team: the notice, no lineup to set');
  await shot('c_noteam');
  await H.click('#tab-squadre'); await H.wait(100);
  ok(await page.$('#noteam') && !(await page.$('[data-act="luopen"]')), 'Carla: the notice on Squadre too, no lineup button on any team');

  // Anna: her next lineup on top of the home page, the editor in view, saved under her account
  await H.logout(); await H.login('anna@example.it', 'annapass'); await H.wait(300);
  ok(await page.$('#nextlu') && /Sölden/.test(await page.textContent('#nextlu')) && /Scegli la formazione/.test(await page.textContent('#nextlu')), 'Anna: «La tua prossima formazione» on top, with the button');
  await shot('c_home_player');
  await H.click('#nextlu [data-act="golu"]'); await H.wait(200);
  ok(await page.evaluate(() => { const r = document.getElementById('lued').getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }), 'the editor opens in view');
  await H.click('[data-act="lusel"][data-v="f-julia-scheib|R"]');
  await H.click('[data-act="lusel"][data-v="f-zrinka-ljutic|T"]');
  await H.click('[data-act="lusave"]'); await H.wait(400);
  D = await H.docs();
  ok(LU(T1) && LU(T1).t.join() === 'f-camille-rast,f-zrinka-ljutic' && LU(T1).r === 'f-julia-scheib' && LU(T1).uid === aUid, 'Anna saved her Sölden lineup');
  await H.click('#tab-classifica'); await H.wait(100);
  ok(/Cambia la formazione/.test(await page.textContent('#nextlu')) && /Rast, Ljuti/.test(await page.textContent('#nextlu')), 'home: her lineup, and «Cambia la formazione»');
  await H.click('#tab-squadre'); await H.wait(100);
  await H.click('[data-act="tsel"][data-v="' + T2 + '"]'); await H.wait(100);
  ok(!(await page.$('[data-act="luopen"]')) && await page.$('[data-act="team"][data-v="' + T1 + '"]'), 'on Bruno\'s team: no lineup button, a way back to her own');
  const foreign = await page.evaluate(([l, t]) => window.DB.op({ k: 'lu', lg: l, r: 'f01', t: t, lu: { t: ['f-sara-hector'], r: null } }).then(() => 'saved', e => e.code), [lid, T2]);
  ok(foreign === 'permission-denied', 'rules: Anna cannot set Bruno\'s lineup');
  ok(await H.raw("return m.setDoc(m.doc(db, 'leagues', a.l, 'pending', a.t), { f01: { t: [], r: null } }, { merge: true })", { l: lid, t: T2 }) === 'permission-denied', 'rules: nor his copy of it');
  ok(await H.raw("return m.getDoc(m.doc(db, 'leagues', a.l, 'races', 'f01', 'lineups', a.t))", { l: lid, t: T2 }) === 'permission-denied', 'rules: nor read it before the deadline');
  ok(await H.raw("return m.deleteDoc(m.doc(db, 'leagues', a.l, 'members', a.u))", { l: lid, u: aUid }) === 'permission-denied', 'rules: nobody leaves the league alone (to come back for a second team)');
  ok(await H.raw("return m.updateDoc(m.doc(db, 'leagues', a.l, 'teams', a.t), { uid: a.u, owner: 'Anna' })", { l: lid, t: T3, u: aUid }) === 'permission-denied', 'rules: nor takes a second team');

  // Werner: told who has no team; locks the free teams; sets the lineup of the team nobody plays
  await H.logout(); await H.login('werner@example.it', 'segreta1'); await H.wait(400);
  ok(/Carla.*è nella lega ma non ha una squadra/.test(await page.textContent('#links')) && !(await page.$('#rulesold')), 'Werner\'s home: Carla has no team; rules up to date');
  await shot('c_home_admin');
  await H.click('#links [data-act="goadm"]'); await H.wait(150);
  ok(/Squadra 3, Squadra 4.*non sono collegate a nessun account/.test(await page.textContent('#links')), 'Gestione → Squadre: the teams without account');
  await H.click('[data-act="lockteams"][data-v="1"]'); await H.wait(300);
  ok((await H.docs())['leagues/' + lid].settings.lockTeams === true, 'Werner: from now on he alone links the teams');
  await shot('c_gestione_squadre');
  await H.click('#tab-squadre'); await H.click('[data-act="tsel"][data-v="' + T4 + '"]'); await H.wait(100);
  await H.click('[data-act="luopen"][data-v="f01|' + T4 + '"]'); await H.wait(100);
  await H.click('[data-act="lusave"]'); await H.wait(400);
  D = await H.docs();
  ok(LU(T4) && LU(T4).t.length === 2, 'Werner set the lineup of the team without an account');

  // Carla: teams locked, so nothing to take; told to ask Werner, who links her
  await H.logout(); await H.login('carla@example.it', 'carlapass'); await H.wait(400);
  ok(!(await page.$('.picks')) && /Chiedi a Werner di collegarti/.test(await page.textContent('#noteam')) && !(await page.$('#noteam [data-act="repick"]')),
    'Carla: teams locked, no picker; the notice tells her to ask Werner');
  ok(await page.evaluate(([l, t]) => window.DB.claimTeam(l, t).then(() => 'taken', e => e.code), [lid, T3]) === 'permission-denied', 'rules: with the teams locked nobody takes a free one');
  await shot('c_noteam_locked');
  await H.logout(); await H.login('werner@example.it', 'segreta1'); await H.wait(300);
  await H.click('#tab-gestione'); await H.click('[data-act="adm"][data-v="squadre"]'); await H.wait(100);
  await page.selectOption('#asg-' + T3, cUid); await H.wait(400);
  ok(/Squadra 4.* non è collegata/.test(await page.textContent('#links')) && !/Carla/.test(await page.textContent('#links')), 'Werner linked Carla to Squadra 3: only Squadra 4 has no account');
  await H.logout(); await H.login('carla@example.it', 'carlapass'); await H.wait(400);
  ok(!(await page.$('#noteam')) && await page.$('#nextlu'), 'Carla: no notice any more, her next lineup on top');

  // old rules in Firebase: the player is told why the save failed, the organiser is warned
  await page.evaluate(() => {
    window.__fake.oldRules = true;
    window.__fake.extraDeny = (m, p, ctx) => /^leagues\/[^/]+\/races\/[^/]+\/lineups\//.test(p) && m !== 'get' && m !== 'list' && (ctx.pre['leagues/' + p.split('/')[1]] || {}).admin !== ctx.uid;
  });
  await H.click('#nextlu [data-act="golu"]'); await H.wait(150);
  await H.click('[data-act="lusave"]'); await H.wait(400);
  ok(/deve aggiornare le regole del database/.test(await page.textContent('#lued .why')), 'Carla\'s save refused: the editor says the rules must be updated');
  await shot('c_rules_player');
  await H.logout(); await H.login('werner@example.it', 'segreta1'); await H.wait(400);
  ok(await page.$('#rulesold') && /Le regole del database sono vecchie/.test(await page.textContent('#rulesold')), 'Werner: warned that the published rules are old');
  await shot('c_rules_admin');
  // (the test site is not https, so the clipboard is a stand-in that keeps what the page writes)
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__clip = t; return Promise.resolve(); } } }));
  await H.wait(200);
  await H.click('#rulesold [data-act="rulescopy"]'); await H.wait(200);
  const copied = await page.evaluate(() => window.__clip || '');
  ok(/match \/config\/rules20261023/.test(copied) && /allow delete: if ladmin\(lid\);/.test(copied) && /Regole copiate/.test(await page.textContent('#fs-toast')), 'the button copies the new rules');
  await H.click('#tab-gestione'); await H.wait(100);
  ok(await page.$('#rulesold'), 'the warning in Gestione too');
  await page.evaluate(() => { window.__fake.oldRules = false; window.__fake.extraDeny = null; });
  await H.logout(); await H.login('werner@example.it', 'segreta1'); await H.wait(400);
  ok(!(await page.$('#rulesold')), 'rules updated: no warning');

  // after the deadline (Sölden women 09:00): Anna cannot change it; Werner corrects any lineup, its copy follows
  await page.clock.setFixedTime(new Date('2026-10-24T07:40:00Z'));
  await H.logout(); await H.login('anna@example.it', 'annapass'); await H.wait(300);
  await H.click('#tab-squadre'); await H.wait(100);
  ok(!(await page.$('[data-act="luopen"][data-v^="f01|"]')), 'after the deadline Anna has no button for Sölden');
  ok(await page.evaluate(([l, t]) => window.DB.op({ k: 'lu', lg: l, r: 'f01', t: t, lu: { t: ['f-julia-scheib'], r: null } }).then(() => 'saved', e => e.code), [lid, T1]) === 'permission-denied', 'rules: a late lineup is refused');
  await H.logout(); await H.login('werner@example.it', 'segreta1'); await H.wait(800);
  D = await H.docs();
  ok(D['leagues/' + lid].archive && D['leagues/' + lid].archive.f01 && D['leagues/' + lid].archive.f01[T1], 'closed race copied into the league document');
  await H.click('#tab-gare'); await H.click('[data-act="race"][data-v="f01"]'); await H.wait(150);
  ok((await page.$$('.rdet [data-act="luopen"]')).length === 4, 'Gare, closed race: a «Correggi» button for each team');
  await H.click('.rdet [data-act="luopen"][data-v="f01|' + T1 + '"]'); await H.wait(150);
  ok(/Gara già chiusa: la correggi tu/.test(await page.textContent('#lued')), 'the editor says the race is closed and he is correcting it');
  await H.click('[data-act="lusel"][data-v="f-zrinka-ljutic|"]');
  await H.click('[data-act="lusel"][data-v="f-julia-scheib|T"]');
  await shot('c_correct');
  await H.click('[data-act="lusave"]'); await H.wait(400);
  D = await H.docs();
  ok(LU(T1).t.join() === 'f-camille-rast,f-julia-scheib' && D['leagues/' + lid].archive.f01[T1].t.join() === 'f-camille-rast,f-julia-scheib' && LU(T1).uid === aUid,
    'Werner corrected Anna\'s closed lineup: the lineup, still under Anna, and its copy');
  ok(/Squadra 1: formazione per GS Sölden salvata/.test(await page.textContent('#fs-toast')), 'saved, for Squadra 1');
  await H.click('#tab-squadre'); await H.click('[data-act="tsel"][data-v="' + T2 + '"]'); await H.wait(100);
  ok(/Gare chiuse/.test(await H.txt()) && await page.$('[data-act="luopen"][data-v="f01|' + T2 + '"]'), 'Squadre: the closed races to correct, for the organiser');
  await H.logout(); await H.login('anna@example.it', 'annapass'); await H.wait(300);
  await H.click('#tab-gare'); await H.click('[data-act="race"][data-v="f01"]'); await H.wait(150);
  ok(/Rast, Scheib/.test(await page.textContent('.rdet')) && !(await page.$('.rdet [data-act="luopen"]')), 'Anna sees the corrected lineup, and cannot change any');
  ok(!page.errors.length, 'no page errors ' + JSON.stringify(page.errors));
  await page.context().close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try { await flowA(browser); await flowB(browser); await flowC(browser); }
  catch (e) { console.error('FAIL', e); process.exitCode = 1; }
  await browser.close();
})();
