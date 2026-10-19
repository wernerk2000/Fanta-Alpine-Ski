// Auction rule: the price starts at the quotation; when no team can pay it (or those who can give up) it starts from 1
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const OUT = '/tmp/claude-0/-home-claude/fc963d46-bd1f-52ac-bbc1-9c85f5597a3b/scratchpad/';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const html = fs.readFileSync('/home/claude/fantaski/fanta-ski.html', 'utf8');
const PAT = /(<script type="application\/json" id="fs-state">)([\s\S]*?)(<\/script>)/;
const st = JSON.parse(html.match(PAT)[2]);
const lg = st.leagues[0];
lg.teams = [{ id: 't1', name: 'Squadra Werner', owner: '' }, { id: 't2', name: 'Squadra Nico', owner: '' }];
const buy = (t, a, price, i) => ({ id: 'p' + t + i, a, t, price, from: '2026-10-01T00:00:00Z' });
lg.purchases = ['f-mikaela-shiffrin', 'f-emma-aicher', 'f-camille-rast', 'f-sofia-goggia', 'f-alice-robinson'].map((a, i) => buy('t1', a, 80, i))
  .concat(['f-paula-moltzan', 'f-laura-pirovano', 'f-julia-scheib', 'f-sara-hector', 'f-kira-weidle-winkelmann'].map((a, i) => buy('t2', a, 97, i)));
lg.lineups = {}; lg.league.auctionOpen = true;
const page0 = html.replace(PAT, (m, a, b, c) => a + JSON.stringify(st).replace(/</g, '\\u003c') + c);
const doc = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + page0 + '</body></html>';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(/^https?:\/\/(?!local\.test)/, r => r.abort());
  await ctx.route('http://local.test/', r => r.fulfill({ contentType: 'text/html', body: doc }));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.claude = { use: async n => n === 'artifact' ? { publish: async h => ({ version: 'v' }) } : { canEdit: async () => true, isOwner: async () => true, id: async () => 'u1' } }; });
  await page.clock.setFixedTime(new Date('2026-10-19T15:00:00Z'));
  await page.goto('http://local.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tab-gestione');
  await page.click('#tab-regole');
  ok(/Se nessuna squadra può arrivare alla quotazione, o chi può arrivarci rinuncia, l'atleta riparte da 1, e chi ha rinunciato non può più offrire per lui/.test(await page.textContent('#main')), 'rule written in Regole');
  await page.click('#tab-gestione'); await page.click('[data-act="adm"][data-v="asta"]');
  // Werner has 100 credits (offer cap 94), Nico 15 (cap 9): only Werner can pay Odermatt's 81
  await page.click('[data-act="at"][data-v="t2"]');
  await page.fill('#aq', 'Odermatt'); await page.click('#alist [data-act="apick"]');
  let t = await page.textContent('.pick');
  ok(/Alla quotazione di 81 possono arrivare: Squadra Werner\. Se rinunciano, si riparte da 1 senza di loro\./.test(t), 'only Werner can pay the quotation');
  ok(await page.inputValue('#aprice') === '81', 'price box starts at the quotation');
  await page.screenshot({ path: OUT + 'auction_reach.png' });
  // Werner gives up: Nico takes him at 5
  await page.fill('#aprice', '5'); await page.dispatchEvent('#aprice', 'input');
  ok(!(await page.isDisabled('#abuy')), 'a price below the quotation is accepted');
  await page.click('[data-act="apickx"]');
  // Werner could pay the quotation: having given up, he cannot take Odermatt below it
  await page.click('[data-act="at"][data-v="t1"]');
  await page.fill('#aq', 'Odermatt'); await page.click('#alist [data-act="apick"]');
  await page.fill('#aprice', '5'); await page.dispatchEvent('#aprice', 'input');
  ok(await page.isDisabled('#abuy') && /Squadra Werner poteva arrivare alla quotazione di 81: se ha rinunciato, non può prenderlo a meno\./.test(await page.textContent('#awhy')), 'who gave up cannot take him below the quotation');
  await page.fill('#aprice', '81'); await page.dispatchEvent('#aprice', 'input');
  ok(!(await page.isDisabled('#abuy')), 'Werner can still take him at the quotation');
  await page.click('[data-act="apickx"]');
  // Werner spends 80 on Brignone: now nobody can pay 81
  await page.click('[data-act="at"][data-v="t1"]');
  await page.fill('#aq', 'Brignone'); await page.click('#alist [data-act="apick"]'); await page.click('#abuy');
  await page.click('[data-act="at"][data-v="t2"]');
  await page.fill('#aq', 'Odermatt'); await page.click('#alist [data-act="apick"]');
  t = await page.textContent('.pick');
  ok(/Nessuna squadra può arrivare alla quotazione di 81: si parte da 1\./.test(t), 'nobody can pay: starts from 1');
  ok(await page.inputValue('#aprice') === '1', 'price box starts at 1');
  await page.screenshot({ path: OUT + 'auction_none.png' });
  await page.click('#abuy');
  ok(/Marco Odermatt/.test(await page.textContent('#main')) && /Odermatt a Squadra Nico per 1 crediti|Odermatt/.test(await page.textContent('#fs-toast')), 'Odermatt goes to Nico for 1');
  ok(!errors.length, 'no page errors ' + JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
