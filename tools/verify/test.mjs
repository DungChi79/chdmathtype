import puppeteer from 'puppeteer';

const BASE = 'http://127.0.0.1:8903/';
const reqs = [];
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('request', r => reqs.push(r.url()));
page.on('requestfailed', r => console.log('REQ FAILED:', r.url(), r.failure()?.errorText));
page.on('response', r => { if (r.status() >= 400) console.log('HTTP', r.status(), r.url()); });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));

await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 2500));

const state = await page.evaluate(() => ({
  mathField: !!document.querySelector('math-field'),
  mfShadow: !!document.querySelector('math-field')?.shadowRoot,
  katex: typeof window.katex,
  mathJax: typeof window.MathJax?.tex2svg,
  hookInCode: document.documentElement.innerHTML.includes('__chdNativeCopy'),
}));
console.log('STATE:', JSON.stringify(state));

const clickByText = async (substr) => page.evaluate((s) => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(s) && x.offsetParent !== null);
  if (!b) return false; b.click(); return true;
}, substr);

console.log('new formula btn:', await clickByText('Công thức mới'));
await new Promise(r => setTimeout(r, 400));
console.log('category btn:', await clickByText('Phân số'));
await new Promise(r => setTimeout(r, 600));
const fracClicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null)
    .find(x => (x.title || '').includes('frac'));
  if (!b) return false; b.click(); return b.title;
});
console.log('fraction template clicked:', fracClicked);
await new Promise(r => setTimeout(r, 500));
await page.keyboard.type('a');
await new Promise(r => setTimeout(r, 600));
const latexVal = await page.evaluate(() =>
  [...document.querySelectorAll('textarea')].map(t => t.value).find(v => v.includes('frac')) ?? null);
console.log('LATEX AFTER TYPE a:', JSON.stringify(latexVal));

// --- Native-copy hook: "Chép cho Word" (bản 1.0.2: payload phải là MathML,
///  vì OMML thô qua clipboard hệ thống không được Word nhận — xem máy người dùng) ---
await page.evaluate(() => {
  window.__copied = null;
  window.__chdNativeCopy = (f) => { window.__copied = f; return Promise.resolve(true); };
});
console.log('copy-word btn:', await clickByText('Chép cho Word'));
await new Promise(r => setTimeout(r, 500));
const copied1 = await page.evaluate(() => window.__copied && {
  hasMathML: window.__copied.html.includes('<math'),
  hasOMML: window.__copied.html.includes('m:oMath'),
  plain: window.__copied.plain,
});
console.log('HOOK btnCopyWord:', JSON.stringify(copied1));

// --- Native-copy hook: "Sao chép tất cả" (đường MathLive, chỉ có plain -> hook tự dựng MathML) ---
await page.evaluate(() => { window.__copied = null; });
await page.click('#btnCopyAllLatex');
await new Promise(r => setTimeout(r, 500));
const copied2 = await page.evaluate(() => window.__copied && {
  hasMathML: window.__copied.html.includes('<math'),
  plain: window.__copied.plain,
});
console.log('HOOK btnCopyAllLatex:', JSON.stringify(copied2));

const external = reqs.filter(u => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:'));
console.log('TOTAL REQUESTS:', reqs.length, '| EXTERNAL REQUESTS:', external.length, JSON.stringify(external.slice(0, 5)));
await browser.close();
