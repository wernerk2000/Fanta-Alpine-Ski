// Browser test of the website with the in-memory database (site/dist built with --mock)
// Flow: Werner signs up (email and password, then username), becomes administrator, creates «Ski Team Paganella»;
// Nico and Pietro sign up, enter with the code and pick their team; Werner fixes Pietro's team, runs the auction;
// lineups, deadline, results, cups; who may create leagues; the invite link.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const DIST = '/home/claude/fantaski/site/dist';
const OUT = '/tmp/claude-0/-home-claude/fc963d46-bd1f-52ac-bbc1-9c85f5597a3b/scratchpad/';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(/^https?:\/\/(?!site\.test)/, r => r.abort());
  await ctx.route(/^http:\/\/site\.test\//, r => {
    let p = new URL(r.request().url()).pathname; if (p === '/') p = '/index.html';
    const f = path.join(DIST, p);
    if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: 'no' });
    r.fulfill({ contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-19T10:00:00Z'));
  await page.goto('http://site.test/', { waitUntil: 'domcontentloaded' });
  const txt = async () => page.textContent('#app');
  const click = s => page.click(s);
  const wait = ms => page.waitForTimeout(ms || 60);
  const league = () => page.evaluate(() => JSON.parse(JSON.stringify(Object.values(window.__mock.store.leagues)[0])));
  async function signup(email, pw, name) {
    if (!(await page.$('form[data-form="register"]'))) await click('[data-act="authtab"][data-v="register"]');
    await page.fill('#re', email); await page.fill('#rp', pw);
    await click('form[data-form="register"] button[type="submit"]'); await wait(150);
    if (name) { await page.fill('#un', name); await click('form[data-form="uname"] button[type="submit"]'); await wait(150); }
  }
  async function login(email, pw) {
    await page.fill('#le', email); await page.fill('#lp', pw);
    await click('form[data-form="login"] button[type="submit"]'); await wait(250);
  }
  const logout = async () => { await click('[data-act="logout"]'); await wait(150); };

  // 1. Werner: email and password, then the username; first administrator; creates the league
  await page.waitForSelector('form[data-form="login"]');
  ok(/Accedi/.test(await txt()), 'signed out: sign-in screen');
  await page.screenshot({ path: OUT + 'site_auth.png' });
  await click('[data-act="authtab"][data-v="register"]');
  ok(!(await page.$('#rn')) && await page.$('#re') && await page.$('#rp'), 'sign-up asks only email and password');
  await page.fill('#re', 'werner@example.it'); await page.fill('#rp', '123');
  await click('form[data-form="register"] button[type="submit"]'); await wait();
  ok(/almeno 6 caratteri/.test(await txt()), 'short password refused');
  await page.fill('#re', 'werner@example.it'); await page.fill('#rp', 'segreta1');
  await click('form[data-form="register"] button[type="submit"]'); await wait(150);
  ok(/Scegli il tuo username/.test(await txt()), 'then the username');
  await page.screenshot({ path: OUT + 'site_username.png' });
  await page.fill('#un', 'we'); await click('form[data-form="uname"] button[type="submit"]'); await wait(100);
  ok(/da 3 a 20 caratteri/.test(await txt()), 'too short a username refused');
  await page.fill('#un', 'Werner K'); await click('form[data-form="uname"] button[type="submit"]'); await wait(100);
  ok(/senza spazi/.test(await txt()), 'username with a space refused');
  await page.fill('#un', 'Werner'); await click('form[data-form="uname"] button[type="submit"]'); await wait(150);
  let t = await txt();
  ok(/Come vuoi giocare/.test(t) && /Crea una lega/.test(t) && /Entra con un codice/.test(t), 'home: the two options');
  ok(await page.$('.opt.locked button[disabled]'), 'creating a league is locked before becoming administrator');
  ok(/Diventa amministratore/.test(t), 'first account: becomes administrator');
  await click('[data-act="claimadmin"]'); await wait(150);
  ok(!(await page.$('.opt.locked')) && await page.$('form[data-form="create"]'), 'administrator can create a league');
  await page.screenshot({ path: OUT + 'site_home_admin.png', fullPage: true });
  await page.fill('#lgn', 'Ski Team Paganella'); await page.fill('#lgt', '7');
  await click('form[data-form="create"] button[type="submit"]'); await wait(200);
  ok(await page.$('#tab-gestione') && /Codice invito/.test(await txt()), 'league created, invite code shown in Gestione');
  const code = (await page.textContent('.codev')).trim();
  ok(/^[A-Z0-9]{5,}$/.test(code), 'invite code ' + code);
  ok((await league()).teams.length === 7 && (await league()).name === 'Ski Team Paganella', 'seven teams in «Ski Team Paganella»');
  ok(/SKI TEAM PAGANELLA/i.test(await page.textContent('header')), 'league name in the header');
  await click('[data-act="adm"][data-v="imp"]'); await wait(60);
  await page.selectOption('#spg', '5'); await click('[data-act="impsave"]'); await wait(120);
  ok((await league()).settings.perGender === 5, 'before the auction the organiser can set 5 men + 5 women');
  await click('#tab-regole');
  ok(/Ogni squadra ha 5 uomini e 5 donne/.test(await txt()), 'the rules follow: 5 + 5');
  await click('#tab-gestione'); await click('[data-act="adm"][data-v="imp"]');
  await page.selectOption('#spg', '6'); await click('[data-act="impsave"]'); await wait(120);
  ok((await league()).settings.perGender === 6, 'and back to 6 + 6');
  await page.screenshot({ path: OUT + 'site_admin.png', fullPage: true });

  // 2. Nico: the username is unique; creating leagues locked; wrong code, right code, picks his team
  await logout();
  await signup('nico@example.it', 'nicopass', 'WERNER');
  ok(/già preso/.test(await txt()), 'a username already taken (whatever the case) is refused');
  await page.fill('#un', 'Nico'); await click('form[data-form="uname"] button[type="submit"]'); await wait(150);
  t = await txt();
  ok(/Come vuoi giocare/.test(t) && await page.$('.opt.locked button[disabled]') && /solo l'amministratore/.test(t), 'player: creating a league is locked');
  ok(!/Diventa amministratore/.test(t), 'second account: no administrator button');
  await page.screenshot({ path: OUT + 'site_home_player.png', fullPage: true });
  await page.fill('#jc', 'XXXXXX'); await click('form[data-form="join"] button[type="submit"]'); await wait(150);
  ok(/Codice non valido/.test(await txt()), 'wrong code refused');
  await page.fill('#jc', code.toLowerCase()); await click('form[data-form="join"] button[type="submit"]'); await wait(250);
  t = await txt();
  ok(/Quale squadra sei/.test(t) && (await page.$$('button.pickrow')).length === 7, 'right code: first the team picker, seven free teams');
  await click('button.pickrow:has-text("Squadra 3")'); await wait(80);
  ok(/Confermi\? Sei Squadra 3/.test(await txt()), 'asks to confirm');
  await page.screenshot({ path: OUT + 'site_pick.png', fullPage: true });
  await click('[data-act="pickok"]'); await wait(200);
  ok(/La tua squadra/.test(await txt()) && /Squadra 3/.test(await page.textContent('h1')), 'Nico is Squadra 3, on his team page');
  ok(!(await page.$('#tab-gestione')), 'no Gestione for a player');
  await click('[data-act="tsel"]:nth-of-type(4)'); await wait(80);
  ok(!/Sì, è la mia/.test(await txt()), 'cannot take a second team');
  const nicoTeam = (await league()).teams.find(x => x.name === 'Squadra 3').id;

  // 3. Pietro picks the wrong team; Werner moves him from Gestione
  await logout();
  await signup('pietro@example.it', 'pietropass', 'Pietro');
  await page.fill('#jc', code); await click('form[data-form="join"] button[type="submit"]'); await wait(250);
  ok(await page.$('.pickrow.taken') && /di Nico/.test(await txt()), 'the picker shows Nico\'s team as taken');
  await click('button.pickrow:has-text("Squadra 4")'); await click('[data-act="pickok"]'); await wait(200);
  let L = await league();
  ok(L.teams.find(x => x.name === 'Squadra 4').uid && L.teams.find(x => x.name === 'Squadra 4').owner === 'Pietro', 'Pietro took Squadra 4 by mistake');
  await logout();
  await page.fill('#le', 'werner@example.it'); await page.fill('#lp', 'sbagliata');
  await click('form[data-form="login"] button[type="submit"]'); await wait(150);
  ok(/Email o password sbagliate/.test(await txt()), 'wrong password refused');
  await login('werner@example.it', 'segreta1');
  ok(!(await page.$('.picks')), 'the organiser is not asked to pick a team');
  await click('#tab-gestione'); await click('[data-act="adm"][data-v="squadre"]'); await wait(80);
  const t5 = L.teams.find(x => x.name === 'Squadra 5').id, pietro = Object.keys(L.members).find(u => L.members[u].name === 'Pietro');
  await page.selectOption('#asg-' + t5, pietro); await wait(200);
  L = await league();
  ok(L.teams.find(x => x.name === 'Squadra 5').uid === pietro && !L.teams.find(x => x.name === 'Squadra 4').uid && L.members[pietro].team === t5, 'Werner moved Pietro to Squadra 5; Squadra 4 is free again');
  ok(!L.teams.find(x => x.name === 'Squadra 4').owner && L.teams.find(x => x.name === 'Squadra 5').owner === 'Pietro', 'the freed team no longer carries Pietro\'s name');
  ok(/adesso è di Pietro/.test(await page.textContent('#fs-toast')), 'confirmation message');
  await page.screenshot({ path: OUT + 'site_assign.png', fullPage: true });

  // 4. Werner runs the auction for Nico's team: quotation, or 1 when nobody can reach it
  await click('[data-act="adm"][data-v="asta"]');
  await click('[data-act="at"][data-v="' + nicoTeam + '"]');
  await page.fill('#aq', 'Odermatt'); await click('#alist [data-act="apick"]'); await wait(60);
  ok(await page.inputValue('#aprice') === '81' && /Alla quotazione di 81 possono arrivare/.test(await txt()), 'price starts at the quotation; who can reach it is listed');
  await page.fill('#aprice', '5'); await page.dispatchEvent('#aprice', 'input'); await wait(40);
  ok(await page.$eval('#abuy', b => b.disabled) && /poteva arrivare alla quotazione/.test(await txt()), 'a team that could reach the quotation cannot buy for less');
  await page.fill('#aprice', '81'); await page.dispatchEvent('#aprice', 'input'); await click('#abuy'); await wait(80);
  for (const n of ['Meillard', 'Kristoffersen']) { await page.fill('#aq', n); await click('#alist [data-act="apick"]'); await click('#abuy'); await wait(80); }
  L = await league();
  ok(L.purchases.length === 3 && L.purchases[0].price === 81, 'three athletes bought for Nico (' + L.purchases.length + ')');
  await click('[data-act="adm"][data-v="imp"]'); await wait(60);
  ok(!(await page.$('#spg')) && /Fissi per questa stagione: 6 uomini e 6 donne/.test(await txt()), 'athletes per team fixed once the auction has started');

  // 5. Nico sets the Sölden lineup before the deadline
  await logout(); await login('nico@example.it', 'nicopass');
  await click('#tab-squadre'); await wait(80);
  ok(/La tua squadra/.test(await txt()), 'Squadre opens on Nico\'s own team after login');
  await click('[data-act="luopen"][data-v="m01"]');
  // the editor starts from the automatic lineup (the two best by price), so the reserve goes first to free a starter slot
  await click('[data-act="lusel"][data-v="m-marco-odermatt|R"]');
  await click('[data-act="lusel"][data-v="m-loic-meillard|T"]');
  await click('[data-act="lusel"][data-v="m-henrik-kristoffersen|T"]');
  await click('[data-act="lusave"]'); await wait(150);
  const lu = await page.evaluate(t => { const L = Object.values(window.__mock.store.leagues)[0]; return L.lineups.m01 && L.lineups.m01[t]; }, nicoTeam);
  ok(lu && lu.t.join() === 'm-loic-meillard,m-henrik-kristoffersen' && lu.r === 'm-marco-odermatt', 'lineup saved in the database');
  await page.screenshot({ path: OUT + 'site_lineup.png', fullPage: true });

  // 6. after the deadline (Sunday 25 Oct, 09:00) the lineup is closed
  await page.clock.setFixedTime(new Date('2026-10-25T08:30:00Z'));
  await click('#tab-classifica'); await click('#tab-squadre'); await wait(80);
  ok(!(await page.$('[data-act="luopen"][data-v="m01"]')), 'no editing after the deadline');
  const denied = await page.evaluate(t => window.DB.op({ k: 'lu', lg: Object.keys(window.__mock.store.leagues)[0], r: 'm01', t: t, lu: { t: ['m-marco-odermatt'], r: null } }).then(() => 'saved', e => e.code), nicoTeam);
  ok(denied === 'permission-denied', 'database refuses a late lineup');

  // 7. Werner enters the Sölden results; Nico's team scores; technical and speed cups
  await logout(); await login('werner@example.it', 'segreta1');
  await click('#tab-gestione'); await click('[data-act="adm"][data-v="ris"]');
  await page.selectOption('#rsel', 'm01');
  await page.fill('#rpaste', `1 3 512269 ODERMATT Marco 1997 SUI 1:07.12 1:08.21 2:15.33 100
2 7 512182 MEILLARD Loic 1996 SUI 1:07.40 1:08.10 2:15.50 +0.17 80
3 9 422304 KRISTOFFERSEN Henrik 1994 NOR 1:07.50 1:08.30 2:15.80 +0.47 60`);
  await click('[data-act="parse"]'); await click('[data-act="psave"]'); await wait(200);
  await click('#tab-classifica'); await wait(80);
  t = await txt();
  // Meillard 80 + best second run 10, Kristoffersen 60; Odermatt is the reserve and does not count
  ok(/1Squadra 3Nico150150/.test(t), 'Nico\'s team leads with 150 (Meillard 80+10, Kristoffersen 60)');
  ok(/Le coppe/.test(t) && /TecnicheSquadra 3150 pt/.test(await page.textContent('.cups')), 'Le coppe: Squadra 3 leads the technical cup');
  await click('[data-act="cl"][data-v="V"]'); await wait(60);
  ok(/Coppa delle veloci/.test(await txt()) && /Nessuna gara ancora corsa\. Si parte .* con (la discesa|il superG)\./.test(await txt()), 'speed standings: none yet, the first speed race named');
  await click('[data-act="cl"][data-v="gen"]');
  await click('#tab-gare'); await click('[data-act="race"][data-v="m01"]'); await wait(80);
  const rd = await page.textContent('.rdet');
  ok(/Meillard · 2° · 90 = 80 \+ miglior 2ª manche 10/.test(rd) && /riserva Odermatt non entrata/.test(rd), 'race detail shows the lineup and points');
  await click('#tab-regole');
  t = await txt();
  ok(/Gare-evento ×1,5 — uomini: .*Kitzbühel \(discesa\)/.test(t) && /Cortina d'Ampezzo \(discesa del 15 gen\)/.test(t), 'rules list the event races from the calendar');
  ok(/riparte da 1, e chi ha rinunciato non può più offrire/.test(t) && /Coppa delle tecniche/.test(t) && /Coppa delle veloci/.test(t), 'rules: auction and prizes');

  // 8. who may create leagues; every league of the site
  await click('#tab-gestione'); await click('[data-act="adm"][data-v="leghe"]'); await wait(60);
  await click('[data-act="allload"]'); await wait(80);
  ok(/Ski Team Paganella/.test(await page.textContent('.panel:has([data-act="siteopen"]) ~ .panel')) && /ci sei/.test(await txt()), 'administrator sees every league');
  await click('[data-act="siteopen"][data-v="1"]'); await wait(100);
  ok(await page.evaluate(() => window.__mock.store.site.openLeagues === true), 'creating leagues opened to everyone');
  await click('#tab-profilo');
  ok(/Le tue leghe/.test(await txt()) && /amministratore del sito/.test(await txt()), 'profile page');
  const tabVisible = await page.evaluate(() => { const n = document.querySelector('.tabs').getBoundingClientRect(), t = document.querySelector('.tab.on').getBoundingClientRect(); return t.left >= n.left - 1 && t.right <= n.right + 1; });
  ok(tabVisible, 'the open tab is scrolled into view in the tab bar');
  await page.screenshot({ path: OUT + 'site_profile.png', fullPage: true });
  await logout(); await login('nico@example.it', 'nicopass');
  await click('#tab-profilo'); await wait(60);
  ok(await page.$('form[data-form="create"]') && !(await page.$('.opt.locked')), 'with creation open, Nico could create a league');
  // Nico changes username: everybody sees the new one
  await page.fill('#pn', 'Nicola'); await click('form[data-form="rename"] button[type="submit"]'); await wait(150);
  L = await league();
  ok(Object.values(L.members).some(m => m.name === 'Nicola') && await page.evaluate(() => !!window.__mock.store.usernames.nicola && !window.__mock.store.usernames.nico), 'username changed everywhere, old one released');
  await click('#tab-classifica'); await wait(60);
  ok(/Squadra 3( tu)?Nicola/.test(await txt()), 'standings show the new username');
  await logout(); await login('werner@example.it', 'segreta1');
  await click('#tab-gestione'); await click('[data-act="adm"][data-v="leghe"]'); await click('[data-act="siteopen"][data-v="0"]'); await wait(100);
  ok(await page.evaluate(() => window.__mock.store.site.openLeagues === false), 'closed again');

  // 9. invite link: Werner shares it, Dori opens it, signs up, chooses a username and is asked for her team
  await click('[data-act="adm"][data-v="squadre"]'); await wait(80);
  const link = await page.inputValue('#invlink');
  ok(link === 'http://site.test/?invito=' + code, 'invite link in Gestione: ' + link);
  const wa = await page.getAttribute('a[href^="https://wa.me/"]', 'href');
  ok(wa && decodeURIComponent(wa).indexOf(link) > 0 && /lega «Ski Team Paganella» di Fanta Alpine Ski/.test(decodeURIComponent(wa)), 'WhatsApp button carries the message with the link');
  await logout();
  await page.goto(link, { waitUntil: 'domcontentloaded' }); await wait(300);
  ok(/Ti hanno invitato in una lega/.test(await txt()) && await page.$('form[data-form="register"]'), 'invite link opens the sign-up form with a note');
  ok(!/invito/.test(page.url()), 'code removed from the address bar: ' + page.url());
  await signup('dori@example.it', 'doripass', 'Dori'); await wait(300);
  L = await league();
  ok(Object.values(L.members).some(m => m.name === 'Dori') && /Quale squadra sei/.test(await txt()), 'Dori is in the league right after the username, asked for her team');
  await page.screenshot({ path: OUT + 'site_invite.png' });
  await click('[data-act="pickskip"]'); await wait(80);
  ok(/Non hai ancora una squadra/.test(await txt()), 'skipping: the league opens, with a reminder');

  // 10. a player names his own team, and only his own
  await logout(); await login('nico@example.it', 'nicopass');
  await click('#tab-squadre'); await wait(80);
  await click('[data-act="ren"]'); await wait(40);
  await page.fill('#trn', '  I   Fulmini  '); await click('form[data-form="tname"] button[type="submit"]'); await wait(150);
  L = await league();
  ok(L.teams.find(x => x.id === nicoTeam).name === 'I Fulmini' && /I Fulmini/.test(await page.textContent('h1')), 'Nico renamed his team «I Fulmini» (spaces tidied)');
  ok(/si chiama «I Fulmini»/.test(await page.textContent('#fs-toast')), 'confirmation message');
  await click('[data-act="tsel"]:has-text("Squadra 5")'); await wait(60);
  ok(!(await page.$('[data-act="ren"]')), 'no rename button on someone else\'s team');
  const other = await page.evaluate(t => window.DB.op({ k: 'teamSet', id: t, name: 'Rubata' }).then(() => 'renamed', e => e.code), t5);
  ok(other === 'permission-denied', 'database refuses renaming another team');
  const long = await page.evaluate(t => window.DB.op({ k: 'teamSet', id: t, name: 'x'.repeat(31) }).then(() => 'renamed', e => e.code), nicoTeam);
  ok(long === 'permission-denied', 'database refuses a name longer than 30 characters');
  await click('#tab-regole');
  ok(/Il nome della squadra lo scegli tu/.test(await txt()), 'rules say so');
  await page.goto('http://site.test/?invito=ZZZZZZ', { waitUntil: 'domcontentloaded' }); await wait(400);
  ok(/non vale più/.test(await page.textContent('#fs-toast')), 'an old invite link says so');
  ok(!errors.length, 'no page errors ' + JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
