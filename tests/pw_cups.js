// Classifica: overall, technical (GS+SL) and speed (DH+SG) standings, the two cups, team counters, rules
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const FS = require('/home/claude/fantaski/src/core.js');
const OUT = '/tmp/claude-0/-home-claude/fc963d46-bd1f-52ac-bbc1-9c85f5597a3b/scratchpad/';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
const html = fs.readFileSync('/home/claude/fantaski/fanta-ski.html', 'utf8');
const PAT = /(<script type="application\/json" id="fs-state">)([\s\S]*?)(<\/script>)/;
const st = FS.migrate(JSON.parse(html.match(PAT)[2]));
st.races.forEach(r => { r.x = 1; });
const lg = st.leagues[0];
lg.teams = [{ id: 't1', name: 'Squadra A', owner: '' }, { id: 't2', name: 'Squadra B', owner: '' }];
const from = lg.league.seasonStart;
lg.purchases = [['m-marco-odermatt', 't1', 100], ['m-loic-meillard', 't1', 50], ['m-franjo-von-allmen', 't2', 60], ['m-vincent-kriechmayr', 't2', 50],
  ['m-henrik-kristoffersen', 't2', 40], ['m-dominik-paris', 't1', 40]].map(([a, t, price], i) => ({ id: 'p' + i, a, t, price, from }));
const gs = st.races.find(r => r.t === 'GS' && r.g === 'M'), dh = st.races.find(r => r.t === 'DH' && r.g === 'M');
lg.lineups = { [gs.id]: { t1: { t: ['m-marco-odermatt', 'm-loic-meillard'], r: null }, t2: { t: ['m-henrik-kristoffersen', 'm-vincent-kriechmayr'], r: null } },
  [dh.id]: { t1: { t: ['m-marco-odermatt', 'm-dominik-paris'], r: null }, t2: { t: ['m-franjo-von-allmen', 'm-vincent-kriechmayr'], r: null } } };
st.results = { [gs.id]: { list: [['m-marco-odermatt', 1, 1, 1, 1], ['m-henrik-kristoffersen', 2, 3, 2, 2], ['m-loic-meillard', 3, 2, 3, 3]], dns: [], src: 't', at: 'x' },
  [dh.id]: { list: [['m-franjo-von-allmen', 1, 3], ['m-marco-odermatt', 2, 5], ['m-vincent-kriechmayr', 3, 7], ['m-dominik-paris', 4, 9]], dns: [], src: 't', at: 'x' } };
const page0 = html.replace(PAT, (m, a, b, c) => a + JSON.stringify(st).replace(/</g, '\\u003c') + c);
const doc = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + page0 + '</body></html>';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(/^https?:\/\/(?!local\.test)/, r => r.abort());
  await ctx.route('http://local.test/', r => r.fulfill({ contentType: 'text/html', body: doc }));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { window.claude = { use: async n => n === 'artifact' ? { publish: async () => ({}) } : { canEdit: async () => false, isOwner: async () => false, id: async () => 'v' } }; });
  await page.clock.setFixedTime(new Date('2027-01-20T12:00:00Z'));
  await page.goto('http://local.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.stand');
  const main = () => page.textContent('#main');
  const first = () => page.textContent('.stand li:first-child');
  ok(/Sfera di cristallo/.test(await main()) && /Squadra A/.test(await first()) && /300/.test(await first()), 'overall: A first with 300 (170 + 130)');
  await page.click('[data-act="cl"][data-v="T"]');
  ok(/Coppa delle tecniche/.test(await main()) && /Squadra A/.test(await first()) && /170/.test(await first()), 'technical: A first with 170');
  await page.click('.chips [data-act="cl"][data-v="V"]');
  ok(/Coppa delle veloci/.test(await main()) && /Squadra B/.test(await first()) && /160/.test(await first()), 'speed: B first with 160');
  await page.click('.chips [data-act="cl"][data-v="gen"]');
  const cups = await page.textContent('.cups');
  ok(/Tecniche\s*Squadra A\s*170 pt/.test(cups) && /Veloci\s*Squadra B\s*160 pt/.test(cups), 'the two cups show their leaders: ' + cups.replace(/\s+/g, ' '));
  await page.screenshot({ path: OUT + 'cups.png', fullPage: true });
  await page.click('button.cup[data-v="V"]');
  ok(/Coppa delle veloci/.test(await main()), 'tapping a cup opens its standings');
  await page.click('#tab-squadre'); await page.click('[data-act="tsel"][data-v="t1"]');
  const th = await page.textContent('.thead');
  ok(/Tecniche\s*170/.test(th) && /Veloci\s*130/.test(th), 'team page counts technical and speed points: ' + th.replace(/\s+/g, ' '));
  await page.click('#tab-regole');
  ok(/Coppa delle tecniche a chi fa più punti in gigante e slalom, uomini e donne insieme/.test(await main()) && /Coppa delle veloci/.test(await main()), 'prizes in Regole');
  ok(!errors.length, 'no page errors ' + JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
