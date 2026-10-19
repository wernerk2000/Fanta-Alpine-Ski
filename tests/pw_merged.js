const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const page0 = fs.readFileSync('/home/claude/fantaski/fanta-ski.html', 'utf8');
const doc = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>' + page0 + '</body></html>';
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route(/^https?:\/\/(?!local\.test)/, r => r.abort());
  await ctx.route('http://local.test/', r => r.fulfill({ contentType: 'text/html', body: doc }));
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // a device with a pending op saved by the previous version (no league id)
  await page.addInitScript(() => {
    localStorage.setItem('fs-pending-v2', JSON.stringify({ ops: [{ k: 'teamSet', id: 't3', name: 'Squadra Anna' }], rev: null }));
    window.claude = { use: async n => n === 'artifact' ? { publish: async h => { window.__pub = h; } } : { canEdit: async () => true, isOwner: async () => true, id: async () => 'u1' } };
  });
  await page.goto('http://local.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tab-gestione');
  const t = await page.textContent('#main');
  const hd = await page.textContent('header');
  console.log(/Ski Team Paganella/i.test(hd) ? 'ok   league name in the header' : 'FAIL name: ' + hd.slice(0, 80));
  console.log(/Squadra 1/.test(t) && /Squadra 7/.test(t) && /Squadra Anna/.test(t) && !/Squadra 3/.test(t) ? 'ok   live teams and the old pending rename show' : 'FAIL teams');
  await page.click('#tab-squadre');
  const sq = await page.textContent('#main');
  console.log(/Rosa\s*0\/12/.test(sq) && /Crediti\s*500/.test(sq) ? 'ok   fresh league: empty roster, full budget' : 'FAIL roster: ' + sq.slice(0, 200));
  console.log(!(await page.$('#lgsel')) ? 'ok   single league: no switch' : 'FAIL switch');
  console.log(errors.length ? 'FAIL ' + errors : 'ok   no errors');
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
