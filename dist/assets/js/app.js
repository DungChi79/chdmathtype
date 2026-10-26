(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  var hasJSZip = typeof window.JSZip !== 'undefined';
  var hasKaTeX = typeof window.katex !== 'undefined';
  var hasCore = typeof window.MTCore !== 'undefined';

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }
  function downloadBlob(data, filename) {
    var url = URL.createObjectURL(data);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  function renderInto(el, tex, display) {
    if (hasKaTeX) { try { window.katex.render(tex, el, { displayMode: !!display, throwOnError: false, trust: true, strict: false }); return true; } catch (e) { /* rơi xuống */ } }
    el.innerHTML = '<span style="font-family:JetBrains Mono,monospace;font-size:12px">' + esc(tex) + '</span>';
    return false;
  }

  /* ---------- Cảnh báo thư viện ---------- */
  function refreshLibWarnings() {
    var msgs = [];
    if (!hasCore) msgs.push('Không tải được thư viện lõi MathType — hãy tải lại trang.');
    if (!hasJSZip) msgs.push('Không tải được thư viện JSZip (cần để mở/tạo file .docx) — kiểm tra kết nối mạng rồi tải lại trang.');
    if (!hasKaTeX) msgs.push('Không tải được KaTeX — xem trước sẽ hiện dạng mã LaTeX và xuất Equation tạm khóa; kiểm tra kết nối mạng rồi tải lại trang.');
    var el = $('libWarning');
    if (msgs.length) { el.textContent = msgs.join(' '); el.classList.add('show'); }
    else el.classList.remove('show');
  }

  /* ---------- Cau hinh khung soan MathLive theo mau toi thieu cua tai lieu ----------
     Ap MOT LAN cho moi math-field (va ap lai vo hai khi doi Inline/Display):
       defaultMode = 'math'  — khung trong mac dinh o che do toan.
       smartMode = false     — GHIM RO: smartMode co the tu chuyen field sang
                               che do text, khi do "/", "^", "_" chi la ky tu
                               thuong, khong con tao phan so/mu kieu Word.
       smartFence = true     — dat TUONG MINH (tai lieu khong ghi mac dinh):
                               ngoac tu lon dan \left...\right nhu Word.
       smartSuperscript = true — dat TUONG MINH: go chu so trong o mu trong
                               thi con tro tu nhay ra ngoai (x^2 roi go tiep).
       removeExtraneousParentheses = true (mac dinh cua MathLive, giu nguyen).
       mathModeSpace = ''    — Space khong chen gi trong math mode (no van
                               dung de nhay ra khoi o mu/chi so).
       popoverPolicy = 'auto' — go "\" hien goi y lenh (\frac, \sqrt...).
       mathVirtualKeyboardPolicy = 'manual' — ban phim ao khong tu mo/khong
                               chen vao duong bam nut cua bang mau.
       inlineShortcuts: GIU NGUYEN mac dinh cua MathLive bang cach spread
                               (pi -> \pi, alpha -> \alpha...). TUYET DOI
                               khong gan {} xoa sach nhu truoc.
       keybindings: chi THEM Tab/Shift+Tab = nhay giua cac o giu cho bang
                               cach spread mang hien co, khong thay wholesale.
     mf.mode chi nhan 'math'/'text'/'latex' — khung nay luon giu 'math';
     nut Inline/Display cua app chi doi bien displayMode rieng. */
  function applyEditorConfig(el) {
    if (!el) return;
    try { el.defaultMode = 'math'; } catch (e) {}
    try { el.smartMode = false; } catch (e) {}
    try { el.smartFence = true; } catch (e) {}
    try { el.smartSuperscript = true; } catch (e) {}
    try { el.removeExtraneousParentheses = true; } catch (e) {}
    try { el.mathModeSpace = ''; } catch (e) {}
    try { el.popoverPolicy = 'auto'; } catch (e) {}
    try { el.mathVirtualKeyboardPolicy = 'manual'; } catch (e) {}
    try {
      var sc = el.inlineShortcuts;
      if (sc && typeof sc === 'object') el.inlineShortcuts = Object.assign({}, sc);
    } catch (e) {}
    if (!el.__chdTabKb) {
      try {
        var kb = el.keybindings || [];
        el.keybindings = kb.concat([
          { key: '[Tab]', command: 'moveToNextPlaceholder' },
          { key: 'shift+[Tab]', command: 'moveToPreviousPlaceholder' }
        ]);
        el.__chdTabKb = true;
      } catch (e) {}
    }
  }
  function applyEditorConfigAll() {
    Array.prototype.forEach.call(document.querySelectorAll('math-field'), applyEditorConfig);
  }

  /* ---------- MathLive: nạp dạng module ESM từ jsdelivr (như các app trước) ---------- */
  var mathliveReady = false;
  function tryLoadMathLive() {
    var p;
    try { p = import('../../vendor/mathlive/mathlive.mjs'); }
    catch (e) { onMathLiveFailed(); return; }
    Promise.resolve(p).then(function () {
      mathliveReady = true;
      document.body.classList.add('mathlive-on');
      /* Ap cau hinh khung soan chuan (xem applyEditorConfig) cho moi
         math-field ngay khi chung duoc tao/nang cap. */
      applyEditorConfigAll();
      /* KHONG duoc gan mf.mode = 'inline'/'display': trong MathLive, "mode"
         la che do SOAN (math/text/latex), khong phai kieu hien thi. Gan sai
         gia tri nay lam hong model.mode -> mf.insert() nem loi va moi thao
         tac go phim/dieu huong theo mode deu truc trac. Kieu Display/Inline
         cua ung dung chi tac dong vao xem truoc va xuat file (bien
         displayMode), khong dung toi mf.mode. */
      $('mfFallback').hidden = true;
      syncMathFieldFromLatex();
      if (typeof onMathLiveReadyConvert === 'function') onMathLiveReadyConvert();
    }).catch(function () { onMathLiveFailed(); });
  }
  function onMathLiveFailed() {
    mathliveReady = false;
    $('mfFallback').hidden = false;
  }

  /* ---------- LaTeX -> MathML bằng KaTeX (script thường, tải ổn định) ---------- */
  function latexToMathml(latex) {
    if (!hasKaTeX || typeof window.katex.renderToString !== 'function') {
      throw new Error('KaTeX chưa tải được nên chưa tạo được MathML để xuất file.');
    }
    var out = window.katex.renderToString(latex, { output: 'mathml', throwOnError: false, trust: true });
    var start = out.indexOf('<math');
    var end = out.lastIndexOf('</math>');
    if (start < 0 || end < 0) throw new Error('KaTeX không tạo được MathML cho công thức này.');
    return out.slice(start, end + '</math>'.length);
  }

  /* =====================================================================
     Ảnh xem trước MathType (kế thừa nguyên vẹn từ app "Sửa MathType trên Mac"):
     MathJax tex-svg -> PNG có đọc ngược pixel tự kiểm chứng, KaTeX dự phòng.
     ===================================================================== */
  var previewStats = { total: 0, failed: 0 };
  function previewFor(latex, display) {
    previewStats.total++;
    return mathJaxPreviewForRaw(latex, display).then(function (res) {
      if (res && res.png) return res;
      return katexPreviewForRaw(latex, display).then(function (kres) {
        if (kres && kres.png) return kres;
        return res || kres;
      });
    }).then(function (res) {
      if (!res || !res.png) previewStats.failed++;
      return res;
    }, function () { previewStats.failed++; return null; });
  }
  function canvasHasVisiblePixels(canvas) {
    try {
      var w = canvas.width, h = canvas.height;
      if (!w || !h) return false;
      var ctx = canvas.getContext('2d');
      var data = ctx.getImageData(0, 0, w, h).data;
      var step = Math.max(1, Math.floor(Math.sqrt((w * h) / 20000)));
      var total = 0, filled = 0;
      for (var y = 0; y < h; y += step) {
        var rowBase = y * w;
        for (var x = 0; x < w; x += step) {
          total++;
          if (data[(rowBase + x) * 4 + 3] > 0) filled++;
        }
      }
      return total > 0 && filled >= 3 && (filled / total) > 0.0002;
    } catch (e) { return false; }
  }
  function canvasToPngBytes(canvas, cb) {
    if (canvas.toBlob) {
      try {
        canvas.toBlob(function (blob) {
          if (!blob) { cb(null); return; }
          blob.arrayBuffer().then(function (buf) { cb(new Uint8Array(buf)); }, function () { cb(null); });
        }, 'image/png');
        return;
      } catch (e) { /* rơi xuống cách toDataURL */ }
    }
    try {
      var durl = canvas.toDataURL('image/png');
      var bin = atob(durl.split(',')[1]);
      var bytes = new Uint8Array(bin.length);
      for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      cb(bytes);
    } catch (e) { cb(null); }
  }
  function rasterizeSvgText(svgText, wPx, hPx, scale, useDataUrl) {
    return new Promise(function (resolve) {
      var img = new Image();
      var blobUrl = null;
      var done = false;
      var finish = function (val) {
        if (done) return; done = true;
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        resolve(val);
      };
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(wPx * scale));
          canvas.height = Math.max(1, Math.round(hPx * scale));
          var ctx2 = canvas.getContext('2d');
          ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
          if (!canvasHasVisiblePixels(canvas)) { finish(null); return; }
          ctx2.globalCompositeOperation = 'destination-over';
          ctx2.fillStyle = '#ffffff';
          ctx2.fillRect(0, 0, canvas.width, canvas.height);
          ctx2.globalCompositeOperation = 'source-over';
          canvasToPngBytes(canvas, finish);
        } catch (e) { finish(null); }
      };
      img.onerror = function () { finish(null); };
      try {
        if (useDataUrl) {
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
        } else {
          blobUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
          img.src = blobUrl;
        }
      } catch (e) { finish(null); return; }
      setTimeout(function () { finish(null); }, 6000);
    });
  }
  /* Trả {svgText, w, h} của MathJax cho một công thức (dùng cho Tải SVG/PNG của trình soạn). */
  function mathJaxSvgFor(latex, display) {
    var MJ = window.MathJax;
    if (!MJ || typeof MJ.tex2svg !== 'function') return null;
    var node = null, svg = null;
    try { node = MJ.tex2svg(latex, { display: !!display }); } catch (e) { return null; }
    if (!node) return null;
    if (node.querySelector) svg = node.querySelector('svg');
    if (!svg && node.tagName && String(node.tagName).toLowerCase() === 'svg') svg = node;
    if (!svg) return null;
    var measure = $('mjMeasure');
    measure.innerHTML = '';
    var clone = svg.cloneNode(true);
    measure.appendChild(clone);
    var rect = clone.getBoundingClientRect();
    var w = rect.width, h = rect.height;
    measure.innerHTML = '';
    if (!w || !h) return null;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', String(Math.round(w)));
    clone.setAttribute('height', String(Math.round(h)));
    clone.style.verticalAlign = '';
    var uses = clone.querySelectorAll ? clone.querySelectorAll('use') : [];
    for (var ui = 0; ui < uses.length; ui++) {
      var hrefVal = uses[ui].getAttribute('href');
      if (hrefVal && !uses[ui].getAttribute('xlink:href')) uses[ui].setAttribute('xlink:href', hrefVal);
    }
    var svgText;
    try { svgText = new XMLSerializer().serializeToString(clone); }
    catch (e) { return null; }
    return { svgText: svgText, w: w, h: h };
  }
  function mathJaxPreviewForRaw(latex, display) {
    var MJ = window.MathJax;
    if (!MJ || typeof MJ.tex2svg !== 'function') return Promise.resolve(null);
    var node = null, svg = null;
    try { node = MJ.tex2svg(latex, { display: !!display }); } catch (e) { return Promise.resolve(null); }
    if (!node) return Promise.resolve(null);
    if (node.querySelector) svg = node.querySelector('svg');
    if (!svg && node.tagName && String(node.tagName).toLowerCase() === 'svg') svg = node;
    if (!svg) return Promise.resolve(null);
    var measure = $('mjMeasure');
    measure.innerHTML = '';
    measure.appendChild(svg);
    var rect = svg.getBoundingClientRect();
    var w = rect.width, h = rect.height;
    if (!w || !h) { measure.innerHTML = ''; return Promise.resolve(null); }
    var wPt = Math.max(6, w * 72 / 96), hPt = Math.max(6, h * 72 / 96);
    var hEx = parseFloat(svg.getAttribute('height'));
    var vaEx = parseFloat(svg.style.verticalAlign);
    var descentPt;
    if (isFinite(hEx) && hEx > 0 && isFinite(vaEx)) descentPt = hPt * (-vaEx / hEx);
    var sizeOnly = { wPt: wPt, hPt: hPt };
    if (typeof descentPt === 'number' && isFinite(descentPt) && descentPt >= 0) sizeOnly.descentPt = descentPt;
    var scale = 4;
    var clone = svg.cloneNode(true);
    measure.innerHTML = '';
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', String(Math.round(w * scale)));
    clone.setAttribute('height', String(Math.round(h * scale)));
    clone.style.verticalAlign = '';
    var uses = clone.querySelectorAll ? clone.querySelectorAll('use') : [];
    for (var ui = 0; ui < uses.length; ui++) {
      var hrefVal = uses[ui].getAttribute('href');
      if (hrefVal && !uses[ui].getAttribute('xlink:href')) {
        uses[ui].setAttribute('xlink:href', hrefVal);
      }
    }
    var svgText;
    try { svgText = new XMLSerializer().serializeToString(clone); }
    catch (e) { return Promise.resolve(sizeOnly); }
    var withPng = function (pngBytes) {
      if (!pngBytes) return sizeOnly;
      var resPng = { png: pngBytes, wPt: wPt, hPt: hPt };
      if (sizeOnly.descentPt !== undefined) resPng.descentPt = sizeOnly.descentPt;
      return resPng;
    };
    return rasterizeSvgText(svgText, w, h, scale, false).then(function (pngBytes) {
      if (pngBytes) return withPng(pngBytes);
      return rasterizeSvgText(svgText, w, h, scale, true).then(withPng);
    });
  }
  var katexCssText = null, katexCssPromise = null;
  function fetchKatexCss() {
    if (katexCssText !== null) return Promise.resolve(katexCssText);
    if (katexCssPromise) return katexCssPromise;
    var href = null;
    var links = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < links.length; i++) {
      if (/katex/i.test(links[i].href || '')) { href = links[i].href; break; }
    }
    if (!href) { katexCssText = ''; return Promise.resolve(''); }
    var base = href.slice(0, href.lastIndexOf('/') + 1);
    katexCssPromise = fetch(href).then(function (r) { return r.text(); }).then(function (css) {
      katexCssText = css.replace(/url\((?!['"]?(?:https?:|data:))['"]?([^'")]+)['"]?\)/g, function (m, p) {
        return 'url(' + base + p + ')';
      });
      return katexCssText;
    }).catch(function () { katexCssText = ''; return ''; });
    return katexCssPromise;
  }
  function katexPreviewForRaw(latex, display) {
    if (!hasKaTeX) return Promise.resolve(null);
    var measure = $('katexMeasure');
    return fetchKatexCss().then(function (css) {
      return new Promise(function (resolve) {
        try {
          window.katex.render(latex, measure, { throwOnError: false, displayMode: !!display, strict: false });
          var w = measure.offsetWidth, h = measure.offsetHeight;
          if (!w || !h) { resolve(null); return; }
          var wPt = Math.max(6, w * 0.75), hPt = Math.max(6, h * 0.75);
          var descentPt;
          var strut = measure.querySelector('.katex-html .base .strut');
          if (strut) {
            var sh = parseFloat(strut.style.height), sva = parseFloat(strut.style.verticalAlign);
            if (isFinite(sh) && sh > 0 && isFinite(sva)) descentPt = hPt * (-sva / sh);
          }
          var sizeOnly = { wPt: wPt, hPt: hPt };
          if (typeof descentPt === 'number') sizeOnly.descentPt = descentPt;
          if (!css) { resolve(sizeOnly); return; }
          var html = new XMLSerializer().serializeToString(measure.firstChild || measure);
          var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' +
            '<style><![CDATA[' + css + ']]></style>' +
            '<foreignObject x="0" y="0" width="100%" height="100%">' +
            '<div xmlns="http://www.w3.org/1999/xhtml" style="font-size:22px;">' + html + '</div>' +
            '</foreignObject></svg>';
          rasterizeSvgText(svg, w, h, 3, false).then(function (pngBytes) {
            if (!pngBytes) { resolve(sizeOnly); return; }
            var resPng = { png: pngBytes, wPt: wPt, hPt: hPt };
            if (typeof descentPt === 'number') resPng.descentPt = descentPt;
            resolve(resPng);
          });
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }

  /* ---------- Chuyển tab chính ---------- */
  function switchTab(which) {
    ['tabEdit', 'tab1', 'tab2', 'tab3', 'tab4'].forEach(function (t) {
      var btn = document.querySelector('.tab-btn[data-tab="' + t + '"]');
      if (btn) btn.classList.toggle('active', t === which);
      $(t).hidden = t !== which;
    });
  }
  document.querySelectorAll('.tab-btn').forEach(function (b) {
    b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
  });

  /* =====================================================================
     TAB SOẠN THẢO
     ===================================================================== */
  var DEFAULT_EQ = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}';
  var curLatex = DEFAULT_EQ;
  var displayMode = false;
  var mf = $('mathField'), ta = $('latexInput');
  var syncing = false;

  /* ---------- Bảng mẫu (dữ liệu kế thừa MathRenderer Web) ---------- */
  var PALETTE = {
  "Quan hệ":[["\\leq","\\leq"],["\\geq","\\geq"],["\\neq","\\neq"],["\\approx","\\approx"],["\\equiv","\\equiv"],["\\sim","\\sim"],["\\simeq","\\simeq"],["\\cong","\\cong"],["\\propto","\\propto"],["\\perp","\\perp"],["\\parallel","\\parallel"],["\\nparallel","\\nparallel"],["<","<"],[">",">"],["=","="],["\\ll","\\ll"],["\\gg","\\gg"],["\\prec","\\prec"],["\\succ","\\succ"],["\\preceq","\\preceq"],["\\succeq","\\succeq"],["\\doteq","\\doteq"],["\\asymp","\\asymp"],["\\mid","\\mid"],["\\nmid","\\nmid"]],
  "Phép toán":[["\\pm","\\pm"],["\\mp","\\mp"],["\\times","\\times"],["\\div","\\div"],["\\cdot","\\cdot"],["\\ast","\\ast"],["\\star","\\star"],["\\oplus","\\oplus"],["\\ominus","\\ominus"],["\\otimes","\\otimes"],["\\oslash","\\oslash"],["\\circ","\\circ"],["\\bullet","\\bullet"],["\\cdots","\\cdots"],["\\ldots","\\ldots"],["\\vdots","\\vdots"],["\\ddots","\\ddots"],["+","+"],["-","-"],["\\cup","\\cup"],["\\cap","\\cap"],["\\wedge","\\wedge"],["\\vee","\\vee"],["\\bigtriangleup","\\bigtriangleup"]],
  "Mũi tên":[["\\rightarrow","\\rightarrow"],["\\leftarrow","\\leftarrow"],["\\leftrightarrow","\\leftrightarrow"],["\\Rightarrow","\\Rightarrow"],["\\Leftarrow","\\Leftarrow"],["\\Leftrightarrow","\\Leftrightarrow"],["\\Longrightarrow","\\Longrightarrow",1],["\\longrightarrow","\\longrightarrow",1],["\\mapsto","\\mapsto"],["\\uparrow","\\uparrow"],["\\downarrow","\\downarrow"],["\\updownarrow","\\updownarrow"],["\\nearrow","\\nearrow"],["\\searrow","\\searrow"],["\\hookrightarrow","\\hookrightarrow"],["\\rightharpoonup","\\rightharpoonup"],["\\rightleftharpoons","\\rightleftharpoons"],["\\to","\\to"],["\\implies","\\implies"],["\\iff","\\iff"]],
  "Tập hợp & logic":[["\\forall","\\forall"],["\\exists","\\exists"],["\\nexists","\\nexists"],["\\neg","\\neg"],["\\land","\\land"],["\\lor","\\lor"],["\\vdash","\\vdash"],["\\models","\\models"],["\\therefore","\\therefore"],["\\because","\\because"],["\\top","\\top"],["\\bot","\\bot"],["\\in","\\in"],["\\notin","\\notin"],["\\ni","\\ni"],["\\subset","\\subset"],["\\subseteq","\\subseteq"],["\\supset","\\supset"],["\\supseteq","\\supseteq"],["\\nsubseteq","\\nsubseteq"],["\\bigcup","\\bigcup"],["\\bigcap","\\bigcap"],["\\emptyset","\\emptyset"],["\\varnothing","\\varnothing"],["\\setminus","\\setminus"],["\\complement","\\complement"],["\\mathbb{N}","\\mathbb{N}"],["\\mathbb{Z}","\\mathbb{Z}"],["\\mathbb{Q}","\\mathbb{Q}"],["\\mathbb{R}","\\mathbb{R}"],["\\mathbb{C}","\\mathbb{C}"],["\\aleph","\\aleph"],["\\infty","\\infty"]],
  "Hy Lạp":[["\\alpha","\\alpha"],["\\beta","\\beta"],["\\gamma","\\gamma"],["\\delta","\\delta"],["\\epsilon","\\epsilon"],["\\varepsilon","\\varepsilon"],["\\zeta","\\zeta"],["\\eta","\\eta"],["\\theta","\\theta"],["\\vartheta","\\vartheta"],["\\iota","\\iota"],["\\kappa","\\kappa"],["\\lambda","\\lambda"],["\\mu","\\mu"],["\\nu","\\nu"],["\\xi","\\xi"],["\\pi","\\pi"],["\\rho","\\rho"],["\\sigma","\\sigma"],["\\varsigma","\\varsigma"],["\\tau","\\tau"],["\\upsilon","\\upsilon"],["\\phi","\\phi"],["\\varphi","\\varphi"],["\\chi","\\chi"],["\\psi","\\psi"],["\\omega","\\omega"],["\\Gamma","\\Gamma"],["\\Delta","\\Delta"],["\\Theta","\\Theta"],["\\Lambda","\\Lambda"],["\\Xi","\\Xi"],["\\Pi","\\Pi"],["\\Sigma","\\Sigma"],["\\Upsilon","\\Upsilon"],["\\Phi","\\Phi"],["\\Psi","\\Psi"],["\\Omega","\\Omega"]],
  "Phân số & căn":[["\\frac{}{}","\\frac{a}{b}",1],["\\dfrac{}{}","\\dfrac{a}{b}",1],["\\tfrac{}{}","\\tfrac{a}{b}",1],["\\sqrt{}","\\sqrt{x}",1],["\\sqrt[]{}","\\sqrt[n]{x}",1],["\\cfrac{}{}","\\cfrac{a}{b}",1],["\\frac{1}{}","\\frac{1}{x}",1],["{}^\\circ","x^\\circ"],["\\%","\\%"]],
  "Mũ & chỉ số":[["{}^{}","x^{n}",1],["{}_{}","x_{n}",1],["{}_{}^{}","x_{i}^{n}",1],["x_i","x_i"],["x^2","x^2"],["x^3","x^3"],["a_{n}","a_{n}"],["a_{n+1}","a_{n+1}",1],["{}^{\\prime}","x'",1],["f'(x)","f'(x)",1],["f''(x)","f''(x)",1],["e^{x}","e^{x}"],["10^{}","10^{n}",1]],
  "Ngoặc":[["\\left( \\right)","\\left( x \\right)",1],["\\left[ \\right]","\\left[ x \\right]",1],["\\left\\{ \\right\\}","\\left\\{ x \\right\\}",1],["\\left| \\right|","\\left| x \\right|",1],["\\left\\| \\right\\|","\\left\\| x \\right\\|",1],["\\langle \\rangle","\\langle x \\rangle",1],["\\lfloor \\rfloor","\\lfloor x \\rfloor",1],["\\lceil \\rceil","\\lceil x \\rceil",1],["( )","(x)"],["[ ]","[x]"]],
  "Dấu trên / dưới":[["\\hat{}","\\hat{x}",1],["\\bar{}","\\bar{x}",1],["\\vec{}","\\vec{x}",1],["\\dot{}","\\dot{x}",1],["\\ddot{}","\\ddot{x}",1],["\\tilde{}","\\tilde{x}",1],["\\overline{}","\\overline{AB}",1],["\\underline{}","\\underline{x}",1],["\\widehat{}","\\widehat{ABC}",1],["\\overrightarrow{}","\\overrightarrow{AB}",1],["\\overbrace{}^{}","\\overbrace{x}^{n}",1],["\\underbrace{}_{}","\\underbrace{x}_{n}",1],["\\check{}","\\check{x}",1],["\\acute{}","\\acute{x}",1],["\\grave{}","\\grave{x}",1]],
  "Tổng & tích":[["\\sum_{}^{}{}","\\sum_{i=1}^{n}",1],["\\sum_{}","\\sum_{i}",1],["\\sum^{}","\\sum^{n}",1],["\\prod_{}^{}{}","\\prod_{i=1}^{n}",1],["\\coprod_{}^{}{}","\\coprod_{i=1}^{n}",1],["\\bigcup_{}^{}{}","\\bigcup_{i=1}^{n}",1],["\\bigcap_{}^{}{}","\\bigcap_{i=1}^{n}",1],["\\bigoplus","\\bigoplus"],["\\bigotimes","\\bigotimes"]],
  "Tích phân & giới hạn":[["\\int","\\int"],["\\int_{}^{}{}","\\int_{a}^{b}",1],["\\iint","\\iint"],["\\iiint","\\iiint"],["\\oint","\\oint"],["\\oiint","\\oiint"],["\\int_{}^{}{}","\\int_{-\\infty}^{+\\infty}",1],["\\lim_{}","\\lim_{x \\to 0}",1],["\\lim_{}","\\lim_{x \\to \\infty}",1],["\\lim_{}","\\lim_{x \\to 0^+}",1]],
  "Ma trận & hệ":[["\\begin{pmatrix} #0 & #0 \\\\ #0 & #0 \\end{pmatrix}","\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",1],["\\begin{bmatrix} #0 & #0 \\\\ #0 & #0 \\end{bmatrix}","\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}",1],["\\begin{vmatrix} #0 & #0 \\\\ #0 & #0 \\end{vmatrix}","\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}",1],["\\begin{matrix} #0 & #0 \\\\ #0 & #0 \\end{matrix}","\\begin{matrix} a & b \\\\ c & d \\end{matrix}",1],["\\begin{pmatrix} #0 & #0 & #0 \\\\ #0 & #0 & #0 \\\\ #0 & #0 & #0 \\end{pmatrix}","\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}",1],["\\binom{}{}","\\binom{n}{k}",1],["\\begin{cases} #0 & \\\\ #0 & \\end{cases}","\\begin{cases} x=1 \\\\ y=2 \\end{cases}",1]],
  "Hàm lượng giác & hàm số":[["\\sin","\\sin"],["\\cos","\\cos"],["\\tan","\\tan"],["\\cot","\\cot"],["\\sec","\\sec"],["\\csc","\\csc"],["\\arcsin","\\arcsin"],["\\arccos","\\arccos"],["\\arctan","\\arctan"],["\\sinh","\\sinh"],["\\cosh","\\cosh"],["\\ln","\\ln"],["\\log","\\log"],["\\log_{}","\\log_{a}",1],["\\exp","\\exp"],["\\min","\\min"],["\\max","\\max"],["\\det","\\det"],["\\gcd","\\gcd"],["\\sin{}","\\sin x",1],["\\cos{}","\\cos x",1],["\\log_{10}","\\log_{10}"]],
  "Giải tích":[["\\frac{d}{dx}","\\frac{d}{dx}",1],["\\frac{dy}{dx}","\\frac{dy}{dx}",1],["\\frac{\\partial}{\\partial x}","\\frac{\\partial f}{\\partial x}",1],["\\frac{\\partial^2}{\\partial x^2}","\\frac{\\partial^2 f}{\\partial x^2}",1],["\\nabla","\\nabla"],["\\Delta","\\Delta"],["\\infty","\\infty"],["\\partial","\\partial"],["f'(x)","f'(x)"],["f''(x)","f''(x)"],["\\frac{d^n}{dx^n}","\\frac{d^n}{dx^n}",1],["\\int_{}^{}{}","\\int_{a}^{b}",1]],
  "Thống kê":[["\\bar{x}","\\bar{x}"],["\\hat{p}","\\hat{p}"],["\\sigma","\\sigma"],["\\sigma^2","\\sigma^2"],["\\mu","\\mu"],["\\binom{}{}","\\binom{n}{k}",1],["P(A|B)","P(A|B)",1],["\\mathbb{E}[X]","\\mathbb{E}[X]",1],["\\mathrm{Var}(X)","\\mathrm{Var}(X)",1],["\\frac{\\sum x_i}{n}","\\frac{\\sum x_i}{n}",1],["\\chi^2","\\chi^2"],["\\sim","\\sim"],["N(\\mu, \\sigma^2)","N(\\mu, \\sigma^2)",1],["\\rho","\\rho"]],
  "Hình học":[["\\angle","\\angle"],["\\measuredangle","\\measuredangle"],["\\triangle","\\triangle"],["\\perp","\\perp"],["\\parallel","\\parallel"],["\\cong","\\cong"],["\\sim","\\sim"],["{}^\\circ","90^\\circ"],["\\overrightarrow{}","\\overrightarrow{AB}",1],["\\overline{}","\\overline{AB}",1],["\\widehat{}","\\widehat{ABC}",1],["\\odot","\\odot"],["\\square","\\square"],["\\overrightarrow{}","\\overrightarrow{v}",1],["\\cdot","\\cdot"],["\\times","\\times"]]
  };
  var TAB_ORDER = ["Quan hệ","Phép toán","Mũi tên","Tập hợp & logic","Hy Lạp","Phân số & căn","Mũ & chỉ số","Ngoặc","Dấu trên / dưới","Tổng & tích","Tích phân & giới hạn","Ma trận & hệ","Hàm lượng giác & hàm số","Giải tích","Thống kê","Hình học"];
  var activePalTab = TAB_ORDER[0];
  var tabsEl = $('paletteTabs'), gridEl = $('paletteGrid');
  TAB_ORDER.forEach(function (name) {
    var b = document.createElement('button');
    b.className = 'ptab' + (name === activePalTab ? ' active' : '');
    b.type = 'button'; b.textContent = name;
    b.addEventListener('click', function () {
      activePalTab = name;
      Array.prototype.forEach.call(tabsEl.children, function (c) { c.classList.toggle('active', c.textContent === name); });
      renderPalette();
    });
    tabsEl.appendChild(b);
  });
  function renderPalette() {
    gridEl.innerHTML = '';
    (PALETTE[activePalTab] || []).forEach(function (item) {
      var b = document.createElement('button');
      b.className = 'sym-btn' + (item[2] ? ' wide' : '');
      b.type = 'button'; b.title = item[0];
      renderInto(b, item[1], false);
      if (!hasKaTeX) b.innerHTML = '<span class="fallback">' + esc(item[0]) + '</span>';
      b.addEventListener('click', function () { insertLatex(item[0]); });
      gridEl.appendChild(b);
    });
  }

  /* ---------- Đồng bộ MathLive <-> LaTeX ---------- */
  function mfAvailable() { return mathliveReady && mf && window.customElements && customElements.get('math-field'); }
  function syncMathFieldFromLatex() {
    if (!mfAvailable()) return;
    syncing = true;
    try { mf.setValue(curLatex, { silenceNotifications: true }); } catch (e) { try { mf.value = curLatex; } catch (e2) {} }
    syncing = false;
  }
  function setLatex(v, source) {
    curLatex = v;
    if (source !== 'mf') syncMathFieldFromLatex();
    if (source !== 'ta') ta.value = v;
    renderPreview();
  }
  function renderPreview() {
    var box = $('previewBox'); box.innerHTML = '';
    if (!curLatex.trim()) { box.innerHTML = '<span class="empty">Công thức trống — hãy gõ LaTeX hoặc bấm một mẫu ở bảng trên.</span>'; return; }
    var ok = renderInto(box, curLatex, displayMode);
    if (!ok) {
      box.innerHTML = '<span class="preview-err">' + esc(curLatex) + '</span>';
    }
  }
  if (mf) {
    mf.addEventListener('input', function () {
      if (syncing) return;
      var v = '';
      try { v = mf.getValue(); } catch (e) { v = mf.value || ''; }
      curLatex = v; ta.value = v; renderPreview();
    });
    /* Enter = nhay sang o giu cho tiep theo thay vi "chot" cong thuc —
       mau chinh thuc trong tai lieu MathLive (huong dan Interacting):
       chan insertLineBreak o beforeinput roi goi moveToNextPlaceholder.
       Khong chan bat ky loai beforeinput nao khac. Tab/Shift+Tab cung
       nhay giua cac o nho keybindings da ghim trong applyEditorConfig. */
    mf.addEventListener('beforeinput', function (ev) {
      if (ev.inputType === 'insertLineBreak') {
        ev.preventDefault();
        try { mf.executeCommand('moveToNextPlaceholder'); } catch (e) {}
      }
    });
  }
  ta.addEventListener('input', function () { setLatex(ta.value, 'ta'); });


  function insertLatex(tpl) {
    if (mfAvailable() && document.activeElement !== ta) {
      try {
        /* Chen mau theo mau chuan cua tai lieu MathLive: DUNG MOT loi goi
           mf.insert(latex, {format:'latex', mode:'math',
           selectionMode:'placeholder', focus:true}) — o giu cho dau tien
           duoc chon san, go chu se thay dung o do. Sau khi chen KHONG lam
           gi them voi field: khong mf.value=, khong focus+click, khong
           su kien tong hop, khong show/hide ban phim ao, khong viet lai
           selection — chinh cac thao tac do (va lop "giu vung chon" cu)
           lam sup vung chon o giu cho, khien phim go dau tien xoa ca
           cau truc mau (loi nguoi dung tai hien 2026-10-23: chen phan so
           roi go "a" thi mat phan so, chi con "a").
           selectionMode 'item' bi CAM: no chon toan bo cau truc vua chen
           nen phim dau tien thay the ca mau.
           O trong trong mau dung token #? — o giu cho that cua MathLive
           tren 0.104.x (ca {} lan [] cua \sqrt[]{} va #0 trong cac mau
           ma tran/he deu duoc doi sang #?). */
        if (mf.mode !== 'math') { try { mf.mode = 'math'; } catch (e) {} }
        var ml = tpl.replace(/\{\}/g, '{#?}').replace(/\[\]/g, '[#?]');
        ml = ml.replace(/#0/g, '#?');
        ml = ml.replace(/\\left(\\?.)\s+\\right/g, '\\left$1 #? \\right');
        ml = ml.replace(/\\(langle|lfloor|lceil)\s+\\(rangle|rfloor|rceil)/g, '\\$1 #? \\$2');
        ml = ml.replace(/\(\s+\)/g, '( #? )').replace(/\[\s+\]/g, '[ #? ]');
        var hasPh = ml.indexOf('#?') >= 0;
        var okIns = mf.insert(ml, {
          format: 'latex',
          mode: 'math',
          selectionMode: hasPh ? 'placeholder' : 'after',
          focus: true
        });
        if (!okIns) throw new Error('mf.insert that bai');
        if (mf.errors && mf.errors.length) { try { console.warn('MathLive insert errors:', mf.errors); } catch (e) {} }
        var v = ''; try { v = mf.getValue(); } catch (e) { v = mf.value || ''; }
        curLatex = v; ta.value = v; renderPreview();
        return;
      } catch (e) { /* rơi xuống chèn vào textarea */ }
    }
    tpl = tpl.replace(/#0/g, ''); /* #0 la o trong danh cho MathLive; chen vao o LaTeX thi de trong that */
    var start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    var end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
    var before = ta.value.slice(0, start), after = ta.value.slice(end);
    var needSpace = (before && !/[\s{(\[]$/.test(before) && tpl.charAt(0) === '\\') ? ' ' : '';
    var nv = before + needSpace + tpl + after;
    setLatex(nv); ta.focus();
    var pos = (before + needSpace).length;
    var idx = tpl.indexOf('{}');
    ta.selectionStart = ta.selectionEnd = idx >= 0 ? pos + idx + 1 : pos + tpl.length;
  }

  /* ---------- Chế độ Display / Inline ---------- */
  function setMode(d) {
    displayMode = d;
    $('modeDisplay').classList.toggle('active', d);
    $('modeInline').classList.toggle('active', !d);
    /* displayMode chi doi cach xem truoc (KaTeX displayMode) va cach xuat
       (oMathPara / $$...$$). Tuyet doi khong gan mf.mode o day — xem giai
       thich o tryLoadMathLive: mf.mode la che do soan cua MathLive, gan
       'display'/'inline' vao se lam hong chen mau va go phim trong khung. */
    /* Ap lai cau hinh khung soan chuan sau moi lan chuyen che do (vo hai:
       cac tuy chon la idempotent, keybindings Tab chi ghim mot lan). */
    applyEditorConfig(mf);
    renderPreview();
  }
  $('modeDisplay').addEventListener('click', function () { setMode(true); });
  $('modeInline').addEventListener('click', function () { setMode(false); });

  /* ---------- Trình tạo ma trận ---------- */
  $('btnMatrix').addEventListener('click', function () {
    var r = Math.max(1, Math.min(6, parseInt($('matRows').value, 10) || 3));
    var c = Math.max(1, Math.min(6, parseInt($('matCols').value, 10) || 3));
    var t = $('matType').value;
    var rows = [], i, j;
    if (t === 'cases') {
      for (i = 0; i < r; i++) rows.push('#0');
      insertLatex('\\begin{cases} ' + rows.join(' \\\\ ') + ' \\end{cases}');
    } else {
      for (i = 0; i < r; i++) { var cells = []; for (j = 0; j < c; j++) cells.push('#0'); rows.push(cells.join(' & ')); }
      insertLatex('\\begin{' + t + '} ' + rows.join(' \\\\ ') + ' \\end{' + t + '}');
    }
    toast('Đã chèn ' + (t === 'cases' ? 'hệ phương trình' : 'ma trận ' + r + '×' + c) + '.');
  });

  /* ---------- Công thức thường dùng + ví dụ ngẫu nhiên ---------- */
  var TEMPLATES = [
    ["Công thức nghiệm bậc hai", "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"],
    ["Định lý Pythagoras", "a^2 + b^2 = c^2"],
    ["Đồng nhất thức Euler", "e^{i\\pi} + 1 = 0"],
    ["Nhị thức Newton", "(a+b)^n = \\sum_{k=0}^{n} \\binom{n}{k} a^{n-k} b^k"],
    ["Khai triển Taylor", "f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!} (x-a)^n"],
    ["Tích phân Gauss", "\\int_{-\\infty}^{+\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}"],
    ["Định nghĩa đạo hàm", "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h) - f(x)}{h}"],
    ["Tích phân từng phần", "\\int u \\, dv = uv - \\int v \\, du"],
    ["Biệt thức Δ", "\\Delta = b^2 - 4ac"],
    ["Định lý cosin", "c^2 = a^2 + b^2 - 2ab \\cos C"],
    ["Tổng cấp số cộng", "S_n = \\frac{n(a_1 + a_n)}{2}"],
    ["Bất đẳng thức Cauchy", "\\frac{a+b}{2} \\geq \\sqrt{ab}"]
  ];
  var tplGrid = $('tplGrid');
  TEMPLATES.forEach(function (t) {
    var b = document.createElement('button');
    b.className = 'tpl-card'; b.type = 'button';
    b.innerHTML = '<b>' + esc(t[0]) + '</b><div class="render"></div>';
    renderInto(b.querySelector('.render'), t[1], false);
    b.addEventListener('click', function () { setLatex(t[1]); toast('Đã nạp: ' + t[0] + '.'); });
    tplGrid.appendChild(b);
  });
  var RANDOM_POOL = TEMPLATES.map(function (t) { return t[1]; }).concat([
    "\\zeta(s) = \\sum_{n=1}^{\\infty} \\frac{1}{n^s}",
    "E = mc^2",
    "P(A \\mid B) = \\frac{P(B \\mid A) P(A)}{P(B)}",
    "\\sin^2\\theta + \\cos^2\\theta = 1",
    "\\vec{a} \\cdot \\vec{b} = |\\vec{a}| \\, |\\vec{b}| \\cos\\theta",
    "\\log_a b = \\frac{\\ln b}{\\ln a}"
  ]);
  /* Hai nút "Ví dụ ngẫu nhiên" / "Công thức mới" đã bỏ khỏi giao diện
     (thay bằng khu vực đăng nhập ở góc trên bên phải) — không gắn handler nữa. */

  /* ---------- Lịch sử & yêu thích (localStorage, chỉ trong trình duyệt này) ---------- */
  var HKEY = 'chdmathtype_history_v1';
  var histFilterFav = false;
  function loadHist() { try { return JSON.parse(localStorage.getItem(HKEY) || '[]'); } catch (e) { return []; } }
  function storeHist(h) { try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, 80))); } catch (e) {} }
  function saveHistory(latex) {
    if (!latex || !latex.trim()) return;
    var h = loadHist().filter(function (x) { return x.latex !== latex; });
    var wasFav = false;
    loadHist().forEach(function (x) { if (x.latex === latex) wasFav = !!x.fav; });
    h.unshift({ latex: latex, fav: wasFav, ts: Date.now() });
    storeHist(h); renderHist();
  }
  function renderHist() {
    var all = loadHist();
    var h = histFilterFav ? all.filter(function (x) { return x.fav; }) : all;
    var el = $('histList'); el.innerHTML = '';
    if (!h.length) {
      el.innerHTML = '<div class="empty-note">' + (histFilterFav ? 'Chưa có công thức yêu thích nào. Bấm ★ ở một mục trong lịch sử để ghim.' : 'Lịch sử trống. Bấm “Lưu vào lịch sử”, hoặc chép/xuất một công thức, nó sẽ xuất hiện ở đây.') + '</div>';
      return;
    }
    h.forEach(function (item) {
      var d = document.createElement('div'); d.className = 'hist-item';
      d.innerHTML = '<div class="hist-main"><div class="hist-render"></div><div class="hist-code"></div></div>' +
        '<button class="icon-btn ' + (item.fav ? 'starred' : '') + '" type="button" title="Yêu thích">' + (item.fav ? '★' : '☆') + '</button>' +
        '<button class="icon-btn del" type="button" title="Xoá">✕</button>';
      renderInto(d.querySelector('.hist-render'), item.latex, false);
      d.querySelector('.hist-code').textContent = item.latex;
      d.querySelector('.hist-main').addEventListener('click', function () { setLatex(item.latex); toast('Đã nạp lại công thức từ lịch sử.'); });
      d.querySelector('.icon-btn').addEventListener('click', function () {
        var hh = loadHist();
        for (var i = 0; i < hh.length; i++) if (hh[i].latex === item.latex && hh[i].ts === item.ts) { hh[i].fav = !hh[i].fav; break; }
        storeHist(hh); renderHist();
      });
      d.querySelector('.del').addEventListener('click', function () {
        var hh = loadHist().filter(function (x) { return !(x.latex === item.latex && x.ts === item.ts); });
        storeHist(hh); renderHist(); toast('Đã xoá khỏi lịch sử.');
      });
      el.appendChild(d);
    });
  }
  $('filterAll').addEventListener('click', function () { histFilterFav = false; renderHist(); });
  $('filterFav').addEventListener('click', function () { histFilterFav = true; renderHist(); });
  $('btnClearHist').addEventListener('click', function () { storeHist([]); renderHist(); toast('Đã xoá toàn bộ lịch sử.'); });
  $('btnSaveHist').addEventListener('click', function () {
    if (!curLatex.trim()) { toast('Chưa có công thức để lưu.'); return; }
    saveHistory(curLatex); toast('Đã lưu công thức vào lịch sử.');
  });

  /* ---------- Bộ công thức (doc set) ---------- */
  var DKEY = 'chdmathtype_docset_v1';
  var docSet = [];
  try { docSet = JSON.parse(localStorage.getItem(DKEY) || '[]'); } catch (e) { docSet = []; }
  function storeDoc() { try { localStorage.setItem(DKEY, JSON.stringify(docSet)); } catch (e) {} }
  function switchPane(name) {
    document.querySelectorAll('.rtab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-pane') === name); });
    document.querySelectorAll('.rpane').forEach(function (p) { p.classList.toggle('active', p.id === 'pane-' + name); });
  }
  document.querySelectorAll('.rtab').forEach(function (t) {
    t.addEventListener('click', function () { switchPane(t.getAttribute('data-pane')); });
  });
  function renderDoc() {
    var el = $('docList'); el.innerHTML = '';
    $('docCount').textContent = docSet.length ? '(' + docSet.length + ')' : '';
    $('docFoot').hidden = docSet.length === 0;
    if (!docSet.length) { el.innerHTML = '<div class="empty-note">Bộ đang trống. Soạn một công thức rồi bấm “Thêm vào bộ công thức”.</div>'; return; }
    docSet.forEach(function (item, idx) {
      var d = document.createElement('div'); d.className = 'doc-item';
      if (item.type === 'eq') {
        var r = document.createElement('div'); r.className = 'render'; renderInto(r, item.latex, true); d.appendChild(r);
        var code = document.createElement('div'); code.className = 'hist-code'; code.textContent = item.latex; d.appendChild(code);
      } else {
        var inp = document.createElement('input'); inp.type = 'text'; inp.value = item.text; inp.placeholder = 'Dòng chữ (tiêu đề, câu dẫn…)';
        inp.addEventListener('input', function () { item.text = inp.value; storeDoc(); });
        d.appendChild(inp);
      }
      var ctrl = document.createElement('div'); ctrl.className = 'doc-ctrl';
      ctrl.innerHTML = '<button class="mini-btn" type="button">↑ Lên</button><button class="mini-btn" type="button">↓ Xuống</button>' +
        (item.type === 'eq' ? '<button class="mini-btn" type="button">Sửa</button>' : '') +
        '<button class="mini-btn danger" type="button">Xoá</button>';
      var btns = ctrl.querySelectorAll('button');
      btns[0].addEventListener('click', function () { if (idx > 0) { var t = docSet[idx - 1]; docSet[idx - 1] = docSet[idx]; docSet[idx] = t; storeDoc(); renderDoc(); } });
      btns[1].addEventListener('click', function () { if (idx < docSet.length - 1) { var t = docSet[idx + 1]; docSet[idx + 1] = docSet[idx]; docSet[idx] = t; storeDoc(); renderDoc(); } });
      if (item.type === 'eq') btns[2].addEventListener('click', function () { setLatex(item.latex); toast('Đã nạp công thức của bộ vào khung soạn.'); });
      btns[btns.length - 1].addEventListener('click', function () { docSet.splice(idx, 1); storeDoc(); renderDoc(); });
      d.appendChild(ctrl); el.appendChild(d);
    });
  }
  $('btnAddDoc').addEventListener('click', function () {
    if (!curLatex.trim()) { toast('Chưa có công thức để thêm.'); return; }
    docSet.push({ type: 'eq', latex: curLatex });
    storeDoc(); renderDoc(); switchPane('docset');
    toast('Đã thêm vào bộ công thức (' + docSet.length + ' mục).');
  });
  $('btnAddText').addEventListener('click', function () { docSet.push({ type: 'text', text: '' }); storeDoc(); renderDoc(); });
  $('btnCopyDoc').addEventListener('click', function () {
    if (!docSet.length) { toast('Bộ công thức đang trống.'); return; }
    var text = docSet.map(function (item) {
      return item.type === 'text' ? (item.text || '') : ('$' + item.latex + '$');
    }).join('\n');
    copyTextPlain(text, 'Đã chép toàn bộ bộ công thức dạng văn bản có $...$.');
  });
  function docFormat() { var r = document.querySelector('input[name="docFmt"]:checked'); return r ? r.value : 'omml'; }
  $('btnExportDoc').addEventListener('click', function () {
    if (!docSet.length) return;
    if (!hasCore || !hasJSZip) { toast('Thư viện cần thiết chưa tải xong — hãy tải lại trang.'); return; }
    var mode = docFormat();
    if (mode === 'omml' && !hasKaTeX) { toast('KaTeX chưa tải được nên chưa xuất Equation được.'); return; }
    var lines = docSet.map(function (item) {
      return item.type === 'text' ? (item.text || '') : ('$$' + item.latex + '$$');
    });
    previewStats = { total: 0, failed: 0 };
    var btn = $('btnExportDoc'); btn.disabled = true; btn.textContent = 'Đang xuất…';
    MTCore.textToDocx(lines.join('\n'), { mode: mode, latexToMathml: latexToMathml, previewFor: previewFor }, window.JSZip)
      .then(function (res) {
        btn.disabled = false; btn.textContent = 'Xuất bộ (.docx)';
        downloadBlob(res.data, 'bo-cong-thuc-chdmathtype.docx');
        var msg = 'Đã xuất bộ ' + docSet.length + ' mục thành file Word (' + (mode === 'mathtype' ? 'MathType' : 'Equation') + ').';
        if (mode === 'mathtype' && previewStats.failed > 0) msg += ' Có ' + previewStats.failed + '/' + previewStats.total + ' công thức chưa có ảnh xem trước — dữ liệu MathType vẫn đầy đủ; nếu đang chạy trong khung xem trước, hãy tải file HTML về mở trực tiếp để có ảnh.';
        toast(msg);
      })
      .catch(function (err) {
        btn.disabled = false; btn.textContent = 'Xuất bộ (.docx)';
        toast('Xuất bộ thất bại: ' + ((err && err.message) || 'lỗi không xác định'));
      });
  });

  /* ---------- Các nút hành động của trình soạn ---------- */
  function showEditError(msg) {
    var el = $('editError');
    if (!msg) { el.classList.remove('show'); el.textContent = ''; return; }
    el.textContent = msg; el.classList.add('show');
  }
  function ommlForCurrent() {
    if (!hasCore) throw new Error('Thư viện lõi chưa tải được.');
    var mml = latexToMathml(curLatex);
    return window.MTCore.mathmlToOmml(mml, { sz: 24 });
  }
  function copyTextPlain(text, doneMsg) {
    function fallback() {
      var tmp = document.createElement('textarea');
      tmp.value = text; tmp.style.position = 'fixed'; tmp.style.opacity = '0';
      document.body.appendChild(tmp); tmp.select();
      try { document.execCommand('copy'); toast(doneMsg); } catch (e) { toast('Trình duyệt chặn sao chép — hãy chọn và chép thủ công.'); }
      tmp.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast(doneMsg); }, fallback);
    } else fallback();
  }
  /* ---------- Chép sang Word bằng cơ chế copy-theo-lựa-chọn ----------
     API clipboard bất đồng bộ (navigator.clipboard.write + ClipboardItem)
     không đáng tin cậy khi trang chạy qua file:// trong Safari: nút bấm
     rơi về chép văn bản thuần nên dán vào Word chỉ ra mã LaTeX. Ngược lại,
     copy theo lựa chọn dùng sự kiện 'copy' gốc — mang đủ định dạng
     HTML/MathML — thì Word tự nhận thành Equation (chính người dùng đã
     xác nhận: bôi chọn trong khung MathLive rồi Cmd+C, dán vào Word tự
     thành Equation). Mọi nút chép sang Word đều đi qua đây: chuẩn bị lựa
     chọn, gắn trình nghe 'copy' dùng-một-lần đặt tường minh text/html và
     text/plain, rồi document.execCommand('copy'). */
  function selectionCopy(prepare, formats, doneMsg) {
    /* Môi trường app native (macOS/Tauri): nếu cầu nối native đã đăng ký
       window.__chdNativeCopy, ghi thẳng payload vào clipboard hệ thống —
       đáng tin cậy hơn hẳn các API clipboard của webview — rồi kết thúc.
       Bản web không có hàm này nên hành vi ở trình duyệt không đổi. */
    if (typeof window.__chdNativeCopy === 'function' && formats &&
        (formats.html != null || formats.plain != null)) {
      var nf = { html: formats.html, plain: formats.plain };
      if (nf.html == null && nf.plain != null && typeof latexToMathml === 'function') {
        try {
          /* plain có thể đã kèm cặp $...$ / $$...$$ (nút Chép LaTeX giờ
             chép kèm dấu $ cho công cụ biên dịch); MathML phải dựng từ mã
             trần nên bóc cặp dấu $ ở hai đầu trước khi dựng. */
          var rawPlain = nf.plain;
          if (rawPlain.length > 4 && rawPlain.slice(0, 2) === '$$' && rawPlain.slice(-2) === '$$') rawPlain = rawPlain.slice(2, -2);
          else if (rawPlain.length > 2 && rawPlain.charAt(0) === '$' && rawPlain.charAt(rawPlain.length - 1) === '$') rawPlain = rawPlain.slice(1, -1);
          nf.html = '<html xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><head><meta charset="utf-8"></head><body><!--StartFragment-->' +
            latexToMathml(rawPlain) + '<!--EndFragment--></body></html>';
        } catch (e) { nf.html = null; }
      }
      if (nf.html != null) {
        try {
          var nr = window.__chdNativeCopy(nf);
          if (nr) { if (doneMsg) toast(doneMsg); return true; }
        } catch (e) {}
      }
    }
    var handler = function (e) {
      document.removeEventListener('copy', handler);
      if (!e.clipboardData) return;
      try {
        if (formats.html != null) e.clipboardData.setData('text/html', formats.html);
        if (formats.plain != null) e.clipboardData.setData('text/plain', formats.plain);
      } catch (err) {}
      if (formats.replace) e.preventDefault();
    };
    document.addEventListener('copy', handler);
    var ok = false;
    try { prepare(); ok = document.execCommand('copy'); } catch (err) {}
    document.removeEventListener('copy', handler);
    if (ok && doneMsg) toast(doneMsg);
    return ok;
  }
  function selectElementContents(el) {
    var range = document.createRange(); range.selectNodeContents(el);
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }
  function clearSelection() {
    var sel = window.getSelection(); if (sel) sel.removeAllRanges();
  }
  function makeOffscreenDiv(innerHtml) {
    var div = document.createElement('div');
    if (innerHtml != null) div.innerHTML = innerHtml;
    div.style.position = 'fixed'; div.style.left = '-9999px'; div.style.top = '0';
    document.body.appendChild(div);
    return div;
  }
  $('btnCopyWord').addEventListener('click', function () {
    showEditError('');
    if (!curLatex.trim()) { toast('Chưa có công thức để chép.'); return; }
    var omml;
    try { omml = ommlForCurrent(); }
    catch (e) { showEditError('Không tạo được Equation: ' + e.message); return; }
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><head><meta charset="utf-8"></head><body><!--StartFragment-->' +
      (displayMode ? '<m:oMathPara>' + omml + '</m:oMathPara>' : omml) +
      '<!--EndFragment--></body></html>';
    var doneMsg = 'Đã chép Equation — dán vào Word (Cmd+V) sẽ thành Equation gốc; dán vào ô văn bản thường sẽ ra mã LaTeX.';
    function done() { saveHistory(curLatex); }
    /* Vỏ native (Tauri): Word nhận MathML qua clipboard hệ thống tốt hơn
       OMML thô (đã kiểm chứng trên máy người dùng: nút "Sao chép tất cả"
       dùng MathML thì dán ra Equation, còn OMML thô thì dán ra LaTeX).
       Bản web không có hook nên vẫn đi đường OMML cũ bên dưới. */
    if (typeof window.__chdNativeCopy === 'function') {
      try {
        var mmlOnly = latexToMathml(curLatex);
        var mmlHtml = '<html xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><head><meta charset="utf-8"></head><body><!--StartFragment-->' + mmlOnly + '<!--EndFragment--></body></html>';
        var okNative = selectionCopy(function () {}, { html: mmlHtml, plain: curLatex }, doneMsg);
        if (okNative) { done(); return; }
      } catch (e) {}
    }
    /* Chính: copy-theo-lựa-chọn trên khối OMML ngoài màn hình. */
    var div = makeOffscreenDiv(html);
    var okSel = selectionCopy(function () { selectElementContents(div); },
      { html: html, plain: curLatex, replace: true }, doneMsg);
    clearSelection(); div.remove();
    if (okSel) { done(); return; }
    /* Dự phòng (chỉ khi execCommand thất bại): API clipboard bất đồng bộ. */
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      var item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([curLatex], { type: 'text/plain' })
      });
      navigator.clipboard.write([item]).then(function () { done(); toast(doneMsg); },
        function () { toast('Trình duyệt chặn sao chép — hãy dùng nút Tải .docx thay thế.'); });
    } else toast('Trình duyệt chặn sao chép — hãy dùng nút Tải .docx thay thế.');
  });
  function exportEditorDocx(mode) {
    showEditError('');
    if (!curLatex.trim()) { toast('Chưa có công thức để xuất.'); return; }
    if (!hasCore || !hasJSZip) { showEditError('Thư viện cần thiết chưa tải xong — hãy tải lại trang.'); return; }
    if (mode === 'omml' && !hasKaTeX) { showEditError('KaTeX chưa tải được nên chưa xuất Equation được.'); return; }
    var text = displayMode ? ('$$' + curLatex + '$$') : ('$' + curLatex + '$');
    previewStats = { total: 0, failed: 0 };
    var btn = mode === 'mathtype' ? $('btnDocxMt') : $('btnDocxEq');
    btn.disabled = true;
    MTCore.textToDocx(text, { mode: mode, latexToMathml: latexToMathml, previewFor: previewFor }, window.JSZip)
      .then(function (res) {
        btn.disabled = false;
        downloadBlob(res.data, mode === 'mathtype' ? 'cong-thuc-mathtype.docx' : 'cong-thuc-equation.docx');
        saveHistory(curLatex);
        if (mode === 'mathtype' && previewStats.failed > 0) {
          showEditError('Đã tải file MathType. Lưu ý: công thức chưa có ảnh xem trước (môi trường hiện tại chặn khâu chụp ảnh) — dữ liệu MathType vẫn đầy đủ, nhấp đúp trên Word + MathType (Windows) vẫn sửa được. Nếu bạn đang mở trang trong khung xem trước, hãy tải file HTML của ứng dụng về và mở trực tiếp, ảnh xem trước sẽ có đầy đủ.');
        } else {
          toast(mode === 'mathtype' ? 'Đã tải file Word chứa MathType thật.' : 'Đã tải file Word chứa Equation gốc.');
        }
      })
      .catch(function (err) {
        btn.disabled = false;
        showEditError('Xuất file thất bại: ' + ((err && err.message) || 'lỗi không xác định'));
      });
  }
  $('btnDocxEq').addEventListener('click', function () { exportEditorDocx('omml'); });
  $('btnDocxMt').addEventListener('click', function () { exportEditorDocx('mathtype'); });
  /* Mã LaTeX kèm cặp dấu $ theo chế độ hiện tại — $...$ khi Inline,
     $$...$$ khi Display — để dán thẳng vào các công cụ biên dịch
     LaTeX / Markdown mà không phải tự thêm dấu $. */
  function latexDelimited() {
    return displayMode ? ('$$' + curLatex + '$$') : ('$' + curLatex + '$');
  }
  $('btnCopyLatex').addEventListener('click', function () {
    if (!curLatex.trim()) { toast('Chưa có công thức để chép.'); return; }
    copyTextPlain(latexDelimited(), displayMode ? 'Đã chép mã LaTeX kèm $$...$$ (Display).' : 'Đã chép mã LaTeX kèm $...$ (Inline).');
  });
  $('btnCopyAllLatex').addEventListener('click', function () {
    if (!curLatex.trim()) { toast('Chưa có công thức để chép.'); return; }
    var doneMsg = 'Đã chép công thức — dán vào Word sẽ thành Equation; dán vào ô văn bản thường sẽ ra mã LaTeX kèm dấu $...$ (Inline) / $$...$$ (Display).';
    /* Chính: chọn toàn bộ nội dung trong khung soạn rồi copy — chính
       MathLive ghi các định dạng của nó (như khi bôi chọn + Cmd+C thủ
       công); trình nghe 'copy' chỉ đặt thêm text/plain = mã LaTeX kèm
       cặp dấu $ theo chế độ hiện tại. */
    if (mfAvailable()) {
      var okMf = selectionCopy(function () {
        try { mf.focus(); } catch (e) {}
        var selected = false;
        try { selected = !!(mf.executeCommand && mf.executeCommand('selectAll')); } catch (e) {}
        if (!selected && typeof mf.select === 'function') { try { mf.select(); } catch (e) {} }
      }, { plain: latexDelimited() }, doneMsg);
      if (okMf) { saveHistory(curLatex); return; }
    }
    /* MathLive không khả dụng: khối MathML (KaTeX) ngoài màn hình. */
    var mml = null;
    try { mml = latexToMathml(curLatex); } catch (e) { mml = null; }
    if (mml) {
      var html = '<html xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><head><meta charset="utf-8"></head><body><!--StartFragment-->' + mml + '<!--EndFragment--></body></html>';
      var div = makeOffscreenDiv(mml);
      var okDiv = selectionCopy(function () { selectElementContents(div); },
        { html: html, plain: latexDelimited(), replace: true }, doneMsg);
      clearSelection(); div.remove();
      if (okDiv) { saveHistory(curLatex); return; }
    }
    copyTextPlain(latexDelimited(), 'Đã chép mã LaTeX kèm dấu $ (chưa tạo được Equation trong môi trường này).');
  });
  $('btnSvg').addEventListener('click', function () {
    if (!curLatex.trim()) { toast('Chưa có công thức để xuất.'); return; }
    var res = mathJaxSvgFor(curLatex, displayMode);
    if (!res) { toast('MathJax chưa sẵn sàng — chờ giây lát rồi thử lại.'); return; }
    downloadBlob(new Blob([res.svgText], { type: 'image/svg+xml;charset=utf-8' }), 'cong-thuc.svg');
    toast('Đã tải file SVG.');
  });
  $('btnPng').addEventListener('click', function () {
    if (!curLatex.trim()) { toast('Chưa có công thức để xuất.'); return; }
    var res = mathJaxSvgFor(curLatex, displayMode);
    if (res) {
      rasterizeSvgText(res.svgText, res.w, res.h, 4, false).then(function (bytes) {
        if (bytes) { downloadBlob(new Blob([bytes], { type: 'image/png' }), 'cong-thuc.png'); toast('Đã tải ảnh PNG.'); }
        else return katexPreviewForRaw(curLatex, displayMode).then(function (k) {
          if (k && k.png) { downloadBlob(new Blob([k.png], { type: 'image/png' }), 'cong-thuc.png'); toast('Đã tải ảnh PNG.'); }
          else toast('Không tạo được ảnh PNG trong môi trường này.');
        });
      });
    } else {
      katexPreviewForRaw(curLatex, displayMode).then(function (k) {
        if (k && k.png) { downloadBlob(new Blob([k.png], { type: 'image/png' }), 'cong-thuc.png'); toast('Đã tải ảnh PNG.'); }
        else toast('Không tạo được ảnh PNG trong môi trường này.');
      });
    }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (!$('tabEdit').hidden) { e.preventDefault(); $('btnCopyWord').click(); }
    }
  });

  /* =====================================================================
     TAB 1: CHUYỂN ĐỔI FILE WORD (MathType -> Equation / LaTeX)
     Kế thừa hành vi của app "Sửa MathType trên Mac".
     ===================================================================== */
  var dropzone = $('dropzone'), fileInput = $('fileInput'),
      openError = $('openError'), progress = $('progress'),
      workspace = $('workspace'), eqList = $('eqList'), emptyNote = $('emptyNote'),
      exportBtn = $('exportBtn'), exportSummary = $('exportSummary'),
      exportError = $('exportError'), resultPanel = $('resultPanel'),
      mathFieldC = $('mathFieldC'), latexInputC = $('latexInputC');

  var coreState = null;
  var fileBaseName = 'file';
  var edits = new Map();
  var checked = new Set();
  var current = null;
  var syncingC = false;

  function canExportOmml() { return hasKaTeX; }

  function showOpenError(msg) { openError.textContent = msg; openError.classList.add('show'); }
  function clearOpenError() { openError.classList.remove('show'); openError.textContent = ''; }

  function handleFile(file) {
    clearOpenError();
    if (!file) return;
    if (!/\.docx$/i.test(file.name || '')) {
      showOpenError('“' + (file.name || 'File') + '” không phải file .docx. Hãy chọn đúng file Word có đuôi .docx (file .doc đời cũ cần được lưu lại thành .docx trong Word trước).');
      return;
    }
    if (!hasJSZip || !hasCore) {
      showOpenError('Thư viện cần thiết chưa tải xong. Hãy kiểm tra kết nối mạng và tải lại trang rồi thử lại.');
      return;
    }
    progress.classList.add('show');
    dropzone.style.pointerEvents = 'none';
    var reader = new FileReader();
    reader.onerror = function () {
      progress.classList.remove('show');
      dropzone.style.pointerEvents = '';
      showOpenError('Không đọc được file này từ máy của bạn. Hãy thử lại hoặc chọn file khác.');
    };
    reader.onload = function () {
      MTCore.openDocx(reader.result, window.JSZip).then(function (state) {
        progress.classList.remove('show');
        dropzone.style.pointerEvents = '';
        startWorkspace(file.name, state);
      }).catch(function (err) {
        progress.classList.remove('show');
        dropzone.style.pointerEvents = '';
        var msg = (err && err.message) ? String(err.message) : '';
        if (/word\/document\.xml/.test(msg)) showOpenError(msg);
        else showOpenError('Không mở được file này — có thể file không phải .docx hợp lệ hoặc đã bị lỗi. Chi tiết: ' + (msg || 'lỗi không xác định'));
      });
    };
    reader.readAsArrayBuffer(file);
  }

  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove('dragover'); });
  });
  dropzone.addEventListener('drop', function (e) {
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) handleFile(files[0]);
  });
  $('openAnotherBtn').addEventListener('click', function () { fileInput.click(); });

  /* Thả .docx vào bất kỳ đâu trong trang -> nạp vào tab Chuyển đổi */
  var dragDepth = 0;
  ['dragenter', 'dragover'].forEach(function (ev) {
    window.addEventListener(ev, function (e) {
      e.preventDefault();
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) {
        document.body.classList.add('global-drag');
      }
    });
  });
  window.addEventListener('dragleave', function (e) {
    if (!e.relatedTarget) document.body.classList.remove('global-drag');
  });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    document.body.classList.remove('global-drag');
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length && /\.docx$/i.test(files[0].name || '')) {
      if (e.target !== dropzone && !dropzone.contains(e.target)) {
        switchTab('tab1');
        handleFile(files[0]);
      }
    }
  });

  function eqByN(n) {
    if (!coreState) return null;
    for (var i = 0; i < coreState.equations.length; i++) {
      if (coreState.equations[i].n === n) return coreState.equations[i];
    }
    return null;
  }
  function currentLatexOf(eq) { return edits.has(eq.n) ? edits.get(eq.n) : (eq.latex || ''); }
  function isEdited(eq) { return edits.has(eq.n) && edits.get(eq.n) !== eq.latex; }

  function startWorkspace(name, state) {
    coreState = state;
    fileBaseName = (name || 'file').replace(/\.docx$/i, '');
    edits = new Map();
    checked = new Set();
    current = null;
    state.equations.forEach(function (eq) { if (!eq.error && eq.latex !== null) checked.add(eq.n); });
    $('wsFileName').textContent = name;
    var okCount = state.equations.filter(function (e) { return !e.error && e.latex !== null; }).length;
    var errCount = state.equations.length - okCount;
    $('wsStats').innerHTML = 'Tìm thấy <b>' + state.equations.length + '</b> công thức MathType &bull; Giải mã thành công <b>' + okCount + '</b> &bull; Lỗi <b>' + errCount + '</b>';
    buildList();
    emptyNote.hidden = state.equations.length !== 0;
    showEditorPlaceholder();
    resultPanel.classList.remove('show');
    exportError.classList.remove('show');
    workspace.classList.add('show');
    refreshExportState();
    workspace.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderPreviewEq(previewEl, latex) {
    previewEl.innerHTML = '';
    if (hasKaTeX) {
      try { window.katex.render(latex, previewEl, { throwOnError: false, displayMode: false, strict: false }); return; }
      catch (e) { /* rơi xuống hiển thị mã nguồn */ }
    }
    var span = document.createElement('span');
    span.className = 'latex-fallback';
    span.textContent = latex;
    previewEl.appendChild(span);
  }

  function buildList() {
    eqList.innerHTML = '';
    coreState.equations.forEach(function (eq) { eqList.appendChild(buildRow(eq)); });
  }

  function buildRow(eq) {
    var row = document.createElement('div');
    row.className = 'eqrow';
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.dataset.n = eq.n;

    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked.has(eq.n);
    cb.disabled = !!eq.error || eq.latex === null;
    cb.setAttribute('aria-label', 'Chuyển đổi công thức số ' + eq.n);
    cb.addEventListener('click', function (e) { e.stopPropagation(); });
    cb.addEventListener('change', function () {
      if (cb.checked) checked.add(eq.n); else checked.delete(eq.n);
      refreshExportState();
    });
    row.appendChild(cb);

    var idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = eq.n;
    row.appendChild(idx);

    var body = document.createElement('div');
    body.className = 'body';
    if (eq.context) {
      var ctx = document.createElement('div');
      ctx.className = 'ctx';
      ctx.textContent = '…' + eq.context;
      ctx.title = eq.context;
      body.appendChild(ctx);
    }
    var preview = document.createElement('div');
    preview.className = 'preview';
    if (eq.error) {
      var errSpan = document.createElement('span');
      errSpan.className = 'latex-fallback';
      errSpan.textContent = 'Không giải mã được công thức này';
      preview.appendChild(errSpan);
    } else {
      renderPreviewEq(preview, currentLatexOf(eq));
    }
    body.appendChild(preview);
    var src = document.createElement('div');
    src.className = 'src';
    if (!eq.error) { src.textContent = currentLatexOf(eq); src.title = currentLatexOf(eq); }
    body.appendChild(src);
    if (eq.error) {
      var et = document.createElement('div');
      et.className = 'errtext';
      et.textContent = eq.error;
      body.appendChild(et);
    }
    row.appendChild(body);

    var badges = document.createElement('div');
    badges.className = 'badges';
    if (eq.appkey) {
      var b1 = document.createElement('span');
      b1.className = 'badge';
      b1.textContent = eq.appkey;
      badges.appendChild(b1);
    }
    if (eq.error) {
      var b2 = document.createElement('span');
      b2.className = 'badge err';
      b2.textContent = 'Lỗi giải mã';
      badges.appendChild(b2);
    } else {
      var b3 = document.createElement('span');
      b3.className = 'badge edited';
      b3.textContent = 'Đã sửa';
      b3.style.display = isEdited(eq) ? '' : 'none';
      b3.dataset.role = 'edited-badge';
      badges.appendChild(b3);
    }
    row.appendChild(badges);

    row.addEventListener('click', function () { selectEquation(eq.n); });
    row.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target === row) selectEquation(eq.n);
    });
    return row;
  }

  function updateRow(eq) {
    var row = eqList.querySelector('.eqrow[data-n="' + eq.n + '"]');
    if (!row) return;
    var preview = row.querySelector('.preview');
    var src = row.querySelector('.src');
    if (preview && !eq.error) renderPreviewEq(preview, currentLatexOf(eq));
    if (src && !eq.error) { src.textContent = currentLatexOf(eq); src.title = currentLatexOf(eq); }
    var badge = row.querySelector('[data-role="edited-badge"]');
    if (badge) badge.style.display = isEdited(eq) ? '' : 'none';
    row.classList.toggle('active', current === eq.n);
  }

  $('selectAllBtn').addEventListener('click', function () {
    if (!coreState) return;
    coreState.equations.forEach(function (eq) { if (!eq.error && eq.latex !== null) checked.add(eq.n); });
    syncCheckboxes(); refreshExportState();
  });
  $('selectNoneBtn').addEventListener('click', function () {
    checked.clear(); syncCheckboxes(); refreshExportState();
  });
  function syncCheckboxes() {
    eqList.querySelectorAll('.eqrow').forEach(function (row) {
      var n = parseInt(row.dataset.n, 10);
      var cb = row.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = checked.has(n);
    });
  }

  /* ---------- Editor nhỏ trong tab Chuyển đổi ---------- */
  function showEditorPlaceholder() {
    current = null;
    $('edTitle').textContent = 'Sửa công thức đã chọn';
    $('edCtx').textContent = '';
    $('edPlaceholder').hidden = false;
    $('edBody').hidden = true;
    $('edError').hidden = true;
    eqList.querySelectorAll('.eqrow').forEach(function (r) { r.classList.remove('active'); });
  }
  function selectEquation(n) {
    var eq = eqByN(n);
    if (!eq) return;
    current = n;
    showEditorC(n);
    eqList.querySelectorAll('.eqrow').forEach(function (r) {
      r.classList.toggle('active', parseInt(r.dataset.n, 10) === n);
    });
  }
  function showEditorC(n) {
    var eq = eqByN(n);
    if (!eq) return;
    $('edTitle').textContent = 'Công thức số ' + eq.n + (eq.appkey ? ' (' + eq.appkey + ')' : '');
    $('edCtx').textContent = eq.context ? ('Ngữ cảnh: …' + eq.context) : '';
    if (eq.error) {
      $('edPlaceholder').hidden = true;
      $('edBody').hidden = true;
      var edErr = $('edError');
      edErr.hidden = false;
      edErr.textContent = 'Công thức này giải mã bị lỗi nên chưa sửa được: ' + eq.error + ' Khi xuất file, công thức này sẽ được giữ nguyên dạng MathType như bản gốc.';
      return;
    }
    $('edError').hidden = true;
    $('edPlaceholder').hidden = true;
    $('edBody').hidden = false;
    var latex = currentLatexOf(eq);
    syncingC = true;
    latexInputC.value = latex;
    if (mathliveReady && mathFieldC) { try { mathFieldC.value = latex; } catch (e) {} }
    syncingC = false;
    $('resetBtn').disabled = !isEdited(eq);
  }
  function onMathLiveReadyConvert() { if (current !== null) showEditorC(current); }
  function applyEditC(n, latex) {
    var eq = eqByN(n);
    if (!eq || eq.error) return;
    if (latex === eq.latex) edits.delete(n); else edits.set(n, latex);
    updateRow(eq);
    $('resetBtn').disabled = !isEdited(eq);
  }
  if (mathFieldC) {
    mathFieldC.addEventListener('input', function () {
      if (syncingC || current === null) return;
      var latex = mathFieldC.value;
      syncingC = true; latexInputC.value = latex; syncingC = false;
      applyEditC(current, latex);
    });
  }
  latexInputC.addEventListener('input', function () {
    if (syncingC || current === null) return;
    var latex = latexInputC.value;
    syncingC = true;
    if (mathFieldC) { try { mathFieldC.value = latex; } catch (e) {} }
    syncingC = false;
    applyEditC(current, latex);
  });
  $('resetBtn').addEventListener('click', function () {
    if (current === null) return;
    var eq = eqByN(current);
    if (!eq) return;
    edits.delete(current);
    showEditorC(current);
    updateRow(eq);
  });
  $('toEditorBtn').addEventListener('click', function () {
    if (current === null) return;
    var eq = eqByN(current);
    if (!eq || eq.error) return;
    setLatex(currentLatexOf(eq));
    switchTab('tabEdit');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Đã đưa công thức số ' + eq.n + ' sang tab Soạn thảo.');
  });

  /* ---------- Xuất file (tab Chuyển đổi) ---------- */
  function exportFormat() {
    var r = document.querySelector('input[name="exportFmt"]:checked');
    return r ? r.value : 'omml';
  }
  document.querySelectorAll('input[name="exportFmt"]').forEach(function (r) {
    r.addEventListener('change', refreshExportState);
  });
  function refreshExportState() {
    if (!coreState) return;
    var total = coreState.equations.length;
    var a = checked.size;
    var b = total - a;
    var fmt = exportFormat();
    var isLatex = fmt === 'latex';
    exportSummary.textContent = 'Sẽ chuyển đổi ' + a + ' công thức • Giữ nguyên MathType ' + b + ' công thức';
    $('selCount').textContent = 'Đã chọn ' + a + ' / ' + total;
    exportBtn.textContent = isLatex ? 'Tải file Word chứa mã LaTeX' : 'Tải file Word đã chuyển đổi';
    $('exportWarn').textContent = isLatex
      ? 'Các công thức đã chọn sẽ trở thành mã LaTeX dạng $...$ trong file mới; mọi nội dung khác giữ nguyên. Hãy mở file mới bằng Word để kiểm tra trước khi dùng chính thức.'
      : 'File mới giữ nguyên mọi công thức không được chọn. Hãy mở file mới bằng Word để kiểm tra trước khi dùng chính thức.';
    if (!isLatex && !canExportOmml()) {
      exportBtn.disabled = true;
      exportBtn.textContent = 'Tải file Word đã chuyển đổi';
      exportSummary.textContent += ' — Thư viện KaTeX chưa tải được nên tạm thời chưa xuất file được; hãy kiểm tra kết nối mạng và tải lại trang.';
    } else {
      exportBtn.disabled = a === 0;
    }
  }
  exportBtn.addEventListener('click', function () {
    if (!coreState) return;
    var fmt = exportFormat();
    var isLatex = fmt === 'latex';
    if (!isLatex && !canExportOmml()) return;
    exportError.classList.remove('show');
    resultPanel.classList.remove('show');
    var convertMap = new Map();
    checked.forEach(function (n) {
      var eq = eqByN(n);
      if (eq && !eq.error) convertMap.set(n, currentLatexOf(eq));
    });
    if (convertMap.size === 0) return;
    var idleLabel = isLatex ? 'Tải file Word chứa mã LaTeX' : 'Tải file Word đã chuyển đổi';
    exportBtn.disabled = true;
    exportBtn.textContent = 'Đang tạo file…';
    var job = isLatex
      ? MTCore.exportLatexDocx(coreState, convertMap)
      : MTCore.exportDocx(coreState, convertMap, latexToMathml);
    var outName = fileBaseName + (isLatex ? '-latex.docx' : '-da-chuyen-doi.docx');
    job.then(function (res) {
      exportBtn.disabled = false;
      exportBtn.textContent = idleLabel;
      downloadBlob(res.data, outName);
      var total = coreState.equations.length;
      var kept = total - res.converted;
      $('resultText').textContent = isLatex
        ? 'Đã chuyển ' + res.converted + ' công thức thành mã LaTeX dạng $...$ • Giữ nguyên MathType ' + kept + ' công thức. Mở file “' + outName + '” để lấy mã LaTeX dùng cho mục đích khác.'
        : 'Đã chuyển đổi ' + res.converted + ' công thức thành Equation native của Word • Giữ nguyên MathType ' + kept + ' công thức. Mở file “' + outName + '” bằng Word trên MacBook, nhấp đúp vào công thức để sửa tiếp.';
      var failsUl = $('resultFails');
      failsUl.innerHTML = '';
      (res.fails || []).forEach(function (f) {
        var li = document.createElement('li');
        li.textContent = 'Công thức số ' + f[0] + ' chưa chuyển được (' + f[1] + ') — đã giữ nguyên dạng MathType trong file mới.';
        failsUl.appendChild(li);
      });
      resultPanel.classList.add('show');
      resultPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }).catch(function (err) {
      exportBtn.disabled = false;
      exportBtn.textContent = idleLabel;
      exportError.textContent = 'Xuất file thất bại: ' + ((err && err.message) || 'lỗi không xác định') + '. Các công thức và lựa chọn của bạn vẫn còn nguyên — hãy thử lại.';
      exportError.classList.add('show');
    });
  });

  /* =====================================================================
     TAB 2: LATEX -> EQUATION / MATHTYPE (kế thừa app cũ)
     ===================================================================== */
  var pasteInput = $('pasteInput'), segCountEl = $('segCount'),
      fileInput2 = $('fileInput2'), tab2State = null, tab2BaseName = '';

  function countSegmentsInText(text) {
    /* Cat doan tren TOAN BO van ban (khong quet theo tung dong): khoi hien
       thi nhieu dong $$...$$ / \[...\] chua ma tran, he cases chi nhan dien
       duoc khi quet mot luot tu dau den cuoi. */
    return tab2SegmentsOf(text).length;
  }
  function refreshSegCount() {
    var n = countSegmentsInText(pasteInput.value);
    segCountEl.innerHTML = n > 0
      ? 'Nhận diện được <b>' + n + '</b> đoạn mã LaTeX trong văn bản đã dán.'
      : 'Chưa nhận diện được đoạn mã LaTeX nào.';
    refreshTab2State();
  }
  pasteInput.addEventListener('input', function () { refreshSegCount(); renderTab2Preview(); });
  /* ---------- Xem truoc truc tiep + chep toan bo sang Word (tab LaTeX) ---------- */
  function tab2SegmentsOf(text) {
    if (!hasCore || typeof MTCore.findLatexSegments !== 'function') return [];
    try { return MTCore.findLatexSegments(text); } catch (e) { return []; }
  }
  /* Chia van ban thanh cac khoi de hien thi / chep sang Word: cat doan
     LaTeX tren TOAN BO van ban bang MTCore.findLatexSegments truoc (khoi
     hien thi nhieu dong nhu ma tran, he cases thanh MOT khoi cong thuc can
     giua duy nhat), roi moi chia phan chu thuong thanh doan van theo dong. */
  function buildTab2Blocks(text) {
    var segs = tab2SegmentsOf(text);
    var blocks = [], cur = { kind: 'line', nodes: [] };
    function pushLine() { blocks.push(cur); cur = { kind: 'line', nodes: [] }; }
    function addText(chunk) {
      String(chunk).split(/\r?\n/).forEach(function (part, idx) {
        if (idx > 0) pushLine();
        if (part) cur.nodes.push({ t: 'text', s: part });
      });
    }
    var pos = 0;
    segs.forEach(function (sg) {
      if (sg.start > pos) addText(text.slice(pos, sg.start));
      if (sg.display) {
        if (cur.nodes.length) pushLine(); else cur = { kind: 'line', nodes: [] };
        blocks.push({ kind: 'display', latex: sg.latex, raw: text.slice(sg.start, sg.end) });
      } else {
        cur.nodes.push({ t: 'math', latex: sg.latex, raw: text.slice(sg.start, sg.end) });
      }
      pos = sg.end;
    });
    if (pos < text.length) addText(text.slice(pos));
    pushLine();
    /* Bo dong trong thua o hai dau van ban va sat khoi hien thi (do cac dau
       ngat dong quanh $$...$$ / \[...\] tao ra); giu dong trong nam giua hai
       dong chu thuong (doan van cach nhau mot dong). */
    return blocks.filter(function (b, i, arr) {
      if (b.kind !== 'line' || b.nodes.length) return true;
      var prev = arr[i - 1], next = arr[i + 1];
      if (!prev || !next) return false;
      if (prev.kind === 'display' || next.kind === 'display') return false;
      return true;
    });
  }
  function renderTab2Preview() {
    var box = $('tab2Preview');
    if (!box) return;
    var text = pasteInput.value;
    box.innerHTML = '';
    if (!text.trim()) {
      box.innerHTML = '<span class="pv-empty">Nội dung xem trước sẽ hiện ở đây — chữ thường giữ nguyên, các đoạn $...$ hiện thành công thức.</span>';
      return;
    }
    buildTab2Blocks(text).forEach(function (b) {
      var p = document.createElement('p');
      if (b.kind === 'display') {
        var span = document.createElement('span');
        span.className = 'pv-display';
        renderInto(span, b.latex, true);
        p.appendChild(span);
      } else {
        b.nodes.forEach(function (n) {
          if (n.t === 'text') p.appendChild(document.createTextNode(n.s));
          else { var s2 = document.createElement('span'); renderInto(s2, n.latex, false); p.appendChild(s2); }
        });
      }
      if (!p.childNodes.length) p.innerHTML = '&nbsp;';
      box.appendChild(p);
    });
  }
  /* Dự phòng cho nút chép tab LaTeX — chỉ dùng khi copy-theo-lựa-chọn
     thất bại; đường chính không còn phụ thuộc ClipboardItem nữa. */
  function copyRichForWord(html, plain, doneMsg) {
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      var item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      });
      navigator.clipboard.write([item]).then(function () { toast(doneMsg); },
        function () { toast('Trình duyệt chặn sao chép — hãy dùng nút tải file Word bên dưới.'); });
    } else toast('Trình duyệt chặn sao chép — hãy dùng nút tải file Word bên dưới.');
  }
  /* Dựng fragment HTML cho clipboard: chữ thường đã escape, mỗi đoạn
     LaTeX thay bằng phần tử MathML nội dòng (KaTeX) — Word đọc MathML
     trong HTML clipboard và tự chuyển thành Equation gốc. */
  function buildTab2Fragment(text) {
    var failed = 0;
    var paras = buildTab2Blocks(text).map(function (b) {
      if (b.kind === 'display') {
        try { return '<p align="center">' + latexToMathml(b.latex) + '</p>'; }
        catch (e) { failed++; return '<p align="center">' + esc(b.raw) + '</p>'; }
      }
      var runs = '';
      b.nodes.forEach(function (n) {
        if (n.t === 'text') { runs += esc(n.s); return; }
        try { runs += latexToMathml(n.latex); }
        catch (e) { failed++; runs += esc(n.raw); }
      });
      return '<p>' + (runs || '&nbsp;') + '</p>';
    });
    return { fragment: paras.join(''), failed: failed };
  }
  var btnTab2Copy = $('btnTab2CopyWord');
  if (btnTab2Copy) btnTab2Copy.addEventListener('click', function () {
    var text = pasteInput.value;
    if (!text.trim()) { toast('Chưa có nội dung để chép — hãy dán văn bản có $...$ trước.'); return; }
    if (!hasCore) { toast('Thư viện lõi chưa tải được — hãy tải lại trang.'); return; }
    if (!hasKaTeX) { toast('KaTeX chưa tải được nên chưa tạo được Equation — hãy tải lại trang.'); return; }
    var built = buildTab2Fragment(text);
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><head><meta charset="utf-8"></head><body><!--StartFragment-->' + built.fragment + '<!--EndFragment--></body></html>';
    var doneMsg = built.failed
      ? 'Đã chép nội dung — dán vào Word sẽ thành Equation (có ' + built.failed + ' đoạn LaTeX không tạo được nên giữ nguyên mã); dán vào ô văn bản thường sẽ ra nguyên văn có $...$.'
      : 'Đã chép toàn bộ nội dung — dán vào Word: chữ là chữ, công thức thành Equation gốc; dán vào ô văn bản thường sẽ ra nguyên văn có $...$.';
    /* Chính: copy-theo-lựa-chọn trên đoạn DOM MathML ngoài màn hình,
       text/plain giữ nguyên văn bản nguồn (còn nguyên $...$). */
    var div = makeOffscreenDiv(built.fragment);
    var okSel = selectionCopy(function () { selectElementContents(div); },
      { html: html, plain: text, replace: true }, doneMsg);
    clearSelection(); div.remove();
    if (!okSel) copyRichForWord(html, text, doneMsg);
  });

  function tab2Mode() {
    var r = document.querySelector('input[name="tab2Mode"]:checked');
    return r ? r.value : 'omml';
  }
  document.querySelectorAll('input[name="tab2Mode"]').forEach(function (r) {
    r.addEventListener('change', refreshTab2State);
  });
  function refreshTab2State() {
    var btn = $('tab2ConvertBtn');
    var hasText = countSegmentsInText(pasteInput.value) > 0;
    var hasFile = !!tab2State;
    var ready = hasText || hasFile;
    var note = '';
    if (!hasJSZip || !hasCore) { ready = false; note = 'Thư viện cần thiết chưa tải xong — kiểm tra kết nối mạng rồi tải lại trang.'; }
    else if (tab2Mode() === 'omml' && !hasKaTeX) { ready = false; note = 'KaTeX chưa tải được nên chưa tạo được Equation; hãy kiểm tra kết nối mạng rồi tải lại trang, hoặc chọn đích MathType.'; }
    else if (!ready) note = 'Hãy dán văn bản có $...$ hoặc chọn một file .docx để bắt đầu.';
    else if (hasText && hasFile) note = 'Đang ưu tiên văn bản đã dán; xoá trắng ô dán nếu muốn chuyển đổi file .docx đã chọn.';
    btn.disabled = !ready;
    $('tab2Status').textContent = note;
  }

  $('pickDocx2Btn').addEventListener('click', function () { fileInput2.click(); });
  fileInput2.addEventListener('change', function () {
    var f = fileInput2.files && fileInput2.files[0];
    fileInput2.value = '';
    if (f) handleTab2File(f);
  });
  function handleTab2File(file) {
    var errEl = $('tab2FileError');
    errEl.classList.remove('show');
    tab2State = null;
    $('pickedFile2').hidden = true;
    $('pickedInfo2').hidden = true;
    if (!/\.docx$/i.test(file.name || '')) {
      errEl.textContent = '“' + (file.name || 'File') + '” không phải file .docx. Hãy chọn đúng file Word có đuôi .docx.';
      errEl.classList.add('show');
      refreshTab2State();
      return;
    }
    if (!hasJSZip || !hasCore) {
      errEl.textContent = 'Thư viện cần thiết chưa tải xong. Hãy kiểm tra kết nối mạng và tải lại trang rồi thử lại.';
      errEl.classList.add('show');
      refreshTab2State();
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () {
      errEl.textContent = 'Không đọc được file này từ máy của bạn. Hãy thử lại hoặc chọn file khác.';
      errEl.classList.add('show');
      refreshTab2State();
    };
    reader.onload = function () {
      MTCore.openDocx(reader.result, window.JSZip).then(function (state) {
        tab2State = state;
        tab2BaseName = (file.name || 'file').replace(/\.docx$/i, '');
        var plain = '';
        state.docXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, function (para) {
          var texts = [];
          para.replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, function (m, t) { texts.push(t); return m; });
          plain += texts.join('') + '\n';
          return para;
        });
        var n = (typeof MTCore.findLatexSegments === 'function') ? MTCore.findLatexSegments(plain).length : 0;
        $('pickedFile2').textContent = file.name;
        $('pickedFile2').hidden = false;
        var info = $('pickedInfo2');
        info.innerHTML = n > 0
          ? 'Nhận diện được <b>' + n + '</b> đoạn mã LaTeX trong nội dung chữ của file này.'
          : 'Chưa thấy đoạn mã LaTeX ($...$) nào trong nội dung chữ của file này.';
        info.hidden = false;
        refreshTab2State();
      }).catch(function (err2) {
        errEl.textContent = 'Không mở được file này — có thể file không phải .docx hợp lệ hoặc đã bị lỗi. Chi tiết: ' + ((err2 && err2.message) || 'lỗi không xác định');
        errEl.classList.add('show');
        refreshTab2State();
      });
    };
    reader.readAsArrayBuffer(file);
  }

  $('tab2ConvertBtn').addEventListener('click', function () {
    var errEl = $('tab2Error'), resEl = $('tab2Result');
    errEl.classList.remove('show');
    resEl.classList.remove('show');
    var mode = tab2Mode();
    previewStats = { total: 0, failed: 0 };
    var opts = { mode: mode, latexToMathml: latexToMathml, previewFor: previewFor };
    var btn = $('tab2ConvertBtn');
    var useText = countSegmentsInText(pasteInput.value) > 0;
    btn.disabled = true;
    btn.textContent = 'Đang chuyển đổi…';
    var job, outName;
    if (useText) {
      job = MTCore.textToDocx(pasteInput.value, opts, window.JSZip);
      outName = 'latex-da-chuyen-doi.docx';
    } else if (tab2State) {
      job = MTCore.convertDocxLatex(tab2State, opts);
      outName = tab2BaseName + '-da-chuyen-doi.docx';
    } else {
      btn.disabled = false;
      btn.textContent = 'Chuyển đổi & tải file Word';
      return;
    }
    job.then(function (res) {
      btn.disabled = false;
      btn.textContent = 'Chuyển đổi & tải file Word';
      downloadBlob(res.data, outName);
      var destLabel = mode === 'mathtype' ? 'MathType (Equation.DSMT4)' : 'Equation của Word';
      var txt = 'Đã chuyển đổi ' + res.converted + ' đoạn mã LaTeX thành ' + destLabel + ' trong file “' + outName + '”.';
      if (typeof res.parasTouched === 'number') txt += ' Đã xây lại ' + res.parasTouched + ' đoạn văn có chứa công thức; mọi đoạn khác giữ nguyên từng byte.';
      $('tab2ResultText').textContent = txt;
      var ul = $('tab2Warnings');
      ul.innerHTML = '';
      (res.warnings || []).forEach(function (w) {
        var li = document.createElement('li');
        li.textContent = w;
        ul.appendChild(li);
      });
      if (mode === 'mathtype' && previewStats.total > 0 && previewStats.failed > 0) {
        var noteLi = document.createElement('li');
        noteLi.textContent = previewStats.failed + '/' + previewStats.total + ' công thức chưa có ảnh xem trước (môi trường hiện tại chặn khâu chụp ảnh dù đã tự kiểm chứng và thử lại bằng cách nạp khác); dữ liệu MathType vẫn đầy đủ — mở bằng Word + MathType trên Windows sẽ hiển thị và sửa được. Nếu bạn đang mở ứng dụng trong khung xem trước, hãy tải file HTML của ứng dụng về và mở trực tiếp — ảnh xem trước sẽ tạo được đầy đủ.';
        ul.appendChild(noteLi);
      }
      resEl.classList.add('show');
      resEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      refreshTab2State();
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'Chuyển đổi & tải file Word';
      errEl.textContent = 'Chuyển đổi thất bại: ' + ((err && err.message) || 'lỗi không xác định') + '. Nội dung bạn đã nhập vẫn còn nguyên — hãy thử lại.';
      errEl.classList.add('show');
      refreshTab2State();
    });
  });

  /* =====================================================================
     TAB 3: MARKDOWN -> EQUATION / MATHTYPE
     Cùng cấu trúc khối/nút nội dòng với lõi (MTCore.parseMarkdown) nên
     xem trước, fragment chép sang Word và file .docx luôn nhất quán.
     ===================================================================== */
  var mdInput = $('mdInput'), mdCountEl = $('mdCount');
  function mdBlocks() {
    if (!hasCore || typeof MTCore.parseMarkdown !== 'function') return [];
    try { return MTCore.parseMarkdown(mdInput.value); } catch (e) { return []; }
  }
  function refreshMdCount() {
    var text = mdInput.value;
    if (!text.trim()) { mdCountEl.textContent = 'Chưa có nội dung Markdown nào.'; return; }
    var nMath = tab2SegmentsOf(text).length;
    var nBlock = mdBlocks().length;
    mdCountEl.innerHTML = 'Nhận diện được <b>' + nMath + '</b> đoạn mã LaTeX và <b>' + nBlock + '</b> khối nội dung (đoạn văn, tiêu đề, danh sách, bảng…).';
  }
  function mdNodesToDom(nodes, parent) {
    (nodes || []).forEach(function (n) {
      if (n.math != null) {
        var s = document.createElement('span');
        renderInto(s, n.math, n.display);
        parent.appendChild(s);
      } else if (n.link != null) {
        var a = document.createElement('a');
        a.href = n.link; a.target = '_blank'; a.rel = 'noopener';
        mdNodesToDom(n.children, a);
        parent.appendChild(a);
      } else if (n.code) {
        var cd = document.createElement('code');
        cd.textContent = n.s;
        parent.appendChild(cd);
      } else {
        var wrap = document.createTextNode(n.s);
        if (n.st) { var st = document.createElement('s'); st.appendChild(wrap); wrap = st; }
        if (n.i) { var em = document.createElement('em'); em.appendChild(wrap); wrap = em; }
        if (n.b) { var be = document.createElement('strong'); be.appendChild(wrap); wrap = be; }
        parent.appendChild(wrap);
      }
    });
  }
  function renderMdPreview() {
    var box = $('mdPreview');
    if (!box) return;
    var text = mdInput.value;
    box.innerHTML = '';
    if (!text.trim()) {
      box.innerHTML = '<span class="pv-empty">Nội dung xem trước sẽ hiện ở đây — tiêu đề, danh sách, bảng và định dạng đậm/nghiêng được thể hiện như trong Word, các đoạn $...$ hiện thành công thức.</span>';
      return;
    }
    mdBlocks().forEach(function (b) {
      if (b.type === 'heading') {
        var h = document.createElement('h' + b.level);
        mdNodesToDom(b.nodes, h);
        box.appendChild(h);
      } else if (b.type === 'display') {
        var p = document.createElement('p');
        var span = document.createElement('span');
        span.className = 'pv-display';
        renderInto(span, b.latex, true);
        p.appendChild(span);
        box.appendChild(p);
      } else if (b.type === 'para') {
        var pp = document.createElement('p');
        mdNodesToDom(b.nodes, pp);
        if (!pp.childNodes.length) pp.innerHTML = '&nbsp;';
        box.appendChild(pp);
      } else if (b.type === 'quote') {
        var q = document.createElement('blockquote');
        var qp = document.createElement('p');
        mdNodesToDom(b.nodes, qp);
        q.appendChild(qp);
        box.appendChild(q);
      } else if (b.type === 'hr') {
        box.appendChild(document.createElement('hr'));
      } else if (b.type === 'code') {
        var pre = document.createElement('pre');
        var code = document.createElement('code');
        code.textContent = b.text;
        pre.appendChild(code);
        box.appendChild(pre);
      } else if (b.type === 'list') {
        var list = document.createElement(b.ordered ? 'ol' : 'ul');
        b.items.forEach(function (it) {
          var li = document.createElement('li');
          if (it.level) li.style.marginLeft = (it.level * 22) + 'px';
          if (it.task != null) li.appendChild(document.createTextNode(it.task ? '☑ ' : '☐ '));
          mdNodesToDom(it.nodes, li);
          list.appendChild(li);
        });
        box.appendChild(list);
      } else if (b.type === 'table') {
        var tbl = document.createElement('table');
        var thead = document.createElement('thead');
        var htr = document.createElement('tr');
        b.header.forEach(function (cell, ci) {
          var th = document.createElement('th');
          th.style.textAlign = b.aligns[ci] || 'left';
          mdNodesToDom(cell, th);
          htr.appendChild(th);
        });
        thead.appendChild(htr);
        tbl.appendChild(thead);
        var tbody = document.createElement('tbody');
        b.rows.forEach(function (row) {
          var tr = document.createElement('tr');
          row.forEach(function (cell, ci) {
            var td = document.createElement('td');
            td.style.textAlign = b.aligns[ci] || 'left';
            mdNodesToDom(cell, td);
            tr.appendChild(td);
          });
          tbody.appendChild(tr);
        });
        tbl.appendChild(tbody);
        box.appendChild(tbl);
      }
    });
  }
  function mdNodesToHtml(nodes, st) {
    var out = '';
    (nodes || []).forEach(function (n) {
      if (n.math != null) {
        try { out += latexToMathml(n.math); }
        catch (e) { st.failed++; out += esc(n.display ? ('$$' + n.math + '$$') : ('$' + n.math + '$')); }
      } else if (n.link != null) {
        var inner = mdNodesToHtml(n.children, st);
        out += /^https?:\/\//i.test(n.link) ? ('<a href="' + esc(n.link) + '">' + inner + '</a>') : inner;
      } else {
        var t = esc(n.s);
        if (n.code) t = '<code>' + t + '</code>';
        else {
          if (n.st) t = '<s>' + t + '</s>';
          if (n.i) t = '<i>' + t + '</i>';
          if (n.b) t = '<b>' + t + '</b>';
        }
        out += t;
      }
    });
    return out;
  }
  function buildMdFragment(text) {
    var st = { failed: 0 };
    var blocks = [];
    try { blocks = MTCore.parseMarkdown(text); } catch (e) { blocks = []; }
    var html = blocks.map(function (b) {
      if (b.type === 'heading') return '<h' + b.level + '>' + mdNodesToHtml(b.nodes, st) + '</h' + b.level + '>';
      if (b.type === 'display') {
        try { return '<p align="center">' + latexToMathml(b.latex) + '</p>'; }
        catch (e) { st.failed++; return '<p align="center">' + esc('$$' + b.latex + '$$') + '</p>'; }
      }
      if (b.type === 'para') return '<p>' + (mdNodesToHtml(b.nodes, st) || '&nbsp;') + '</p>';
      if (b.type === 'quote') return '<blockquote><p>' + mdNodesToHtml(b.nodes, st) + '</p></blockquote>';
      if (b.type === 'hr') return '<hr/>';
      if (b.type === 'code') return '<pre>' + esc(b.text) + '</pre>';
      if (b.type === 'list') {
        var tag = b.ordered ? 'ol' : 'ul';
        return '<' + tag + '>' + b.items.map(function (it) {
          return '<li>' + (it.task != null ? (it.task ? '☑ ' : '☐ ') : '') + mdNodesToHtml(it.nodes, st) + '</li>';
        }).join('') + '</' + tag + '>';
      }
      if (b.type === 'table') {
        var th = b.header.map(function (c, ci) { return '<th align="' + (b.aligns[ci] || 'left') + '">' + mdNodesToHtml(c, st) + '</th>'; }).join('');
        var trs = b.rows.map(function (r) {
          return '<tr>' + r.map(function (c, ci) { return '<td align="' + (b.aligns[ci] || 'left') + '">' + mdNodesToHtml(c, st) + '</td>'; }).join('') + '</tr>';
        }).join('');
        return '<table border="1" cellspacing="0" cellpadding="6"><thead><tr>' + th + '</tr></thead><tbody>' + trs + '</tbody></table>';
      }
      return '';
    });
    return { fragment: html.join(''), failed: st.failed };
  }
  var btnMdCopy = $('btnMdCopyWord');
  if (btnMdCopy) btnMdCopy.addEventListener('click', function () {
    var text = mdInput.value;
    if (!text.trim()) { toast('Chưa có nội dung để chép — hãy dán nội dung Markdown trước.'); return; }
    if (!hasCore) { toast('Thư viện lõi chưa tải được — hãy tải lại trang.'); return; }
    if (!hasKaTeX) { toast('KaTeX chưa tải được nên chưa tạo được Equation — hãy tải lại trang.'); return; }
    var built = buildMdFragment(text);
    var html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><head><meta charset="utf-8"></head><body><!--StartFragment-->' + built.fragment + '<!--EndFragment--></body></html>';
    var doneMsg = built.failed
      ? 'Đã chép nội dung — dán vào Word: định dạng Markdown thành định dạng Word, công thức thành Equation (có ' + built.failed + ' đoạn LaTeX không tạo được nên giữ nguyên mã); dán vào ô văn bản thường sẽ ra nguyên văn Markdown.'
      : 'Đã chép toàn bộ nội dung — dán vào Word: định dạng Markdown thành định dạng Word, công thức thành Equation gốc; dán vào ô văn bản thường sẽ ra nguyên văn Markdown.';
    var div = makeOffscreenDiv(built.fragment);
    var okSel = selectionCopy(function () { selectElementContents(div); },
      { html: html, plain: text, replace: true }, doneMsg);
    clearSelection(); div.remove();
    if (!okSel) copyRichForWord(html, text, doneMsg);
  });

  function tab3Mode() {
    var r = document.querySelector('input[name="tab3Mode"]:checked');
    return r ? r.value : 'omml';
  }
  document.querySelectorAll('input[name="tab3Mode"]').forEach(function (r) {
    r.addEventListener('change', refreshMdState);
  });
  function refreshMdState() {
    var btn = $('tab3ConvertBtn');
    var ready = !!mdInput.value.trim();
    var note = '';
    if (!hasJSZip || !hasCore) { ready = false; note = 'Thư viện cần thiết chưa tải xong — kiểm tra kết nối mạng rồi tải lại trang.'; }
    else if (tab3Mode() === 'omml' && !hasKaTeX) { ready = false; note = 'KaTeX chưa tải được nên chưa tạo được Equation; hãy kiểm tra kết nối mạng rồi tải lại trang, hoặc chọn đích MathType.'; }
    else if (!ready) note = 'Hãy dán nội dung Markdown (hoặc chọn file .md) để bắt đầu.';
    btn.disabled = !ready;
    $('tab3Status').textContent = note;
  }
  mdInput.addEventListener('input', function () { refreshMdCount(); renderMdPreview(); refreshMdState(); });
  $('pickMdBtn').addEventListener('click', function () { $('mdFileInput').click(); });
  $('mdFileInput').addEventListener('change', function () {
    var f = $('mdFileInput').files && $('mdFileInput').files[0];
    $('mdFileInput').value = '';
    if (!f) return;
    var errEl = $('mdFileError');
    errEl.classList.remove('show');
    var reader = new FileReader();
    reader.onerror = function () {
      errEl.textContent = 'Không đọc được file “' + (f.name || 'Markdown') + '” từ máy của bạn. Hãy thử lại hoặc dán nội dung trực tiếp.';
      errEl.classList.add('show');
    };
    reader.onload = function () {
      mdInput.value = String(reader.result || '');
      refreshMdCount(); renderMdPreview(); refreshMdState();
      toast('Đã nạp nội dung từ file “' + f.name + '”.');
    };
    reader.readAsText(f);
  });
  $('tab3ConvertBtn').addEventListener('click', function () {
    var errEl = $('tab3Error'), resEl = $('tab3Result');
    errEl.classList.remove('show');
    resEl.classList.remove('show');
    if (!mdInput.value.trim()) { refreshMdState(); return; }
    var mode = tab3Mode();
    previewStats = { total: 0, failed: 0 };
    var opts = { mode: mode, latexToMathml: latexToMathml, previewFor: previewFor };
    var btn = $('tab3ConvertBtn');
    btn.disabled = true;
    btn.textContent = 'Đang chuyển đổi…';
    MTCore.markdownToDocx(mdInput.value, opts, window.JSZip).then(function (res) {
      btn.disabled = false;
      btn.textContent = 'Chuyển đổi & tải file Word';
      downloadBlob(res.data, 'markdown-da-chuyen-doi.docx');
      var destLabel = mode === 'mathtype' ? 'MathType (Equation.DSMT4)' : 'Equation của Word';
      $('tab3ResultText').textContent = 'Đã chuyển nội dung Markdown thành file “markdown-da-chuyen-doi.docx”: ' + res.converted + ' công thức thành ' + destLabel + ', định dạng tiêu đề, danh sách, bảng và trích dẫn được giữ nguyên.';
      var ul = $('tab3Warnings');
      ul.innerHTML = '';
      (res.warnings || []).forEach(function (w) {
        var li = document.createElement('li');
        li.textContent = w;
        ul.appendChild(li);
      });
      if (mode === 'mathtype' && previewStats.total > 0 && previewStats.failed > 0) {
        var noteLi = document.createElement('li');
        noteLi.textContent = previewStats.failed + '/' + previewStats.total + ' công thức chưa có ảnh xem trước (môi trường hiện tại chặn khâu chụp ảnh); dữ liệu MathType vẫn đầy đủ — mở bằng Word + MathType trên Windows sẽ hiển thị và sửa được. Nếu bạn đang mở ứng dụng trong khung xem trước, hãy tải file HTML của ứng dụng về và mở trực tiếp — ảnh xem trước sẽ tạo được đầy đủ.';
        ul.appendChild(noteLi);
      }
      resEl.classList.add('show');
      resEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      refreshMdState();
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = 'Chuyển đổi & tải file Word';
      errEl.textContent = 'Chuyển đổi thất bại: ' + ((err && err.message) || 'lỗi không xác định') + '. Nội dung bạn đã nhập vẫn còn nguyên — hãy thử lại.';
      errEl.classList.add('show');
      refreshMdState();
    });
  });

  /* ---------- Khởi tạo ---------- */
  refreshLibWarnings();
  renderPalette();
  ta.value = curLatex;
  renderPreview();
  renderHist();
  renderDoc();
  refreshSegCount();
  renderTab2Preview();
  refreshTab2State();
  refreshMdCount();
  renderMdPreview();
  refreshMdState();
  tryLoadMathLive();
})();
    