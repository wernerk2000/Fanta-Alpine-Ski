const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const OUT = '/tmp/claude-0/-home-claude/fc963d46-bd1f-52ac-bbc1-9c85f5597a3b/scratchpad/';
const page0 = fs.readFileSync('/home/claude/fantaski/fanta-ski.html', 'utf8');
const RESET = ':root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}';
const doc = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>' + RESET + '</style></head><body>' + page0 + '</body></html>';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

const paste = `Rank Bib FIS Code Name Year Nation Run 1 Run 2 Total Time Diff. FIS Points Cup Points
1 3 512269 ODERMATT Marco 1997 SUI 1:07.12 1:08.21 2:15.33 0.00 100
2 34 6190558 NEWMAN Pierre 2004 FRA 1:08.50 1:06.90 2:15.40 +0.07 1.10 80
3 7 512182 MEILLARD Loic 1996 SUI 1:07.40 1:08.10 2:15.50 +0.17 2.65 60
4 1 422304 KRISTOFFERSEN Henrik 1994 NOR 1:07.30 1:08.30 2:15.60 +0.27 4.20 50
5 38 422729 HAUGAN Timon 1996 NOR 1:09.90 1:06.95 2:16.85 +1.52 15.00 45
Did not finish 2nd run
12 54320 FASTGUY Some 1999 AUT 1:07.00`;

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.route(/^https?:\/\/(?!local\.test)/, r => r.abort());
  await ctx.route('http://local.test/', r => r.fulfill({ contentType: 'text/html', body: doc }));
  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|net::/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => {
    window.__pub = null;
    window.claude = { use: async n => n === 'artifact' ? { publish: async h => { window.__pub = h; return { version: 'v' }; } } : n === 'user' ? { canEdit: async () => true, isOwner: async () => true, id: async () => 'u1' } : null };
  });
  await page.goto('http://local.test/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tab-gestione');
  const click = sel => page.click(sel);

  // rules
  await click('#tab-regole');
  let txt = await page.textContent('#main');
  ok(/Bonus partenza/.test(txt) && /Bonus seconda manche/.test(txt) && /Bonus serie/.test(txt), 'Regole shows the three bonus blocks');
  ok(/\+10 a chi fa il miglior tempo della 2ª manche/.test(txt) && /\+1 per ogni posizione recuperata/.test(txt) && /\+20 per ogni vittoria consecutiva/.test(txt), 'Regole shows the values');
  ok(/Malus/.test(txt) && /−10 se l'atleta non arriva al traguardo/.test(txt) && /pettorali dall'1 al 7/.test(txt) && /dispari fino al 19/.test(txt) && /primo dopo la 1ª manche non chiude nei primi 5/.test(txt), 'Regole shows the malus block');
  await page.screenshot({ path: OUT + 'regole.png', fullPage: true });

  // settings
  await click('#tab-gestione');
  await click('[data-act="adm"][data-v="imp"]');
  ok(await page.inputValue('#r2b') === '10' && await page.inputValue('#r2g') === '1' && await page.inputValue('#skp') === '10' && await page.inputValue('#skw') === '20', 'Impostazioni shows the new bonus fields');
  ok(await page.inputValue('#mdf') === '10' && await page.inputValue('#mtp') === '10' && await page.inputValue('#mld') === '10' && await page.inputValue('#tgp') === '7', 'Impostazioni shows the malus fields');
  await page.fill('#r2b', '12');
  await click('[data-act="impsave"]');
  await click('#tab-regole');
  ok(/\+12 a chi fa il miglior tempo/.test(await page.textContent('#main')), 'changed value reaches the rules');

  // auction: Odermatt and Meillard to Squadra 1, Haugan to Squadra 2
  await click('#tab-gestione');
  await click('[data-act="adm"][data-v="asta"]');
  for (const [name, team] of [['Odermatt', 't1'], ['Meillard', 't1'], ['Haugan', 't2']]) {
    await click('[data-act="at"][data-v="' + team + '"]');
    await page.fill('#aq', name);
    await click('#alist [data-act="apick"]');
    await click('#abuy');
  }
  // results
  await click('[data-act="adm"][data-v="ris"]');
  await page.selectOption('#rsel', 'm01');
  await page.fill('#rpaste', paste);
  await click('[data-act="parse"]');
  ok(await page.inputValue('#p1-m-marco-odermatt') === '2' && await page.inputValue('#p2-m-loic-meillard') === '3', 'preview shows run-1 place and run-2 time place (Odermatt 2nd after run 1, Meillard 3rd run-2 time)');
  ok(await page.inputValue('#pb-m-timon-haugan') === '38' && await page.inputValue('#p1-m-timon-haugan') === '6' && await page.inputValue('#p2-m-timon-haugan') === '2', 'Haugan: bib 38, 6th after run 1, 2nd run-2 time');
  txt = await page.textContent('#main');
  ok(/Manca il miglior tempo di 2ª manche/.test(txt), 'warns that nobody in the listone has the best run-2 time');
  // the best run-2 time was by an athlete outside the listone; pretend Haugan had it to test the input
  await page.fill('#p2-m-timon-haugan', '1');
  await page.dispatchEvent('#p2-m-timon-haugan', 'change');
  await page.screenshot({ path: OUT + 'preview.png', fullPage: true });
  await click('[data-act="psave"]');
  await click('#fs-savebar [data-act="save"]');
  await page.waitForFunction(() => !!window.__pub);
  const pub = await page.evaluate(() => window.__pub);
  const st = JSON.parse(pub.match(/<script type="application\/json" id="fs-state">([\s\S]*?)<\/script>/)[1]);
  const L = st.results.m01.list;
  ok(JSON.stringify(L.find(x => x[0] === 'm-timon-haugan')) === '["m-timon-haugan",5,38,6,1]', 'saved entry [id, rank, bib, run-1 place, run-2 place]: ' + JSON.stringify(L.find(x => x[0] === 'm-timon-haugan')));
  ok(st.leagues[0].league.run2Best === 12, 'saved league settings');

  // race detail
  await click('#tab-gare');
  await click('[data-act="race"][data-v="m01"]');
  txt = await page.textContent('.rdet');
  ok(/6° dopo la 1ª/.test(txt) && /miglior 2ª manche/.test(txt), 'results table shows run data');
  // Haugan: 5th = 45, bib 38 top 5 = +35, gained 1 place = +1, best run 2 = +12 → 93
  ok(/= 45 \+ pettorale 35 \+ rimonta 1 \+ miglior 2ª manche 12/.test(txt), 'team table shows the bonus breakdown');
  ok(/93/.test(txt), 'Haugan scores 93');
  await page.screenshot({ path: OUT + 'gara.png', fullPage: true });

  // maluses: Copper Mountain GS with Odermatt out in run 2, Meillard (bib 4) 16th, Haugan not qualified
  const paste2 = `1 9 422304 KRISTOFFERSEN Henrik 1994 NOR 1:07.12 1:08.21 2:15.33 100
16 4 512182 MEILLARD Loic 1996 SUI 1:08.40 1:09.10 2:17.50 +2.17 80
Did not qualify for 2nd run
30 422729 HAUGAN Timon 1996 NOR 1:10.12
Did not finish 2nd run
1 512269 ODERMATT Marco 1997 SUI 1:06.90`;
  await click('#tab-gestione');
  await click('[data-act="adm"][data-v="ris"]');
  await page.selectOption('#rsel', 'm05');
  await page.fill('#rpaste', paste2);
  await click('[data-act="parse"]');
  ok(await page.getAttribute('[data-act="pst"][data-v="m-marco-odermatt|dnf"]', 'aria-pressed') === 'true', 'Odermatt pre-set as out');
  ok(await page.getAttribute('[data-act="pst"][data-v="m-timon-haugan|nc"]', 'aria-pressed') === 'true' && await page.inputValue('#pn-m-timon-haugan') === '30', 'Haugan pre-set as unclassified with bib 30');
  await page.screenshot({ path: OUT + 'preview2.png', fullPage: true });
  await (await page.$('.unr')).evaluate(el => el.parentElement.scrollIntoView());
  await (await page.$$('.unr'))[0].screenshot({ path: OUT + 'unr.png' });
  await click('[data-act="psave"]');
  await page.evaluate(() => { window.__pub = null; });
  await click('#fs-savebar [data-act="save"]');
  await page.waitForFunction(() => !!window.__pub);
  const st2 = JSON.parse((await page.evaluate(() => window.__pub)).match(/<script type="application\/json" id="fs-state">([\s\S]*?)<\/script>/)[1]);
  ok(JSON.stringify(st2.results.m05.dnf) === '["m-marco-odermatt"]' && JSON.stringify(st2.results.m05.nc) === '[["m-timon-haugan",30]]', 'saved dnf and nc: ' + JSON.stringify([st2.results.m05.dnf, st2.results.m05.nc]));
  await click('#tab-gare');
  await click('[data-act="race"][data-v="m05"]');
  txt = await page.textContent('.rdet');
  ok(/Odermatt · uscito · −10/.test(txt), 'Odermatt out: −10');
  ok(/Meillard · 16° · 5 = 15 − malus primo gruppo 10/.test(txt), 'Meillard first group 16th: 15 − 10');
  ok(/In rosa, senza posizione/.test(txt) && /fuori classifica · pett\. 30/.test(txt), 'results table lists rostered athletes without a place');
  await page.screenshot({ path: OUT + 'gara2.png', fullPage: true });
  await (await page.$('.rdet')).screenshot({ path: OUT + 'rdet2.png' });

  // several leagues: create a second one, buy in it, enter results once, switch from the header
  ok(!(await page.$('#lgsel')), 'no league switch with a single league');
  await click('#tab-gestione');
  await click('[data-act="adm"][data-v="leghe"]');
  await page.fill('#lgn', 'Ski team');
  await page.fill('#lgt', '4');
  await click('[data-act="lgadd"]');
  ok(await page.$('#lgsel') && (await page.$$eval('#lgsel option', o => o.map(x => x.textContent))).join() === 'Fanta Alpine Ski,Ski team', 'header switch lists both leagues');
  ok(await page.inputValue('#lgsel') !== '' && /Ski team/.test(await page.textContent('#lgsel option:checked')), 'the new league is open');
  await click('[data-act="adm"][data-v="asta"]');
  ok((await page.$$('[data-act="at"]')).length === 4, 'the new league has 4 teams');
  await page.fill('#aq', 'Odermatt');
  await click('#alist [data-act="apick"]');
  await click('#abuy');
  await click('[data-act="adm"][data-v="ris"]');
  await page.selectOption('#rsel', 'm09');
  await page.fill('#rpaste', `1 2 512182 MEILLARD Loic 1996 SUI 1:07.12 1:08.21 2:15.33 100
Did not finish 2nd run
1 512269 ODERMATT Marco 1997 SUI 1:06.90`);
  await click('[data-act="parse"]');
  txt = await page.textContent('#main');
  ok(/Fanta Alpine Ski: Squadra 1 · Ski team: Squadra 1/.test(txt), 'results preview lists the teams of every league');
  await click('[data-act="psave"]');
  await page.evaluate(() => { window.__pub = null; });
  await click('#fs-savebar [data-act="save"]');
  await page.waitForFunction(() => !!window.__pub);
  const st3 = JSON.parse((await page.evaluate(() => window.__pub)).match(/<script type="application\/json" id="fs-state">([\s\S]*?)<\/script>/)[1]);
  ok(st3.leagues.length === 2 && !st3.league && st3.leagues[1].purchases.length === 1 && JSON.stringify(st3.results.m09.dnf) === '["m-marco-odermatt"]', 'saved: two leagues, shared results');
  await click('#tab-gare');
  await click('[data-act="race"][data-v="m09"]');
  ok(/Odermatt · uscito · −10/.test(await page.textContent('.rdet')), 'Ski team: Odermatt out −10');
  await page.selectOption('#lgsel', st3.leagues[0].id);
  ok(/Fanta Alpine Ski/.test(await page.textContent('#lgsel option:checked')), 'switched back from the header');
  await click('#tab-gare');
  if (!(await page.$('.rdet'))) await click('[data-act="race"][data-v="m09"]');
  txt = await page.textContent('.rdet');
  ok(/Odermatt · uscito · −10/.test(txt) && /Meillard · 1° · 1/.test(txt), 'Fanta Alpine Ski league scores the same results: ' + txt.slice(0, 0));
  await page.screenshot({ path: OUT + 'leghe.png' });
  ok(!errors.length, 'no page errors ' + JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
