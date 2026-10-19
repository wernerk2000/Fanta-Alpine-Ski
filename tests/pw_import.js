// Import of the old page's league into the website (mock database), then two people take their teams
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
  const store = () => page.evaluate(() => Object.values(window.__mock.store.leagues)[0] || null);

  await page.waitForSelector('form[data-form="login"]');
  await click('[data-act="authtab"][data-v="register"]');
  await page.fill('#re', 'werner@example.it'); await page.fill('#rp', 'segreta1');
  await click('form[data-form="register"] button[type="submit"]'); await wait(150);
  await page.fill('#un', 'Werner'); await click('form[data-form="uname"] button[type="submit"]'); await wait(150);
  await click('[data-act="claimadmin"]'); await wait(150);
  ok(await page.$('#impf'), 'first screen of the administrator offers the import');
  await page.setInputFiles('#impf', OUT + 'leghe_test.json'); await wait(200);
  ok(/Fanta Ski PROVA/.test(await txt()) && /7 squadre · 18 acquisti/.test(await txt()), 'file read: league, teams and purchases listed');
  await click('[data-act="impgo"][data-v="0"]'); await wait(300);
  const L = await store();
  ok(L && L.teams.length === 7 && L.purchases.length === 18 && L.lineups.m01 && L.lineups.m01.t3, 'league imported with 7 teams, 18 purchases and the Sölden lineup');
  ok(/Codice invito/.test(await txt()) && await page.$('#invlink'), 'opens on Gestione → Squadre with the invite link');
  await page.screenshot({ path: OUT + 'site_import.png', fullPage: true });

  await click('#tab-squadre'); await wait(100);
  ok(/Squadra Werner/.test(await page.textContent('.thead')) && /Squadra libera/.test(await txt()), 'Werner is shown his own team, free to take');
  await click('[data-act="claim"]'); await wait(200);
  ok(/La tua squadra/.test(await txt()), 'Werner took Squadra Werner');
  const link = await page.evaluate(() => { const L = Object.values(window.__mock.store.leagues)[0]; return 'http://site.test/?invito=' + L.code; });

  await click('[data-act="logout"]'); await wait(150);
  await page.goto(link, { waitUntil: 'domcontentloaded' }); await wait(300);
  await page.fill('#re', 'nico@example.it'); await page.fill('#rp', 'nicopass');
  await click('form[data-form="register"] button[type="submit"]'); await wait(150);
  await page.fill('#un', 'Nico'); await click('form[data-form="uname"] button[type="submit"]'); await wait(400);
  ok(/Quale squadra sei/.test(await txt()) && /Squadra Nico.*forse sei tu/.test(await txt()), 'Nico is asked for his team, Squadra Nico suggested');
  await click('button.pickrow:has-text("Squadra Nico")'); await click('[data-act="pickok"]'); await wait(200);
  const t = await txt();
  ok(/La tua squadra/.test(t) && /Pinheiro Braathen/.test(t), 'Nico took his team and sees his athletes');
  await click('#tab-classifica'); await wait(80);
  ok((await page.$$('.stand li')).length === 7, 'standings list the 7 teams');
  ok(!errors.length, 'no page errors ' + JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
