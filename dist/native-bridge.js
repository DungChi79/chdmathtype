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

// Mở mọi link http(s) bằng trình duyệt hệ thống thay vì trong webview:
// webview của app không mở được tab mới, nên nút "Hỗ trợ" (và các link
// ngoài khác) cần đi qua lệnh shell của Tauri. Chỉ chặn link http(s)
// tuyệt đối; link tương đối, blob: và tải file trong app không bị đụng.
(function installExternalLinkOpener() {
  if (!window.__TAURI__ || !window.__TAURI__.core ||
      typeof window.__TAURI__.core.invoke !== 'function') return;
  if (document.documentElement.dataset.chdExtWired) return;
  document.documentElement.dataset.chdExtWired = '1';
  document.addEventListener('click', function (ev) {
    var a = ev.target && ev.target.closest ? ev.target.closest('a') : null;
    if (!a) return;
    var href = a.getAttribute('href') || '';
    if (href.indexOf('http://') !== 0 && href.indexOf('https://') !== 0) return;
    ev.preventDefault();
    window.__TAURI__.core.invoke('open_external_url', { url: href }).catch(function () {
      nativeToast('Không mở được link — hãy mở thủ công: ' + href);
    });
  }, true);
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
  wireMathTypeButton(copyBtn, b);
  return true;
}

// ---- Gửi thẳng vào Word MathType (nút xanh, kế bên nút Equation) ----
// Cách làm: dùng đúng đường xuất .docx MathType đã kiểm chứng của app
// (MTCore.textToDocx ở chế độ mathtype) để lấy đối tượng OLE MathType
// thật + ảnh PNG xem trước, rồi gói thành RTF có \objemb và nhờ phía
// native đặt RTF lên clipboard + dán vào Word bằng hai lớp đã kiểm chứng.
// Trên Mac (không có MathType) Word hiển thị ảnh xem trước; gửi file cho
// máy Windows có MathType sẽ mở sửa được như đối tượng MathType thật.
function bytesToHex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var h = bytes[i].toString(16);
    s += (h.length < 2 ? '0' : '') + h;
  }
  return s;
}
function hexWrapped(hex) {
  var out = '';
  for (var i = 0; i < hex.length; i += 64) out += hex.slice(i, i + 64) + '\n';
  return out;
}
function buildMathTypeRtf(ole, png, wPt, hPt) {
  var twW = Math.max(20, Math.round(wPt * 20));
  var twH = Math.max(20, Math.round(hPt * 20));
  return '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\fnil Arial;}}\n' +
    '{\\object\\objemb\\objw' + twW + '\\objh' + twH + '\n' +
    '{\\*\\objclass Equation.DSMT4}\n' +
    '{\\*\\objdata ' + hexWrapped(bytesToHex(ole)) + '}\n' +
    '{\\result{\\pict\\pngblip\\picwgoal' + twW + '\\pichgoal' + twH + '\\picscalex100\\picscaley100\n' +
    hexWrapped(bytesToHex(png)) + '}}\n' +
    '}\n}\n';
}

// Vẽ ảnh PNG xem trước bằng MathJax (đường SVG thuần, không foreignObject)
// — cùng cách app vẫn vẽ preview cho xuất .docx, nhưng tự chứa trong bridge
// vì các hàm preview của app không nằm ở phạm vi toàn cục.
function bridgePreviewFor(latex) {
  return new Promise(function (resolve) {
    var holder = null, url = null;
    function done(v) {
      try { if (url) URL.revokeObjectURL(url); } catch (e) {}
      try { if (holder) holder.remove(); } catch (e) {}
      resolve(v);
    }
    try {
      var MJ = window.MathJax;
      if (!MJ || typeof MJ.tex2svg !== 'function') { done(null); return; }
      var node = MJ.tex2svg(latex, { display: false });
      var svg = null;
      if (node) {
        if (node.querySelector) svg = node.querySelector('svg');
        if (!svg && node.tagName && String(node.tagName).toLowerCase() === 'svg') svg = node;
      }
      if (!svg) { done(null); return; }
      holder = document.createElement('div');
      holder.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:-9999px;';
      document.body.appendChild(holder);
      holder.appendChild(svg);
      var rect = svg.getBoundingClientRect();
      var w = rect.width, h = rect.height;
      if (!w || !h) { done(null); return; }
      var wPt = Math.max(6, w * 72 / 96), hPt = Math.max(6, h * 72 / 96);
      var hEx = parseFloat(svg.getAttribute('height'));
      var vaEx = parseFloat(svg.style.verticalAlign);
      var descentPt = (isFinite(hEx) && hEx > 0 && isFinite(vaEx)) ? hPt * (-vaEx / hEx) : 0;
      var clone = svg.cloneNode(true);
      holder.innerHTML = '';
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('width', String(Math.round(w * 4)));
      clone.setAttribute('height', String(Math.round(h * 4)));
      var xml = new XMLSerializer().serializeToString(clone);
      url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
      var img = new Image();
      img.onload = function () {
        try {
          var cv = document.createElement('canvas');
          cv.width = Math.max(1, Math.round(w * 4));
          cv.height = Math.max(1, Math.round(h * 4));
          var ctx = cv.getContext('2d');
          ctx.drawImage(img, 0, 0, cv.width, cv.height);
          ctx.globalCompositeOperation = 'destination-over';
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cv.width, cv.height);
          ctx.globalCompositeOperation = 'source-over';
          var finish = function (bytes) {
            if (!bytes) { done(null); return; }
            done({ png: bytes, wPt: wPt, hPt: hPt, descentPt: descentPt });
          };
          if (cv.toBlob) {
            cv.toBlob(function (blob) {
              if (!blob) { finish(null); return; }
              blob.arrayBuffer().then(function (buf) { finish(new Uint8Array(buf)); },
                function () { finish(null); });
            }, 'image/png');
          } else {
            var durl = cv.toDataURL('image/png');
            var bin = atob(durl.split(',')[1]);
            var bytes = new Uint8Array(bin.length);
            for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
            finish(bytes);
          }
        } catch (e) { done(null); }
      };
      img.onerror = function () { done(null); };
      img.src = url;
    } catch (e) { done(null); }
  });
}

function wireMathTypeButton(copyBtn, pushBtn) {
  if (!window.__TAURI__ || !window.__TAURI__.core ||
      typeof window.__TAURI__.core.invoke !== 'function') return false;
  if (pushBtn.nextSibling && pushBtn.nextSibling.dataset &&
      pushBtn.nextSibling.dataset.chdMtWired) return true;
  var b2 = document.createElement('button');
  b2.type = 'button';
  b2.className = copyBtn.className;
  b2.dataset.chdMtWired = '1';
  b2.textContent = '⇢ Gửi thẳng vào Word MathType';
  b2.title = 'Đẩy công thức sang Word dưới dạng đối tượng MathType thật: trên Mac hiển thị ảnh xem trước, gửi file cho máy Windows có MathType sẽ mở sửa được';
  b2.style.background = '#1f6fd6';
  b2.style.borderColor = '#1f6fd6';
  b2.style.color = '#fff';
  b2.addEventListener('click', function () {
    var latex = '';
    try {
      var mfEl = document.getElementById('mathField');
      if (mfEl && typeof mfEl.getValue === 'function') latex = mfEl.getValue('latex') || '';
    } catch (e) {}
    latex = (latex || '').trim();
    if (!latex) { nativeToast('Chưa có công thức để gửi.'); return; }
    if (!window.MTCore || typeof window.MTCore.textToDocx !== 'function' ||
        typeof window.JSZip !== 'function') {
      nativeToast('Chức năng MathType chưa tải xong — hãy thử lại sau vài giây.');
      return;
    }
    b2.disabled = true;
    var preview = null;
    bridgePreviewFor(latex).then(function (res) {
      preview = res;
      return window.MTCore.textToDocx('$' + latex + '$',
        { mode: 'mathtype', previewFor: function () { return Promise.resolve(preview); } },
        window.JSZip);
    }).then(function (res) {
      var data = res && res.data;
      if (!data) throw new Error('no docx data');
      return (typeof data.arrayBuffer === 'function' ? data.arrayBuffer() : data)
        .then(function (buf) { return window.JSZip.loadAsync(buf); });
    }).then(function (zip) {
      var oleFile = zip.file('word/embeddings/oleObject1.bin');
      var imgFile = zip.file('word/media/image1.png');
      if (!oleFile || !imgFile) throw new Error('missing ole/png part');
      return Promise.all([
        oleFile.async('uint8array'),
        imgFile.async('uint8array')
      ]);
    }).then(function (parts) {
      b2.disabled = false;
      var wPt = (preview && preview.wPt) || 60;
      var hPt = (preview && preview.hPt) || 20;
      // Cùng hệ số 0.88 như đường xuất .docx MathType để cỡ hiển thị khớp chữ.
      var rtf = buildMathTypeRtf(parts[0], parts[1], wPt * 0.88, hPt * 0.88);
      return window.__TAURI__.core.invoke('push_mathtype_to_word',
        { rtf: rtf, plain: latex });
    }).then(function (msg) {
      nativeToast(msg || 'Đã gửi công thức MathType vào Word.');
    }).catch(function (err) {
      b2.disabled = false;
      nativeToast(typeof err === 'string' ? err :
        'Không gửi được công thức MathType vào Word.');
    });
  });
  pushBtn.parentNode.insertBefore(b2, pushBtn.nextSibling);
  return true;
}

// Poll cho tới khi gắn được nút (không giới hạn số lần): app mới chỉ tạo
// nút "Chép cho Word" sau khi đăng nhập xong, nên giới hạn 10 giây cũ sẽ
// bỏ lỡ nút nếu đăng nhập lâu hơn.
var chdTimer = setInterval(function () {
  if (wireWordButton()) clearInterval(chdTimer);
}, 250);
