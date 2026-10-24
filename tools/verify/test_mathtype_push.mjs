// Kiểm tra nút "Gửi thẳng vào Word MathType" (bridge native-only):
// - nút xanh, nằm ngay sau nút "Gửi thẳng vào Word"
// - bấm nút -> gọi invoke('push_mathtype_to_word', {rtf, plain})
// - RTF chứa \objemb Equation.DSMT4 + \objdata (CFB MathType thật) + \pngblip
// - nút Equation cũ vẫn gọi invoke('push_to_word') (không hồi quy)
// Chạy: node test_mathtype_push.mjs  (cần server dist ở http://127.0.0.1:8903/)
import puppeteer from 'puppeteer';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8903/';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  window.__invoked = [];
  window.__TAURI__ = {
    core: { invoke: (cmd, args) => { window.__invoked.push({ cmd, args }); return Promise.resolve('mock-ok'); } },
    clipboardManager: { writeHtml: () => Promise.resolve() },
  };
});
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 3000));

const btns = await page.evaluate(() => [...document.querySelectorAll('button')]
  .filter(b => b.offsetParent !== null)
  .map(b => ({ text: b.textContent.trim(), bg: getComputedStyle(b).backgroundColor })));
const pushBtn = btns.find(b => b.text === '⇢ Gửi thẳng vào Word');
const mtBtn = btns.find(b => b.text === '⇢ Gửi thẳng vào Word MathType');
console.log('push button present:', !!pushBtn);
console.log('mathtype button present:', !!mtBtn, '| bg:', mtBtn?.bg);
const order = await page.evaluate(() => {
  const all = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
  const i1 = all.findIndex(b => b.textContent.trim() === '⇢ Gửi thẳng vào Word');
  const i2 = all.findIndex(b => b.textContent.trim() === '⇢ Gửi thẳng vào Word MathType');
  return { i1, i2, adjacent: i2 === i1 + 1 };
});
console.log('ORDER:', JSON.stringify(order));

// Đặt một công thức mẫu vào khung soạn (đường đã kiểm chứng của test.mjs)
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
const latex = await page.evaluate(() => document.getElementById('mathField')?.getValue('latex'));
console.log('EDITOR LATEX:', JSON.stringify(latex));

// Bấm nút MathType và lấy RTF đã gửi cho native
const mtClicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '⇢ Gửi thẳng vào Word MathType');
  if (!b) return false; b.click(); return true;
});
console.log('mt button clicked:', mtClicked);
await new Promise(r => setTimeout(r, 4000));
const invoked = await page.evaluate(() => window.__invoked);
console.log('INVOKED CMDS:', JSON.stringify(invoked.map(i => i.cmd)));
const mtCall = invoked.find(i => i.cmd === 'push_mathtype_to_word');
if (!mtCall) { console.log('FAIL: no push_mathtype_to_word invoke'); await browser.close(); process.exit(1); }
const rtf = mtCall.args.rtf;
console.log('RTF len:', rtf.length, '| plain:', JSON.stringify(mtCall.args.plain));
console.log('RTF has objemb:', rtf.includes('\\objemb'), '| DSMT4:', rtf.includes('Equation.DSMT4'), '| pngblip:', rtf.includes('\\pngblip'));
fs.writeFileSync('/tmp/mt-rtf.rtf', rtf);
const objHex = (rtf.match(/\\objdata\s+([0-9a-f\s]+?)\s*\}/i) || [])[1]?.replace(/\s+/g, '');
const pngTail = rtf.slice(rtf.indexOf('picscaley100') + 12);
const pngHex = (pngTail.match(/^\s*([0-9a-f\s]+)/) || [])[1]?.replace(/\s+/g, '');
console.log('objdata hex len:', objHex?.length, '| png hex len:', pngHex?.length);
if (objHex) fs.writeFileSync('/tmp/mt-rtf-ole.bin', Buffer.from(objHex, 'hex'));
if (pngHex) fs.writeFileSync('/tmp/mt-rtf-png.png', Buffer.from(pngHex, 'hex'));
const objw = (rtf.match(/\\objw(\d+)/) || [])[1];
const objh = (rtf.match(/\\objh(\d+)/) || [])[1];
console.log('objw/objh (twips):', objw, objh);

// Hồi quy: nút Equation cũ vẫn gọi push_to_word
await page.evaluate(() => { window.__invoked = []; });
const eqClicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === '⇢ Gửi thẳng vào Word');
  if (!b) return false; b.click(); return true;
});
await new Promise(r => setTimeout(r, 1500));
const invoked2 = await page.evaluate(() => window.__invoked.map(i => i.cmd));
console.log('eq button clicked:', eqClicked, '| invoked after:', JSON.stringify(invoked2));
await browser.close();
