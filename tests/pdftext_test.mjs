// The site's own PDF reader (site/src/pdftext.js) against PDF.js on FIS results PDFs, and the results read from them
// against the official ones. PDFs come from the scratchpad (not in the repository): node tests/pdftext_test.mjs [pdf ...]
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const PT = require('../site/src/pdftext.js');
const FS = require('../src/core.js');
const SP = '/tmp/claude-0/-home-claude/6a1fd610-285d-5ec3-81bb-63f0103a1bd0/scratchpad/pdf/';
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['f01.pdf', 'm01.pdf'].map(f => SP + f).filter(f => fs.existsSync(f));
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
// the same row building and cleaning as site/src/app.js
const appSrc = fs.readFileSync(new URL('../site/src/app.js', import.meta.url), 'utf8');
const grab = name => { const i = appSrc.indexOf('  function ' + name + '('); const j = appSrc.indexOf('\n  }\n', i); return appSrc.slice(i, j + 4); };
const { pdfRows, pdfClean } = new Function(grab('pdfRows') + grab('pdfClean') + 'return { pdfRows, pdfClean };')();
let pdfjs = null;
try { pdfjs = await import('/opt/npm-tools/node_modules/pdfjs-dist/legacy/build/pdf.mjs'); } catch (e) { pdfjs = null; }
const A = JSON.parse(fs.readFileSync(new URL('../docs/data/athletes.json', import.meta.url), 'utf8')).athletes;
const R = JSON.parse(fs.readFileSync(new URL('../docs/data/results.json', import.meta.url), 'utf8')).results;
for (const f of files) {
  const buf = fs.readFileSync(f);
  const t0 = Date.now();
  const pages = PT.read(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const mine = pdfClean([].concat(...pages.map(pdfRows)));
  console.log('--', f.split('/').pop(), pages.length, 'pages,', mine.split('\n').length, 'lines,', Date.now() - t0, 'ms');
  if (pdfjs) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise, lines = [];
    for (let p = 1; p <= doc.numPages; p++) pdfRows((await (await doc.getPage(p)).getTextContent()).items).forEach(l => lines.push(l));
    const theirs = pdfClean(lines), a = mine.split('\n'), b = theirs.split('\n');
    const diff = a.map((l, i) => l === b[i] ? null : i).filter(i => i !== null);
    ok(!diff.length && a.length === b.length, 'same text as PDF.js, line by line' + (diff.length ? ' — first difference at line ' + diff[0] + ':\n  mine:   ' + a[diff[0]] + '\n  pdf.js: ' + b[diff[0]] : ''));
  }
  const head = mine.slice(0, 700), g = /\bwomen\b/i.test(head) ? 'F' : 'M', rid = (g === 'F' ? 'f' : 'm') + '01';
  const pr = FS.parseResults(mine, A.filter(x => x.g === g && !x.hide), { runs: true });
  ok(pr.matched >= 25 && pr.runs === pr.matched && pr.sure, rid + ': ' + pr.matched + ' athletes placed, both runs for all, ' + pr.nf.length + ' DNF, ' + pr.nq.length + ' DNQ');
  if (R[rid]) {
    const ref = R[rid], dnf = {}, nc = {};
    ref.dnf.forEach(x => { dnf[x[0]] = x[1]; }); ref.nc.forEach(x => { nc[x[0]] = x[1]; });
    ok(JSON.stringify(pr.list) === JSON.stringify(ref.list), rid + ': the list equals the official results');
    ok(pr.nf.every(a => dnf[a] === pr.sbib[a]) && Object.keys(dnf).every(a => pr.nf.indexOf(a) >= 0), rid + ': DNF and their bibs equal the official ones');
    ok(pr.nq.every(a => nc[a] === pr.sbib[a]) && Object.keys(nc).every(a => pr.nq.indexOf(a) >= 0), rid + ': DNQ and their bibs equal the official ones');
  }
}
