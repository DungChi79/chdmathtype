// Kiểm chứng vòng web mới trên dist (1.0.6):
// - full-width: .wrap không còn max-width 1240px
// - nút Chép LaTeX kèm $ theo chế độ; ô mã LaTeX giữ thô (đồng bộ không vỡ)
// - tab Markdown: đúng vị trí sau tab LaTeX, xem trước có định dạng,
//   MTCore.markdownToDocx sinh .docx đúng ở cả hai chế độ
// Chạy: node test_web_round.mjs  (cần server dist ở http://127.0.0.1:8903/)
import puppeteer from 'puppeteer';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8903/';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(BASE, ['clipboard-read', 'clipboard-write']);
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 3000));

// 1. Full-width
const wrap = await page.evaluate(() => {
  const el = document.querySelector('.wrap');
  const cs = getComputedStyle(el);
  return { maxWidth: cs.maxWidth, width: cs.width, clientWidth: el.clientWidth };
});
console.log('WRAP:', JSON.stringify(wrap));

// 2. Editor: đặt công thức mẫu, kiểm tra đồng bộ thô
const clickByText = async (substr) => page.evaluate((s) => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes(s) && x.offsetParent !== null);
  if (!b) return false; b.click(); return true;
}, substr);
await clickByText('Công thức mới');
await new Promise(r => setTimeout(r, 400));
await clickByText('Phân số');
await new Promise(r => setTimeout(r, 600));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null)
    .find(x => (x.title || '').includes('frac'));
  if (b) b.click();
});
await new Promise(r => setTimeout(r, 500));
await page.keyboard.type('a');
await new Promise(r => setTimeout(r, 800));
const sync = await page.evaluate(() => {
  const mfLatex = document.getElementById('mathField')?.getValue('latex');
  const ta = [...document.querySelectorAll('textarea')].map(t => t.value).find(v => v.includes('frac'));
  return { mfLatex, taValue: ta, taHasDollar: (ta || '').includes('$') };
});
console.log('SYNC:', JSON.stringify(sync));

// 3. Nút Chép LaTeX ở chế độ Inline (mặc định)
await page.evaluate(() => { const b = document.getElementById('btnCopyLatex'); if (b) b.click(); });
await new Promise(r => setTimeout(r, 600));
const clipInline = await page.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR:' + e.message));
console.log('CLIP INLINE:', JSON.stringify(clipInline));

// 4. Chuyển Display rồi chép lại
const modeBtn = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null)
    .find(x => /display/i.test(x.textContent) && !/inline/i.test(x.textContent));
  if (!b) return null; b.click(); return b.textContent.trim();
});
await new Promise(r => setTimeout(r, 600));
await page.evaluate(() => { const b = document.getElementById('btnCopyLatex'); if (b) b.click(); });
await new Promise(r => setTimeout(r, 600));
const clipDisplay = await page.evaluate(() => navigator.clipboard.readText().catch(e => 'ERR:' + e.message));
console.log('MODE BTN:', JSON.stringify(modeBtn), '| CLIP DISPLAY:', JSON.stringify(clipDisplay));

// 5. Tab Markdown: vị trí + xem trước
const tabs = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null)
    .map(x => x.textContent.trim());
  const iL = btns.findIndex(t => t.includes('LaTeX → Equation'));
  const iM = btns.findIndex(t => t.includes('Markdown → Equation'));
  return { iL, iM, after: iM === iL + 1, all: btns.filter(t => t.includes('Equation')) };
});
console.log('TABS:', JSON.stringify(tabs));
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.includes('Markdown → Equation'));
  if (b) b.click();
});
await new Promise(r => setTimeout(r, 800));
const mdSample = [
  '# Định lý Viète',
  'Cho phương trình $ax^2+bx+c=0$ với $a \\ne 0$, ta có **tổng hai nghiệm** là $x_1+x_2=-\\frac{b}{a}$ và *tích* là $x_1x_2=\\frac{c}{a}$.',
  '',
  '- Nghiệm thứ nhất: $x_1$',
  '- Nghiệm thứ hai: $x_2$',
  '',
  '| Hệ số | Giá trị |',
  '|---|---|',
  '| $a$ | 2 |',
  '| $b$ | -3 |',
  '',
  '$$\\int_0^1 x^2 dx = \\frac{1}{3}$$',
  '',
].join('\n');
// Đi qua đúng nút "Chuyển đổi & tải file Word" của tab (đường UI thật,
// kèm latexToMathml/previewFor của app); chặn URL.createObjectURL để bắt blob.
await page.evaluate((sample) => {
  const ta = document.getElementById('mdInput');
  ta.value = sample;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  window.__blobs = [];
  const orig = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob) => {
    window.__blobs.push(blob);
    return orig(new Blob(['x']));
  };
}, mdSample);
await new Promise(r => setTimeout(r, 1500));
const previewInfo = await page.evaluate(() => ({
  html: document.getElementById('mdPreview')?.innerHTML || '',
  count: document.getElementById('mdCount')?.textContent || '',
}));
const previewHtml = previewInfo.html;
console.log('MD PREVIEW has h1:', /<h1/i.test(previewHtml), '| bold:', /<strong/i.test(previewHtml),
  '| table:', /<table/i.test(previewHtml), '| katex:', previewHtml.includes('katex'),
  '| count text:', previewInfo.count);
const b64 = async () => page.evaluate(async () => {
  const blob = window.__blobs[window.__blobs.length - 1];
  if (!blob) return null;
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.slice(i, i + 8192));
  return btoa(s);
});
await page.evaluate(() => { window.__blobs = []; document.getElementById('tab3ConvertBtn').click(); });
await new Promise(r => setTimeout(r, 5000));
const ommlB64 = await b64();
console.log('MD OMML blob captured:', !!ommlB64);
if (ommlB64) fs.writeFileSync('/tmp/md-omml.docx', Buffer.from(ommlB64, 'base64'));
await page.evaluate(() => {
  window.__blobs = [];
  document.querySelector('input[name=tab3Mode][value=mathtype]').click();
  document.getElementById('tab3ConvertBtn').click();
});
await new Promise(r => setTimeout(r, 5000));
const mtB64 = await b64();
console.log('MD MT blob captured:', !!mtB64);
if (mtB64) fs.writeFileSync('/tmp/md-mt.docx', Buffer.from(mtB64, 'base64'));
await browser.close();
