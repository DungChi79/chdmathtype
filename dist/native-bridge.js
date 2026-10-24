// ChdMathType — native bridge, chi nap trong ban app Tauri (macOS).
// 1) Tro MathLive vao fonts/sounds da dong goi san trong app.
// 2) Them nut "Gui thang vao Word" canh nut "Chep cho Word" cua chinh app:
//    nut nay dung lai dung luong chep Equation da duoc kiem chung cua app,
//    roi nho vo native kich hoat Microsoft Word va dan tai vi tri con tro.
import('./vendor/mathlive/mathlive.mjs').then(function (m) {
  try {
    if (m && m.MathfieldElement) {
      m.MathfieldElement.fontsDirectory = './vendor/mathlive/fonts/';
      m.MathfieldElement.soundsDirectory = './vendor/mathlive/sounds/';
    }
  } catch (e) { /* bo qua: MathLive tu tim fonts canh module */ }
}).catch(function () {});

// Dang ky ham chep clipboard he thong cho app: moi nut "chep sang Word" cua
// app deu di qua selectionCopy, va selectionCopy se goi __chdNativeCopy neu
// co (ban web khong co ham nay nen hanh vi khong doi). Ghi thang vao
// NSPasteboard qua plugin cua Tauri — bo qua hoan toan cac API clipboard
// khong on dinh cua WKWebView (nguyen nhan dan vao Word chi ra ma LaTeX).
(function installNativeCopy() {
  var cm = window.__TAURI__ && window.__TAURI__.clipboardManager;
  if (!cm || typeof cm.writeHtml !== 'function') return;
  window.__chdNativeCopy = function (formats) {
    var p;
    try {
      p = Promise.resolve(cm.writeHtml(formats.html,
        formats.plain != null ? String(formats.plain) : undefined));
    } catch (e) {
      p = Promise.reject(e);
    }
    window.__chdCopyPromise = p;
    p.catch(function () {
      nativeToast('Không ghi được vào clipboard hệ thống — hãy thử lại, hoặc dùng nút tải file .docx.');
    });
    return p;
  };
})();

function nativeToast(msg) {
  var t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);' +
    'background:#26221f;color:#fff;padding:10px 18px;border-radius:999px;' +
    'font:500 14px/1.35 system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.28);' +
    'z-index:2147483647;max-width:88vw;text-align:center;opacity:0;transition:opacity .25s';
  document.body.appendChild(t);
  requestAnimationFrame(function () { t.style.opacity = '1'; });
  setTimeout(function () {
    t.style.opacity = '0';
    setTimeout(function () { t.remove(); }, 300);
  }, 3400);
}

function wireWordButton() {
  if (!window.__TAURI__ || !window.__TAURI__.core ||
      typeof window.__TAURI__.core.invoke !== 'function') return false;
  var btns = document.querySelectorAll('button');
  var copyBtn = null;
  for (var i = 0; i < btns.length; i++) {
    if ((btns[i].textContent || '').indexOf('Chép cho Word') !== -1) { copyBtn = btns[i]; break; }
  }
  if (!copyBtn) return false;
  if (copyBtn.dataset.chdWired) return true;
  copyBtn.dataset.chdWired = '1';
  var b = document.createElement('button');
  b.type = 'button';
  b.className = copyBtn.className;
  b.textContent = '⇢ Gửi thẳng vào Word';
  b.title = 'Chép công thức dạng Equation rồi tự dán vào tài liệu Word đang mở, ngay tại vị trí con trỏ';
  b.addEventListener('click', function () {
    copyBtn.click(); // app ghi Equation vao clipboard he thong qua __chdNativeCopy
    var proceeded = false;
    function proceed() {
      if (proceeded) return;
      proceeded = true;
      window.__TAURI__.core.invoke('push_to_word').then(function (msg) {
        nativeToast(msg || 'Đã gửi công thức vào Word.');
      }).catch(function (err) {
        nativeToast(typeof err === 'string' ? err :
          'Không gửi được vào Word. Hãy mở sẵn một tài liệu Word rồi thử lại.');
      });
    }
    // Cho viec ghi clipboard hoan tat roi moi dan; du phong bang moc 900ms.
    var p = window.__chdCopyPromise;
    if (p && typeof p.then === 'function') {
      p.then(proceed, proceed);
      setTimeout(proceed, 900);
    } else {
      setTimeout(proceed, 300);
    }
  });
  copyBtn.parentNode.insertBefore(b, copyBtn.nextSibling);
  return true;
}

var chdTries = 0;
var chdTimer = setInterval(function () {
  if (wireWordButton() || ++chdTries > 40) clearInterval(chdTimer);
}, 250);
