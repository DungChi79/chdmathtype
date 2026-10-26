/* =====================================================================
   TAB WORD-IMAGE — Word (.docx) -> LaTeX + link anh Cloudinary
   - Cong thuc MathType (OLE): giai ma bang MTCore.oleToLatex (loi da kiem chung).
   - Cong thuc Equation (OMML): bo chuyen OMML -> LaTeX viet rieng ben duoi.
   - Anh: file media goc trong goi .docx (ban chat la zip), nhung tai len
     DUNG VUNG DANG HIEN THI trong Word: vung cat (crop) ma Word da dat
     (a:srcRect / VML crop) duoc ap len anh goc o do phan giai day du.
     Nguoi dung bam vao tung anh trong danh sach de cat lai / xoay / got
     vien truoc khi tai. Anh khong bi cat thi tai nguyen ban tung byte.
     -> tai len Cloudinary (unsigned) -> thay run anh bang run chu URL thuan.
   Cac ham thuan (parser XML, OMML->LaTeX, transform XML)
   duoc treo len window.ChdWordImage de kiem thu doc lap duoc.
   ===================================================================== */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function wiEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function wiXmlEsc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  var toastTimer = null;
  function wiToast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }
  function wiDownload(data, filename) {
    var url = URL.createObjectURL(data);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }
  function wiFmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1).replace('.', ',') + ' KB';
    return (n / 1048576).toFixed(2).replace('.', ',') + ' MB';
  }
  function wiFmtCm(emu) { return (emu / 360000).toFixed(1).replace('.', ',') + 'cm'; }

  /* ================= Parser XML nho (cho fragment OMML) ================= */
  function wiDecodeEntities(s) {
    return s.replace(/&#x([0-9a-fA-F]+);/g, function (m, g) { return String.fromCodePoint(parseInt(g, 16)); })
      .replace(/&#(\d+);/g, function (m, g) { return String.fromCodePoint(parseInt(g, 10)); })
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }
  function wiParseXml(xml) {
    var root = { tag: '#root', attrs: {}, children: [] };
    var stack = [root];
    function addText(t, raw) {
      if (!t) return;
      stack[stack.length - 1].children.push({ tag: '#text', text: raw ? t : wiDecodeEntities(t) });
    }
    var i = 0, n = xml.length;
    while (i < n) {
      var lt = xml.indexOf('<', i);
      if (lt < 0) { addText(xml.slice(i)); break; }
      if (lt > i) addText(xml.slice(i, lt));
      if (xml.indexOf('<!--', lt) === lt) { var e1 = xml.indexOf('-->', lt); i = e1 < 0 ? n : e1 + 3; continue; }
      if (xml.indexOf('<![CDATA[', lt) === lt) { var e2 = xml.indexOf(']]>', lt); addText(xml.slice(lt + 9, e2 < 0 ? n : e2), true); i = e2 < 0 ? n : e2 + 3; continue; }
      if (xml.indexOf('<?', lt) === lt) { var e3 = xml.indexOf('?>', lt); i = e3 < 0 ? n : e3 + 2; continue; }
      var gt = xml.indexOf('>', lt);
      if (gt < 0) break;
      var inside = xml.slice(lt + 1, gt);
      i = gt + 1;
      if (inside.charAt(0) === '/') { if (stack.length > 1) stack.pop(); continue; }
      var selfClose = /\/$/.test(inside);
      if (selfClose) inside = inside.slice(0, -1);
      var sp = inside.search(/\s/);
      var tag = sp < 0 ? inside : inside.slice(0, sp);
      var attrStr = sp < 0 ? '' : inside.slice(sp + 1);
      var attrs = {};
      var are = /([^\s=]+)\s*=\s*"([^"]*)"|([^\s=]+)\s*=\s*'([^']*)'/g, am;
      while ((am = are.exec(attrStr))) {
        attrs[am[1] || am[3]] = wiDecodeEntities(am[2] !== undefined && am[2] !== null ? am[2] : am[4]);
      }
      var node = { tag: tag, attrs: attrs, children: [] };
      stack[stack.length - 1].children.push(node);
      if (!selfClose) stack.push(node);
    }
    return root;
  }
  function wiLocal(tag) { var i = tag.indexOf(':'); return i >= 0 ? tag.slice(i + 1) : tag; }
  function wiChildEl(el, name) {
    for (var i = 0; i < el.children.length; i++) {
      var c = el.children[i];
      if (c.tag !== '#text' && wiLocal(c.tag) === name) return c;
    }
    return null;
  }
  function wiChildEls(el, name) {
    return el.children.filter(function (c) { return c.tag !== '#text' && wiLocal(c.tag) === name; });
  }
  function wiAttr(el, name) {
    if (!el) return null;
    for (var k in el.attrs) { if (wiLocal(k) === name) return el.attrs[k]; }
    return null;
  }
  function wiPropVal(el, prName, valName) {
    var pr = wiChildEl(el, prName); if (!pr) return null;
    var v = wiChildEl(pr, valName); if (!v) return null;
    return wiAttr(v, 'val');
  }
  function wiRawText(el) {
    var s = '';
    (function walk(nd) {
      for (var i = 0; i < nd.children.length; i++) {
        var c = nd.children[i];
        if (c.tag === '#text') s += c.text; else walk(c);
      }
    })(el);
    return s;
  }
  function wiFindFirst(el, name) {
    if (el.tag !== '#text' && wiLocal(el.tag) === name) return el;
    for (var i = 0; i < el.children.length; i++) {
      var r = wiFindFirst(el.children[i], name);
      if (r) return r;
    }
    return null;
  }

  /* ================= OMML -> LaTeX ================= */
  var WI_CHAR_MAP = {
    '\u0393': '\\Gamma', '\u0394': '\\Delta', '\u0398': '\\Theta', '\u039B': '\\Lambda', '\u039E': '\\Xi',
    '\u03A0': '\\Pi', '\u03A3': '\\Sigma', '\u03A5': '\\Upsilon', '\u03A6': '\\Phi', '\u03A8': '\\Psi', '\u03A9': '\\Omega',
    '\u03B1': '\\alpha', '\u03B2': '\\beta', '\u03B3': '\\gamma', '\u03B4': '\\delta', '\u03B5': '\\varepsilon',
    '\u03B6': '\\zeta', '\u03B7': '\\eta', '\u03B8': '\\theta', '\u03B9': '\\iota', '\u03BA': '\\kappa',
    '\u03BB': '\\lambda', '\u03BC': '\\mu', '\u03BD': '\\nu', '\u03BE': '\\xi', '\u03C0': '\\pi',
    '\u03C1': '\\rho', '\u03C3': '\\sigma', '\u03C4': '\\tau', '\u03C5': '\\upsilon', '\u03C6': '\\varphi',
    '\u03C7': '\\chi', '\u03C8': '\\psi', '\u03C9': '\\omega',
    '\u03D1': '\\vartheta', '\u03F5': '\\epsilon', '\u03D6': '\\varpi', '\u03F1': '\\varrho', '\u03C2': '\\varsigma',
    '\u2212': '-', '\u00D7': '\\times', '\u00F7': '\\div', '\u00B7': '\\cdot', '\u22C5': '\\cdot',
    '\u00B1': '\\pm', '\u2213': '\\mp', '\u2217': '\\ast', '\u2218': '\\circ', '\u2219': '\\bullet',
    '\u2264': '\\le', '\u2265': '\\ge', '\u2260': '\\ne', '\u2248': '\\approx', '\u2261': '\\equiv',
    '\u223C': '\\sim', '\u2243': '\\simeq', '\u2245': '\\cong', '\u221D': '\\propto',
    '\u226A': '\\ll', '\u226B': '\\gg', '\u227A': '\\prec', '\u227B': '\\succ', '\u227C': '\\preceq', '\u227D': '\\succeq',
    '\u2192': '\\to', '\u2190': '\\leftarrow', '\u2194': '\\leftrightarrow',
    '\u21D2': '\\Rightarrow', '\u21D0': '\\Leftarrow', '\u21D4': '\\Leftrightarrow',
    '\u2191': '\\uparrow', '\u2193': '\\downarrow', '\u21A6': '\\mapsto',
    '\u27F6': '\\longrightarrow', '\u27F5': '\\longleftarrow', '\u27F9': '\\Longrightarrow',
    '\u2208': '\\in', '\u2209': '\\notin', '\u220B': '\\ni',
    '\u2282': '\\subset', '\u2286': '\\subseteq', '\u2283': '\\supset', '\u2287': '\\supseteq',
    '\u222A': '\\cup', '\u2229': '\\cap', '\u2216': '\\setminus', '\u2205': '\\emptyset',
    '\u2200': '\\forall', '\u2203': '\\exists', '\u2204': '\\nexists', '\u00AC': '\\neg',
    '\u2227': '\\wedge', '\u2228': '\\vee', '\u2223': '\\mid', '\u2225': '\\parallel', '\u22A5': '\\perp',
    '\u221E': '\\infty', '\u2202': '\\partial', '\u2207': '\\nabla',
    '\u2220': '\\angle', '\u2221': '\\measuredangle', '\u25B3': '\\triangle',
    '\u2234': '\\therefore', '\u2235': '\\because',
    '\u2026': '\\ldots', '\u22EF': '\\cdots', '\u22EE': '\\vdots', '\u22F1': '\\ddots', '\u22F0': '\\ddots',
    '\u27E8': '\\langle', '\u27E9': '\\rangle',
    '\u230A': '\\lfloor', '\u230B': '\\rfloor', '\u2308': '\\lceil', '\u2309': '\\rceil',
    '\u211D': '\\mathbb{R}', '\u2115': '\\mathbb{N}', '\u2124': '\\mathbb{Z}', '\u211A': '\\mathbb{Q}',
    '\u2102': '\\mathbb{C}', '\u2119': '\\mathbb{P}', '\u210D': '\\mathbb{H}',
    '\u2113': '\\ell', '\u210F': '\\hbar', '\u2135': '\\aleph',
    '\u221A': '\\surd', '\u00B0': '^{\\circ}', '\u2032': "'", '\u2033': "''",
    '\u2295': '\\oplus', '\u2297': '\\otimes', '\u2296': '\\ominus', '\u2298': '\\oslash', '\u2299': '\\odot',
    '\u25EF': '\\bigcirc', '\u25A1': '\\square',
    '\u2211': '\\sum', '\u220F': '\\prod', '\u222B': '\\int', '\u222E': '\\oint',
    '\u00A0': ' '
  };
  function wiMapMathText(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      var cmd = WI_CHAR_MAP[ch];
      if (cmd) {
        out += cmd;
        var nx = s.charAt(i + 1);
        if (nx && /[a-zA-Z]/.test(nx) && /\\[a-zA-Z]+$/.test(cmd)) out += ' ';
        continue;
      }
      if (ch === '%') out += '\\%';
      else if (ch === '&') out += '\\&';
      else if (ch === '#') out += '\\#';
      else if (ch === '_') out += '\\_';
      else if (ch === '$') out += '\\$';
      else if (ch === '{') out += '\\{';
      else if (ch === '}') out += '\\}';
      else if (ch === '\\') out += '\\backslash ';
      else out += ch;
    }
    return out;
  }
  var WI_NARY_MAP = {
    '\u222B': '\\int', '\u222E': '\\oint', '\u222C': '\\iint', '\u222D': '\\iiint',
    '\u2211': '\\sum', '\u220F': '\\prod', '\u2210': '\\coprod',
    '\u22C2': '\\bigcap', '\u22C3': '\\bigcup', '\u22C1': '\\bigvee', '\u22C0': '\\bigwedge',
    '\u2A01': '\\bigoplus', '\u2A02': '\\bigotimes', '\u2A00': '\\bigodot', '\u2A04': '\\biguplus'
  };
  var WI_ACCENT_MAP = {
    '\u0302': 'hat', '\u0303': 'tilde', '\u0304': 'bar', '\u0305': 'bar',
    '\u0307': 'dot', '\u0308': 'ddot', '\u0300': 'grave', '\u0301': 'acute',
    '\u0306': 'breve', '\u030C': 'check', '\u20D7': 'vec'
  };
  var WI_FUNC_SET = {
    sin: 1, cos: 1, tan: 1, cot: 1, sec: 1, csc: 1,
    arcsin: 1, arccos: 1, arctan: 1, sinh: 1, cosh: 1, tanh: 1, coth: 1,
    arg: 1, det: 1, dim: 1, exp: 1, gcd: 1, hom: 1, inf: 1, ker: 1, lg: 1,
    lim: 1, liminf: 1, limsup: 1, ln: 1, log: 1, max: 1, min: 1, Pr: 1, sup: 1
  };
  function wiDelimTex(ch, isRight) {
    if (ch === '' || ch === null) return '.';
    switch (ch) {
      case '(': case ')': case '[': case ']': return ch;
      case '{': return '\\{';
      case '}': return '\\}';
      case '|': return '|';
      case '\u2016': return '\\|';
      case '<': case '\u27E8': return '\\langle';
      case '>': case '\u27E9': return '\\rangle';
      case '\u230A': return '\\lfloor';
      case '\u230B': return '\\rfloor';
      case '\u2308': return '\\lceil';
      case '\u2309': return '\\rceil';
      case '/': return '/';
      case '\\': return '\\backslash';
      default: return wiMapMathText(ch);
    }
  }
  function wiConvChildren(el) { return el.children.map(wiConvNode).join(''); }
  function wiConvSlot(el, name) {
    var c = wiChildEl(el, name);
    return c ? wiConvChildren(c) : '';
  }
  function wiConvRun(node) {
    var sty = wiPropVal(node, 'rPr', 'sty');
    var text = '';
    node.children.forEach(function (c) {
      var t = wiLocal(c.tag);
      if (t === 't') text += wiRawText(c);
      else if (t === 'sym') { var ch = wiAttr(c, 'chr'); if (ch) text += ch; }
    });
    if (sty === 'p' && /[A-Za-z]/.test(text) && /^[A-Za-z0-9 .,;:'()\-]+$/.test(text)) {
      return '\\mathrm{' + text.replace(/\s+/g, '') + '}';
    }
    return wiMapMathText(text);
  }
  function wiConvNode(node) {
    if (node.tag === '#text') return wiMapMathText(node.text);
    var tag = wiLocal(node.tag);
    if (tag === 'ctrlPr' || /Pr$/.test(tag)) return '';
    switch (tag) {
      case 'oMath': case 'oMathPara': return wiConvChildren(node);
      case 'r': return wiConvRun(node);
      case 't': return wiMapMathText(wiRawText(node));
      case 'sym': { var chr = wiAttr(node, 'chr'); return chr ? wiMapMathText(chr) : ''; }
      case 'e': case 'num': case 'den': case 'sub': case 'sup': case 'deg': case 'lim':
        return wiConvChildren(node);
      case 'f': {
        var type = wiPropVal(node, 'fPr', 'type') || 'bar';
        var num = wiConvSlot(node, 'num'), den = wiConvSlot(node, 'den');
        if (type === 'lin') return num + '/' + den;
        if (type === 'noBar') return '\\genfrac{}{}{0pt}{}{' + num + '}{' + den + '}';
        return '\\frac{' + num + '}{' + den + '}';
      }
      case 'rad': {
        var e = wiConvSlot(node, 'e');
        var hide = wiPropVal(node, 'radPr', 'degHide');
        var deg = wiConvSlot(node, 'deg');
        if (hide === '1' || hide === 'on' || !deg) return '\\sqrt{' + e + '}';
        return '\\sqrt[' + deg + ']{' + e + '}';
      }
      case 'sSup': return wiConvSlot(node, 'e') + '^{' + wiConvSlot(node, 'sup') + '}';
      case 'sSub': return wiConvSlot(node, 'e') + '_{' + wiConvSlot(node, 'sub') + '}';
      case 'sSubSup': return wiConvSlot(node, 'e') + '_{' + wiConvSlot(node, 'sub') + '}^{' + wiConvSlot(node, 'sup') + '}';
      case 'sPre': return '{}_{' + wiConvSlot(node, 'sub') + '}^{' + wiConvSlot(node, 'sup') + '}' + wiConvSlot(node, 'e');
      case 'nary': {
        var chr = wiPropVal(node, 'naryPr', 'chr') || '\u222B';
        var cmd = WI_NARY_MAP[chr] || wiMapMathText(chr);
        var sub = wiConvSlot(node, 'sub'), sup = wiConvSlot(node, 'sup'), e2 = wiConvSlot(node, 'e');
        return cmd + (sub ? '_{' + sub + '}' : '') + (sup ? '^{' + sup + '}' : '') + ' ' + e2;
      }
      case 'd': {
        var beg = wiPropVal(node, 'dPr', 'begChr'); if (beg === null) beg = '(';
        var end = wiPropVal(node, 'dPr', 'endChr'); if (end === null) end = ')';
        var sep = wiPropVal(node, 'dPr', 'sepChr'); if (sep === null) sep = '|';
        var parts = wiChildEls(node, 'e').map(wiConvChildren);
        var sepTex = sep ? wiDelimTex(sep, true) : '';
        return '\\left' + wiDelimTex(beg, false) + ' ' + parts.join(sepTex ? ' ' + sepTex + ' ' : ' ') + ' \\right' + wiDelimTex(end, true);
      }
      case 'm': {
        var rows = wiChildEls(node, 'mr').map(function (mr) {
          return wiChildEls(mr, 'e').map(wiConvChildren).join(' & ');
        });
        return '\\begin{matrix} ' + rows.join(' \\\\ ') + ' \\end{matrix}';
      }
      case 'eqArr': {
        var erows = wiChildEls(node, 'e').map(wiConvChildren);
        return '\\begin{aligned} ' + erows.join(' \\\\ ') + ' \\end{aligned}';
      }
      case 'acc': {
        var achr = wiPropVal(node, 'accPr', 'chr') || '\u0302';
        var acmd = WI_ACCENT_MAP[achr];
        var ae = wiConvSlot(node, 'e');
        return acmd ? '\\' + acmd + '{' + ae + '}' : ae;
      }
      case 'bar': {
        var pos = wiPropVal(node, 'barPr', 'pos') || 'top';
        return (pos === 'bot' ? '\\underline{' : '\\overline{') + wiConvSlot(node, 'e') + '}';
      }
      case 'func': {
        var fn = wiChildEl(node, 'fName');
        var fe = wiConvSlot(node, 'e');
        var raw = fn ? wiRawText(fn).replace(/\s+/g, '') : '';
        if (/^[a-zA-Z]+$/.test(raw) && WI_FUNC_SET[raw]) return '\\' + raw + ' ' + fe;
        return (fn ? wiConvChildren(fn) : '') + fe;
      }
      case 'limLow': return wiConvSlot(node, 'e') + '_{' + wiConvSlot(node, 'lim') + '}';
      case 'limUpp': return wiConvSlot(node, 'e') + '^{' + wiConvSlot(node, 'lim') + '}';
      case 'groupChr': {
        var gchr = wiPropVal(node, 'groupChrPr', 'chr') || '\u23DE';
        var ge = wiConvSlot(node, 'e');
        if (gchr === '\u23DE') return '\\overbrace{' + ge + '}';
        if (gchr === '\u23DF') return '\\underbrace{' + ge + '}';
        return ge;
      }
      case 'borderBox': case 'box': return wiConvChildren(node);
      case 'phant': return '';
      default: return wiConvChildren(node);
    }
  }
  function wiOmmlToLatex(xmlStr) {
    var root = wiParseXml(xmlStr);
    var math = wiFindFirst(root, 'oMath');
    var s = wiConvChildren(math || root);
    return s.replace(/[ \t\r\n]+/g, ' ').trim();
  }

  /* ================= Xu ly XML cua mot part (.docx) ================= */
  var WI_RUN_RE = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
  function wiParseRels(xml) {
    var map = {};
    if (!xml) return map;
    var re = /<Relationship\b[^>]*>/g, m;
    while ((m = re.exec(xml))) {
      var id = m[0].match(/Id="([^"]+)"/), tg = m[0].match(/Target="([^"]+)"/);
      if (id && tg) map[id[1]] = tg[1];
    }
    return map;
  }
  function wiResolvePart(baseDir, target) {
    var t = String(target || '');
    if (t.charAt(0) === '/') return t.replace(/^\//, '');
    var parts = (baseDir + '/' + t).split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '..') out.pop();
      else if (parts[i] !== '.' && parts[i] !== '') out.push(parts[i]);
    }
    return out.join('/');
  }
  /* Kich thuoc HIEN THI cua anh trong Word (EMU) — dung de nhan dien anh qua nho.
     DrawingML: <wp:extent cx cy>; VML: style width/height cua <v:shape>. */
  function wiParseLenEmu(v) {
    var m = /^(-?[\d.]+)\s*(pt|px|cm|mm|in)?$/.exec(String(v).trim());
    if (!m) return 0;
    var n = parseFloat(m[1]);
    var u = m[2] || 'pt';
    if (u === 'pt') return Math.round(n * 12700);
    if (u === 'in') return Math.round(n * 914400);
    if (u === 'cm') return Math.round(n * 360000);
    if (u === 'mm') return Math.round(n * 36000);
    return Math.round(n * 9525); /* px @96dpi */
  }
  function wiDispOfDrawing(spanXml) {
    var tag = spanXml.match(/<wp:extent\b[^>]*>/);
    if (!tag) return null;
    var cx = tag[0].match(/cx="(\d+)"/), cy = tag[0].match(/cy="(\d+)"/);
    if (!cx || !cy) return null;
    return { w: parseInt(cx[1], 10), h: parseInt(cy[1], 10) };
  }
  function wiDispOfVml(s, idx) {
    var sh = s.lastIndexOf('<v:shape', idx);
    if (sh < 0) return null;
    var tagEnd = s.indexOf('>', sh);
    var tag = s.slice(sh, tagEnd < 0 ? idx : tagEnd + 1);
    var st = tag.match(/style="([^"]*)"/) || tag.match(/style='([^']*)'/);
    if (!st) return null;
    var w = /(?:^|;)\s*width\s*:\s*([^;]+)/.exec(st[1]);
    var h = /(?:^|;)\s*height\s*:\s*([^;]+)/.exec(st[1]);
    if (!w || !h) return null;
    var dw = wiParseLenEmu(w[1]), dh = wiParseLenEmu(h[1]);
    return (dw > 0 && dh > 0) ? { w: dw, h: dh } : null;
  }
  /* ---- Vung cat (crop) cua anh trong Word ----
     Crop duoc bieu dien bang phan tram lech tu moi canh: {l,t,r,b} (0..1).
     DrawingML: <a:srcRect l t r b> don vi 1/100000 (100000 = 100%).
     VML: thuoc tinh cropleft/croptop/cropright/cropbottom tren <v:shape>,
     dang "12345f" (co dinh /65536), "25%" hoac so thap phan. */
  function wiCropFracNorm(c) {
    if (!c) return null;
    function cl(v) { v = Number(v) || 0; if (v < 0) v = 0; if (v > 0.95) v = 0.95; return v; }
    var o = { l: cl(c.l), t: cl(c.t), r: cl(c.r), b: cl(c.b) };
    if (o.l + o.r >= 0.999 || o.t + o.b >= 0.999) return null;
    if (o.l < 0.001 && o.t < 0.001 && o.r < 0.001 && o.b < 0.001) return null;
    return o;
  }
  /* Hinh chu nhat HIEN THI (pixel, theo kich thuoc tu nhien cua anh) khi ap
     vung cat len anh goc. Tra null neu khong co cat (hien thi toan anh). */
  function wiDisplayRect(natW, natH, crop) {
    var c = wiCropFracNorm(crop);
    if (!c || !(natW > 0) || !(natH > 0)) return null;
    var x = Math.round(c.l * natW), y = Math.round(c.t * natH);
    var w = Math.round((1 - c.l - c.r) * natW), h = Math.round((1 - c.t - c.b) * natH);
    if (w < 1 || h < 1) return null;
    return { x: x, y: y, w: w, h: h };
  }
  /* Xoay vung cat theo anh: CW = anh xoay 90 do theo chieu kim dong ho,
     CCW = nguoc chieu. Dung khi nguoi dung xoay anh trong trinh chinh sua
     ma van muon giu dung vung noi dung da chon. */
  function wiRotFracCW(f) { return { l: f.b, t: f.l, r: f.t, b: f.r }; }
  function wiRotFracCCW(f) { return { l: f.t, t: f.r, r: f.b, b: f.l }; }
  function wiRotFrac(f, cwTurns) {
    var o = { l: f.l, t: f.t, r: f.r, b: f.b };
    var n = ((cwTurns % 4) + 4) % 4;
    for (var i = 0; i < n; i++) o = wiRotFracCW(o);
    return o;
  }
  function wiCropOfDrawingSpan(spanXml, relIdx) {
    var sub = spanXml.slice(relIdx);
    var next = sub.indexOf('<a:blip', 1);
    var seg = next > 0 ? sub.slice(0, next) : sub;
    var m = seg.match(/<a:srcRect\b[^>]*>/);
    if (!m) return null;
    function num(name) {
      var mm = m[0].match(new RegExp('[\\s]' + name + '="(-?\\d+)"'));
      return mm ? parseInt(mm[1], 10) / 100000 : 0;
    }
    return wiCropFracNorm({ l: num('l'), t: num('t'), r: num('r'), b: num('b') });
  }
  function wiCropOfVml(s, idx) {
    var sh = s.lastIndexOf('<v:shape', idx);
    if (sh < 0) return null;
    var tagEnd = s.indexOf('>', sh);
    var tag = s.slice(sh, tagEnd < 0 ? idx : tagEnd + 1);
    function f(name) {
      var m = tag.match(new RegExp(name + '="([^"]+)"')) || tag.match(new RegExp(name + "='([^']+)'"));
      if (!m) return 0;
      var v = String(m[1]).trim();
      if (/f$/i.test(v)) return parseFloat(v) / 65536;
      if (/%$/.test(v)) return parseFloat(v) / 100;
      var n = parseFloat(v);
      return isNaN(n) ? 0 : n;
    }
    return wiCropFracNorm({ l: f('cropleft'), t: f('croptop'), r: f('cropright'), b: f('cropbottom') });
  }
  /* Cac tham chieu anh trong mot run: [{rid, disp, crop}] — cac khoang
     mc:Fallback (ban sao VML cua nhanh Choice) bi loai truoc khi quet de
     khong dem trung, nhung noi dung sau AlternateContent van duoc quet. */
  function wiRunImageRefs(runXml) {
    var s = runXml.replace(/<mc:Fallback>[\s\S]*?<\/mc:Fallback>/g, '');
    var spans = [];
    var di = 0;
    while (true) {
      var ds = s.indexOf('<w:drawing', di);
      if (ds < 0) break;
      var de = s.indexOf('</w:drawing>', ds);
      if (de < 0) break;
      spans.push([ds, de + 12]);
      di = de + 12;
    }
    var refs = [];
    var re = /<a:blip\b[^>]*>|<v:imagedata\b[^>]*>/g, m;
    while ((m = re.exec(s))) {
      var rm = m[0].match(/r:embed="([^"]+)"/) || m[0].match(/r:id="([^"]+)"/);
      if (!rm) continue;
      var disp = null, crop = null;
      var inSpan = false;
      for (var k = 0; k < spans.length; k++) {
        if (m.index >= spans[k][0] && m.index < spans[k][1]) {
          var spanXml = s.substring(spans[k][0], spans[k][1]);
          disp = wiDispOfDrawing(spanXml);
          crop = wiCropOfDrawingSpan(spanXml, m.index - spans[k][0]);
          inSpan = true;
          break;
        }
      }
      if (!inSpan) { disp = wiDispOfVml(s, m.index); crop = wiCropOfVml(s, m.index); }
      refs.push({ rid: rm[1], disp: disp, crop: crop });
    }
    return refs;
  }
  /* Anh "qua nho": manh vo cong thuc loi hoa anh / loi khoang trang.
     disp: kich thuoc hien thi EMU (neu biet); pixW/pixH: kich thuoc pixel (neu giai ma duoc). */
  function wiIsTinyImage(disp, pixW, pixH) {
    if (disp && disp.w > 0 && disp.h > 0) {
      if (disp.w < 360000 && disp.h < 360000) return true;   /* ca hai chieu duoi 1 cm */
      if (Math.min(disp.w, disp.h) < 90000) return true;     /* mot chieu duoi 0,25 cm: vet mong */
    }
    if (pixW > 0 && pixH > 0) {
      if (pixW < 48 && pixH < 48) return true;
      if (Math.min(pixW, pixH) < 16) return true;
    }
    return false;
  }
  function wiIsEquationRun(block) {
    if (block.indexOf('<w:object') < 0) return false;
    var pm = block.match(/ProgID="([^"]+)"/);
    return !!pm && pm[1].indexOf('Equation') === 0;
  }
  function wiTextRun(text, sz) {
    var rpr = sz ? '<w:rPr><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>' : '';
    return '<w:r>' + rpr + '<w:t xml:space="preserve">' + wiXmlEsc(text) + '</w:t></w:r>';
  }
  /* Tach cac phan tu cung cap NGOAI CUNG cua mot the (the co the long nhau).
     Tra ve [{start, end, open, inner}] theo vi tri trong xml. */
  function wiTopLevelElements(xml, tag) {
    var open = '<' + tag, close = '</' + tag + '>';
    var out = [], depth = 0, start = -1, innerStart = -1, i = 0;
    while (i < xml.length) {
      var no = xml.indexOf(open, i);
      var nc = xml.indexOf(close, i);
      if (nc < 0) break;
      if (no >= 0 && no < nc) {
        /* phan biet <w:tbl> voi <w:tblPr>: ky tu sau ten the phai la >, / hoac khoang trang */
        var after = xml.charAt(no + open.length);
        if (after !== '>' && after !== '/' && !/\s/.test(after)) { i = no + open.length; continue; }
        var gt = xml.indexOf('>', no);
        if (gt < 0) break;
        if (xml.charAt(gt - 1) === '/') {
          if (depth === 0) out.push({ start: no, end: gt + 1, open: xml.slice(no, gt + 1), inner: '' });
          i = gt + 1;
          continue;
        }
        if (depth === 0) { start = no; innerStart = gt + 1; }
        depth++;
        i = gt + 1;
      } else {
        depth--;
        if (depth < 0) depth = 0;
        if (depth === 0 && start >= 0) {
          out.push({ start: start, end: nc + close.length, open: xml.slice(start, innerStart), inner: xml.slice(innerStart, nc) });
          start = -1;
        }
        i = nc + close.length;
      }
    }
    return out;
  }
  var WI_TCPR_RE = /^\s*<w:tcPr\b[^>]*\/>|^\s*<w:tcPr\b[^>]*>[\s\S]*?<\/w:tcPr>/;
  function wiTableHasImage(inner) {
    /* Chi tinh anh thuoc CHINH bang nay — anh nam trong bang long ben trong
       se do de quy xu ly rieng, khong vi the ma go ca bang ngoai. */
    var nested = wiTopLevelElements(inner, 'w:tbl');
    var own = inner;
    if (nested.length) {
      var s = '', last = 0;
      nested.forEach(function (t) { s += inner.slice(last, t.start); last = t.end; });
      s += inner.slice(last);
      own = s;
    }
    return own.indexOf('<a:blip') >= 0 || own.indexOf('<v:imagedata') >= 0;
  }
  /* Go BANG co chua anh thanh cac doan noi tiep (doc theo hang, trong hang tu
     trai sang phai): cau hoi 2 cot (mot ben chu, mot ben hinh) giu du moi noi
     dung, link anh nam trong dong chay tu tren xuong nhu doan thuong. Bang
     khong chua anh giu nguyen, nhung van quet tiep cac o de tim bang long
     chua anh. */
  function wiFlattenTables(xml) {
    var counter = { n: 0 };
    function cellContent(cell) {
      var m = cell.inner.match(WI_TCPR_RE);
      return m ? cell.inner.slice(m[0].length) : cell.inner;
    }
    function mapCells(tblInner, fn) {
      var rows = wiTopLevelElements(tblInner, 'w:tr');
      if (!rows.length) return tblInner;
      var out = '', last = 0;
      rows.forEach(function (row) {
        out += tblInner.slice(last, row.start);
        var cells = wiTopLevelElements(row.inner, 'w:tc');
        if (!cells.length) { out += tblInner.slice(row.start, row.end); last = row.end; return; }
        var rowOut = row.open, cl = 0;
        cells.forEach(function (cell) {
          rowOut += row.inner.slice(cl, cell.start);
          var raw = cell.inner;
          var m = raw.match(WI_TCPR_RE);
          var tcPr = m ? m[0] : '';
          var content = m ? raw.slice(m[0].length) : raw;
          rowOut += cell.open + tcPr + fn(content) + '</w:tc>';
          cl = cell.end;
        });
        rowOut += row.inner.slice(cl) + '</w:tr>';
        out += rowOut;
        last = row.end;
      });
      out += tblInner.slice(last);
      return out;
    }
    function cellContents(tblInner) {
      var s = '';
      wiTopLevelElements(tblInner, 'w:tr').forEach(function (row) {
        wiTopLevelElements(row.inner, 'w:tc').forEach(function (cell) {
          s += flattenTables(cellContent(cell));
        });
      });
      return s;
    }
    function flattenTables(x) {
      var tables = wiTopLevelElements(x, 'w:tbl');
      if (!tables.length) return x;
      var out = '', last = 0;
      tables.forEach(function (t) {
        out += x.slice(last, t.start);
        last = t.end;
        if (wiTableHasImage(t.inner)) { counter.n++; out += cellContents(t.inner); }
        else out += t.open + mapCells(t.inner, flattenTables) + '</w:tbl>';
      });
      out += x.slice(last);
      return out;
    }
    return { xml: flattenTables(xml), count: counter.n };
  }
  /* Thay DUNG phan tu anh trong run bang chu URL, giu nguyen moi noi dung khac
     cung run (chu, dau tab, ngat dong...) — tranh mat noi dung khi mot run chua
     ca anh lan chu. actions: mang theo thu tu xuat hien cua anh trong run,
     moi phan tu la URL (thay) hoac null (bo qua — giu nguyen anh).
     Tra ve null neu so phan tu anh khong khop actions (lech hiem gap).
     Sau khi thay, bo <w:position> khoi rPr cua run: do la thuoc tinh can
     duong nen (baseline) danh cho ANH (gia tri am lon = ha anh xuong khoi
     duong nen cho khop dong chu). Neu de nguyen cho chu URL, Word ha chu
     xuong dung bang ay -> dong bi doi cao len thanh mot khoang trang to
     dung o giua van ban ma khong xoa duoc (khong phai doan trong). Run nao
     khong co anh nao duoc thay (return null o tren) thi giu nguyen 100%. */
  function wiReplaceRunImages(block, actions) {
    var i = 0, replaced = 0, seen = 0;
    var re = /<mc:AlternateContent>[\s\S]*?<\/mc:AlternateContent>|<w:drawing>[\s\S]*?<\/w:drawing>|<w:pict>[\s\S]*?<\/w:pict>/g;
    var out = block.replace(re, function (seg) {
      var hasImg = seg.indexOf('<a:blip') >= 0 || seg.indexOf('<v:imagedata') >= 0;
      if (!hasImg) return seg;
      seen++;
      var a = actions[i++];
      if (a === null || a === undefined) return seg;
      replaced++;
      return '<w:t xml:space="preserve">' + wiXmlEsc(a) + '</w:t>';
    });
    if (seen !== actions.length || !replaced) return null;
    return out.replace(/<w:position\b[^>]*\/>/g, '');
  }
  /* handlers: ole(block) -> latex | null (loi, giu nguyen) | undefined (khong phai Equation)
               omml(xml, display) -> latex (nem loi = giu nguyen)
               img(rid) -> url | null (loi: giu nguyen run, dem loi)
                                 | undefined (bo qua: giu nguyen run, khong dem loi)
               flattenTables: true = go bang chua anh thanh doan noi tiep truoc */
  function wiTransformPartXml(xml, handlers) {
    var stats = { oleOk: 0, oleFail: 0, ommlOk: 0, ommlFail: 0, imgOk: 0, imgFail: 0, imgSkip: 0, tblFlat: 0 };
    var src = xml;
    if (handlers.flattenTables) {
      var fl = wiFlattenTables(src);
      src = fl.xml;
      stats.tblFlat = fl.count;
    }
    var out = src.replace(WI_RUN_RE, function (block) {
      if (block.indexOf('<w:object') < 0) return block;
      var latex = handlers.ole(block);
      if (latex === undefined) return block;
      if (latex === null) { stats.oleFail++; return block; }
      stats.oleOk++;
      return wiTextRun('$' + latex + '$', handlers.fontSize);
    });
    out = out.replace(/<m:oMathPara\b[^>]*>[\s\S]*?<\/m:oMathPara>/g, function (block) {
      try {
        var mm = block.match(/<m:oMath\b[^>]*>[\s\S]*?<\/m:oMath>/);
        var latex = handlers.omml(mm ? mm[0] : block, true);
        stats.ommlOk++;
        return wiTextRun('$$' + latex + '$$', handlers.fontSize);
      } catch (e) { stats.ommlFail++; return block; }
    });
    out = out.replace(/<m:oMath\b[^>]*>[\s\S]*?<\/m:oMath>/g, function (block) {
      try {
        var latex = handlers.omml(block, false);
        stats.ommlOk++;
        return wiTextRun('$' + latex + '$', handlers.fontSize);
      } catch (e) { stats.ommlFail++; return block; }
    });
    out = out.replace(WI_RUN_RE, function (block) {
      if (block.indexOf('<w:object') >= 0) return block;
      var refs = wiRunImageRefs(block);
      if (!refs.length) return block;
      var actions = [], nSkip = 0, nUrl = 0;
      for (var i = 0; i < refs.length; i++) {
        var url = handlers.img(refs[i].rid);
        if (url === undefined) { actions.push(null); nSkip++; }
        else if (url === null) { stats.imgFail++; return block; }
        else { actions.push(url); nUrl++; }
      }
      if (!nUrl) { stats.imgSkip += nSkip; return block; }
      var nb = wiReplaceRunImages(block, actions);
      if (nb === null) {
        if (nSkip) { stats.imgSkip += nSkip; return block; } /* lech thu tu hiem gap: giu nguyen cho chac */
        nb = actions.map(function (u) { return wiTextRun(u, handlers.fontSize); }).join(wiTextRun(' ', handlers.fontSize));
      }
      stats.imgOk += nUrl;
      stats.imgSkip += nSkip;
      return nb;
    });
    return { xml: out, stats: stats };
  }

  /* ================= Phan trinh duyet: chuan bi anh & tai len Cloudinary ================= */
  var WI_MIME = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml',
    tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/x-emf', wmf: 'image/x-wmf'
  };
  var WI_DECODABLE = { png: 1, jpg: 1, jpeg: 1, gif: 1, bmp: 1, webp: 1 };
  function wiExtOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }
  function wiLoadBitmap(blob) {
    if (typeof window.createImageBitmap === 'function') return window.createImageBitmap(blob);
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Không giải mã được ảnh')); };
      img.src = url;
    });
  }
  /* Ve anh da xoay (rot = so lan 90 do theo chieu kim dong ho) ra canvas. */
  function wiDrawRotated(bmp, rot) {
    var w = bmp.width, h = bmp.height;
    var swap = (((rot % 4) + 4) % 4) % 2 === 1;
    var c = document.createElement('canvas');
    c.width = swap ? h : w;
    c.height = swap ? w : h;
    var ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((((rot % 4) + 4) % 4) * Math.PI / 2);
    ctx.drawImage(bmp, -w / 2, -h / 2);
    return c;
  }
  /* ================= EMF -> PNG: ve lai anh vector EMF tren canvas =================
     Trinh duyet khong hien thi duoc EMF, Cloudinary cung tu choi dinh dang
     nay khi tai len nguyen ban — nen anh EMF duoc VE LAI tu cac ban ghi GDI
     trong file (duong thang, da giac, bezier, ellipse, chu, anh DIB nhung
     san...) thanh PNG ngay trong trinh duyet. Ho tro tap ban ghi pho bien
     cua hinh trong de thi (bang bien thien, do thi, hinh hoc); ban ghi la
     (gradient, vung cat, EMF+ thuan khong kem ban ghi GDI) thi bo qua an
     toan. Khong ve duoc gi -> tra null, noi goi tu quay ve phuong an tai
     nguyen ban / giu anh goc nhu truoc. */
  function wiEmfRender(bytes) {
    try { return wiEmfRenderInner(bytes); }
    catch (e) { return null; }
  }
  /* Ban ve EMF cua mot job duoc nho lai tren chinh job (bytes khong doi
     trong suot phien lam viec) de tranh ve lai nhieu lan (hinh thu nho,
     trinh chinh sua, ban tai len dung chung mot ban). */
  function wiEmfCanvas(job) {
    if (job._emfCanvas !== undefined) return job._emfCanvas;
    job._emfCanvas = (job.bytes && job.bytes.length) ? wiEmfRender(job.bytes) : null;
    return job._emfCanvas;
  }
  function wiEmfRenderInner(bytes) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.length < 88) return null;
    if (dv.getUint32(0, true) !== 1 || dv.getUint32(40, true) !== 0x464D4520) return null; /* Type=EMR_HEADER, chu ky " EMF" */
    function I(o) { return dv.getInt32(o, true); }
    function U(o) { return dv.getUint32(o, true); }
    function F32(o) { return dv.getFloat32(o, true); }
    var bL = I(8), bT = I(12), bR = I(16), bB = I(20);
    var fWmm = Math.abs(I(32) - I(24)) / 100, fHmm = Math.abs(I(36) - I(28)) / 100;
    var devW = I(72), devH = I(76), mmW = I(80), mmH = I(84);
    var bw = Math.max(1, bR - bL), bh = Math.max(1, bB - bT);
    var cw, ch;
    if (fWmm > 0 && fHmm > 0) {
      var s0 = Math.min(2200 / fWmm, 2200 / fHmm);
      if (s0 > 16) s0 = 16;
      if (s0 < 0.5) s0 = 0.5;
      cw = Math.max(1, Math.round(fWmm * s0));
      ch = Math.max(1, Math.round(fHmm * s0));
    } else { cw = Math.min(bw, 2200); ch = Math.min(bh, 2200); }
    if (cw > 4096 || ch > 4096) {
      var kk = Math.min(4096 / cw, 4096 / ch);
      cw = Math.max(1, Math.round(cw * kk));
      ch = Math.max(1, Math.round(ch * kk));
    }
    var canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext('2d');
    var BASE = [cw / bw, 0, 0, ch / bh, -bL * cw / bw, -bT * ch / bh];
    function mul(m1, m2) {
      return [
        m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
        m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
        m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
      ];
    }
    function defPen() { return { type: 0, w: 0, color: 0, cap: 0, join: 0 }; }
    function defBrush() { return { style: 0, color: 0xFFFFFF, hatch: 0 }; }
    function defFont() { return { h: -16, esc: 0, weight: 400, italic: 0, under: 0, strike: 0, name: 'Times New Roman' }; }
    function newState() {
      return {
        winOrg: { x: 0, y: 0 }, winExt: { x: 1, y: 1 }, vpOrg: { x: 0, y: 0 }, vpExt: { x: 1, y: 1 },
        mapMode: 1, world: [1, 0, 0, 1, 0, 0],
        pen: defPen(), brush: defBrush(), font: defFont(),
        textColor: 0, bkColor: 0xFFFFFF, bkMode: 2, fillMode: 1, rop: 13,
        align: 0, arcDir: 1, miter: 10, pos: { x: 0, y: 0 }
      };
    }
    var st = newState();
    var stack = [];
    var objs = {};
    var pathSegs = null, pathOpen = false;
    var drawn = 0;
    function cloneState(s) {
      return {
        winOrg: { x: s.winOrg.x, y: s.winOrg.y }, winExt: { x: s.winExt.x, y: s.winExt.y },
        vpOrg: { x: s.vpOrg.x, y: s.vpOrg.y }, vpExt: { x: s.vpExt.x, y: s.vpExt.y },
        mapMode: s.mapMode, world: s.world.slice(),
        pen: s.pen, brush: s.brush, font: s.font,
        textColor: s.textColor, bkColor: s.bkColor, bkMode: s.bkMode, fillMode: s.fillMode,
        rop: s.rop, align: s.align, arcDir: s.arcDir, miter: s.miter, pos: { x: s.pos.x, y: s.pos.y }
      };
    }
    function winVp() {
      var sx, sy;
      if (st.mapMode === 7 || st.mapMode === 8) {
        sx = st.vpExt.x / (st.winExt.x || 1);
        sy = st.vpExt.y / (st.winExt.y || 1);
        if (st.mapMode === 7) {
          var a = Math.min(Math.abs(sx), Math.abs(sy));
          sx = sx < 0 ? -a : a; sy = sy < 0 ? -a : a;
        }
      } else if (st.mapMode === 1) { sx = 1; sy = 1; }
      else {
        var unit = { 2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 0.01764 }[st.mapMode] || 0.1;
        var mdx = (devW > 0 && mmW > 0) ? mmW / devW : 0.2646;
        var mdy = (devH > 0 && mmH > 0) ? mmH / devH : 0.2646;
        sx = unit / mdx; sy = -unit / mdy;
      }
      return [sx, 0, 0, sy, st.vpOrg.x - st.winOrg.x * sx, st.vpOrg.y - st.winOrg.y * sy];
    }
    function fullMat() { return mul(BASE, mul(winVp(), st.world)); }
    function applyT() {
      var M = fullMat();
      ctx.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]);
      ctx.globalCompositeOperation = (st.rop === 7) ? 'xor' : 'source-over';
      return M;
    }
    function scaleAvg() {
      var M = fullMat();
      var d = Math.abs(M[0] * M[3] - M[1] * M[2]);
      return d > 0 ? Math.sqrt(d) : 1;
    }
    function colStr(c) { return 'rgb(' + (c & 255) + ',' + ((c >> 8) & 255) + ',' + ((c >> 16) & 255) + ')'; }
    function penOn() { return st.pen && st.pen.type !== 5; }
    function brushOn() { return st.brush && st.brush.style !== 1 && st.brush.style !== 3 && st.brush.style !== 5; }
    function setStroke() {
      var p = st.pen;
      ctx.strokeStyle = colStr(p.color);
      if (p.w > 0) ctx.lineWidth = p.w;
      else ctx.lineWidth = 1 / Math.max(0.0001, scaleAvg());
      ctx.lineCap = ['round', 'square', 'butt'][p.cap] || 'round';
      ctx.lineJoin = ['round', 'bevel', 'miter'][p.join] || 'round';
      ctx.miterLimit = st.miter || 10;
      if (p.type >= 1 && p.type <= 4) {
        var u = Math.max(ctx.lineWidth, 1 / Math.max(0.0001, scaleAvg()));
        var pat = { 1: [6 * u, 3 * u], 2: [1 * u, 2 * u], 3: [6 * u, 3 * u, 1 * u, 3 * u], 4: [6 * u, 3 * u, 1 * u, 3 * u, 1 * u, 3 * u] }[p.type];
        ctx.setLineDash(pat || []);
      } else ctx.setLineDash([]);
    }
    function brushFillStyle() {
      var b = st.brush;
      if (b.style === 2) { /* BS_HATCHED: ve mau gach tren o 8x8 */
        var t = document.createElement('canvas');
        t.width = 8; t.height = 8;
        var g = t.getContext('2d');
        g.strokeStyle = colStr(b.color); g.lineWidth = 1.2;
        g.beginPath();
        if (b.hatch === 0 || b.hatch === 4 || b.hatch === 5) { g.moveTo(0, 4); g.lineTo(8, 4); }
        if (b.hatch === 1 || b.hatch === 4 || b.hatch === 5) { g.moveTo(4, 0); g.lineTo(4, 8); }
        if (b.hatch === 2 || b.hatch === 5) { g.moveTo(0, 8); g.lineTo(8, 0); }
        if (b.hatch === 3 || b.hatch === 5) { g.moveTo(0, 0); g.lineTo(8, 8); }
        g.stroke();
        return ctx.createPattern(t, 'repeat') || colStr(b.color);
      }
      return colStr(b.color);
    }
    function buildPath(segs) {
      var p = new Path2D();
      for (var i = 0; i < segs.length; i++) {
        var g = segs[i];
        if (g[0] === 'M') p.moveTo(g[1], g[2]);
        else if (g[0] === 'L') p.lineTo(g[1], g[2]);
        else if (g[0] === 'C') p.bezierCurveTo(g[1], g[2], g[3], g[4], g[5], g[6]);
        else if (g[0] === 'Z') p.closePath();
        else if (g[0] === 'R') p.rect(g[1], g[2], g[3], g[4]);
        else if (g[0] === 'RR') { if (p.roundRect) p.roundRect(g[1], g[2], g[3], g[4], [g[5], g[6]]); else p.rect(g[1], g[2], g[3], g[4]); }
        else if (g[0] === 'E') p.ellipse(g[1], g[2], Math.abs(g[3]), Math.abs(g[4]), 0, g[5], g[6], !!g[7]);
      }
      return p;
    }
    function paint(p, mode) {
      if (mode === 'fs' || mode === 'f') {
        if (brushOn()) {
          applyT();
          ctx.fillStyle = brushFillStyle();
          ctx.fill(p, st.fillMode === 1 ? 'evenodd' : 'nonzero');
          drawn++;
        }
        if (mode === 'f') return;
      }
      if ((mode === 'fs' || mode === 's') && penOn()) {
        applyT();
        setStroke();
        ctx.stroke(p);
        drawn++;
      }
    }
    function emit(segs, mode) {
      if (pathSegs) { for (var i = 0; i < segs.length; i++) pathSegs.push(segs[i]); }
      else if (mode) paint(buildPath(segs), mode);
    }
    /* Cac op "to" (LINETO, POLYLINETO...): tiep noi tu vi tri hien tai. */
    function emitCont(segs, mode) {
      var all = [['M', st.pos.x, st.pos.y]].concat(segs);
      if (pathSegs) {
        if (pathOpen) all = segs;
        for (var i = 0; i < all.length; i++) pathSegs.push(all[i]);
        pathOpen = true;
      } else if (mode) paint(buildPath(all), mode);
    }
    function ptsL(base, count) {
      var a = [];
      for (var i = 0; i < count; i++) a.push([I(base + i * 8), I(base + i * 8 + 4)]);
      return a;
    }
    function ptsS(base, count) {
      var a = [];
      for (var i = 0; i < count; i++) a.push([dv.getInt16(base + i * 4, true), dv.getInt16(base + i * 4 + 2, true)]);
      return a;
    }
    function fontStr() {
      var f = st.font;
      var size = Math.abs(f.h) || 16;
      if (f.h > 0) size = Math.round(f.h * 0.82); /* chieu cao o chua le trong -> co chu em gan dung */
      var name = String(f.name || 'Times New Roman').replace(/[";]/g, '');
      return (f.italic ? 'italic ' : '') + (f.weight || 400) + ' ' + size + 'px "' + name + '", "Times New Roman", serif';
    }
    function drawText(ro, isW) {
      var refX = I(ro + 36), refY = I(ro + 40);
      var nChars = U(ro + 44), offStr = U(ro + 48), opts = U(ro + 52), offDx = U(ro + 72);
      var rcL = I(ro + 56), rcT = I(ro + 60), rcR = I(ro + 64), rcB = I(ro + 68);
      if (!nChars || nChars > 20000 || !offStr) return;
      var so = ro + offStr, i, str = '';
      if (isW) {
        if (so + nChars * 2 > bytes.length + 2) return;
        for (i = 0; i < nChars; i++) str += String.fromCharCode(dv.getUint16(so + i * 2, true));
      } else {
        if (so + nChars > bytes.length + 1) return;
        for (i = 0; i < nChars; i++) str += String.fromCharCode(dv.getUint8(so + i));
      }
      if (!str) return;
      applyT();
      if ((opts & 2) || (st.bkMode === 2 && rcR > rcL && rcB > rcT)) {
        ctx.fillStyle = colStr(st.bkColor);
        ctx.fillRect(rcL, rcT, rcR - rcL, rcB - rcT);
      }
      var clipped = !!(opts & 4) && rcR > rcL && rcB > rcT;
      if (clipped) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rcL, rcT, rcR - rcL, rcB - rcT);
        ctx.clip();
      }
      ctx.font = fontStr();
      ctx.fillStyle = colStr(st.textColor);
      var hal = st.align & 6, ver = st.align & 24;
      ctx.textBaseline = ver === 8 ? 'bottom' : (ver === 24 ? 'alphabetic' : 'top');
      var x = refX, y = refY;
      if (st.align & 1) { x = st.pos.x; y = st.pos.y; } /* TA_UPDATECP */
      var esc = (st.font.esc || 0) * Math.PI / 1800;
      var pdy = !!(opts & 0x2000);
      var dxs = null;
      if (offDx) {
        dxs = [];
        var ndx = pdy ? nChars * 2 : nChars;
        for (i = 0; i < ndx; i++) dxs.push(I(ro + offDx + i * 4));
      }
      var startOff = 0, totW = 0;
      ctx.save();
      ctx.translate(x, y);
      if (esc) ctx.rotate(-esc);
      if (dxs) {
        for (i = 0; i < nChars; i++) totW += dxs[pdy ? i * 2 : i];
        startOff = hal === 6 ? -totW / 2 : (hal === 2 ? -totW : 0);
        ctx.textAlign = 'left';
        var cxp = startOff, cyp = 0;
        for (i = 0; i < nChars; i++) {
          ctx.fillText(str.charAt(i), cxp, cyp);
          if (pdy) { cxp += dxs[i * 2]; cyp += dxs[i * 2 + 1]; }
          else cxp += dxs[i];
        }
      } else {
        try { totW = ctx.measureText(str).width; } catch (e) { totW = 0; }
        startOff = hal === 6 ? -totW / 2 : (hal === 2 ? -totW : 0);
        ctx.textAlign = hal === 6 ? 'center' : (hal === 2 ? 'right' : 'left');
        ctx.fillText(str, 0, 0);
      }
      if (st.align & 1) st.pos.x += totW;
      if ((st.font.under || st.font.strike) && totW > 0) {
        var sz = Math.abs(st.font.h) || 16;
        ctx.strokeStyle = colStr(st.textColor);
        ctx.lineWidth = Math.max(sz / 14, 1 / Math.max(0.0001, scaleAvg()));
        ctx.beginPath();
        if (st.font.under) { ctx.moveTo(startOff, sz * 0.16); ctx.lineTo(startOff + totW, sz * 0.16); }
        if (st.font.strike) { ctx.moveTo(startOff, -sz * 0.3); ctx.lineTo(startOff + totW, -sz * 0.3); }
        ctx.stroke();
      }
      ctx.restore();
      if (clipped) ctx.restore();
      drawn++;
    }
    function dibCanvas(ro, offBmi, cbBmi, offBits) {
      if (!offBmi || !offBits || cbBmi < 40) return null;
      var bo = ro + offBmi;
      if (bo + 40 > bytes.length || U(bo) < 40) return null;
      var w = I(bo + 4), hh = I(bo + 8);
      var bpp = dv.getUint16(bo + 14, true);
      if (U(bo + 16) !== 0 || !(w > 0) || !hh || w > 8192 || Math.abs(hh) > 8192) return null; /* chi BI_RGB */
      var h = Math.abs(hh), topDown = hh < 0;
      var pal = [];
      if (bpp <= 8) {
        var hdrSize = U(bo);
        var nPal = Math.min(1 << bpp, Math.max(0, Math.floor((cbBmi - hdrSize) / 4)));
        var usedC = U(bo + 32);
        if (usedC) nPal = Math.min(usedC, 256);
        for (var pi = 0; pi < nPal; pi++) {
          var po = bo + hdrSize + pi * 4;
          pal.push([dv.getUint8(po + 2), dv.getUint8(po + 1), dv.getUint8(po)]);
        }
        if (!pal.length) return null;
      }
      var bitsBase = ro + offBits;
      var rowSize = Math.floor((bpp * w + 31) / 32) * 4;
      if (bitsBase + rowSize * h > bytes.length + rowSize) return null;
      var tc = document.createElement('canvas');
      tc.width = w; tc.height = h;
      var tg = tc.getContext('2d');
      var img = tg.createImageData(w, h);
      var data = img.data;
      var alphaUsed = false, axx, ayy;
      if (bpp === 32) {
        for (ayy = 0; ayy < h && !alphaUsed; ayy++)
          for (axx = 3; axx < w * 4; axx += 4)
            if (dv.getUint8(bitsBase + ayy * rowSize + axx) !== 0) { alphaUsed = true; break; }
      }
      for (var yy = 0; yy < h; yy++) {
        var srow = bitsBase + (topDown ? yy : (h - 1 - yy)) * rowSize;
        var drow = yy * w * 4;
        for (var xx = 0; xx < w; xx++) {
          var di = drow + xx * 4, r = 0, g = 0, b = 0, a = 255, so2, vv, cc;
          if (bpp === 32) { so2 = srow + xx * 4; b = dv.getUint8(so2); g = dv.getUint8(so2 + 1); r = dv.getUint8(so2 + 2); a = alphaUsed ? dv.getUint8(so2 + 3) : 255; }
          else if (bpp === 24) { so2 = srow + xx * 3; b = dv.getUint8(so2); g = dv.getUint8(so2 + 1); r = dv.getUint8(so2 + 2); }
          else if (bpp === 16) { vv = dv.getUint16(srow + xx * 2, true); r = Math.round(((vv >> 10) & 31) * 255 / 31); g = Math.round(((vv >> 5) & 31) * 255 / 31); b = Math.round((vv & 31) * 255 / 31); }
          else if (bpp === 8) { cc = pal[dv.getUint8(srow + xx)]; if (!cc) continue; r = cc[0]; g = cc[1]; b = cc[2]; }
          else if (bpp === 4) { vv = dv.getUint8(srow + (xx >> 1)); cc = pal[(xx % 2 === 0) ? (vv >> 4) : (vv & 15)]; if (!cc) continue; r = cc[0]; g = cc[1]; b = cc[2]; }
          else if (bpp === 1) { vv = dv.getUint8(srow + (xx >> 3)); cc = pal[(vv >> (7 - (xx % 8))) & 1]; if (!cc) continue; r = cc[0]; g = cc[1]; b = cc[2]; }
          else return null;
          data[di] = r; data[di + 1] = g; data[di + 2] = b; data[di + 3] = a;
        }
      }
      tg.putImageData(img, 0, 0);
      return tc;
    }
    function blitDib(ro, offBmi, cbBmi, offBits, dx, dy, dw2, dh2, sx, sy, sw2, sh2) {
      var tc = dibCanvas(ro, offBmi, cbBmi, offBits);
      if (!tc) return;
      applyT();
      try { ctx.drawImage(tc, sx, sy, sw2, sh2, dx, dy, dw2, dh2); drawn++; } catch (e) { /* bo qua DIB loi */ }
    }
    function stockSelect(k) {
      if (k === 6) st.pen = { type: 0, w: 0, color: 0xFFFFFF, cap: 0, join: 0 };
      else if (k === 7) st.pen = defPen();
      else if (k === 8) st.pen = { type: 5, w: 0, color: 0, cap: 0, join: 0 };
      else if (k === 0) st.brush = { style: 0, color: 0xFFFFFF, hatch: 0 };
      else if (k === 1) st.brush = { style: 0, color: 0xC0C0C0, hatch: 0 };
      else if (k === 2) st.brush = { style: 0, color: 0x808080, hatch: 0 };
      else if (k === 3) st.brush = { style: 0, color: 0x404040, hatch: 0 };
      else if (k === 4) st.brush = { style: 0, color: 0, hatch: 0 };
      else if (k === 5) st.brush = { style: 1, color: 0, hatch: 0 };
      else if (k === 18) st.brush = { style: 0, color: 0xFFFFFF, hatch: 0 };
      else if (k === 19) st.pen = defPen();
      else if (k === 10 || k === 11 || k === 16) st.font = { h: -13, esc: 0, weight: 400, italic: 0, under: 0, strike: 0, name: 'Courier New' };
      else if (k === 12 || k === 13 || k === 17) st.font = { h: -13, esc: 0, weight: 400, italic: 0, under: 0, strike: 0, name: 'Arial' };
    }
    function arcSegs(ro, closeMode) {
      var l = I(ro + 8), t = I(ro + 12), r = I(ro + 16), b = I(ro + 20);
      var cx = (l + r) / 2, cy = (t + b) / 2;
      var rx = Math.abs(r - l) / 2, ry = Math.abs(b - t) / 2;
      if (!rx || !ry) return [];
      var a0 = Math.atan2((I(ro + 28) - cy) / ry, (I(ro + 24) - cx) / rx);
      var a1 = Math.atan2((I(ro + 36) - cy) / ry, (I(ro + 32) - cx) / rx);
      var seg = ['E', cx, cy, rx, ry, a0, a1, st.arcDir === 1 ? 1 : 0];
      if (closeMode === 'pie') return [['M', cx, cy], seg, ['Z']];
      if (closeMode === 'chord') return [seg, ['Z']];
      return [seg];
    }
    var off = 0, guard = 0;
    while (off + 8 <= bytes.length && guard++ < 300000) {
      var type = U(off), size = U(off + 4);
      if (size < 8) break;
      if (off + size > bytes.length) size = bytes.length - off;
      var ro = off, x, y, n, pts, i2;
      switch (type) {
        case 14: break; /* EMR_EOF */
        case 9: st.winExt = { x: I(ro + 8), y: I(ro + 12) }; break;
        case 10: st.winOrg = { x: I(ro + 8), y: I(ro + 12) }; break;
        case 11: st.vpExt = { x: I(ro + 8), y: I(ro + 12) }; break;
        case 12: st.vpOrg = { x: I(ro + 8), y: I(ro + 12) }; break;
        case 17: st.mapMode = U(ro + 8); break;
        case 18: st.bkMode = U(ro + 8); break;
        case 19: st.fillMode = U(ro + 8); break;
        case 20: st.rop = U(ro + 8); break;
        case 22: st.align = U(ro + 8); break;
        case 24: st.textColor = U(ro + 8); break;
        case 25: st.bkColor = U(ro + 8); break;
        case 27:
          st.pos = { x: I(ro + 8), y: I(ro + 12) };
          emit([['M', st.pos.x, st.pos.y]], null);
          if (pathSegs) pathOpen = true;
          break;
        case 31:
          if (I(ro + 12)) st.vpExt.x = st.vpExt.x * I(ro + 8) / I(ro + 12);
          if (I(ro + 20)) st.vpExt.y = st.vpExt.y * I(ro + 16) / I(ro + 20);
          break;
        case 32:
          if (I(ro + 12)) st.winExt.x = st.winExt.x * I(ro + 8) / I(ro + 12);
          if (I(ro + 20)) st.winExt.y = st.winExt.y * I(ro + 16) / I(ro + 20);
          break;
        case 33: stack.push(cloneState(st)); break;
        case 34: {
          var nn = I(ro + 8);
          var idx = nn > 0 ? nn - 1 : stack.length + nn;
          if (idx >= 0 && idx < stack.length) { st = stack[idx]; stack.length = idx; }
          break;
        }
        case 35: st.world = [F32(ro + 8), F32(ro + 12), F32(ro + 16), F32(ro + 20), F32(ro + 24), F32(ro + 28)]; break;
        case 36: {
          var X = [F32(ro + 8), F32(ro + 12), F32(ro + 16), F32(ro + 20), F32(ro + 24), F32(ro + 28)];
          var md = U(ro + 32);
          if (md === 1) st.world = [1, 0, 0, 1, 0, 0];
          else if (md === 2) st.world = mul(X, st.world);
          else if (md === 3) st.world = mul(st.world, X);
          else if (md === 4) st.world = X;
          break;
        }
        case 37: {
          var ih = U(ro + 8);
          if (ih & 0x80000000) stockSelect(ih & 0x7FFFFFFF);
          else {
            var ob = objs[ih];
            if (ob) {
              if (ob.kind === 'pen') st.pen = ob;
              else if (ob.kind === 'brush') st.brush = ob;
              else if (ob.kind === 'font') st.font = ob;
            }
          }
          break;
        }
        case 38: {
          var ps1 = U(ro + 12) & 0xF;
          objs[U(ro + 8)] = { kind: 'pen', type: ps1 <= 7 ? ps1 : 0, w: I(ro + 16), color: U(ro + 24), cap: 0, join: 0 };
          break;
        }
        case 39:
          objs[U(ro + 8)] = { kind: 'brush', style: U(ro + 12), color: U(ro + 16), hatch: I(ro + 20) };
          break;
        case 40: delete objs[U(ro + 8)]; break;
        case 41: { /* ANGLEARC */
          var acx = I(ro + 8), acy = I(ro + 12), arad = U(ro + 16);
          var aa0 = F32(ro + 20) * Math.PI / 180, asw = F32(ro + 24) * Math.PI / 180;
          var segs = [];
          var steps = Math.max(2, Math.min(72, Math.ceil(Math.abs(asw) / (Math.PI / 36))));
          for (i2 = 0; i2 <= steps; i2++) {
            var aa = aa0 + asw * i2 / steps;
            segs.push(['L', acx + arad * Math.cos(aa), acy - arad * Math.sin(aa)]);
          }
          emitCont(segs, 's');
          var ae = aa0 + asw;
          st.pos = { x: acx + arad * Math.cos(ae), y: acy - arad * Math.sin(ae) };
          break;
        }
        case 42: { /* ELLIPSE */
          var el = I(ro + 8), et = I(ro + 12), er = I(ro + 16), eb = I(ro + 20);
          emit([['E', (el + er) / 2, (et + eb) / 2, Math.abs(er - el) / 2, Math.abs(eb - et) / 2, 0, Math.PI * 2, 0]], 'fs');
          if (pathSegs) pathOpen = true;
          break;
        }
        case 43: emit([['R', I(ro + 8), I(ro + 12), I(ro + 16) - I(ro + 8), I(ro + 20) - I(ro + 12)]], 'fs'); if (pathSegs) pathOpen = true; break;
        case 44: emit([['RR', I(ro + 8), I(ro + 12), I(ro + 16) - I(ro + 8), I(ro + 20) - I(ro + 12), I(ro + 24) / 2, I(ro + 28) / 2]], 'fs'); if (pathSegs) pathOpen = true; break;
        case 45: emit(arcSegs(ro, null), 's'); if (pathSegs) pathOpen = true; break;
        case 46: emit(arcSegs(ro, 'chord'), 'fs'); if (pathSegs) pathOpen = true; break;
        case 47: emit(arcSegs(ro, 'pie'), 'fs'); if (pathSegs) pathOpen = true; break;
        case 55: { /* ARCTO */
          var atSegs = arcSegs(ro, null);
          if (atSegs.length) {
            emitCont(atSegs, 's');
            st.pos = { x: I(ro + 32), y: I(ro + 36) };
          }
          if (pathSegs) pathOpen = true;
          break;
        }
        case 54: /* LINETO */
          x = I(ro + 8); y = I(ro + 12);
          emitCont([['L', x, y]], 's');
          st.pos = { x: x, y: y };
          break;
        case 15: { /* SETPIXELV */
          var M15 = applyT();
          ctx.fillStyle = colStr(U(ro + 16));
          ctx.fillRect(I(ro + 8), I(ro + 12), 1 / Math.max(0.0001, Math.abs(M15[0])), 1 / Math.max(0.0001, Math.abs(M15[3])));
          drawn++;
          break;
        }
        case 2: case 3: case 4: case 87: case 86: case 85: {
          n = U(ro + 24);
          if (n > 100000) break;
          var is16 = type >= 85;
          pts = is16 ? ptsS(ro + 28, n) : ptsL(ro + 28, n);
          if (!pts.length) break;
          var sg = [['M', pts[0][0], pts[0][1]]];
          if (type === 2 || type === 85) {
            for (i2 = 1; i2 + 2 < pts.length; i2 += 3) sg.push(['C', pts[i2][0], pts[i2][1], pts[i2 + 1][0], pts[i2 + 1][1], pts[i2 + 2][0], pts[i2 + 2][1]]);
            emit(sg, 's');
          } else if (type === 3 || type === 86) {
            for (i2 = 1; i2 < pts.length; i2++) sg.push(['L', pts[i2][0], pts[i2][1]]);
            sg.push(['Z']);
            emit(sg, 'fs');
          } else {
            for (i2 = 1; i2 < pts.length; i2++) sg.push(['L', pts[i2][0], pts[i2][1]]);
            emit(sg, 's');
          }
          if (pathSegs) pathOpen = true;
          break;
        }
        case 5: case 6: case 88: case 89: { /* POLYBEZIERTO / POLYLINETO (+16) */
          n = U(ro + 24);
          if (n > 100000) break;
          var is16b = type >= 88;
          pts = is16b ? ptsS(ro + 28, n) : ptsL(ro + 28, n);
          if (!pts.length) break;
          var sg2 = [];
          if (type === 5 || type === 88) {
            for (i2 = 0; i2 + 2 < pts.length; i2 += 3) sg2.push(['C', pts[i2][0], pts[i2][1], pts[i2 + 1][0], pts[i2 + 1][1], pts[i2 + 2][0], pts[i2 + 2][1]]);
          } else {
            for (i2 = 0; i2 < pts.length; i2++) sg2.push(['L', pts[i2][0], pts[i2][1]]);
          }
          emitCont(sg2, 's');
          st.pos = { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
          break;
        }
        case 7: case 8: case 90: case 91: { /* POLYPOLYLINE / POLYPOLYGON (+16) */
          var nPoly = U(ro + 24);
          if (nPoly > 10000) break;
          var is16c = type >= 90;
          var counts = [], total = 0, ci;
          for (ci = 0; ci < nPoly; ci++) { counts.push(U(ro + 32 + ci * 4)); total += counts[ci]; }
          if (total > 200000) break;
          var pBase = ro + 32 + nPoly * 4;
          pts = is16c ? ptsS(pBase, total) : ptsL(pBase, total);
          var sg3 = [], pi2 = 0;
          for (ci = 0; ci < nPoly; ci++) {
            var cnt = counts[ci];
            if (cnt > 0 && pi2 < pts.length) {
              sg3.push(['M', pts[pi2][0], pts[pi2][1]]);
              for (i2 = 1; i2 < cnt && pi2 + i2 < pts.length; i2++) sg3.push(['L', pts[pi2 + i2][0], pts[pi2 + i2][1]]);
              if (type === 8 || type === 91) sg3.push(['Z']);
            }
            pi2 += cnt;
          }
          emit(sg3, (type === 8 || type === 91) ? 'fs' : 's');
          if (pathSegs) pathOpen = true;
          break;
        }
        case 56: { /* POLYDRAW */
          n = U(ro + 24);
          if (n > 100000) break;
          pts = ptsL(ro + 28, n);
          var tBase = ro + 28 + n * 8, sg4 = [], i3 = 0;
          while (i3 < n) {
            var tp = dv.getUint8(tBase + i3);
            var kind = tp & 0x06;
            if (kind === 6) { sg4.push(['M', pts[i3][0], pts[i3][1]]); i3++; }
            else if (kind === 2) { sg4.push(['L', pts[i3][0], pts[i3][1]]); if (tp & 1) sg4.push(['Z']); i3++; }
            else if (kind === 4) {
              if (i3 + 2 >= n) break;
              sg4.push(['C', pts[i3][0], pts[i3][1], pts[i3 + 1][0], pts[i3 + 1][1], pts[i3 + 2][0], pts[i3 + 2][1]]);
              if (tp & 1) sg4.push(['Z']);
              i3 += 3;
            } else i3++;
          }
          emit(sg4, 's');
          if (pathSegs) pathOpen = true;
          if (pts.length) st.pos = { x: pts[pts.length - 1][0], y: pts[pts.length - 1][1] };
          break;
        }
        case 59: pathSegs = []; pathOpen = false; break; /* BEGINPATH */
        case 60: break; /* ENDPATH: giu pathSegs cho FILL/STROKEPATH */
        case 61: if (pathSegs) { pathSegs.push(['Z']); pathOpen = false; } break; /* CLOSEFIGURE */
        case 62: if (pathSegs) { paint(buildPath(pathSegs), 'f'); pathSegs = null; pathOpen = false; } break; /* FILLPATH */
        case 63: if (pathSegs) { paint(buildPath(pathSegs), 'fs'); pathSegs = null; pathOpen = false; } break; /* STROKEANDFILLPATH */
        case 64: if (pathSegs) { paint(buildPath(pathSegs), 's'); pathSegs = null; pathOpen = false; } break; /* STROKEPATH */
        case 68: pathSegs = null; pathOpen = false; break; /* ABORTPATH */
        case 57: st.arcDir = U(ro + 8); break;
        case 58: st.miter = F32(ro + 8); break;
        case 76: /* BITBLT */
          if (U(ro + 92)) blitDib(ro, U(ro + 84), U(ro + 88), U(ro + 92), I(ro + 24), I(ro + 28), I(ro + 32), I(ro + 36), I(ro + 44), I(ro + 48), I(ro + 32), I(ro + 36));
          break;
        case 77: /* STRETCHBLT */
          if (U(ro + 92)) blitDib(ro, U(ro + 84), U(ro + 88), U(ro + 92), I(ro + 24), I(ro + 28), I(ro + 32), I(ro + 36), I(ro + 44), I(ro + 48), I(ro + 100), I(ro + 104));
          break;
        case 80: /* SETDIBITSTODEVICE */
          blitDib(ro, U(ro + 48), U(ro + 52), U(ro + 56), I(ro + 24), I(ro + 28), I(ro + 40), I(ro + 44), I(ro + 32), I(ro + 36), I(ro + 40), I(ro + 44));
          break;
        case 81: /* STRETCHDIBITS */
          blitDib(ro, U(ro + 48), U(ro + 52), U(ro + 56), I(ro + 24), I(ro + 28), I(ro + 72), I(ro + 76), I(ro + 32), I(ro + 36), I(ro + 40), I(ro + 44));
          break;
        case 82: { /* EXTCREATEFONTINDIRECTW */
          var fb = ro + 12, nm = '';
          for (i2 = 0; i2 < 32; i2++) {
            var chc = dv.getUint16(fb + 28 + i2 * 2, true);
            if (!chc) break;
            nm += String.fromCharCode(chc);
          }
          objs[U(ro + 8)] = {
            kind: 'font', h: I(fb), esc: I(fb + 8), weight: I(fb + 16) || 400,
            italic: dv.getUint8(fb + 20), under: dv.getUint8(fb + 21), strike: dv.getUint8(fb + 22),
            name: nm || 'Times New Roman'
          };
          break;
        }
        case 95: { /* EXTCREATEPEN */
          var psx = U(ro + 28), ptx = psx & 0xF;
          objs[U(ro + 8)] = {
            kind: 'pen', type: ptx <= 7 ? ptx : 0, w: U(ro + 32), color: U(ro + 40),
            cap: (psx >> 8) & 0xF, join: (psx >> 12) & 0xF
          };
          break;
        }
        case 83: drawText(ro, false); break;
        case 84: drawText(ro, true); break;
        default: break; /* ban ghi chua ho tro: bo qua an toan */
      }
      if (type === 14) break;
      off += size;
    }
    if (!drawn) return null;
    return canvas;
  }

  /* Vung cat hieu luc cua mot anh: nguoi dung chinh tay (userCrop, toa do
     trong khong gian da xoay job.rotate) — neu khong thi vung cat Word dat
     san (job.crop, khong gian goc, chi dung khi chua xoay). */
  function wiEffectiveFrac(job) {
    if (job.userCrop) return wiCropFracNorm(job.userCrop);
    if (!job.rotate && job.crop) return job.crop;
    return null;
  }
  /* Dung "anh se tai len" cho mot job:
     - Khong cat, khong xoay, dinh dang trinh duyet giai ma duoc -> NGUYEN BAN
       tung byte + ten goc (mode 'raw').
     - Co cat/xoay va giai ma duoc -> ve vung hien thi o do phan giai day du
       (mode 'crop'); giu JPG neu goc la JPG, con lai xuat PNG.
     - Anh EMF -> VE LAI thanh PNG bang wiEmfRender (ke ca khi khong cat),
       ap dung xoay/vung cat nhu anh thuong (mode 'emf'); ve lai that bai
       thi quay ve nguyen ban (mode 'raw').
     - Dinh dang khong giai ma duoc con lai (SVG/TIFF/WMF) -> nguyen ban
       (mode 'raw'), nguoi goi tu ghi chu ro o ket qua. */
  async function wiBuildUploadPayload(job) {
    var ext = wiExtOf(job.path);
    var name = job.path.split('/').pop();
    var rawBlob = new Blob([job.bytes], { type: WI_MIME[ext] || 'application/octet-stream' });
    var frac = wiEffectiveFrac(job);
    var rot = job.rotate || 0;
    var isEmf = (ext === 'emf');
    if (!isEmf && ((!frac && !rot) || !WI_DECODABLE[ext])) return { blob: rawBlob, filename: name, mode: 'raw' };
    try {
      var full;
      if (isEmf) {
        var cnv = wiEmfCanvas(job);
        if (!cnv) return { blob: rawBlob, filename: name, mode: 'raw' };
        full = wiDrawRotated(cnv, rot);
      } else {
        var bmp = await wiLoadBitmap(rawBlob);
        full = wiDrawRotated(bmp, rot);
        if (bmp.close) bmp.close();
      }
      var canvas = full;
      var rect = frac ? wiDisplayRect(full.width, full.height, frac) : null;
      if (rect && (rect.x > 0 || rect.y > 0 || rect.w !== full.width || rect.h !== full.height)) {
        canvas = document.createElement('canvas');
        canvas.width = rect.w;
        canvas.height = rect.h;
        canvas.getContext('2d').drawImage(full, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
      }
      var isJpg = (ext === 'jpg' || ext === 'jpeg');
      var blob = await new Promise(function (res) { canvas.toBlob(res, isJpg ? 'image/jpeg' : 'image/png', 0.92); });
      if (!blob) return { blob: rawBlob, filename: name, mode: 'raw' };
      return {
        blob: blob,
        filename: isJpg ? name : name.replace(/\.[a-z0-9]+$/i, '') + '.png',
        mode: isEmf ? 'emf' : 'crop', w: canvas.width, h: canvas.height
      };
    } catch (e) {
      return { blob: rawBlob, filename: name, mode: 'raw' };
    }
  }
  function wiUploadCloudinary(blob, filename, cfg) {
    var fd = new FormData();
    fd.append('file', blob, filename);
    fd.append('upload_preset', cfg.preset);
    if (cfg.folder) fd.append('folder', cfg.folder);
    return fetch('https://api.cloudinary.com/v1_1/' + encodeURIComponent(cfg.cloud) + '/image/upload', {
      method: 'POST', body: fd
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (json) {
        if (res.ok && json && json.secure_url) return json.secure_url;
        var msg = (json && json.error && json.error.message) ? json.error.message : ('HTTP ' + res.status);
        throw new Error('Cloudinary: ' + msg);
      });
    });
  }
  /* Kiem tra mot chuoi XML co "well-formed" khong (bat loi cat dut / lech
     the do cac phep thay the bang bieu thuc chinh quy gay ra). */
  function wiXmlWellFormed(xml) {
    try {
      var d = new DOMParser().parseFromString(xml, 'text/xml');
      return !d.getElementsByTagName('parsererror').length;
    } catch (e) { return false; }
  }
  /* Kiem tra lan cuoi cho file .docx sap tai ve: mo lai duoc bang JSZip va
     word/document.xml hop le — dam bao khong bao gio giao file ma Word
     mo ra bao loi. */
  async function wiValidateDocxBlob(blob) {
    try {
      var z = await window.JSZip.loadAsync(blob);
      var doc = z.file('word/document.xml');
      if (!doc) return false;
      return wiXmlWellFormed(await doc.async('string'));
    } catch (e) { return false; }
  }

  /* ================= Trang thai + giao dien ================= */
  var WI_CFG_KEY = 'chdmathtype.wordimage.cfg.v1';
  function wiStoreGet() {
    try {
      var raw = window.localStorage.getItem(WI_CFG_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function wiStoreSet(obj) {
    try { window.localStorage.setItem(WI_CFG_KEY, JSON.stringify(obj)); } catch (e) { /* chay khong can luu */ }
  }
  var wiState = null; /* { file, zip, parts:[{name, xml, relMap}], jobs:[], olePaths:Set, fontSize, counts } */
  var wiBusy = false;
  var wiLastBlob = null, wiLastName = '';

  function wiReadCfg() {
    return {
      cloud: $('wiCloud').value.trim(),
      preset: $('wiPreset').value.trim(),
      folder: $('wiFolder').value.trim()
    };
  }
  function wiSaveCfg() {
    var cfg = wiReadCfg();
    wiStoreSet(cfg);
    $('wiSaved').textContent = (cfg.cloud || cfg.preset)
      ? 'Đã lưu trên trình duyệt này — lần sau mở lên là có sẵn, khỏi nhập lại.'
      : 'Chưa có cấu hình nào được lưu.';
    wiRefreshState();
  }
  function wiRefreshState() {
    var cfg = wiReadCfg();
    var btn = $('wiConvert');
    btn.disabled = wiBusy || !wiState || !cfg.cloud || !cfg.preset;
    var st = $('wiStatus');
    if (wiState && (!cfg.cloud || !cfg.preset)) st.textContent = 'Hãy nhập Cloud name và Upload preset ở mục 1 trước.';
    else if (wiState && !wiBusy) st.textContent = 'Sẵn sàng — bấm nút để chuyển đổi.';
    else if (!wiBusy) st.textContent = '';
  }
  function wiShowError(el, msg) {
    el.textContent = msg;
    el.classList.add('show');
  }
  function wiHideError(el) { el.classList.remove('show'); }

  async function wiLoadFile(file) {
    var errEl = $('wiError');
    wiHideError(errEl);
    $('wiResult').classList.remove('show');
    wiState = null;
    $('wiImgList').innerHTML = '';
    $('wiScanInfo').textContent = 'Đang đọc file…';
    wiRefreshState();
    if (typeof window.JSZip === 'undefined') {
      $('wiScanInfo').textContent = 'Chưa chọn file nào.';
      wiShowError(errEl, 'Không tải được thư viện JSZip (cần để mở file .docx) — kiểm tra kết nối mạng rồi tải lại trang.');
      return;
    }
    if (/\.doc$/i.test(file.name || '') && !/\.docx$/i.test(file.name || '')) {
      $('wiScanInfo').textContent = 'Chưa chọn file nào.';
      wiShowError(errEl, '“' + file.name + '” là file .doc đời cũ (định dạng nhị phân) — tab này đọc file .docx. Hãy mở file bằng Word, chọn Lưu thành (Save As) định dạng .docx rồi đưa vào đây.');
      return;
    }
    var buf;
    try { buf = await file.arrayBuffer(); }
    catch (e) {
      $('wiScanInfo').textContent = 'Chưa chọn file nào.';
      wiShowError(errEl, 'Không đọc được file “' + file.name + '” từ máy của bạn. Hãy thử lại.');
      return;
    }
    var head = new Uint8Array(buf.slice(0, 4));
    if (head[0] === 0xD0 && head[1] === 0xCF) {
      $('wiScanInfo').textContent = 'Chưa chọn file nào.';
      wiShowError(errEl, '“' + file.name + '” là file .doc đời cũ (định dạng nhị phân) — hãy mở bằng Word và Lưu thành .docx trước khi đưa vào đây.');
      return;
    }
    if (!(head[0] === 0x50 && head[1] === 0x4B)) {
      $('wiScanInfo').textContent = 'Chưa chọn file nào.';
      wiShowError(errEl, '“' + file.name + '” không phải file Word (.docx) hợp lệ.');
      return;
    }
    var zip;
    try { zip = await window.JSZip.loadAsync(buf); }
    catch (e) {
      $('wiScanInfo').textContent = 'Chưa chọn file nào.';
      wiShowError(errEl, 'Không mở được “' + file.name + '” — file có thể bị hỏng hoặc không phải .docx.');
      return;
    }
    if (!zip.file('word/document.xml')) {
      $('wiScanInfo').textContent = 'Chưa chọn file nào.';
      wiShowError(errEl, 'Không thấy nội dung văn bản trong “' + file.name + '” — đây không phải file .docx hợp lệ.');
      return;
    }
    var partNames = ['word/document.xml'];
    zip.file(/^word\/header\d+\.xml$/).forEach(function (f) { partNames.push(f.name); });
    zip.file(/^word\/footer\d+\.xml$/).forEach(function (f) { partNames.push(f.name); });
    var parts = [];
    var fontSize = 24;
    var stylesFile = zip.file('word/styles.xml');
    if (stylesFile) {
      var sx = await stylesFile.async('string');
      var sm = sx.match(/<w:style[^>]*w:styleId="Normal"[^>]*>([\s\S]*?)<\/w:style>/);
      if (sm) { var zm = sm[1].match(/<w:sz w:val="(\d+)"/); if (zm) fontSize = parseInt(zm[1], 10); }
    }
    var counts = { ole: 0, omml: 0, imgRefs: 0, hfImgs: 0 };
    var jobsByKey = {};
    var jobs = [];
    var olePaths = {};
    for (var pi = 0; pi < partNames.length; pi++) {
      var pname = partNames[pi];
      var xml = await zip.file(pname).async('string');
      var base = pname.split('/').pop();
      var relsFile = zip.file('word/_rels/' + base + '.rels');
      var relMap = relsFile ? wiParseRels(await relsFile.async('string')) : {};
      var isBodyPart = (pname === 'word/document.xml');
      parts.push({ name: pname, xml: xml, relMap: relMap, isBody: isBodyPart });
      counts.omml += (xml.match(/<m:oMath[\s>]/g) || []).length;
      var runs = xml.match(WI_RUN_RE) || [];
      for (var ri = 0; ri < runs.length; ri++) {
        var block = runs[ri];
        if (block.indexOf('<w:object') >= 0) {
          if (wiIsEquationRun(block)) {
            counts.ole++;
            var ridM = block.match(/OLEObject[^>]*r:id="([^"]+)"/);
            if (ridM && relMap[ridM[1]]) olePaths[wiResolvePart('word', relMap[ridM[1]])] = true;
          }
          continue;
        }
        var refs = wiRunImageRefs(block);
        for (var fi = 0; fi < refs.length; fi++) {
          var target = relMap[refs[fi].rid];
          if (!target) continue;
          var path = wiResolvePart('word', target);
          if (!zip.file(path)) continue;
          if (!isBodyPart) { counts.hfImgs++; continue; } /* anh header/footer: bo qua han */
          counts.imgRefs++;
          var key = path;
          if (!jobsByKey[key]) {
            var job = {
              key: key, path: path, refs: 0, el: null, bytes: null,
              disp: refs[fi].disp || null, crop: refs[fi].crop || null,
              tiny: false, pixW: 0, pixH: 0,
              rotate: 0, userCrop: null, edited: false, thumbUrl: null
            };
            jobsByKey[key] = job;
            jobs.push(job);
          }
          /* Cac vi tri khac nhau cua cung mot file media co the co vung cat
             khac nhau; ban tai len la duy nhat nen lay vung cat dau tien
             tim thay (nguoi dung van chinh lai duoc tung anh). */
          if (!jobsByKey[key].crop && refs[fi].crop) jobsByKey[key].crop = refs[fi].crop;
          jobsByKey[key].refs++;
        }
      }
    }
    wiState = { file: file, zip: zip, parts: parts, jobs: jobs, olePaths: Object.keys(olePaths), fontSize: fontSize, counts: counts };
    wiRenderScan();
    wiRefreshState();
    wiToast('Đã đọc file “' + file.name + '”.');
  }
  async function wiRenderScan() {
    var st = wiState;
    var extraParts = st.parts.length - 1;
    var totalBytes = 0;
    for (var i = 0; i < st.jobs.length; i++) {
      var f = st.zip.file(st.jobs[i].path);
      if (f) { st.jobs[i].bytes = await f.async('uint8array'); totalBytes += st.jobs[i].bytes.length; }
    }
    /* Phan loai anh qua nho: dua vao kich thuoc hien thi trong Word + kich thuoc pixel */
    var tinyCount = 0;
    for (var j = 0; j < st.jobs.length; j++) {
      var jb = st.jobs[j];
      var jext = wiExtOf(jb.path);
      if (jb.bytes && WI_DECODABLE[jext]) {
        try {
          var bmp2 = await wiLoadBitmap(new Blob([jb.bytes], { type: WI_MIME[jext] || '' }));
          jb.pixW = bmp2.width; jb.pixH = bmp2.height;
          if (bmp2.close) bmp2.close();
        } catch (e) { /* khong giai ma duoc: chi dua vao kich thuoc hien thi */ }
      }
      if (jb.bytes && jext === 'emf') {
        var ecv = wiEmfCanvas(jb);
        if (ecv) { jb.pixW = ecv.width; jb.pixH = ecv.height; }
      }
      jb.tiny = wiIsTinyImage(jb.disp, jb.pixW, jb.pixH);
      if (jb.tiny) tinyCount++;
    }
    $('wiScanInfo').innerHTML = 'File <b>' + wiEsc(st.file.name) + '</b>' +
      (extraParts ? ' (thân bài + ' + extraParts + ' phần header/footer)' : '') +
      ' · <b>' + st.counts.ole + '</b> công thức MathType · <b>' + st.counts.omml + '</b> công thức Equation · ' +
      '<b>' + st.counts.imgRefs + '</b> vị trí ảnh, <b>' + st.jobs.length + '</b> ảnh duy nhất (' + wiFmtBytes(totalBytes) + ')' +
      (st.counts.hfImgs ? ' · bỏ qua <b>' + st.counts.hfImgs + '</b> ảnh ở header/footer' : '') +
      (tinyCount ? ' · <b>' + tinyCount + '</b> ảnh quá nhỏ sẽ bỏ qua' : '');
    var list = $('wiImgList');
    list.innerHTML = '';
    st.jobs.forEach(function (job, idx) {
      var ext = wiExtOf(job.path);
      var row = document.createElement('div');
      row.className = 'wi-img';
      var img = document.createElement('img');
      img.alt = '';
      if (WI_DECODABLE[ext] && job.bytes) {
        img.src = URL.createObjectURL(new Blob([job.bytes], { type: WI_MIME[ext] || '' }));
      }
      img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
      var meta = document.createElement('div');
      meta.className = 'wi-meta';
      var name = job.path.split('/').pop();
      meta.innerHTML = '<span class="wi-name">Ảnh ' + (idx + 1) + ': ' + wiEsc(name) + '</span>' +
        (job.refs > 1 ? ' · dùng ở ' + job.refs + ' vị trí' : '') +
        '<span class="wi-badge" data-badge="word" hidden>Đã cắt trong Word</span>' +
        '<span class="wi-badge edited" data-badge="edited" hidden>Đã chỉnh sửa</span>' +
        '<div class="wi-dim"></div>' +
        '<div class="wi-url" hidden></div>';
      var status = document.createElement('span');
      if (job.tiny) {
        status.className = 'wi-status skip';
        status.textContent = 'Bỏ qua — ảnh quá nhỏ';
      } else {
        status.className = 'wi-status wait';
        status.textContent = 'Chờ xử lý';
      }
      row.appendChild(img);
      row.appendChild(meta);
      job.el = {
        img: img, status: status,
        dim: meta.querySelector('.wi-dim'),
        url: meta.querySelector('.wi-url'),
        badgeWord: meta.querySelector('[data-badge="word"]'),
        badgeEdited: meta.querySelector('[data-badge="edited"]')
      };
      if (!job.tiny && (WI_DECODABLE[ext] || ext === 'emf')) {
        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'btn small wi-edit-btn';
        editBtn.textContent = 'Chỉnh sửa';
        editBtn.addEventListener('click', function (ev) { ev.stopPropagation(); wiEdOpen(job); });
        row.appendChild(editBtn);
        row.classList.add('clickable');
        row.title = 'Bấm để cắt / xoay / gọt viền ảnh này trước khi tải lên';
        row.addEventListener('click', function () { wiEdOpen(job); });
      }
      row.appendChild(status);
      list.appendChild(row);
      wiRefreshJobRow(job);
    });
  }
  /* Dong ghi chu + nhan trang thai cua mot anh trong danh sach. */
  function wiJobDimText(job) {
    var base = job.bytes ? wiFmtBytes(job.bytes.length) : '';
    if (job.tiny) {
      return base + ' · quá nhỏ' +
        (job.disp ? ' (hiển thị ≈ ' + wiFmtCm(job.disp.w) + '×' + wiFmtCm(job.disp.h) + ')' : (job.pixW ? ' (' + job.pixW + '×' + job.pixH + ' px)' : '')) +
        ' — bỏ qua, giữ nguyên trong file mới';
    }
    if (job.edited) return base + ' · sẽ tải lên đúng vùng bạn đã chọn trong trình chỉnh sửa';
    if (job.crop) {
      var rect = (job.pixW && job.pixH) ? wiDisplayRect(job.pixW, job.pixH, job.crop) : null;
      return base + (wiExtOf(job.path) === 'emf'
        ? ' · Word đã cắt sẵn — sẽ vẽ lại thành PNG đúng vùng đang hiển thị'
        : ' · Word đã cắt sẵn — sẽ tải lên đúng vùng đang hiển thị') + (rect ? ' (' + rect.w + '×' + rect.h + ' px)' : '');
    }
    if (wiExtOf(job.path) === 'emf') return base + ' · ảnh EMF — sẽ vẽ lại thành PNG rồi tải lên (EMF nguyên bản trình duyệt và Cloudinary đều không nhận)';
    return base + ' · hiển thị toàn ảnh trong Word — tải lên nguyên bản';
  }
  function wiRefreshJobRow(job, skipThumb) {
    if (!job.el) return;
    job.el.dim.textContent = wiJobDimText(job);
    if (job.el.badgeWord) job.el.badgeWord.hidden = !(job.crop && !job.edited);
    if (job.el.badgeEdited) job.el.badgeEdited.hidden = !job.edited;
    if (skipThumb || job.tiny) return;
    wiBuildUploadPayload(job).then(function (p) {
      if (!job.el || !job.el.img) return;
      if (job.thumbUrl) URL.revokeObjectURL(job.thumbUrl);
      job.thumbUrl = URL.createObjectURL(p.blob);
      job.el.img.src = job.thumbUrl;
      job.el.img.style.visibility = 'visible';
    });
  }
  function wiSetJobStatus(job, cls, text) {
    if (!job.el) return;
    job.el.status.className = 'wi-status ' + cls;
    job.el.status.textContent = text;
  }

  /* ================= Trinh chinh sua anh (cat / xoay / got vien) =================
     Mo bang cach bam vao mot anh trong danh sach. Khung cat khoi tao dung
     vung dang hien thi trong Word; keo rong ra duoc toi anh day du.
     userCrop luu trong KHONG GIAN DA XOAY (job.rotate) de khop voi
     wiBuildUploadPayload: xoay truoc, cat sau. */
  var wiEd = null; /* { job, bmp, rot, frac, frac0, rot0, natW, natH } */
  function wiEdFracForJob(job) {
    if (job.userCrop) return { l: job.userCrop.l, t: job.userCrop.t, r: job.userCrop.r, b: job.userCrop.b };
    return wiRotFrac(job.crop || { l: 0, t: 0, r: 0, b: 0 }, job.rotate || 0);
  }
  async function wiEdOpen(job) {
    if (wiBusy || wiEd) return;
    var ext = wiExtOf(job.path);
    if ((!WI_DECODABLE[ext] && ext !== 'emf') || !job.bytes) {
      wiToast('Định dạng ảnh này không mở trình chỉnh sửa được — sẽ tải lên nguyên bản.');
      return;
    }
    var bmp;
    try {
      if (ext === 'emf') {
        bmp = wiEmfCanvas(job); /* chinh sua tren ban PNG da ve lai tu EMF */
        if (!bmp) throw new Error('emf');
      } else {
        bmp = await wiLoadBitmap(new Blob([job.bytes], { type: WI_MIME[ext] || '' }));
      }
    }
    catch (e) { wiToast('Không giải mã được ảnh này để chỉnh sửa — sẽ tải lên nguyên bản.'); return; }
    var frac = wiEdFracForJob(job);
    wiEd = {
      job: job, bmp: bmp, rot: job.rotate || 0,
      frac: { l: frac.l, t: frac.t, r: frac.r, b: frac.b },
      frac0: { l: frac.l, t: frac.t, r: frac.r, b: frac.b },
      rot0: job.rotate || 0, natW: 0, natH: 0
    };
    $('wiCropTitle').textContent = 'Chỉnh sửa: ' + job.path.split('/').pop() + (job.refs > 1 ? ' (dùng ở ' + job.refs + ' vị trí — chỉnh một lần áp cho tất cả)' : '');
    $('wiCropResetWord').disabled = !job.crop;
    $('wiCropModal').hidden = false;
    wiEdRenderStage();
  }
  function wiEdClose() {
    if (wiEd && wiEd.bmp && wiEd.bmp.close) wiEd.bmp.close();
    wiEd = null;
    wiDrag = null;
    $('wiCropModal').hidden = true;
  }
  function wiEdRenderStage() {
    if (!wiEd) return;
    var full = wiDrawRotated(wiEd.bmp, wiEd.rot);
    wiEd.natW = full.width;
    wiEd.natH = full.height;
    var stage = $('wiCropCanvas');
    stage.width = full.width;
    stage.height = full.height;
    stage.getContext('2d').drawImage(full, 0, 0);
    wiEdBoxUpdate();
  }
  function wiEdBoxUpdate() {
    if (!wiEd) return;
    var f = wiEd.frac, box = $('wiCropBox');
    box.style.left = (f.l * 100) + '%';
    box.style.top = (f.t * 100) + '%';
    box.style.width = ((1 - f.l - f.r) * 100) + '%';
    box.style.height = ((1 - f.t - f.b) * 100) + '%';
    var pw = Math.max(1, Math.round((1 - f.l - f.r) * wiEd.natW));
    var ph = Math.max(1, Math.round((1 - f.t - f.b) * wiEd.natH));
    $('wiCropInfo').innerHTML = 'Vùng sẽ tải lên: <b>' + pw + '×' + ph + ' px</b> · ảnh đầy đủ ' + wiEd.natW + '×' + wiEd.natH + ' px';
  }
  /* Tu got vien trong suot / vien trung mau nen 4 goc cua anh day du dang
     hien tren canvas. Tra ve frac cua vung con noi dung (kem le dem nho),
     null neu khong co vien dang ke hoac anh rong. */
  function wiTrimFrac(canvas) {
    var w = canvas.width, h = canvas.height;
    if (w < 8 || h < 8) return null;
    var data;
    try { data = canvas.getContext('2d').getImageData(0, 0, w, h).data; }
    catch (e) { return null; }
    function px(x, y) { var i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]]; }
    var corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
    function isBg(p) {
      for (var i = 0; i < 4; i++) {
        var c = corners[i];
        if (c[3] < 12 && p[3] < 12) return true;
        if (Math.abs(p[0] - c[0]) <= 14 && Math.abs(p[1] - c[1]) <= 14 &&
            Math.abs(p[2] - c[2]) <= 14 && Math.abs(p[3] - c[3]) <= 14) return true;
      }
      return false;
    }
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (!isBg(px(x, y))) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    var pad = 3;
    minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
    if (minX <= 0 && minY <= 0 && maxX >= w - 1 && maxY >= h - 1) return null;
    return { l: minX / w, t: minY / h, r: 1 - (maxX + 1) / w, b: 1 - (maxY + 1) / h };
  }
  var wiDrag = null;
  function wiEdPointerPos(e) {
    var r = $('wiCropCanvas').getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }
  function wiEdOnDown(e) {
    if (!wiEd) return;
    var handle = (e.target && e.target.getAttribute) ? e.target.getAttribute('data-h') : null;
    var pos = wiEdPointerPos(e);
    wiDrag = {
      mode: handle || 'move', sx: pos.x, sy: pos.y,
      f0: { l: wiEd.frac.l, t: wiEd.frac.t, r: wiEd.frac.r, b: wiEd.frac.b }
    };
    e.preventDefault();
  }
  function wiEdOnMove(e) {
    if (!wiDrag || !wiEd) return;
    var pos = wiEdPointerPos(e);
    var dx = pos.x - wiDrag.sx, dy = pos.y - wiDrag.sy;
    var f = { l: wiDrag.f0.l, t: wiDrag.f0.t, r: wiDrag.f0.r, b: wiDrag.f0.b };
    var MIN = 0.02;
    if (wiDrag.mode === 'move') {
      var wF = 1 - f.l - f.r, hF = 1 - f.t - f.b;
      f.l = Math.min(Math.max(wiDrag.f0.l + dx, 0), 1 - wF);
      f.r = 1 - wF - f.l;
      f.t = Math.min(Math.max(wiDrag.f0.t + dy, 0), 1 - hF);
      f.b = 1 - hF - f.t;
    } else {
      if (wiDrag.mode.indexOf('w') >= 0) f.l = Math.min(Math.max(wiDrag.f0.l + dx, 0), 1 - f.r - MIN);
      if (wiDrag.mode.indexOf('e') >= 0) f.r = Math.min(Math.max(wiDrag.f0.r - dx, 0), 1 - f.l - MIN);
      if (wiDrag.mode.indexOf('n') >= 0) f.t = Math.min(Math.max(wiDrag.f0.t + dy, 0), 1 - f.b - MIN);
      if (wiDrag.mode.indexOf('s') >= 0) f.b = Math.min(Math.max(wiDrag.f0.b - dy, 0), 1 - f.t - MIN);
    }
    wiEd.frac = f;
    wiEdBoxUpdate();
  }
  function wiEdFracDiff(a, b) {
    if (!a && !b) return false;
    if (!a || !b) return true;
    return Math.abs(a.l - b.l) > 0.0005 || Math.abs(a.t - b.t) > 0.0005 ||
           Math.abs(a.r - b.r) > 0.0005 || Math.abs(a.b - b.b) > 0.0005;
  }
  function wiEdApply() {
    if (!wiEd) return;
    var job = wiEd.job;
    var norm = wiCropFracNorm(wiEd.frac);
    var changed = wiEd.rot !== wiEd.rot0 || wiEdFracDiff(norm, wiCropFracNorm(wiEd.frac0));
    if (changed) {
      /* Luu frac THO (ke ca 0 o moi canh = nguoi dung chu dong chon toan
         anh) de phan biet voi "chua tung chinh" — xem wiEffectiveFrac. */
      job.userCrop = { l: wiEd.frac.l, t: wiEd.frac.t, r: wiEd.frac.r, b: wiEd.frac.b };
      job.rotate = wiEd.rot;
      job.edited = true;
    }
    wiEdClose();
    if (changed) {
      wiRefreshJobRow(job);
      wiToast('Đã áp dụng — ảnh tải lên sẽ là vùng bạn đã chọn.');
    }
  }
  async function wiConvert() {
    if (!wiState || wiBusy) return;
    var cfg = wiReadCfg();
    var errEl = $('wiConvertError');
    wiHideError(errEl);
    $('wiResult').classList.remove('show');
    if (!cfg.cloud || !cfg.preset) {
      wiShowError(errEl, 'Chưa có cấu hình Cloudinary — hãy nhập Cloud name và Upload preset (Unsigned) ở mục 1 trước.');
      $('wiCloud').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    wiBusy = true;
    wiRefreshState();
    var btn = $('wiConvert');
    var btnLabel = btn.textContent;
    btn.textContent = 'Đang xử lý…';
    var st = wiState;
    var fails = [];
    try {
      /* 1) Tai san du lieu OLE cua cac cong thuc MathType */
      var oleBytes = {};
      for (var oi = 0; oi < st.olePaths.length; oi++) {
        var of = st.zip.file(st.olePaths[oi]);
        if (of) oleBytes[st.olePaths[oi]] = await of.async('uint8array');
      }
      /* 2) Tai tung anh len Cloudinary (bo qua anh qua nho): anh tai len la
            DUNG VUNG DANG HIEN THI trong Word — ap vung cat cua Word (hoac
            vung nguoi dung da chinh trong trinh chinh sua) len anh goc o do
            phan giai day du; anh khong bi cat thi nguyen ban tung byte. */
      var skipKeys = {};
      st.jobs.forEach(function (j) { if (j.tiny) skipKeys[j.key] = true; });
      var urlMap = {};
      var cropUploads = 0;
      var emfUploads = 0;
      var uncroppable = [];
      for (var ji = 0; ji < st.jobs.length; ji++) {
        var job = st.jobs[ji];
        var name = job.path.split('/').pop();
        if (job.tiny) {
          wiSetJobStatus(job, 'skip', 'Bỏ qua — ảnh quá nhỏ');
          continue;
        }
        $('wiStatus').textContent = 'Đang tải ảnh ' + (ji + 1) + '/' + st.jobs.length + ': ' + name + '…';
        wiSetJobStatus(job, 'busy', 'Đang tải lên…');
        try {
          var payload = await wiBuildUploadPayload(job);
          if (payload.mode === 'emf') {
            if (job.el) job.el.dim.textContent = wiFmtBytes(payload.blob.size) + ' · đã vẽ lại EMF thành PNG ' + payload.w + '×' + payload.h + ' px' + (wiEffectiveFrac(job) ? ' (đúng vùng đang hiển thị)' : '') + ' — ảnh EMF gốc ' + wiFmtBytes(job.bytes.length);
          } else if (payload.mode === 'crop') {
            cropUploads++;
            if (job.el) job.el.dim.textContent = wiFmtBytes(payload.blob.size) + ' · vùng đang hiển thị ' + payload.w + '×' + payload.h + ' px (ảnh gốc ' + wiFmtBytes(job.bytes.length) + ')';
          } else {
            if (job.el) job.el.dim.textContent = wiFmtBytes(job.bytes.length) + ' · ảnh gốc nguyên bản';
            if (wiEffectiveFrac(job) && !WI_DECODABLE[wiExtOf(job.path)]) uncroppable.push(name);
          }
          var url = await wiUploadCloudinary(payload.blob, payload.filename, cfg);
          if (payload.mode === 'emf') emfUploads++;
          urlMap[job.key] = url;
          wiSetJobStatus(job, 'ok', 'Đã lên Cloudinary ✓');
          if (job.el) { job.el.url.hidden = false; job.el.url.textContent = url; }
        } catch (e) {
          urlMap[job.key] = null;
          wiSetJobStatus(job, 'fail', 'Tải lên lỗi — giữ ảnh gốc');
          fails.push('Ảnh ' + name + ': ' + ((e && e.message) || e) + ' — đã giữ nguyên ảnh gốc trong file mới.');
        }
      }
      /* 3) Bien doi tung part */
      $('wiStatus').textContent = 'Đang tạo file Word mới…';
      var totals = { oleOk: 0, oleFail: 0, ommlOk: 0, ommlFail: 0, imgOk: 0, imgFail: 0, imgSkip: 0, tblFlat: 0 };
      st.parts.forEach(function (part) {
        var handlers = {
          fontSize: st.fontSize,
          flattenTables: !!part.isBody,
          ole: function (block) {
            if (!wiIsEquationRun(block)) return undefined;
            var core = window.MTCore;
            if (!core || typeof core.oleToLatex !== 'function') return null;
            var ridM = block.match(/OLEObject[^>]*r:id="([^"]+)"/);
            if (!ridM) return null;
            var target = part.relMap[ridM[1]];
            if (!target) return null;
            var bytes = oleBytes[wiResolvePart('word', target)];
            if (!bytes) return null;
            try {
              var res = core.oleToLatex(bytes);
              return (res && res.latex) ? res.latex : null;
            } catch (e) { return null; }
          },
          omml: function (xmlStr) { return wiOmmlToLatex(xmlStr); },
          img: function (rid) {
            if (!part.isBody) return undefined; /* anh o header/footer: bo qua, giu nguyen */
            var target = part.relMap[rid];
            if (!target) return null;
            var key = wiResolvePart('word', target);
            if (skipKeys[key]) return undefined; /* anh qua nho: bo qua, giu nguyen */
            return Object.prototype.hasOwnProperty.call(urlMap, key) ? urlMap[key] : null;
          }
        };
        var res = wiTransformPartXml(part.xml, handlers);
        totals.oleOk += res.stats.oleOk; totals.oleFail += res.stats.oleFail;
        totals.ommlOk += res.stats.ommlOk; totals.ommlFail += res.stats.ommlFail;
        totals.imgOk += res.stats.imgOk; totals.imgFail += res.stats.imgFail;
        totals.imgSkip += res.stats.imgSkip; totals.tblFlat += res.stats.tblFlat;
        part.outXml = res.xml;
        if (res.xml !== part.xml) {
          /* Chi ghi ban bien doi vao goi neu XML con hop le; phan nao bien
             doi lam hong cau truc thi giu nguyen ban goc — khong de mot
             phan loi lam ca file Word khong mo duoc. */
          if (wiXmlWellFormed(res.xml)) st.zip.file(part.name, res.xml);
          else fails.push('Phần nội dung “' + part.name + '” sau khi biến đổi không đạt kiểm tra an toàn nên đã được giữ nguyên bản gốc trong file mới.');
        }
      });
      if (totals.oleFail) fails.push(totals.oleFail + ' công thức MathType không giải mã được — đã giữ nguyên dạng gốc trong file mới.');
      if (totals.ommlFail) fails.push(totals.ommlFail + ' công thức Equation không chuyển được — đã giữ nguyên dạng gốc trong file mới.');
      if (totals.tblFlat) fails.push('Đã gỡ ' + totals.tblFlat + ' bảng có chứa ảnh thành các đoạn văn nối tiếp (từ trên xuống) để không mất nội dung ở các cột — link ảnh nằm trong dòng chảy văn bản như đoạn thường.');
      var tinyJobs = 0;
      st.jobs.forEach(function (j) { if (j.tiny) tinyJobs++; });
      if (tinyJobs) fails.push('Đã bỏ qua ' + tinyJobs + ' ảnh quá nhỏ (mảnh công thức lỗi / vệt trắng) — không tải lên Cloudinary, giữ nguyên trong file mới.');
      if (st.counts.hfImgs) fails.push('Đã bỏ qua ' + st.counts.hfImgs + ' ảnh nằm ở header/footer — không tải lên Cloudinary, giữ nguyên trong file mới.');
      if (uncroppable.length) fails.push('Ảnh ' + uncroppable.join(', ') + ' có vùng cắt trong Word nhưng định dạng này trình duyệt không cắt được — đã tải lên nguyên bản đầy đủ.');
      /* 4) Xuat file — kem kiem tra hop le lan cuoi: goi .docx phai mo lai
            duoc va document.xml phai dung cau truc; neu khong dat thi dong
            goi lai tu file goc, van khong dat nua thi dung lai chu khong
            giao file hong (tranh loi Word "experienced an error"). */
      var blob = await st.zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
      if (!(await wiValidateDocxBlob(blob))) {
        var freshZip = await window.JSZip.loadAsync(await st.file.arrayBuffer());
        st.parts.forEach(function (part) {
          if (part.outXml && part.outXml !== part.xml && wiXmlWellFormed(part.outXml)) freshZip.file(part.name, part.outXml);
        });
        blob = await freshZip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
        if (!(await wiValidateDocxBlob(blob))) {
          throw new Error('Không tạo được file Word hợp lệ từ file này — đã dừng lại để tránh giao cho bạn một file hỏng. File gốc của bạn không bị thay đổi.');
        }
        fails.push('Bản đóng gói đầu tiên không đạt kiểm tra hợp lệ nên đã được đóng gói lại từ file gốc cho an toàn.');
      }
      wiLastBlob = blob;
      wiLastName = (st.file.name || 'file').replace(/\.docx$/i, '') + '-latex-link-anh.docx';
      wiDownload(blob, wiLastName);
      $('wiResultText').textContent = 'Đã tạo file “' + wiLastName + '”: ' +
        (totals.oleOk + totals.ommlOk) + ' công thức đã thành mã LaTeX (' + totals.oleOk + ' MathType, ' + totals.ommlOk + ' Equation), ' +
        totals.imgOk + ' vị trí ảnh đã thay bằng link Cloudinary.' +
        (cropUploads ? ' Trong đó ' + cropUploads + ' ảnh được tải lên theo đúng vùng đang hiển thị trong Word (đã áp vùng cắt).' : '') +
        (emfUploads ? ' Trong đó ' + emfUploads + ' ảnh EMF đã được vẽ lại thành PNG rồi tải lên (EMF nguyên bản thì trình duyệt và Cloudinary đều không nhận).' : '') +
        (totals.tblFlat ? ' Đã gỡ ' + totals.tblFlat + ' bảng có ảnh thành đoạn nối tiếp.' : '') +
        (totals.imgSkip ? ' Bỏ qua ' + totals.imgSkip + ' vị trí ảnh (ở header/footer hoặc quá nhỏ) — giữ nguyên ảnh gốc.' : '');
      var ul = $('wiFails');
      ul.innerHTML = '';
      fails.forEach(function (f) {
        var li = document.createElement('li');
        li.textContent = f;
        ul.appendChild(li);
      });
      $('wiResult').classList.add('show');
      $('wiResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      $('wiStatus').textContent = 'Xong.';
      wiToast('Đã tạo file Word mới: công thức thành LaTeX, ảnh thành link Cloudinary.');
    } catch (e) {
      wiShowError(errEl, 'Chuyển đổi thất bại: ' + ((e && e.message) || 'lỗi không xác định') + '. File gốc của bạn không bị thay đổi — hãy thử lại.');
      $('wiStatus').textContent = '';
    } finally {
      wiBusy = false;
      btn.textContent = btnLabel;
      wiRefreshState();
    }
  }

  /* ================= Khoi tao tab ================= */
  window.ChdWordImage = {
    parseXml: wiParseXml,
    ommlToLatex: wiOmmlToLatex,
    transformPartXml: wiTransformPartXml,
    runImageRefs: wiRunImageRefs,
    parseRels: wiParseRels,
    resolvePart: wiResolvePart,
    flattenTables: wiFlattenTables,
    isTinyImage: wiIsTinyImage,
    replaceRunImages: wiReplaceRunImages,
    cropFracNorm: wiCropFracNorm,
    displayRect: wiDisplayRect,
    rotFracCW: wiRotFracCW,
    rotFracCCW: wiRotFracCCW,
    rotFrac: wiRotFrac,
    effectiveFrac: wiEffectiveFrac,
    buildUploadPayload: wiBuildUploadPayload,
    emfRender: wiEmfRender,
    xmlWellFormed: wiXmlWellFormed
  };
  if ($('wiConvert')) {
    var saved = wiStoreGet();
    if (saved) {
      if (saved.cloud) $('wiCloud').value = saved.cloud;
      if (saved.preset) $('wiPreset').value = saved.preset;
      if (saved.folder) $('wiFolder').value = saved.folder;
    }
    ['wiCloud', 'wiPreset', 'wiFolder'].forEach(function (id) {
      $(id).addEventListener('input', wiSaveCfg);
    });
    wiSaveCfg();
    var dz = $('wiDrop'), fi = $('wiFile');
    dz.addEventListener('click', function () { fi.click(); });
    dz.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); }
    });
    fi.addEventListener('change', function () {
      if (fi.files && fi.files[0]) wiLoadFile(fi.files[0]);
      fi.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      dz.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover'); });
    });
    dz.addEventListener('drop', function (e) {
      e.stopPropagation();
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) wiLoadFile(files[0]);
    });
    $('wiConvert').addEventListener('click', wiConvert);
    $('wiDownload').addEventListener('click', function () {
      if (wiLastBlob) wiDownload(wiLastBlob, wiLastName);
    });
    /* Trinh chinh sua anh: keo khung cat, cac nut xoay / got vien / ap dung */
    $('wiCropBox').addEventListener('pointerdown', wiEdOnDown);
    window.addEventListener('pointermove', wiEdOnMove);
    window.addEventListener('pointerup', function () { wiDrag = null; });
    $('wiCropCancel').addEventListener('click', wiEdClose);
    $('wiCropApply').addEventListener('click', wiEdApply);
    $('wiCropFull').addEventListener('click', function () {
      if (wiEd) { wiEd.frac = { l: 0, t: 0, r: 0, b: 0 }; wiEdBoxUpdate(); }
    });
    $('wiCropResetWord').addEventListener('click', function () {
      if (wiEd && wiEd.job.crop) { wiEd.frac = wiRotFrac(wiEd.job.crop, wiEd.rot); wiEdBoxUpdate(); }
    });
    $('wiCropRotateL').addEventListener('click', function () {
      if (!wiEd) return;
      wiEd.rot = (wiEd.rot + 3) % 4;
      wiEd.frac = wiRotFracCCW(wiEd.frac);
      wiEdRenderStage();
    });
    $('wiCropRotateR').addEventListener('click', function () {
      if (!wiEd) return;
      wiEd.rot = (wiEd.rot + 1) % 4;
      wiEd.frac = wiRotFracCW(wiEd.frac);
      wiEdRenderStage();
    });
    $('wiCropTrim').addEventListener('click', function () {
      if (!wiEd) return;
      var f = wiTrimFrac($('wiCropCanvas'));
      if (f) { wiEd.frac = f; wiEdBoxUpdate(); }
      else wiToast('Không thấy viền trống đáng kể để gọt ở ảnh này.');
    });
    $('wiCropModal').addEventListener('click', function (e) { if (e.target === this) wiEdClose(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && wiEd) wiEdClose();
    });
    wiRefreshState();
  }
})();
    