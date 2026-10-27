/* MTCore — verified MathType-on-Mac core library (browser + Node).
 * Pipeline: .docx (ZIP) -> CFB -> "Equation Native" -> MTEF v5 -> LaTeX,
 * and back: LaTeX -> MathML (injected) -> OMML -> surgical .docx rewrite.
 * Ported 1:1 from the Python reference in ~/workspace/mathtype-lab (validated
 * byte-exact on 130/130 real MathType equations, Word-for-Mac verified).
 * Exposes window.MTCore in browsers and module.exports in Node.
 * Only external dependency: JSZip (passed in by the caller).
 */
(function (global) {
'use strict';

/* ================= CFB (OLE2 Compound File) reader, read-only ================= */
function cfbOpen(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const secSize = 1 << dv.getUint16(30, true);
  const numFat = dv.getUint32(44, true);
  const firstDir = dv.getInt32(48, true);
  const cutoff = dv.getUint32(56, true);
  const firstMiniFat = dv.getInt32(60, true);
  const numMiniFat = dv.getUint32(64, true);
  const firstDifat = dv.getInt32(68, true);
  const secOff = sid => (sid + 1) * secSize;

  const difat = [];
  for (let i = 0; i < 109; i++) { const v = dv.getInt32(76 + i * 4, true); if (v >= 0) difat.push(v); }
  let nextDifat = firstDifat, guard = 0;
  while (nextDifat >= 0 && guard++ < 10000) {
    const off = secOff(nextDifat), per = secSize / 4 - 1;
    for (let i = 0; i < per; i++) { const v = dv.getInt32(off + i * 4, true); if (v >= 0) difat.push(v); }
    nextDifat = dv.getInt32(off + per * 4, true);
  }
  const fat = [];
  for (const fs of difat.slice(0, numFat)) {
    const off = secOff(fs);
    for (let i = 0; i < secSize / 4; i++) fat.push(dv.getInt32(off + i * 4, true));
  }
  function chain(start, fatArr) {
    const out = []; let sid = start, g = 0;
    while (sid >= 0 && sid !== -2 && g++ < 100000) { out.push(sid); sid = fatArr[sid]; }
    return out;
  }
  function readBig(start) {
    const sids = chain(start, fat);
    const out = new Uint8Array(sids.length * secSize);
    sids.forEach((sid, i) => out.set(bytes.subarray(secOff(sid), secOff(sid) + secSize), i * secSize));
    return out;
  }
  const dirBytes = readBig(firstDir);
  const ddv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const entries = [];
  for (let off = 0; off + 128 <= dirBytes.length; off += 128) {
    const nameLen = ddv.getUint16(off + 64, true);
    if (nameLen < 2) continue;
    let name = '';
    for (let i = 0; i < nameLen - 2; i += 2) name += String.fromCharCode(ddv.getUint16(off + i, true));
    entries.push({ name, type: dirBytes[off + 66], start: ddv.getInt32(off + 116, true), size: ddv.getUint32(off + 120, true) });
  }
  const root = entries.find(e => e.type === 5);
  const miniStream = root ? readBig(root.start).slice(0, root.size) : new Uint8Array(0);
  const miniFat = [];
  if (firstMiniFat >= 0 && numMiniFat > 0) {
    for (const sid of chain(firstMiniFat, fat).slice(0, numMiniFat)) {
      const off = secOff(sid);
      for (let i = 0; i < secSize / 4; i++) miniFat.push(dv.getInt32(off + i * 4, true));
    }
  }
  const MINI = 64;
  function readMini(start) {
    const sids = chain(start, miniFat);
    const out = new Uint8Array(sids.length * MINI);
    sids.forEach((sid, i) => out.set(miniStream.subarray(sid * MINI, sid * MINI + MINI), i * MINI));
    return out;
  }
  return {
    entries,
    getStream(name) {
      const e = entries.find(x => x.name === name && x.type === 2);
      if (!e) return null;
      if (e.size < cutoff) return readMini(e.start).slice(0, e.size);
      return readBig(e.start).slice(0, e.size);
    }
  };
}

/* ================= MTEF v5 parser (port of mtef.py) ================= */
class MTEFError extends Error {}
class Reader {
  constructor(data) { this.d = data; this.pos = 0; }
  u8() { if (this.pos >= this.d.length) throw new MTEFError('EOF'); return this.d[this.pos++]; }
  peek() { if (this.pos >= this.d.length) throw new MTEFError('EOF peek'); return this.d[this.pos]; }
  u16() { const v = this.d[this.pos] | (this.d[this.pos + 1] << 8); this.pos += 2; return v; }
  i16() { const v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; }
  uint() { const b = this.u8(); return b === 0xFF ? this.u16() : b; }
  sint() { const b = this.u8(); return b === 0xFF ? this.u16() - 32768 : b - 128; }
  cstr() {
    let end = this.pos;
    while (end < this.d.length && this.d[end] !== 0) end++;
    let s = '';
    for (let i = this.pos; i < end; i++) s += String.fromCharCode(this.d[i]);
    this.pos = end + 1; return s;
  }
  nudge() { const b1 = this.u8(), b2 = this.u8(); if (b1 === 128 && b2 === 128) { this.i16(); this.i16(); } }
}
const OPT_NUDGE = 0x08;
class MTEFParser {
  constructor(data) {
    this.r = new Reader(data);
    this.fonts = {}; this.encodings = {};
    this.fontCounter = 0; this.encCounter = 4; this.colorCounter = 0;
    this.colors = {}; this.warnings = [];
  }
  dimArray() {
    const r = this.r, count = r.u8(), bytepos = r.pos;
    const getN = i => { const b = r.d[bytepos + (i >> 1)]; return i % 2 === 0 ? (b >> 4) & 0xF : b & 0xF; };
    let i = 0;
    for (let k = 0; k < count; k++) { i++; while (getN(i) !== 0xF) i++; i++; }
    r.pos = bytepos + ((i + 1) >> 1);
  }
  rulerBody() {
    // Ruler data embedded in LINE/PILE records (MathType 6/7): NO leading
    // type byte — stop count + (type, offset) pairs. Verified on real streams.
    const r = this.r;
    const n = r.u8();
    for (let i = 0; i < n; i++) { r.u8(); r.u16(); }
  }
  parseList() {
    const items = [];
    while (true) {
      if (this.r.peek() === 0) { this.r.u8(); return items; }
      items.push(this.parseRecord());
    }
  }
  parseRecord() {
    const r = this.r, t = r.u8();
    if (t === 0) return ['end'];
    if (t >= 100) { const ln = r.uint(); r.pos += ln; return ['future', t]; }
    if (t === 1) {
      const opts = r.u8();
      if (opts & OPT_NUDGE) r.nudge();
      if (opts & 0x04) r.i16();
      if (opts & 0x02) this.rulerBody();
      if (opts & 0x01) return ['line', []];
      return ['line', this.parseList()];
    }
    if (t === 2) {
      const opts = r.u8();
      if (opts & OPT_NUDGE) r.nudge();
      const typeface = r.sint();
      let mtcode = null, fontpos = null;
      if (!(opts & 0x20)) mtcode = r.u16();
      if (opts & 0x04) fontpos = r.u8();
      if (opts & 0x10) fontpos = r.u16();
      const emb = [];
      if (opts & 0x01) {
        while (true) {
          const nt = r.peek();
          if (nt === 6) emb.push(this.parseRecord());
          // MathType may interleave COLOR (15) / COLOR_DEF (16) records
          // inside an embellishment list when the accented character is
          // colored (Nguyen Quan Nho corpus eqs 79/82/83, 2026-10-23):
          // consume them without treating them as embellishments.
          else if (nt === 15 || nt === 16) this.parseRecord();
          else if (nt === 0) { r.u8(); break; }
          else throw new MTEFError('embell list: unexpected record ' + nt);
        }
      }
      return ['char', mtcode, fontpos, typeface, opts, emb];
    }
    if (t === 3) {
      const opts = r.u8();
      if (opts & OPT_NUDGE) r.nudge();
      const selector = r.u8();
      const b = r.u8();
      const variation = (b & 0x80) ? ((b & 0x7F) | (r.u8() << 8)) : b;
      const tmplOpts = r.u8(); // MathType 6/7: options byte for ALL template classes
      const subs = this.parseList();
      return ['tmpl', selector, variation, tmplOpts, subs];
    }
    if (t === 4) {
      const opts = r.u8();
      if (opts & OPT_NUDGE) r.nudge();
      r.u8(); r.u8();
      if (opts & 0x02) this.rulerBody();
      return ['pile', this.parseList()];
    }
    if (t === 5) {
      const opts = r.u8();
      if (opts & OPT_NUDGE) r.nudge();
      r.u8(); r.u8(); r.u8();
      const rows = r.uint(), cols = r.uint();
      r.pos += Math.floor((rows + 1 + 3) / 4);
      r.pos += Math.floor((cols + 1 + 3) / 4);
      return ['matrix', rows, cols, this.parseList()];
    }
    if (t === 6) {
      const opts = r.u8();
      if (opts & OPT_NUDGE) r.nudge();
      return ['embell', r.u8()];
    }
    if (t === 7) { this.rulerBody(); return ['ruler']; }
    if (t === 8) { const idx = r.uint(); const style = r.u8(); return ['font_style_def', idx, style]; }
    if (t === 9) {
      const b = r.u8();
      if (b === 101) r.i16();
      else if (b === 100) { r.u8(); r.i16(); }
      else r.u8();
      return ['size'];
    }
    if (t >= 10 && t <= 14) return ['size'];
    if (t === 15) return ['color', r.uint()];
    if (t === 16) {
      const opts = r.u8(), n = (opts & 0x01) ? 4 : 3;
      const vals = [];
      for (let i = 0; i < n; i++) vals.push(r.u16());
      const name = (opts & 0x04) ? r.cstr() : null;
      this.colors[++this.colorCounter] = [vals, name];
      return ['color_def'];
    }
    if (t === 17) {
      const enc = r.uint(), name = r.cstr();
      this.fonts[++this.fontCounter] = [enc, name];
      return ['font_def'];
    }
    if (t === 18) {
      r.u8(); this.dimArray(); this.dimArray();
      const nstyles = r.u8();
      for (let i = 0; i < nstyles; i++) { const idx = r.uint(); if (idx !== 0) r.u8(); }
      return ['eqn_prefs'];
    }
    if (t === 19) {
      const name = r.cstr();
      this.encodings[++this.encCounter] = name;
      return ['encoding_def', name];
    }
    throw new MTEFError('unknown record type ' + t + ' at ' + (r.pos - 1));
  }
  parse() {
    const r = this.r;
    const version = r.u8();
    if (version !== 5) throw new MTEFError('MTEF version ' + version);
    const platform = r.u8(), product = r.u8(), prodver = r.u8(), subver = r.u8();
    const appkey = r.cstr();
    const eqopts = r.u8();
    let root = null;
    while (true) {
      if (r.peek() === 0) { r.u8(); break; }
      const node = this.parseRecord();
      if (node[0] === 'line' || node[0] === 'pile') root = node;
    }
    if (r.pos !== r.d.length) this.warnings.push('trailing bytes: ' + (r.d.length - r.pos));
    return { header: { version, platform, product, prodver, subver, appkey, inline: !!(eqopts & 1) },
             root, warnings: this.warnings };
  }
}
function extractMTEF(equationNative) {
  const off = equationNative[0] | (equationNative[1] << 8) | (equationNative[2] << 16) | (equationNative[3] << 24);
  return equationNative.subarray(off >>> 0);
}
function parseEquationNative(equationNative) {
  return new MTEFParser(extractMTEF(equationNative)).parse();
}

/* ================= MTEF tree -> LaTeX (port of mtef2latex.py) ================= */
const SYMBOLS = {"α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "ε": "\\varepsilon", "ϵ": "\\epsilon", "ζ": "\\zeta", "η": "\\eta", "θ": "\\theta", "ϑ": "\\vartheta", "ι": "\\iota", "κ": "\\kappa", "λ": "\\lambda", "μ": "\\mu", "ν": "\\nu", "ξ": "\\xi", "π": "\\pi", "ϖ": "\\varpi", "ρ": "\\rho", "ϱ": "\\varrho", "σ": "\\sigma", "ς": "\\varsigma", "τ": "\\tau", "υ": "\\upsilon", "φ": "\\varphi", "ϕ": "\\phi", "χ": "\\chi", "ψ": "\\psi", "ω": "\\omega", "Γ": "\\Gamma", "Δ": "\\Delta", "Θ": "\\Theta", "Λ": "\\Lambda", "Ξ": "\\Xi", "Π": "\\Pi", "Σ": "\\Sigma", "Υ": "\\Upsilon", "Φ": "\\Phi", "Ψ": "\\Psi", "Ω": "\\Omega", "±": "\\pm", "∓": "\\mp", "×": "\\times", "÷": "\\div", "·": "\\cdot", "⋅": "\\cdot", "∗": "\\ast", "⋆": "\\star", "∘": "\\circ", "◯": "\\bigcirc", "∙": "\\bullet", "…": "\\dots", "⋯": "\\cdots", "′": "\\prime", "″": "\\prime\\prime", "∠": "\\angle", "⊥": "\\perp", "∥": "\\parallel", "∝": "\\propto", "∞": "\\infty", "≠": "\\ne", "≤": "\\le", "≥": "\\ge", "≈": "\\approx", "≡": "\\equiv", "∼": "\\sim", "≃": "\\simeq", "≅": "\\cong", "∈": "\\in", "∉": "\\notin", "∋": "\\ni", "⊂": "\\subset", "⊃": "\\supset", "⊆": "\\subseteq", "⊇": "\\supseteq", "∪": "\\cup", "∩": "\\cap", "∅": "\\emptyset", "∀": "\\forall", "∃": "\\exists", "∄": "\\nexists", "∇": "\\nabla", "∂": "\\partial", "∑": "\\sum", "∏": "\\prod", "∫": "\\int", "∮": "\\oint", "∬": "\\iint", "∭": "\\iiint", "√": "\\surd", "→": "\\to", "←": "\\leftarrow", "↔": "\\leftrightarrow", "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow", "↑": "\\uparrow", "↓": "\\downarrow", "↦": "\\mapsto", "⟹": "\\Longrightarrow", "⟸": "\\Longleftarrow", "⟺": "\\Longleftrightarrow", "−": "-", "–": "-", "°": "^\\circ", "{": "\\{", "}": "\\}", "%": "\\%", "&": "\\&", "#": "\\#", "_": "\\_", "$": "\\$", "\\": "\\backslash", "^": "\\hat{}", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "∖": "\\setminus", "⌀": "\\emptyset", "∡": "\\measuredangle", "∢": "\\sphericalangle", "⦰": "\\varnothing", "⟨": "\\langle", "⟩": "\\rangle", "⊕": "\\oplus", "⊗": "\\otimes", "⊖": "\\ominus", "⊙": "\\odot", "⊘": "\\oslash", "≺": "\\prec", "≻": "\\succ", "⊢": "\\vdash", "✓": "\\checkmark", "∴": "\\therefore", "∵": "\\because", "ℝ": "\\mathbb{R}", "ℕ": "\\mathbb{N}", "ℤ": "\\mathbb{Z}", "ℚ": "\\mathbb{Q}", "ℂ": "\\mathbb{C}", "ℓ": "\\ell", "ℏ": "\\hbar", "ℵ": "\\aleph", "⊄": "\\nsubseteq", "⊈": "\\nsubseteq", "⊅": "\\nsupseteq", "⊉": "\\nsupseteq", "⊊": "\\subsetneq", "⊋": "\\supsetneq", "⊏": "\\sqsubset", "⊐": "\\sqsupset", "⊑": "\\sqsubseteq", "⊒": "\\sqsupseteq", "⊔": "\\sqcup", "⊓": "\\sqcap", "△": "\\triangle", "▽": "\\triangledown", "□": "\\square", "◇": "\\diamond", "♠": "\\spadesuit", "♣": "\\clubsuit", "♥": "\\heartsuit", "♦": "\\diamondsuit", "¬": "\\neg", "∧": "\\land", "∨": "\\lor", "⊤": "\\top", "∣": "\\mid", "∤": "\\nmid", "∦": "\\nparallel", "≪": "\\ll", "≫": "\\gg", "≲": "\\lesssim", "≳": "\\gtrsim", "⋂": "\\bigcap", "⋃": "\\bigcup", "⊎": "\\uplus", "⨁": "\\bigoplus", "⨂": "\\bigotimes", "⨀": "\\bigodot", "↗": "\\nearrow", "↘": "\\searrow", "↙": "\\swarrow", "↖": "\\nwarrow", "⇑": "\\Uparrow", "⇓": "\\Downarrow", "⇕": "\\Updownarrow", "↕": "\\updownarrow", "↪": "\\hookrightarrow", "↩": "\\hookleftarrow", "↼": "\\leftharpoonup", "↽": "\\leftharpoondown", "⇀": "\\rightharpoonup", "⇁": "\\rightharpoondown", "⇌": "\\rightleftharpoons", "⌒": "\\frown", "⏞": "\\overbrace", "⏟": "\\underbrace", " ": "\\ ", " ": " ", "\t": " "};
const FENCE_DEFAULTS = {"0": ["\\langle", "\\rangle"], "1": ["(", ")"], "2": ["\\{", "\\}"], "3": ["[", "]"], "4": ["\\lvert", "\\rvert"], "5": ["\\lVert", "\\rVert"], "6": ["\\lfloor", "\\rfloor"], "7": ["\\lceil", "\\rceil"], "8": ["\\llbracket", "\\rrbracket"]};
const FENCE_CHARS = {"(": "(", ")": ")", "[": "[", "]": "]", "{": "\\{", "}": "\\}", "|": "\\lvert", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil", "⟨": "\\langle", "⟩": "\\rangle"};
const EMBELL_MAP = {"2": "\\dot{%s}", "3": "\\ddot{%s}", "24": "\\dddot{%s}", "5": null, "6": null, "18": null, "8": "\\tilde{%s}", "9": "\\hat{%s}", "11": "\\overrightarrow{%s}", "12": "\\overleftarrow{%s}", "13": "\\overleftrightarrow{%s}", "17": "\\bar{%s}", "19": "\\overset{\\frown}{%s}", "29": "\\underline{%s}"};
const KNOWN_FUNCS = new Set(["Pr", "arccos", "arcsin", "arctan", "arg", "cos", "cosh", "cot", "coth", "csc", "deg", "det", "dim", "exp", "gcd", "inf", "ker", "lg", "lim", "ln", "log", "max", "min", "sec", "sin", "sinh", "sup", "tan", "tanh"]);

function makeEmitter() {
  const unknown = [];
  function charLatex(mtcode, fontpos, typeface) {
    if (mtcode !== null && mtcode !== undefined) {
      if (mtcode === 0xEF02) return '\\ '; // MT Extra space glyph (verified)
      if (mtcode === 0xEC07) return '\\lvert'; // MT Extra left vertical bar (verified)
      if (mtcode === 0xEC08) return '\\rvert'; // MT Extra right vertical bar
      const ch = String.fromCharCode(mtcode);
      if (Object.prototype.hasOwnProperty.call(SYMBOLS, ch)) return SYMBOLS[ch];
      if (/^[\p{L}\p{N}]$/u.test(ch) || '+-=<>()[]/.,;:!?\'"*|'.includes(ch)) return ch;
      if (mtcode >= 0xE000 && mtcode <= 0xF8FF) { unknown.push('MTExtra U+' + mtcode.toString(16).toUpperCase()); return '\\boxed{?}'; }
      unknown.push('U+' + mtcode.toString(16).toUpperCase() + ' ' + JSON.stringify(ch));
      return ch;
    }
    unknown.push('fontpos ' + fontpos + ' typeface ' + typeface);
    return '\\boxed{?}';
  }
  function emitChar(node) {
    const mtcode = node[1], fontpos = node[2], typeface = node[3], emb = node[5];
    let s = charLatex(mtcode, fontpos, typeface);
    for (const e of emb) {
      const et = e[1];
      if (et === 5 || et === 6 || et === 18) s += "'".repeat({ 5: 1, 6: 2, 18: 3 }[et]);
      else if (et === 10) s = '\\not' + s;
      else if (EMBELL_MAP[et]) s = EMBELL_MAP[et].replace('%s', s);
      else unknown.push('embell ' + et);
    }
    return s;
  }
  function slotsOf(subs) { return subs.filter(x => x[0] === 'line' || x[0] === 'pile' || x[0] === 'matrix'); }
  function emit(node) {
    if (!node) return '';
    const k = node[0];
    if (k === 'line') return emitLine(node[1]);
    if (k === 'pile') {
      const lines = node[1].filter(x => x[0] === 'line').map(emit).filter(x => x.trim());
      if (!lines.length) return '';
      if (lines.length === 1) return lines[0];
      return '\\begin{array}{l}' + lines.join('\\\\') + '\\end{array}';
    }
    if (k === 'matrix') {
      const rows = node[1], cols = node[2];
      const vals = node[3].filter(c => c[0] === 'line').map(emit);
      const out = [];
      for (let i = 0; i < rows; i++) out.push(vals.slice(i * cols, (i + 1) * cols).join(' & '));
      return '\\begin{matrix}' + out.join('\\\\') + '\\end{matrix}';
    }
    if (k === 'char') return emitChar(node);
    if (k === 'tmpl') return emitTmpl(node, null);
    return '';
  }
  function emitLine(children) {
    const atoms = [];
    let i = 0;
    while (i < children.length) {
      const node = children[i], k = node[0];
      if (k === 'char') {
        const typeface = node[3];
        if (typeface === 1) {
          let txt = '';
          while (i < children.length && children[i][0] === 'char' && children[i][3] === 1) {
            const c = children[i];
            txt += (c[1] !== null && c[1] !== undefined) ? String.fromCharCode(c[1]) : '?';
            i++;
          }
          atoms.push('\\text{' + txt.replaceAll('}', '\\}') + '}');
          continue;
        }
        if (typeface === 2) {
          let name = '', j = i;
          while (j < children.length && children[j][0] === 'char' && children[j][3] === 2 &&
                 children[j][1] !== null && children[j][1] !== undefined && /^\p{L}$/u.test(String.fromCharCode(children[j][1]))) {
            name += String.fromCharCode(children[j][1]); j++;
          }
          if (name) {
            atoms.push(KNOWN_FUNCS.has(name) ? '\\' + name : '\\operatorname{' + name + '}');
            i = j; continue;
          }
          atoms.push(emitChar(node)); i++; continue;
        }
        atoms.push(emitChar(node)); i++; continue;
      }
      if (k === 'tmpl' && (node[1] === 27 || node[1] === 28 || node[1] === 29)) {
        const base = atoms.length ? atoms.pop() : '';
        atoms.push(emitTmpl(node, base)); i++; continue;
      }
      if (k === 'line' || k === 'pile' || k === 'matrix' || k === 'tmpl') { atoms.push(emit(node)); i++; continue; }
      i++;
    }
    return atoms.join('');
  }
  function emitTmpl(node, base) {
    const sel = node[1], v = node[2], subs = node[4];
    const slots = slotsOf(subs);
    const S = j => (j < slots.length ? emit(slots[j]) : '');
    if (sel === 27 || sel === 28 || sel === 29) {
      let sub = '', sup = '';
      if (sel === 27) sub = S(0);
      else if (sel === 28) sup = slots.length ? S(slots.length - 1) : '';
      else { sub = S(0); sup = S(1); }
      let out = base || '';
      if (sub) out += '_{' + sub + '}';
      if (sup) out += '^{' + sup + '}';
      return out;
    }
    if (sel <= 9) {
      const content = S(0);
      const chars = subs.filter(x => x[0] === 'char');
      let dl, dr;
      const def = FENCE_DEFAULTS[sel] || ['(', ')'];
      dl = def[0]; dr = def[1];
      if (sel === 9) { dl = '('; dr = ']'; }
      if (chars.length) {
        const got = chars.map(c => charLatex(c[1], c[2], c[3]));
        if (got.length >= 1 && chars[0][1]) dl = FENCE_CHARS[String.fromCharCode(chars[0][1])] !== undefined ? FENCE_CHARS[String.fromCharCode(chars[0][1])] : got[0];
        if (got.length >= 2 && chars[1][1]) dr = FENCE_CHARS[String.fromCharCode(chars[1][1])] !== undefined ? FENCE_CHARS[String.fromCharCode(chars[1][1])] : got[1];
      }
      const left = (sel === 9 || (v & 0x01)) ? '\\left' + dl : '\\left.';
      const right = (sel === 9 || (v & 0x02)) ? '\\right' + dr : '\\right.';
      return left + content + right;
    }
    if (sel === 10) { // ROOT: slots = [radicand, degree] (verified on real streams)
      const rad = S(0), deg = S(1);
      return deg.trim() ? '\\sqrt[' + deg + ']{' + rad + '}' : '\\sqrt{' + rad + '}';
    }
    if (sel === 11) {
      const num = S(0), den = S(1);
      if (v & 0x02) return '{' + num + '}/{' + den + '}';
      return ((v & 0x01) ? '\\tfrac' : '\\frac') + '{' + num + '}{' + den + '}';
    }
    if (sel === 12) return '\\underline{' + S(0) + '}';
    if (sel === 13) return '\\overline{' + S(0) + '}';
    if (sel === 14) {
      const main = S(0);
      const chars = subs.filter(x => x[0] === 'char');
      if (!main.trim()) return chars.length ? emitChar(chars[0]) : '\\rightarrow';
      if ((v & 0x10) && !(v & 0x20)) return '\\xleftarrow{' + main + '}';
      return '\\xrightarrow{' + main + '}';
    }
    if (sel >= 15 && sel <= 22) {
      const main = S(0), upper = S(1), lower = S(2);
      const chars = subs.filter(x => x[0] === 'char');
      let op;
      if (sel === 15) op = ({ 1: '\\int', 2: '\\iint', 3: '\\iiint', 4: '\\oint', 8: '\\oint', 12: '\\oint' })[v & 0x0F] || '\\int';
      else if (sel === 16) op = '\\sum';
      else if (sel === 17) op = '\\prod';
      else if (sel === 18) op = '\\coprod';
      else if (sel === 19) op = '\\bigcup';
      else if (sel === 20) op = '\\bigcap';
      else op = chars.length ? emitChar(chars[0]) : '\\sum';
      let out = op;
      if (lower.trim()) out += '_{' + lower + '}';
      if (upper.trim()) out += '^{' + upper + '}';
      return out + main;
    }
    if (sel === 23) {
      const main = S(0), lower = S(1), upper = S(2);
      let out = main;
      if (lower.trim()) out += '_{' + lower + '}';
      if (upper.trim()) out += '^{' + upper + '}';
      return out;
    }
    if (sel === 24 || sel === 25) {
      const main = S(0), small = S(1);
      if (v & 0x01) return '\\overbrace{' + main + '}' + (small.trim() ? '^{' + small + '}' : '');
      return '\\underbrace{' + main + '}' + (small.trim() ? '_{' + small + '}' : '');
    }
    if (sel === 26) return S(0) + ':' + S(1);
    if (sel === 30) return '\\left\\langle ' + S(0) + '\\middle| ' + S(1) + '\\right\\rangle';
    if (sel === 31) return (v & 0x04) ? '\\underrightarrow{' + S(0) + '}' : '\\vec{' + S(0) + '}';
    if (sel === 32) return '\\tilde{' + S(0) + '}';
    if (sel === 33) return '\\hat{' + S(0) + '}';
    if (sel === 34) return '\\overset{\\frown}{' + S(0) + '}';
    if (sel === 35) return S(0);
    if (sel === 36) return '\\cancel{' + S(0) + '}';
    if (sel === 37) return '\\boxed{' + S(0) + '}';
    unknown.push('tmpl selector ' + sel);
    return S(0);
  }
  return {
    toLatex(tree) {
      // A TeX control word is backslash + a maximal run of letters, so a
      // command glued to a following letter (\Rightarrowh, \lvertm) is one
      // undefined token. Insert the invisible space TeX expects — the split
      // point needs the dictionary of commands this emitter can produce:
      // whole run known -> leave; else split after longest known prefix.
      const STRUCT = ['frac','tfrac','sqrt','left','right','middle','text','operatorname','mathbb','begin','end','lim','not','vec','hat','tilde','bar','dot','ddot','dddot','underline','overline','overbrace','underbrace','overrightarrow','overleftarrow','overleftrightarrow','xrightarrow','xleftarrow','underrightarrow','overset','frown','boxed','cancel','lvert','rvert','lVert','rVert','lfloor','rfloor','lceil','rceil','langle','rangle','llbracket','rrbracket'];
      const known = new Set(STRUCT);
      KNOWN_FUNCS.forEach(f => known.add(f));
      Object.values(SYMBOLS).forEach(v => { if (/^\\[a-zA-Z]+$/.test(v)) known.add(v.slice(1)); });
      Object.values(EMBELL_MAP).forEach(v => { if (v && /^\\[a-zA-Z]+/.test(v)) { const mm = v.match(/^\\([a-zA-Z]+)/); if (mm) known.add(mm[1]); } });
      let s = emit(tree.root);
      const cuts = [];
      for (const m of s.matchAll(/\\([a-zA-Z]+)/g)) {
        const run = m[1];
        if (known.has(run)) continue;
        for (let L = run.length - 1; L > 0; L--) {
          if (known.has(run.slice(0, L))) { cuts.push(m.index + 1 + L); break; }
        }
      }
      cuts.sort((a, b) => b - a);
      for (const pos of cuts) s = s.slice(0, pos) + ' ' + s.slice(pos);
      return { latex: s, unknown: unknown.slice() };
    }
  };
}
function mtefToLatex(equationNative) {
  const tree = parseEquationNative(equationNative);
  const em = makeEmitter();
  const res = em.toLatex(tree);
  return { latex: res.latex, unknown: res.unknown, header: tree.header, warnings: tree.warnings };
}
function oleToLatex(oleBytes) {
  const cfb = cfbOpen(oleBytes);
  const en = cfb.getStream('Equation Native');
  if (!en) throw new MTEFError('no Equation Native stream');
  return mtefToLatex(en);
}

/* ================= Minimal XML parser (for MathML input) ================= */
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|lt|gt|amp|apos|quot);/g, (m, g) => {
    if (g === 'lt') return '<'; if (g === 'gt') return '>'; if (g === 'amp') return '&';
    if (g === 'apos') return "'"; if (g === 'quot') return '"';
    if (g[1] === 'x' || g[1] === 'X') return String.fromCodePoint(parseInt(g.slice(2), 16));
    return String.fromCodePoint(parseInt(g.slice(1), 10));
  });
}
function parseXml(str) {
  let pos = 0; const len = str.length;
  function parseElement() {
    pos++; // '<'
    let name = '';
    while (pos < len && !/[\s/>]/.test(str[pos])) name += str[pos++];
    const attrs = {};
    while (pos < len) {
      while (pos < len && /\s/.test(str[pos])) pos++;
      if (str[pos] === '/' && str[pos + 1] === '>') { pos += 2; return { tag: name, attrs, children: [] }; }
      if (str[pos] === '>') { pos++; break; }
      let an = '';
      while (pos < len && !/[\s=/>]/.test(str[pos])) an += str[pos++];
      while (pos < len && /\s/.test(str[pos])) pos++;
      let av = '';
      if (str[pos] === '=') {
        pos++;
        while (pos < len && /\s/.test(str[pos])) pos++;
        const q = str[pos++]; let v = '';
        while (pos < len && str[pos] !== q) v += str[pos++];
        pos++; av = decodeEntities(v);
      }
      if (an) attrs[an] = av;
    }
    const children = [];
    while (pos < len) {
      if (str.startsWith('</', pos)) { pos += 2; while (pos < len && str[pos] !== '>') pos++; pos++; return { tag: name, attrs, children }; }
      if (str.startsWith('<!--', pos)) { const e = str.indexOf('-->', pos); pos = e < 0 ? len : e + 3; continue; }
      if (str[pos] === '<') children.push(parseElement());
      else { let t = ''; while (pos < len && str[pos] !== '<') t += str[pos++]; if (t) children.push({ text: decodeEntities(t) }); }
    }
    return { tag: name, attrs, children };
  }
  while (pos < len) {
    if (str.startsWith('<?', pos)) { const e = str.indexOf('?>', pos); pos = e < 0 ? len : e + 2; }
    else if (str.startsWith('<!--', pos)) { const e = str.indexOf('-->', pos); pos = e < 0 ? len : e + 3; }
    else if (str[pos] === '<') break;
    else pos++;
  }
  return parseElement();
}
function iterText(node) {
  if (node.text !== undefined) return node.text;
  return node.children.map(iterText).join('');
}
function elemChildren(node) { return node.children.filter(c => c.text === undefined); }

/* ================= MathML -> OMML (port of mathml2omml.py) ================= */
const BB_MAP = { R: '\u211D', N: '\u2115', Z: '\u2124', Q: '\u211A', C: '\u2102', P: '\u2119', H: '\u210D' };
const ACCENT_MAP = { '\u02C6': '\u0302', '^': '\u0302', '\u02DC': '\u0303', '~': '\u0303', '\u00AF': '\u00AF', '\u2192': '\u20D7', '\u02D9': '\u0307', '\u00A8': '\u0308' };
const BIG_OPS = ['\u2211', '\u220F', '\u2210', '\u222B', '\u222C', '\u222D', '\u222E', '\u22C3', '\u22C2', '\u2A01', '\u2A02', '\u2A00'];
function mathmlToOmml(mathmlStr, opts) {
  const sz = (opts && opts.sz) || 0;
  const rootEl = parseXml(mathmlStr);
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escA = s => esc(s).replace(/"/g, '&quot;');
  function run(text, plain, bold) {
    let s = '<m:r>';
    if (plain || bold) s += '<m:rPr><m:sty m:val="' + (bold ? 'b' : 'p') + '"/></m:rPr>';
    if (sz) s += '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/></w:rPr>';
    const sp = (text.startsWith(' ') || text.endsWith(' ')) ? ' xml:space="preserve"' : '';
    return s + '<m:t' + sp + '>' + esc(text) + '</m:t></m:r>';
  }
  function convChildren(el) { return elemChildren(el).map(conv).join(''); }
  function conv(el) {
    const tag = el.tag.split(':').pop();
    const kids = elemChildren(el);
    switch (tag) {
      case 'math': case 'mrow': case 'semantics': case 'mstyle': case 'mpadded': case 'menclose': case 'mphantom': case 'mfenced':
        return convChildren(el);
      case 'annotation': return '';
      case 'mi': case 'mo': case 'mn': case 'mtext': case 'ms': {
        const text = iterText(el), mv = el.attrs.mathvariant || '';
        if (mv === 'double-struck' && BB_MAP[text]) return run(BB_MAP[text], false, false);
        return run(text, tag === 'mtext' || mv === 'normal', mv === 'bold');
      }
      case 'mspace': return run(' ', true, false);
      case 'mfrac': return '<m:f><m:num>' + conv(kids[0]) + '</m:num><m:den>' + conv(kids[1]) + '</m:den></m:f>';
      case 'msup': return '<m:sSup><m:e>' + conv(kids[0]) + '</m:e><m:sup>' + conv(kids[1]) + '</m:sup></m:sSup>';
      case 'msub': return '<m:sSub><m:e>' + conv(kids[0]) + '</m:e><m:sub>' + conv(kids[1]) + '</m:sub></m:sSub>';
      case 'msubsup': return '<m:sSubSup><m:e>' + conv(kids[0]) + '</m:e><m:sub>' + conv(kids[1]) + '</m:sub><m:sup>' + conv(kids[2]) + '</m:sup></m:sSubSup>';
      case 'msqrt': return '<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>' + convChildren(el) + '</m:e></m:rad>';
      case 'mroot': return '<m:rad><m:deg>' + conv(kids[1]) + '</m:deg><m:e>' + conv(kids[0]) + '</m:e></m:rad>';
      case 'mover': {
        const accText = kids.length > 1 ? iterText(kids[1]) : '';
        if (ACCENT_MAP[accText]) return '<m:acc><m:accPr><m:chr m:val="' + escA(ACCENT_MAP[accText]) + '"/></m:accPr><m:e>' + conv(kids[0]) + '</m:e></m:acc>';
        return '<m:limUpp><m:e>' + conv(kids[0]) + '</m:e><m:lim>' + conv(kids[1]) + '</m:lim></m:limUpp>';
      }
      case 'munder': return '<m:limLow><m:e>' + conv(kids[0]) + '</m:e><m:lim>' + conv(kids[1]) + '</m:lim></m:limLow>';
      case 'munderover': {
        const baseTxt = iterText(kids[0]);
        if (BIG_OPS.includes(baseTxt)) return '<m:nary><m:naryPr><m:chr m:val="' + escA(baseTxt) + '"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>' + conv(kids[1]) + '</m:sub><m:sup>' + conv(kids[2]) + '</m:sup><m:e/></m:nary>';
        return '<m:sSubSup><m:e>' + conv(kids[0]) + '</m:e><m:sub>' + conv(kids[1]) + '</m:sub><m:sup>' + conv(kids[2]) + '</m:sup></m:sSubSup>';
      }
      case 'mtable': {
        let s = '<m:m>';
        for (const tr of kids) { s += '<m:mr>'; for (const td of elemChildren(tr)) s += '<m:e>' + convChildren(td) + '</m:e>'; s += '</m:mr>'; }
        return s + '</m:m>';
      }
      default: return convChildren(el);
    }
  }
  return '<m:oMath>' + conv(rootEl) + '</m:oMath>';
}

/* ================= .docx layer ================= */
function stripTagsToText(xml) {
  return decodeEntities(xml.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
}
const RUN_RE_SRC = '<w:r\\b[^>]*>[\\s\\S]*?<\\/w:r>';
async function openDocx(arrayBuffer, JSZipLib) {
  const zip = await JSZipLib.loadAsync(arrayBuffer);
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Không thấy word/document.xml — đây không phải file .docx hợp lệ.');
  const docXml = await docFile.async('string');
  const relMap = {};
  const relsFile = zip.file('word/_rels/document.xml.rels');
  if (relsFile) {
    const relsXml = await relsFile.async('string');
    for (const m of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relMap[m[1]] = m[2];
  }
  let fontSize = 24;
  const stylesFile = zip.file('word/styles.xml');
  if (stylesFile) {
    const sx = await stylesFile.async('string');
    const sm = sx.match(/<w:style[^>]*w:styleId="Normal"[^>]*>([\s\S]*?)<\/w:style>/);
    if (sm) { const zm = sm[1].match(/<w:sz w:val="(\d+)"/); if (zm) fontSize = parseInt(zm[1], 10); }
  }
  let relsXml = '', contentTypesXml = '';
  if (relsFile) relsXml = await relsFile.async('string');
  const ctFile = zip.file('[Content_Types].xml');
  if (ctFile) contentTypesXml = await ctFile.async('string');
  const equations = [];
  const runRe = new RegExp(RUN_RE_SRC, 'g');
  let ctx = '', n = 0;
  for (const m of docXml.matchAll(runRe)) {
    if (!m[0].includes('<w:object')) { ctx += stripTagsToText(m[0]); continue; }
    n++;
    const eq = { n, context: ctx.trim().slice(-110), latex: null, error: null, appkey: null, unknown: [] };
    ctx = '';
    try {
      const ridM = m[0].match(/OLEObject[^>]*r:id="([^"]+)"/);
      const target = ridM ? relMap[ridM[1]] : null;
      if (!target) throw new Error('Không tìm thấy phần nhúng trong rels');
      const path = target.startsWith('word/') ? target : 'word/' + target.replace(/^\//, '');
      const f = zip.file(path);
      if (!f) throw new Error('Thiếu file nhúng ' + path);
      const bytes = await f.async('uint8array');
      const res = oleToLatex(bytes);
      eq.latex = res.latex; eq.appkey = res.header.appkey; eq.unknown = res.unknown;
      if (res.warnings && res.warnings.length) eq.error = 'MTEF: ' + res.warnings.join('; ');
    } catch (e) { eq.error = String((e && e.message) || e); }
    equations.push(eq);
  }
  return { zip, docXml, equations, fontSize, relsXml, contentTypesXml };
}
async function exportDocx(state, convertLatex, latexToMathml) {
  let idx = 0; const fails = [];
  const runRe = new RegExp(RUN_RE_SRC, 'g');
  const newXml = state.docXml.replace(runRe, block => {
    if (!block.includes('<w:object')) return block;
    idx++;
    if (!convertLatex.has(idx)) return block;
    try {
      const mml = latexToMathml(convertLatex.get(idx));
      return mathmlToOmml(mml, { sz: state.fontSize });
    } catch (e) { fails.push([idx, String((e && e.message) || e)]); return block; }
  });
  state.zip.file('word/document.xml', newXml);
  const isNode = typeof window === 'undefined';
  const data = await state.zip.generateAsync({ type: isNode ? 'uint8array' : 'blob', compression: 'DEFLATE' });
  return { data, converted: convertLatex.size - fails.length, fails };
}

/* ================= Export variant: equations -> $...$ LaTeX text ================= */
function xmlEscape(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
async function exportLatexDocx(state, convertLatex) {
  let idx = 0; const fails = [];
  const runRe = new RegExp(RUN_RE_SRC, 'g');
  const newXml = state.docXml.replace(runRe, block => {
    if (!block.includes('<w:object')) return block;
    idx++;
    if (!convertLatex.has(idx)) return block;
    const latex = convertLatex.get(idx);
    return '<w:r><w:rPr><w:sz w:val="' + state.fontSize + '"/><w:szCs w:val="' + state.fontSize + '"/></w:rPr>' +
           '<w:t xml:space="preserve">$' + xmlEscape(latex) + '$</w:t></w:r>';
  });
  state.zip.file('word/document.xml', newXml);
  const isNode = typeof window === 'undefined';
  const data = await state.zip.generateAsync({ type: isNode ? 'uint8array' : 'blob', compression: 'DEFLATE' });
  return { data, converted: convertLatex.size - fails.length, fails };
}

/* ================= LaTeX parser -> AST (subset for the MTEF writer) ================= */
const REV_SYMBOLS = {};
for (const [ch, cmd] of Object.entries(SYMBOLS)) {
  if (/^\\[a-zA-Z]+$/.test(cmd) && !REV_SYMBOLS[cmd.slice(1)]) REV_SYMBOLS[cmd.slice(1)] = ch;
}
Object.assign(REV_SYMBOLS, {
  le: '\u2264', ge: '\u2265', ne: '\u2260', neq: '\u2260', to: '\u2192', gets: '\u2190',
  infty: '\u221E', nabla: '\u2207', partial: '\u2202', forall: '\u2200', exists: '\u2203',
  ldots: '\u2026', cdots: '\u22EF', vdots: '\u22EE', ddots: '\u22F1', angle: '\u2220',
  perp: '\u22A5', parallel: '\u2225', times: '\u00D7', div: '\u00F7', pm: '\u00B1', mp: '\u2213',
  cdot: '\u00B7', ast: '\u2217', circ: '\u2218', bullet: '\u2219', sim: '\u223C', simeq: '\u2243',
  approx: '\u2248', equiv: '\u2261', cong: '\u2245', propto: '\u221D', in: '\u2208', notin: '\u2209',
  ni: '\u220B', subset: '\u2282', supset: '\u2283', subseteq: '\u2286', supseteq: '\u2287',
  cup: '\u222A', cap: '\u2229', emptyset: '\u2205', setminus: '\u2216', land: '\u2227', lor: '\u2228',
  neg: '\u00AC', mid: '\u2223', Rightarrow: '\u21D2', Leftarrow: '\u21D0', Leftrightarrow: '\u21D4',
  Rightarrow2: '\u21D2', implies: '\u21D2', impliedby: '\u21D0', iff: '\u21D4',
  rightarrow: '\u2192', leftarrow: '\u2190', leftrightarrow: '\u2194', mapsto: '\u21A6',
  longrightarrow: '\u2192', longleftarrow: '\u2190', Longrightarrow: '\u21D2', Longleftarrow: '\u21D0',
  Longleftrightarrow: '\u21D4', uparrow: '\u2191', downarrow: '\u2193', ell: '\u2113',
  prime: '\u2032', checkmark: '\u2713', oslash: '\u2298', updownarrow: '\u2195', nexists: '\u2204', Box: '\u25A1', bigcirc: '\u25EF', triangle: '\u25B3', square: '\u25A1', diamond: '\u25C7',
  therefore: '\u2234', because: '\u2235', ll: '\u226A', gg: '\u226B', lesssim: '\u2272', gtrsim: '\u2273',
  colon: ':', varnothing: '\u2205', diameter: '\u2300', measuredangle: '\u2221', sphericalangle: '\u2222',
  oplus: '\u2295', otimes: '\u2297', odot: '\u2299', hbar: '\u210F', aleph: '\u2135',
  alpha: '\u03B1', beta: '\u03B2', gamma: '\u03B3', delta: '\u03B4', epsilon: '\u03F5', varepsilon: '\u03B5',
  zeta: '\u03B6', eta: '\u03B7', theta: '\u03B8', vartheta: '\u03D1', iota: '\u03B9', kappa: '\u03BA',
  lambda: '\u03BB', mu: '\u03BC', nu: '\u03BD', xi: '\u03BE', pi: '\u03C0', varpi: '\u03D6',
  rho: '\u03C1', varrho: '\u03F1', sigma: '\u03C3', varsigma: '\u03C2', tau: '\u03C4', upsilon: '\u03C5',
  phi: '\u03D5', varphi: '\u03C6', chi: '\u03C7', psi: '\u03C8', omega: '\u03C9',
  Gamma: '\u0393', Delta: '\u0394', Theta: '\u0398', Lambda: '\u039B', Xi: '\u039E', Pi: '\u03A0',
  Sigma: '\u03A3', Upsilon: '\u03A5', Phi: '\u03A6', Psi: '\u03A8', Omega: '\u03A9',
  sin: null, cos: null, tan: null, cot: null, sec: null, csc: null, arcsin: null, arccos: null, arctan: null,
  sinh: null, cosh: null, tanh: null, ln: null, log: null, lg: null, exp: null, max: null, min: null,
  sup: null, inf: null, det: null, ker: null, dim: null, gcd: null, deg: null, arg: null, lim: null
});
const BB_LETTERS = { '\u211D': 'R', '\u2115': 'N', '\u2124': 'Z', '\u211A': 'Q', '\u2102': 'C', '\u2119': 'P', '\u210D': 'H' };

function tokenizeLatex(str) {
  const toks = []; let i = 0;
  while (i < str.length) {
    const c = str[i];
    if (c === '\\') {
      let j = i + 1;
      if (j < str.length && /[a-zA-Z]/.test(str[j])) {
        let name = '';
        while (j < str.length && /[a-zA-Z]/.test(str[j])) name += str[j++];
        toks.push({ k: 'cmd', v: name }); i = j;
      } else if (j < str.length) {
        toks.push({ k: 'esc', v: str[j] }); i = j + 1;
      } else { i = j; }
    } else if ('{}^_&[]'.includes(c)) { toks.push({ k: c }); i++; }
    else { toks.push({ k: 'ch', v: c }); i++; }
  }
  return toks;
}

function parseLatex(input, warnings) {
  const toks = tokenizeLatex(input);
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  function rawGroupText() {
    // current token must be '{'; returns raw inner text (for \text, \operatorname, env names)
    let out = '';
    if (!peek() || peek().k !== '{') return out;
    next(); let depth = 1;
    while (pos < toks.length && depth > 0) {
      const t = next();
      if (t.k === '{') { depth++; out += '{'; }
      else if (t.k === '}') { depth--; if (depth > 0) out += '}'; }
      else if (t.k === 'cmd') out += '\\' + t.v;
      else if (t.k === 'esc') out += '\\' + t.v;
      else out += (t.v !== undefined ? t.v : t.k);
    }
    return out;
  }
  function parseGroupOrAtom() {
    const t = peek();
    if (t && t.k === '{') { next(); const s = parseSeq(() => peek() && peek().k === '}'); if (peek() && peek().k === '}') next(); return { t: 'seq', items: s }; }
    const a = parseAtom();
    return a || { t: 'seq', items: [] };
  }
  function parseSeq(stopPred) {
    const items = [];
    while (pos < toks.length && !stopPred()) {
      const before = pos;
      const item = parseItem();
      if (item) items.push(item);
      if (pos === before) { next(); } // guarantee progress on stray tokens
    }
    return items;
  }
  function withScripts(atom) {
    let sub = null, sup = null, guard = 0;
    while (pos < toks.length && guard++ < 4) {
      const t = peek();
      if (t.k === '^') { next(); sup = parseGroupOrAtom(); }
      else if (t.k === '_') { next(); sub = parseGroupOrAtom(); }
      else break;
    }
    if (sub || sup) {
      if (atom.t === 'bigop') { atom.sub = sub; atom.sup = sup; return atom; }
      return { t: 'script', base: atom, sub, sup };
    }
    return atom;
  }
  function parseItem() { const a = parseAtom(); return a ? withScripts(a) : null; }
  function parseAtom() {
    const t = next();
    if (!t) return null;
    if (t.k === '[' || (t.k === 'ch' && t.v === '(')) {
      const open = t.k === '[' ? '[' : '(';
      const isClose = t.k === '['
        ? (x) => x && x.k === ']'
        : (x) => x && x.k === 'ch' && x.v === ')';
      const save = pos;
      const inner = parseSeq(() => isClose(peek()));
      if (isClose(peek())) { next(); return { t: 'fence', l: open, r: open === '(' ? ')' : ']', sized: false, inner: { t: 'seq', items: inner } }; }
      pos = save;
      return { t: 'char', ch: open };
    }
    if (t.k === ']') return null;
    if (t.k === 'ch') {
      if (t.v === ' ') return { t: 'char', ch: ' ' };
      return { t: 'char', ch: t.v };
    }
    if (t.k === '{') { pos--; return parseGroupOrAtom(); }
    if (t.k === 'esc') {
      if (t.v === '\\') return { t: 'char', ch: '\u0001' }; // row-break marker sentinel
      if (t.v === ' ') return { t: 'char', ch: ' ' };
      if (t.v === ',' || t.v === ';' || t.v === ':' || t.v === '!') return { t: 'char', ch: ' ' };
      return { t: 'char', ch: t.v };
    }
    if (t.k === 'cmd') {
      const c = t.v;
      if (c === 'binom') {
        const bnum = parseGroupOrAtom(), bden = parseGroupOrAtom();
        return { t: 'fence', l: '(', r: ')', sized: true, inner: { t: 'frac', num: bnum, den: bden, small: false } };
      }
      if (c === 'frac' || c === 'dfrac' || c === 'tfrac') {
        return { t: 'frac', num: parseGroupOrAtom(), den: parseGroupOrAtom(), small: c === 'tfrac' };
      }
      if (c === 'sqrt') {
        let deg = null;
        if (peek() && peek().k === '[') {
          next(); const d = parseSeq(() => peek() && peek().k === ']');
          if (peek() && peek().k === ']') next();
          deg = { t: 'seq', items: d };
        }
        return { t: 'sqrt', rad: parseGroupOrAtom(), deg };
      }
      if (c === 'left') {
        const d = readDelim();
        const inner = parseSeq(() => peek() && peek().k === 'cmd' && peek().v === 'right');
        let r = null;
        if (peek() && peek().k === 'cmd' && peek().v === 'right') { next(); r = readDelim(); }
        return { t: 'fence', l: d, r, sized: true, inner: { t: 'seq', items: inner } };
      }
      if (c === 'right') { pos--; return null; }
      if (c === 'begin') {
        const env = rawGroupText();
        if (env === 'array') rawGroupText(); // discard column spec {l}, {cc}, ...
        const cells = []; let row = []; let cell = [];
        const flushCell = () => { row.push({ t: 'seq', items: cell }); cell = []; };
        const flushRow = () => { flushCell(); cells.push(row); row = []; };
        // parse items one by one, splitting on & and sentinel row breaks
        while (pos < toks.length) {
          if (peek().k === 'cmd' && peek().v === 'end') { next(); rawGroupText(); break; }
          if (peek().k === '&') { next(); flushCell(); continue; }
          if (peek().k === 'esc' && peek().v === '\\') { next(); flushRow(); continue; }
          const it = parseItem();
          if (it) cell.push(it);
        }
        flushRow();
        if (env === 'array' && cells.every(r => r.length === 1)) {
          return { t: 'pile', lines: cells.map(r => r[0]) };
        }
        const mat = { t: 'matrix', env, rows: cells };
        const F = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['\\{', '\\}'], vmatrix: ['\\lvert', '\\rvert'], Vmatrix: ['\u2016', '\u2016'], cases: ['\\{', null] };
        if (F[env]) return { t: 'fence', l: F[env][0], r: F[env][1], sized: true, inner: mat };
        return mat;
      }
      if (c === 'end') { rawGroupText(); return null; }
      if (c === 'text' || c === 'textrm' || c === 'textnormal') return { t: 'text', text: rawGroupText() };
      if (c === 'operatorname') return { t: 'func', name: rawGroupText() };
      if (c === 'mathbb' || c === 'mathbf' || c === 'mathcal' || c === 'mathrm' || c === 'mathit' || c === 'boldsymbol') {
        const inner = parseGroupOrAtom();
        if (c === 'mathbb') {
          const ch = inner.items && inner.items[0] && inner.items[0].ch;
          if (ch) return { t: 'char', ch: BB_LETTERS[ch] ? ch : ch, bb: true, letter: ch };
          return inner;
        }
        return inner;
      }
      if (c === 'vec' || c === 'hat' || c === 'tilde' || c === 'bar' || c === 'dot' || c === 'ddot' || c === 'dddot' || c === 'breve' || c === 'check' ||
          c === 'widehat' || c === 'widetilde' || c === 'overline' || c === 'underline' || c === 'overbrace' ||
          c === 'underbrace' || c === 'overrightarrow' || c === 'overleftarrow' || c === 'overleftrightarrow') {
        return { t: 'acc', kind: c, inner: parseGroupOrAtom() };
      }
      if (c === 'boxed') return { t: 'boxed', inner: parseGroupOrAtom() };
      if (c === 'cancel') return { t: 'cancel', inner: parseGroupOrAtom() };
      if (c === 'sum' || c === 'prod' || c === 'coprod' || c === 'bigcup' || c === 'bigcap' ||
          c === 'int' || c === 'iint' || c === 'iiint' || c === 'oint' || c === 'lim') {
        return { t: 'bigop', op: c, sub: null, sup: null };
      }
      if (c === 'vert') return { t: 'char', ch: '|' };
      if (c === 'quad' || c === 'qquad') return { t: 'char', ch: ' ' };
      if (c === 'displaystyle' || c === 'limits' || c === 'nolimits' || c === 'limits') return { t: 'char', ch: '' };
      if (c === 'not') {
        const a = parseAtom();
        if (a && a.t === 'char') return { t: 'char', ch: a.ch, neg: true };
        return a;
      }
      const funcs = ['sin','cos','tan','cot','sec','csc','arcsin','arccos','arctan','sinh','cosh','tanh','coth','ln','log','lg','exp','max','min','sup','inf','det','ker','dim','gcd','deg','arg','Pr','liminf','limsup'];
      if (funcs.includes(c)) return { t: 'func', name: c };
      if (REV_SYMBOLS[c] !== undefined && REV_SYMBOLS[c] !== null) return { t: 'char', ch: REV_SYMBOLS[c] };
      if (warnings) warnings.push('unknown command \\' + c);
      return { t: 'func', name: c };
    }
    return null;
  }
  function readDelim() {
    const t = next();
    if (!t) return null;
    if (t.k === 'ch') return t.v === '.' ? null : t.v;
    if (t.k === '[') return '[';
    if (t.k === ']') return ']';
    if (t.k === 'esc') return '\\' + t.v;
    if (t.k === 'cmd') return '\\' + t.v;
    return null;
  }
  const items = parseSeq(() => false);
  return { t: 'seq', items };
}

/* ================= LaTeX AST -> MTEF writer (Strategy B, experimental) ================= */
const MTEF_PREAMBLE_HEX = '050100070844534d543700011357696e416c6c4261736963436f6465506167657300110554696d6573204e657720526f6d616e00110353796d626f6c001105436f7572696572204e65770011044d5420457874726100120008212f458f442f4150f4100f475f4150f21f1e4150f4150f4100f445f425f48f425f4100f4100f435f4100f48f45f42a5f48f48f4100f4100f40f48f417f48f4100f412a5f445f45f45f45f45f410f0c01000100010202020200020001010100030001000400000a';
const COMPOBJ_HEX = '0100feff030a0000ffffffff03ce020000000000c000000000000046160000004d6174685479706520372e30204571756174696f6e000c0000004d61746854797065204546000f0000004571756174696f6e2e44534d543400f439b271000000000000000000000000';
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
class ByteWriter {
  constructor() { this.a = []; }
  u8(v) { this.a.push(v & 0xFF); }
  u16(v) { this.a.push(v & 0xFF, (v >> 8) & 0xFF); }
  uint(v) { if (v < 0xFF) this.u8(v); else { this.u8(0xFF); this.u16(v); } }
  sint(v) { if (v >= -128 && v <= 126) this.u8(v + 128); else { this.u8(0xFF); this.u16(v + 32768); } }
  bytes(b) { for (const x of b) this.a.push(x); }
  done() { return new Uint8Array(this.a); }
}
const TF_TEXT = 1, TF_FUNC = 2, TF_VAR = 3, TF_SYM = 6, TF_NUM = 8;
// Character encodings measured from 627 real MathType equations (2026-10-22):
// glyphs are selected by (style, fontpos) pairs pointing into the Symbol /
// MT Extra fonts. Writing a bare Unicode codepoint in the variable style
// makes MathType render the replacement glyph (black diamond) for symbols
// such as \in, \emptyset and even the math space.
const SYMBOL_POS = { 0x2208: 206, 0x2209: 207, 0x2205: 198, 0x2192: 174, 0x2190: 172, 0x2191: 173, 0x2193: 175, 0x2194: 171,
  0x21D2: 222, 0x21D0: 220, 0x21D4: 219, 0x21D1: 221, 0x21D3: 223, 0x2264: 163, 0x2265: 179, 0x2260: 185, 0x2248: 187,
  0x2261: 186, 0x221E: 165, 0x00B1: 177, 0x00D7: 180, 0x00F7: 184, 0x00B0: 176, 0x2200: 34, 0x2203: 36, 0x220B: 39,
  0x221D: 181, 0x2202: 182, 0x2220: 208, 0x2207: 209, 0x2211: 229, 0x220F: 213, 0x222B: 242, 0x221A: 214, 0x222A: 200,
  0x2229: 199, 0x2282: 204, 0x2283: 201, 0x22A5: 94, 0x22C5: 215, 0x2212: 45, 0x223C: 126 };
const GREEK_LOWER_POS = { '\u03B1': 97, '\u03B2': 98, '\u03B3': 103, '\u03B4': 100, '\u03B5': 101, '\u03F5': 101, '\u03B6': 122, '\u03B7': 104, '\u03B8': 113, '\u03D1': 74, '\u03B9': 105, '\u03BA': 107, '\u03BB': 108, '\u03BC': 109, '\u03BD': 110, '\u03BE': 120, '\u03C0': 112, '\u03C1': 114, '\u03C3': 115, '\u03C2': 86, '\u03C4': 116, '\u03C5': 117, '\u03C6': 102, '\u03D5': 106, '\u03C7': 99, '\u03C8': 121, '\u03C9': 119, '\u03D6': 118 };
const GREEK_UPPER_POS = { '\u0393': 71, '\u0394': 68, '\u0398': 81, '\u039B': 76, '\u039E': 88, '\u03A0': 80, '\u03A3': 83, '\u03A5': 85, '\u03A6': 70, '\u03A8': 89, '\u03A9': 87 };
const BB_POS = { '\u211D': 161, '\u2124': 162 };
// Symbol-style glyphs with no confirmed Symbol-font position: written in the
// symbol style without a fontpos byte (best effort; content is preserved).
const SYMBOL_NOPOS = new Set([0x2298, 0x2195, 0x2204, 0x25A1, 0x25EF]);
// Combining diacritics are stored as MT Extra style (22) char records,
// mirroring how real files store U+0302 / U+20D7 (used for \breve / \check,
// which have no confirmed EMBELL number).
const COMBINING_TF22 = new Set([0x0302, 0x0303, 0x0306, 0x0307, 0x0308, 0x030C, 0x20D7]);
const BB_FROM_LETTER = { R: '\u211D', N: '\u2115', Z: '\u2124', Q: '\u211A', C: '\u2102', P: '\u2119', H: '\u210D' };
function writeCharRecord(w, ch, opts2) {
  let code = ch.codePointAt(0);
  let tf = null, fontpos = null;
  // MathType stores math-mode spaces as the MT Extra space glyph U+EF02,
  // which real files always write in style 24.
  if (ch === ' ' && !(opts2 && opts2.tf === TF_TEXT)) { code = 0xEF02; tf = 24; }
  else if (GREEK_LOWER_POS[ch] !== undefined) { tf = 4; fontpos = GREEK_LOWER_POS[ch]; }
  else if (GREEK_UPPER_POS[ch] !== undefined) { tf = 5; fontpos = GREEK_UPPER_POS[ch]; }
  else if (BB_POS[ch] !== undefined) { tf = 11; fontpos = BB_POS[ch]; }
  else if (SYMBOL_POS[code] !== undefined) { tf = TF_SYM; fontpos = SYMBOL_POS[code]; }
  else if (SYMBOL_NOPOS.has(code)) { tf = TF_SYM; }
  else if (COMBINING_TF22.has(code)) { tf = 22; }
  if (tf === null) {
    tf = TF_VAR;
    if (opts2 && opts2.tf) tf = opts2.tf;
    else if (/[0-9]/.test(ch)) tf = TF_NUM;
    else if (ch.length === 1 && '+-=<>()[]/.,;:!?*|\'’.'.includes(ch)) tf = TF_SYM;
    if (tf === TF_SYM && code <= 0xFF) fontpos = code;
  }
  if (ch === '-' && tf === TF_SYM) code = 0x2212; // real MathType writes U+2212 for math minus
  const opts = fontpos !== null ? 0x04 : 0;
  w.u8(2); w.u8(opts); w.sint(tf); w.u16(code);
  if (fontpos !== null) w.u8(fontpos);
}
function writeNullLine(w) { w.u8(1); w.u8(0x01); }
function writeLine(w, seq) { w.u8(1); w.u8(0); writeSeq(w, seq && seq.items ? seq.items : []); w.u8(0); }
function writeSlot(node) {
  return x => { x.u8(1); x.u8(0); if (node && node.t === 'seq') writeSeq(x, node.items); else if (node) writeNode(x, node); x.u8(0); };
}
function writeTmpl(w, sel, variation, subs) {
  w.u8(3); w.u8(0); w.u8(sel);
  if (variation >= 0x80) { w.u8(0x80 | (variation & 0x7F)); w.u8((variation >> 8) & 0xFF); } else w.u8(variation);
  w.u8(0); // MathType 6/7 template-options byte
  for (const s of subs) s(w);
  w.u8(0);
}
const EMBELL_FOR_ACCENT = { dot: 2, ddot: 3, dddot: 24, tilde: 8, hat: 9, vec: 11, bar: 17 };
function writeSeq(w, items) {
  for (let i = 0; i < items.length; i++) {
    const node = items[i];
    if (node.t === 'bigop' && node.op !== 'lim') {
      // BigOp main slot = the rest of this sequence (mirrors the decoder)
      const rest = items.slice(i + 1);
      writeBigOp(w, node, rest);
      return;
    }
    writeNode(w, node);
  }
}
function writeNode(w, node) {
  switch (node.t) {
    case 'seq': writeSeq(w, node.items); return;
    case 'char': {
      if (node.ch === '') return;
      if (node.bb && BB_FROM_LETTER[node.letter]) { writeCharRecord(w, BB_FROM_LETTER[node.letter], { tf: TF_VAR }); return; }
      if (node.neg) {
        writeCharRecord(w, node.ch, null);
        // negation: re-emit as CHAR with NOT embellishment is not in the
        // decoder map for arbitrary chars; use a slash overlay via EMBELL 10
        // is decode-only in the emitter — simplest faithful fallback: keep char.
        return;
      }
      writeCharRecord(w, node.ch, null);
      return;
    }
    case 'text': {
      for (const ch of node.text) writeCharRecord(w, ch === ' ' ? ' ' : ch, { tf: TF_TEXT });
      return;
    }
    case 'func': {
      for (const ch of node.name) writeCharRecord(w, ch, { tf: TF_FUNC });
      return;
    }
    case 'frac':
      writeTmpl(w, 11, node.small ? 1 : 0, [writeSlot(node.num), writeSlot(node.den)]);
      return;
    case 'sqrt':
      writeTmpl(w, 10, 0, [writeSlot(node.rad), w => w.u8(0x0B), node.deg ? writeSlot(node.deg) : writeNullLine]);
      return;
    case 'script': {
      writeNode(w, node.base);
      if (node.sub && node.sup) { writeTmpl(w, 29, 0, [w => w.u8(0x0B), writeSlot(node.sub), writeSlot(node.sup)]); w.u8(0x0A); }
      else if (node.sub) { writeTmpl(w, 27, 0, [w => w.u8(0x0B), writeSlot(node.sub), writeNullLine]); w.u8(0x0A); }
      else if (node.sup) { writeTmpl(w, 28, 0, [w => w.u8(0x0B), writeNullLine, writeSlot(node.sup)]); w.u8(0x0A); }
      return;
    }
    case 'fence': {
      if (!node.sized) {
        if (node.l) writeCharRecord(w, node.l === '\\{' ? '{' : node.l, null);
        writeSeq(w, node.inner.items || []);
        if (node.r) writeCharRecord(w, node.r === '\\}' ? '}' : node.r, null);
        return;
      }
      const selMap = { '(': 1, '\\{': 2, '[': 3, '|': 4, '\\lvert': 4, '\\rvert': 4, '\\lVert': 5, '\u2016': 5, '\\lfloor': 6, '\\lceil': 7, '<': 0, '\\langle': 0 };
      const sel = selMap[node.l] !== undefined ? selMap[node.l] : 1;
      const variation = (node.l ? 1 : 0) | (node.r ? 2 : 0);
      const subs = [writeSlot(node.inner)];
      const delimCode = d => d === '\\{' ? 123 : d === '\\}' ? 125 : d === '\\lfloor' ? 0x230A : d === '\\rfloor' ? 0x230B :
                              d === '\\lceil' ? 0x2308 : d === '\\rceil' ? 0x2309 : d === '\\langle' ? 0x27E8 : d === '\\rangle' ? 0x27E9 :
                              d === '\\lvert' ? 0xEC07 : d === '\\rvert' ? 0xEC08 : d === '\\lVert' || d === '\\rVert' ? 0x2016 :
                              d === '|' ? 0x7C : d.codePointAt(0);
      // fence delimiter glyphs live in the MT Extra style (22) in real files
      if (node.l) subs.push(x => { x.u8(2); x.u8(0); x.sint(22); x.u16(delimCode(node.l)); });
      if (node.r) subs.push(x => { x.u8(2); x.u8(0); x.sint(22); x.u16(delimCode(node.r)); });
      writeTmpl(w, sel, variation, subs);
      return;
    }
    case 'bigop': writeBigOp(w, node, []); return;
    case 'pile': {
      w.u8(4); w.u8(0); w.u8(0); w.u8(0);
      for (const line of node.lines) writeLine(w, line);
      w.u8(0);
      return;
    }
    case 'matrix': {
      const rows = node.rows.length;
      const cols = rows ? node.rows[0].length : 0;
      w.u8(5); w.u8(0); w.u8(0); w.u8(0); w.u8(0);
      w.uint(rows); w.uint(cols);
      const ruleBytes = Math.floor((rows + 1 + 3) / 4) + Math.floor((cols + 1 + 3) / 4);
      for (let i = 0; i < ruleBytes; i++) w.u8(0);
      for (const row of node.rows) for (const cell of row) writeLine(w, cell);
      w.u8(0);
      return;
    }
    case 'acc': {
      const inner = node.inner;
      const single = inner && inner.t === 'seq' && inner.items.length === 1 && inner.items[0].t === 'char' ? inner.items[0] : null;
      const emb = EMBELL_FOR_ACCENT[node.kind];
      if (single && emb) {
        const ch = single.ch;
        w.u8(2); w.u8(0x01); w.sint(TF_VAR); w.u16(ch.codePointAt(0));
        w.u8(6); w.u8(0); w.u8(emb); w.u8(0);
        return;
      }
      if (node.kind === 'breve' || node.kind === 'check') {
        writeSeq(w, inner.items || []);
        w.u8(2); w.u8(0); w.sint(22); w.u16(node.kind === 'breve' ? 0x0306 : 0x030C);
        return;
      }
      const tmplSel = { hat: 33, widehat: 33, tilde: 32, widetilde: 32, overline: 13, underline: 12, vec: 31, overrightarrow: 31, overleftarrow: 31, overleftrightarrow: 31 }[node.kind];
      if (node.kind === 'overbrace' || node.kind === 'underbrace') {
        writeTmpl(w, 24, node.kind === 'overbrace' ? 1 : 0, [writeSlot(inner), writeNullLine]);
        return;
      }
      if (tmplSel) { writeTmpl(w, tmplSel, 0, [writeSlot(inner)]); return; }
      writeSeq(w, inner.items || []); return;
    }
    case 'boxed': writeTmpl(w, 37, 0, [writeSlot(node.inner)]); return;
    case 'cancel': writeTmpl(w, 36, 0, [writeSlot(node.inner)]); return;
  }
}
function writeBigOp(w, node, rest) {
  if (node.op === 'lim') {
    const mainFn = x => { x.u8(1); x.u8(0); for (const ch of 'lim') writeCharRecord(x, ch, { tf: TF_FUNC }); x.u8(0); };
    writeTmpl(w, 23, 16, [mainFn, x => x.u8(0x0B), node.sub ? writeSlot(node.sub) : writeNullLine, node.sup ? writeSlot(node.sup) : writeNullLine]);
    return;
  }
  const selMap = { sum: 16, prod: 17, coprod: 18, bigcup: 19, bigcap: 20 };
  let sel = selMap[node.op], variation = 0;
  if (node.op === 'int') { sel = 15; variation = 1; }
  if (node.op === 'iint') { sel = 15; variation = 2; }
  if (node.op === 'iiint') { sel = 15; variation = 3; }
  if (node.op === 'oint') { sel = 15; variation = 4; }
  const mainFn = x => writeLine(x, { t: 'seq', items: rest });
  if (node.op === 'int' && node.sup && node.sub) {
    // Real MathType integral with both limits: variation 113, script-size before the
    // upper limit, symbol-size + integral sign char at the end (verified vs a real file).
    writeTmpl(w, 15, 113, [mainFn, x => x.u8(0x0B), writeSlot(node.sup), writeSlot(node.sub), x => x.u8(0x0D), x => writeCharRecord(x, '\u222B', null)]);
    return;
  }
  const signMap = { sum: '\u2211', prod: '\u220F', coprod: '\u2210', bigcup: '\u22C3', bigcap: '\u22C2', int: '\u222B', iint: '\u222C', iiint: '\u222D', oint: '\u222E' };
  writeTmpl(w, sel, variation, [mainFn, x => x.u8(0x0B), node.sup ? writeSlot(node.sup) : writeNullLine, node.sub ? writeSlot(node.sub) : writeNullLine, x => x.u8(0x0D), x => writeCharRecord(x, signMap[node.op], null)]);
}
function latexToEquationNative(latex, warnings) {
  const ast = parseLatex(latex, warnings);
  const w = new ByteWriter();
  w.bytes(hexToBytes(MTEF_PREAMBLE_HEX));
  writeLine(w, ast);
  w.u8(0);
  const mtef = w.done();
  const en = new Uint8Array(28 + mtef.length);
  en[0] = 28; en[4] = 2; en[6] = 2;
  // offset 8 = MTEF length (verified against real files: len 201->0xC9, 251->0xFB, 236->0xEC)
  en[8] = mtef.length & 0xFF; en[9] = (mtef.length >> 8) & 0xFF; en[10] = (mtef.length >> 16) & 0xFF; en[11] = (mtef.length >> 24) & 0xFF;
  en.set(mtef, 28);
  return en;
}

/* ================= CFB (OLE2) writer ================= */
function cfbWrite(streams) {
  const SEC = 512, MINI = 64, END = -2, FREE = -1;
  // mini stream: each stream starts on a 64-byte boundary
  let miniLen = 0;
  const meta = streams.map(s => {
    const start = miniLen / MINI;
    const padded = Math.ceil(Math.max(s.data.length, 1) / MINI) * MINI;
    miniLen += padded;
    return { name: s.name, data: s.data, start, padded };
  });
  const miniStream = new Uint8Array(miniLen);
  meta.forEach(m => miniStream.set(m.data, m.start * MINI));
  const nMiniSecs = miniLen / MINI;
  const nMiniStreamSecs = Math.ceil(miniLen / SEC) || 1;
  const nEntries = streams.length + 1;
  const nDirSecs = Math.ceil(nEntries * 128 / SEC);
  const nMiniFatSecs = Math.ceil(nMiniSecs / (SEC / 4)) || 1;
  // sector layout: [ministream][directory][minifat][fat...]
  const dirStart = nMiniStreamSecs;
  const miniFatStart = dirStart + nDirSecs;
  const fatStart = miniFatStart + nMiniFatSecs;
  let nFatSecs = 1;
  let total = fatStart + nFatSecs;
  while (Math.ceil(total / (SEC / 4)) > nFatSecs) { nFatSecs++; total = fatStart + nFatSecs; }
  const fat = new Int32Array(total).fill(FREE);
  const chainSet = (start, count) => { for (let i = 0; i < count; i++) fat[start + i] = (i === count - 1) ? END : start + i + 1; };
  chainSet(0, nMiniStreamSecs); chainSet(dirStart, nDirSecs); chainSet(miniFatStart, nMiniFatSecs); chainSet(fatStart, nFatSecs);
  const out = new Uint8Array((total + 1) * SEC);
  const dv = new DataView(out.buffer);
  // header
  out.set([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], 0);
  dv.setUint16(24, 0x003E, true); dv.setUint16(26, 0x0003, true); dv.setUint16(28, 0xFFFE, true);
  dv.setUint16(30, 9, true); dv.setUint16(32, 6, true);
  dv.setUint32(40, 0, true); dv.setUint32(44, nFatSecs, true); dv.setUint32(48, dirStart, true);
  dv.setUint32(52, 0, true); dv.setUint32(56, 4096, true);
  dv.setUint32(60, miniFatStart, true); dv.setUint32(64, nMiniFatSecs, true);
  dv.setUint32(68, END, true); dv.setUint32(72, 0, true);
  for (let i = 0; i < 109; i++) dv.setInt32(76 + i * 4, i < nFatSecs ? fatStart + i : FREE, true);
  const secOff = sid => (sid + 1) * SEC;
  out.set(miniStream.subarray(0, nMiniStreamSecs * SEC), secOff(0));
  // directory
  const dirOff = secOff(dirStart);
  const writeEntry = (idx, name, type, start, size, left, right, child, color) => {
    const off = dirOff + idx * 128;
    for (let i = 0; i < name.length; i++) dv.setUint16(off + i * 2, name.charCodeAt(i), true);
    dv.setUint16(off + (name.length) * 2, 0, true);
    dv.setUint16(off + 64, (name.length + 1) * 2, true);
    out[off + 66] = type; out[off + 67] = color;
    dv.setInt32(off + 68, left, true); dv.setInt32(off + 72, right, true); dv.setInt32(off + 76, child, true);
    dv.setInt32(off + 116, start, true); dv.setUint32(off + 120, size, true); dv.setUint32(off + 124, 0, true);
  };
  // Root Entry must carry the MathType class CLSID, or Word cannot associate
  // the object with the MathType server (found via user test 2026-10-22:
  // zero CLSID -> Word shows dead picture boxes, MathType never engages).
  const clsidOff = dirOff + 80;
  out.set([0x03, 0xCE, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46], clsidOff);
  // The directory MUST be a name-sorted binary tree (MS-CFB): readers such as
  // Windows Ole32 locate streams by walking this tree with the standard
  // comparator (name length first, then case-insensitive name). A linear
  // chain in insertion order makes some streams unfindable - olefile-style
  // linear readers still work, which is why this defect hid until a real
  // Windows double-click test (2026-10-22: object never activated).
  const nameCmp = (a, b) => {
    if (a.length !== b.length) return a.length - b.length;
    const ua = a.toUpperCase(), ub = b.toUpperCase();
    return ua < ub ? -1 : ua > ub ? 1 : 0;
  };
  const dirEntries = meta.map((m, i) => ({ sid: i + 1, name: m.name, m, left: -1, right: -1 }));
  const sorted = [...dirEntries].sort((x, y) => nameCmp(x.name, y.name));
  const buildTree = (lo, hi) => {
    if (lo > hi) return -1;
    const mid = (lo + hi) >> 1;
    const node = sorted[mid];
    node.left = buildTree(lo, mid - 1);
    node.right = buildTree(mid + 1, hi);
    return node.sid;
  };
  const treeRoot = buildTree(0, sorted.length - 1);
  writeEntry(0, 'Root Entry', 5, 0, miniLen, -1, -1, treeRoot, 0);
  dirEntries.forEach(e => writeEntry(e.sid, e.name, 2, e.m.start, e.m.data.length, e.left, e.right, -1, 1));
  // minifat
  const mfOff = secOff(miniFatStart);
  for (let i = 0; i < nMiniFatSecs * (SEC / 4); i++) dv.setInt32(mfOff + i * 4, FREE, true);
  meta.forEach(m => {
    const n = m.padded / MINI;
    for (let i = 0; i < n; i++) dv.setInt32(mfOff + (m.start + i) * 4, i === n - 1 ? END : m.start + i + 1, true);
  });
  // fat
  const fatOff = secOff(fatStart);
  for (let i = 0; i < total; i++) dv.setInt32(fatOff + i * 4, fat[i], true);
  return out;
}
function makeMathTypeOle(equationNative) {
  return cfbWrite([
    { name: '\u0001Ole', data: new Uint8Array([1, 0, 0, 2, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) },
    { name: '\u0001CompObj', data: hexToBytes(COMPOBJ_HEX) },
    { name: '\u0003ObjInfo', data: new Uint8Array([0, 0, 3, 0, 4, 0]) },
    { name: 'Equation Native', data: equationNative }
  ]);
}

/* ================= LaTeX-in-text -> Equation / MathType ================= */
// Display segments that span several lines (matrix blocks, cases, ...) are
// invisible to per-line processing, so line-based workflows lift them out
// first and leave a one-line placeholder behind (user report 2026-10-23:
// pasted matrix blocks stayed literal text in preview, copy and downloads).
function extractMultilineDisplay(text) {
  const segs = findLatexSegments(text);
  const multi = segs.filter(s => s.display && text.slice(s.start, s.end).includes('\n'));
  if (!multi.length) return { text, blocks: new Map() };
  const blocks = new Map();
  let out = '', pos = 0;
  multi.forEach((s, i) => {
    const key = '\u0001SEG' + i + '\u0002';
    blocks.set(key, s);
    out += text.slice(pos, s.start) + '\n' + key + '\n';
    pos = s.end;
  });
  out += text.slice(pos);
  return { text: out, blocks };
}
function findLatexSegments(text) {
  const segs = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '\\' && text[i + 1] === '$') { i += 2; continue; }
    if (text.startsWith('$$', i)) {
      const j = text.indexOf('$$', i + 2);
      if (j > i + 1) { segs.push({ start: i, end: j + 2, latex: text.slice(i + 2, j), display: true }); i = j + 2; continue; }
    }
    if (text[i] === '$') {
      let j = i + 1;
      while (j < text.length && !(text[j] === '$' && text[j - 1] !== '\\')) j++;
      if (j < text.length && j > i + 1) { segs.push({ start: i, end: j + 1, latex: text.slice(i + 1, j), display: false }); i = j + 1; continue; }
    }
    if (text.startsWith('\\(', i)) {
      const j = text.indexOf('\\)', i + 2);
      if (j > i + 1) { segs.push({ start: i, end: j + 2, latex: text.slice(i + 2, j), display: false }); i = j + 2; continue; }
    }
    if (text.startsWith('\\[', i)) {
      const j = text.indexOf('\\]', i + 2);
      if (j > i + 1) { segs.push({ start: i, end: j + 2, latex: text.slice(i + 2, j), display: true }); i = j + 2; continue; }
    }
    i++;
  }
  return segs;
}
const SHAPETYPE_XML = '<v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75" o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f"><v:stroke joinstyle="miter"/><v:formulas><v:f eqn="if lineDrawn pixelLineWidth 0"/><v:f eqn="sum @0 1 0"/><v:f eqn="sum 0 0 @1"/><v:f eqn="prod @2 1 2"/><v:f eqn="prod @3 21600 pixelWidth"/><v:f eqn="prod @3 21600 pixelHeight"/><v:f eqn="sum @0 0 1"/><v:f eqn="prod @6 1 2"/><v:f eqn="prod @7 21600 pixelWidth"/><v:f eqn="sum @8 21600 0"/><v:f eqn="prod @7 21600 pixelHeight"/><v:f eqn="sum @10 21600 0"/></v:formulas><v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/><o:lock v:ext="edit" aspectratio="t"/></v:shapetype>';
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='; // verified 1x1 RGBA(0,0,0,0)
function tinyPng() {
  const bin = typeof atob !== 'undefined' ? atob(TINY_PNG_B64) : Buffer.from(TINY_PNG_B64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function buildObjectXml(o) {
  const dxa = Math.round(o.wPt * 20), dya = Math.round(o.hPt * 20);
  return '<w:object w:dxaOrig="' + dxa + '" w:dyaOrig="' + dya + '">' + SHAPETYPE_XML +
    '<v:shape id="_x0000_i' + o.shapeId + '" type="#_x0000_t75" style="width:' + o.wPt.toFixed(1) + 'pt;height:' + o.hPt.toFixed(1) + 'pt" o:ole=""><v:imagedata r:id="' + o.imgRid + '" o:title=""/></v:shape>' +
    '<o:OLEObject Type="Embed" ProgID="Equation.DSMT4" ShapeID="_x0000_i' + o.shapeId + '" DrawAspect="Content" ObjectID="_' + o.objectId + '" r:id="' + o.oleRid + '"/></w:object>';
}
class PartAllocator {
  constructor(docXml, relsXml) {
    this.maxRid = 0;
    for (const m of (relsXml || '').matchAll(/Id="rId(\d+)"/g)) this.maxRid = Math.max(this.maxRid, parseInt(m[1], 10));
    this.maxOle = 0; this.maxImg = 0; this.maxShape = 1024;
    for (const m of (relsXml || '').matchAll(/oleObject(\d+)\.bin/g)) this.maxOle = Math.max(this.maxOle, parseInt(m[1], 10));
    for (const m of (relsXml || '').matchAll(/image(\d+)\./g)) this.maxImg = Math.max(this.maxImg, parseInt(m[1], 10));
    for (const m of (docXml || '').matchAll(/_x0000_i(\d+)/g)) this.maxShape = Math.max(this.maxShape, parseInt(m[1], 10));
    this.newRels = []; this.newParts = [];
  }
  addMathType(latex, preview, warnings) {
    // Formulas placed as MathType objects show at the preview picture's size,
    // which reads slightly larger than the surrounding text (user report
    // 2026-10-23); the OMML/Equation path sizes itself from the text font
    // and needs no change. Trim only the placed size (picture extents and
    // the matching baseline descent); the MTEF content itself is untouched,
    // so opening/editing in MathType is unaffected.
    const MT_SIZE_SCALE = 0.88;
    const pv0 = preview && (preview.png || preview.wPt)
      ? { png: preview.png || tinyPng(), wPt: preview.wPt || Math.max(14, latex.length * 5.5), hPt: preview.hPt || 15, descentPt: preview.descentPt || 0 }
      : { png: tinyPng(), wPt: Math.min(380, Math.max(14, latex.length * 5.5)), hPt: 15, descentPt: 0 };
    const pv = { png: pv0.png, wPt: pv0.wPt * MT_SIZE_SCALE, hPt: pv0.hPt * MT_SIZE_SCALE, descentPt: pv0.descentPt * MT_SIZE_SCALE };
    const oleIdx = ++this.maxOle, imgIdx = ++this.maxImg;
    const imgRid = 'rId' + (++this.maxRid), oleRid = 'rId' + (++this.maxRid);
    const shapeId = ++this.maxShape;
    const objectId = String(1800000000 + Math.floor(Math.random() * 99999999));
    const en = latexToEquationNative(latex, warnings);
    this.newParts.push({ path: 'word/embeddings/oleObject' + oleIdx + '.bin', data: makeMathTypeOle(en) });
    this.newParts.push({ path: 'word/media/image' + imgIdx + '.png', data: pv.png });
    this.newRels.push('<Relationship Id="' + imgRid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image' + imgIdx + '.png"/>');
    this.newRels.push('<Relationship Id="' + oleRid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="embeddings/oleObject' + oleIdx + '.bin"/>');
    return { xml: buildObjectXml({ imgRid, oleRid, shapeId, objectId, wPt: pv.wPt, hPt: pv.hPt }), descentPt: pv.descentPt };
  }
}
const REL_TYPE_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
async function equationXmlFor(latex, display, opts, alloc) {
  if (opts.mode === 'mathtype') {
    let preview = null;
    if (opts.previewFor) preview = await opts.previewFor(latex, display);
    const obj = alloc.addMathType(latex, preview, opts.warnings);
    // Real MathType runs carry a negative w:position equal to the formula's
    // descent, so the math baseline lands on the text baseline instead of
    // the picture's bottom edge (user screenshot 2026-10-22: formulas floated).
    const rPr = obj.descentPt > 0.4 ? '<w:rPr><w:position w:val="' + (-Math.round(obj.descentPt * 2)) + '"/></w:rPr>' : '';
    return '<w:r>' + rPr + obj.xml + '</w:r>';
  }
  const mml = opts.latexToMathml(latex);
  return mathmlToOmml(mml, { sz: opts.fontSize || 24 });
}
async function textToDocx(text, opts, JSZipLib) {
  const warnings = [];
  opts = Object.assign({}, opts, { warnings });
  const alloc = new PartAllocator('', '');
  alloc.maxRid = 1; // rId1 is reserved for the styles relationship below
  const paras = [];
  let converted = 0;
  // In pasted exam text a literal "\\" at a line end is a line-break marker,
  // not content: turn it into a real <w:br/> instead of printing backslashes
  // into the Word file (user report 2026-10-22).
  const textRun = t => {
    if (!t) return '';
    const parts = t.split('\\\\');
    const runs = [];
    parts.forEach((p, i) => {
      if (i > 0) runs.push('<w:r><w:br/></w:r>');
      if (p) runs.push('<w:r><w:t xml:space="preserve">' + xmlEscape(p) + '</w:t></w:r>');
    });
    return runs.join('');
  };
  const extDoc = extractMultilineDisplay(String(text));
  for (const rawLine of extDoc.text.split(/\r?\n/)) {
    const phSeg = extDoc.blocks.get(rawLine.trim());
    if (phSeg) {
      const eq = await equationXmlFor(phSeg.latex, true, opts, alloc); converted++;
      paras.push('<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' + eq + '</w:p>');
      continue;
    }
    const segs = findLatexSegments(rawLine);
    if (!segs.length) { paras.push('<w:p>' + textRun(rawLine) + '</w:p>'); continue; }
    if (segs.length === 1 && segs[0].display && rawLine.slice(0, segs[0].start).trim() === '' && rawLine.slice(segs[0].end).trim() === '') {
      const eq = await equationXmlFor(segs[0].latex, true, opts, alloc); converted++;
      paras.push('<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' + eq + '</w:p>');
      continue;
    }
    let inner = '', last = 0;
    for (const s of segs) {
      inner += textRun(rawLine.slice(last, s.start).replace(/\\\$/g, '$'));
      inner += await equationXmlFor(s.latex, s.display, opts, alloc); converted++;
      last = s.end;
    }
    inner += textRun(rawLine.slice(last).replace(/\\\$/g, '$'));
    paras.push('<w:p>' + inner + '</w:p>');
  }
  const docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>' +
    paras.join('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="' + REL_TYPE_DOC.replace('officeDocument', 'styles') + '" Target="styles.xml"/>' + alloc.newRels.join('') + '</Relationships>';
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>';
  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="' + REL_TYPE_DOC + '" Target="word/document.xml"/></Relationships>';
  const zip = new JSZipLib();
  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels').file('.rels', rootRels);
  zip.folder('word').file('document.xml', docXml);
  zip.folder('word').file('styles.xml', stylesXml);
  zip.folder('word/_rels').file('document.xml.rels', relsXml);
  for (const p of alloc.newParts) zip.file(p.path, p.data);
  const isNode = typeof window === 'undefined';
  const data = await zip.generateAsync({ type: isNode ? 'uint8array' : 'blob', compression: 'DEFLATE' });
  return { data, converted, warnings };
}
async function convertDocxLatex(state, opts) {
  const warnings = [];
  opts = Object.assign({}, opts, { warnings, fontSize: state.fontSize });
  const alloc = new PartAllocator(state.docXml, state.relsXml || '');
  let docXml = state.docXml;
  if (!/xmlns:v=/.test(docXml.slice(0, docXml.indexOf('>') + 2000))) {
    // MathType objects need VML/Office namespaces on the root element
    const idx = docXml.indexOf('>', docXml.indexOf('<w:document'));
    docXml = docXml.slice(0, idx) + ' xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"' + docXml.slice(idx);
  }
  const paraRe = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  const matches = [...docXml.matchAll(paraRe)];
  const replacements = new Map();
  let converted = 0, parasTouched = 0;
  const consumedParas = new Set();
  let mi = 0;
  while (mi < matches.length) {
    const m = matches[mi];
    const para = m[0];
    const texts = [...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(x => decodeEntities(x[1]));
    const plain = texts.join('');
    if (!plain.includes('$') && !plain.includes('\\(') && !plain.includes('\\[')) { mi++; continue; }
    let segs = findLatexSegments(plain);
    // A display segment may span several Word paragraphs (a pasted matrix
    // block becomes one paragraph per line): accumulate following
    // paragraphs until the segment closes, then convert the joined unit.
    let joined = plain, mj = mi;
    const unclosedDisp = t => ((t.match(/\$\$/g) || []).length % 2 === 1) || ((t.split('\\[').length - 1) > (t.split('\\]').length - 1));
    while (mj + 1 < matches.length && !segs.some(s => s.display) && unclosedDisp(joined)) {
      mj++;
      const pj = matches[mj][0];
      const tj = [...pj.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(x => decodeEntities(x[1]));
      joined += '\n' + tj.join('');
      segs = findLatexSegments(joined);
    }
    if (!segs.length) { mi++; continue; }
    parasTouched++;
    const openTag = para.match(/^<w:p\b[^>]*>/)[0];
    const pPrM = para.match(/^<w:p\b[^>]*>(<w:pPr>[\s\S]*?<\/w:pPr>)?/);
    const pPr = pPrM && pPrM[1] ? pPrM[1] : '';
    const rPrM = para.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
    const rPr = rPrM ? rPrM[0] : ('<w:rPr><w:sz w:val="' + state.fontSize + '"/><w:szCs w:val="' + state.fontSize + '"/></w:rPr>');
    const textRun = t => t ? '<w:r>' + rPr + '<w:t xml:space="preserve">' + xmlEscape(t) + '</w:t></w:r>' : '';
    if (mj > mi) {
      const extBlk = extractMultilineDisplay(joined);
      const outParas = [];
      let firstPara = true;
      for (const rawLine of extBlk.text.split(/\r?\n/)) {
        const phSeg = extBlk.blocks.get(rawLine.trim());
        if (phSeg) {
          const eq = await equationXmlFor(phSeg.latex, true, opts, alloc); converted++;
          outParas.push(openTag + '<w:pPr><w:jc w:val="center"/></w:pPr>' + eq + '</w:p>');
          firstPara = false;
          continue;
        }
        const lsegs = findLatexSegments(rawLine);
        let innerB = '', lastB = 0;
        for (const s of lsegs) {
          innerB += textRun(rawLine.slice(lastB, s.start).replace(/\\\$/g, '$'));
          innerB += await equationXmlFor(s.latex, s.display, opts, alloc);
          converted++;
          lastB = s.end;
        }
        innerB += textRun(rawLine.slice(lastB).replace(/\\\$/g, '$'));
        outParas.push(openTag + (firstPara ? pPr : '') + innerB + '</w:p>');
        firstPara = false;
      }
      const endIdx = matches[mj].index + matches[mj][0].length;
      replacements.set(m.index, { len: endIdx - m.index, xml: outParas.join('') });
      for (let k = mi + 1; k <= mj; k++) consumedParas.add(matches[k].index);
      mi = mj + 1;
      continue;
    }
    let inner = '', last = 0;
    for (const s of segs) {
      inner += textRun(plain.slice(last, s.start).replace(/\\\$/g, '$'));
      inner += await equationXmlFor(s.latex, s.display, opts, alloc);
      converted++;
      last = s.end;
    }
    inner += textRun(plain.slice(last).replace(/\\\$/g, '$'));
    replacements.set(m.index, { len: para.length, xml: openTag + pPr + inner + '</w:p>' });
    mi++;
  }
  let out = '', lastIdx = 0;
  for (const m of matches) {
    if (consumedParas.has(m.index)) { out += docXml.slice(lastIdx, m.index); lastIdx = m.index + m[0].length; continue; }
    const rep = replacements.get(m.index);
    if (!rep) continue;
    out += docXml.slice(lastIdx, m.index) + rep.xml;
    lastIdx = m.index + rep.len;
  }
  out += docXml.slice(lastIdx);
  // write back: document, rels, content types, new parts
  state.zip.file('word/document.xml', out);
  if (alloc.newRels.length) {
    let relsXml = state.relsXml || '';
    relsXml = relsXml.replace('</Relationships>', alloc.newRels.join('') + '</Relationships>');
    state.zip.file('word/_rels/document.xml.rels', relsXml);
    for (const p of alloc.newParts) state.zip.file(p.path, p.data);
    let ct = state.contentTypesXml || '';
    if (ct && !/Extension="bin"/.test(ct)) ct = ct.replace('</Types>', '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/></Types>');
    if (ct && !/Extension="png"/.test(ct)) ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
    if (ct) state.zip.file('[Content_Types].xml', ct);
  }
  const isNode = typeof window === 'undefined';
  const data = await state.zip.generateAsync({ type: isNode ? 'uint8array' : 'blob', compression: 'DEFLATE' });
  return { data, converted, parasTouched, warnings };
}

/* ================= Markdown -> Equation / MathType ================= */
// Markdown carries the same LaTeX math as the plain-text flow ($...$,
// $$...$$, \(...\), \[...\]); the parser turns a Markdown document into
// block objects whose inline content is node lists ({s,b,i,st,code} text
// runs, {math,display} formulas, {link,children}) so the .docx writer
// here and the app's preview / clipboard renderers walk one structure.
function mdParseEmphasis(s, flags, out) {
  let buf = '';
  const flush = () => {
    if (buf) { out.push({ s: buf, b: !!flags.b, i: !!flags.i, st: !!flags.st, code: false }); buf = ''; }
  };
  const wordChar = ch => !!ch && /[0-9A-Za-zÀ-ỹ]/.test(ch);
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && '$`*_~[]\\'.indexOf(s[i + 1]) >= 0) { buf += s[i + 1]; i += 2; continue; }
    if (c === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) { flush(); out.push({ s: s.slice(i + 1, j), b: !!flags.b, i: !!flags.i, st: !!flags.st, code: true }); i = j + 1; continue; }
    }
    if (c === '!' && s[i + 1] === '[') {
      const m = /^!\[([^\]]*)\]\([^)]*\)/.exec(s.slice(i));
      if (m) { buf += m[1]; i += m[0].length; continue; }
    }
    if (c === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(s.slice(i));
      if (m) {
        flush();
        const kids = [];
        mdParseEmphasis(m[1], flags, kids);
        out.push({ link: m[2], children: kids });
        i += m[0].length; continue;
      }
    }
    const tri = s.slice(i, i + 3), duo = s.slice(i, i + 2);
    if (tri === '***' || tri === '___') {
      const j = s.indexOf(tri, i + 3);
      if (j > i + 3) { flush(); mdParseEmphasis(s.slice(i + 3, j), Object.assign({}, flags, { b: true, i: true }), out); i = j + 3; continue; }
    }
    if (duo === '**' || duo === '__') {
      if (duo === '__' && wordChar(s[i - 1])) { buf += duo; i += 2; continue; }
      const j = s.indexOf(duo, i + 2);
      if (j > i + 2) { flush(); mdParseEmphasis(s.slice(i + 2, j), Object.assign({}, flags, { b: true }), out); i = j + 2; continue; }
    }
    if (duo === '~~') {
      const j = s.indexOf('~~', i + 2);
      if (j > i + 2) { flush(); mdParseEmphasis(s.slice(i + 2, j), Object.assign({}, flags, { st: true }), out); i = j + 2; continue; }
    }
    if (c === '*' || c === '_') {
      if (c === '_' && wordChar(s[i - 1])) { buf += c; i++; continue; }
      let j = i + 1;
      while (j < s.length && !(s[j] === c && s[j + 1] !== c && s[j - 1] !== c)) j++;
      if (j < s.length && j > i + 1 && s[j - 1] !== ' ' && (c === '*' || !wordChar(s[j + 1]))) {
        flush(); mdParseEmphasis(s.slice(i + 1, j), Object.assign({}, flags, { i: true }), out); i = j + 1; continue;
      }
    }
    buf += c; i++;
  }
  flush();
}
function mdInlineNodes(text) {
  const segs = findLatexSegments(text);
  const nodes = [];
  let pos = 0;
  for (const sg of segs) {
    if (sg.start > pos) mdParseEmphasis(text.slice(pos, sg.start).replace(/\\\$/g, '$'), {}, nodes);
    nodes.push({ math: sg.latex, display: !!sg.display });
    pos = sg.end;
  }
  if (pos < text.length) mdParseEmphasis(text.slice(pos).replace(/\\\$/g, '$'), {}, nodes);
  return nodes;
}
function parseMarkdown(text) {
  const ext = extractMultilineDisplay(String(text));
  const lines = ext.text.split(/\r?\n/);
  const blocks = [];
  const isBlank = l => !l.trim();
  const headingRe = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
  const hrRe = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const listRe = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
  const fenceRe = /^\s*(```+|~~~+)/;
  function splitRow(l) {
    let t = l.trim();
    if (t.charAt(0) === '|') t = t.slice(1);
    if (t.charAt(t.length - 1) === '|' && t.charAt(t.length - 2) !== '\\') t = t.slice(0, -1);
    return t.split('|').map(c => c.replace(/\\\|/g, '|').trim());
  }
  function isSepRow(l) {
    if (l.indexOf('-') < 0) return false;
    const cells = splitRow(l);
    return cells.length >= 1 && cells.every(c => /^:?-{1,}:?$/.test(c));
  }
  function startsBlock(l, nextL) {
    return fenceRe.test(l) || headingRe.test(l) || hrRe.test(l) || listRe.test(l) ||
      /^\s*>/.test(l) || !!ext.blocks.get(l.trim()) ||
      (l.indexOf('|') >= 0 && nextL !== undefined && isSepRow(nextL));
  }
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const ph = ext.blocks.get(line.trim());
    if (ph) { blocks.push({ type: 'display', latex: ph.latex }); i++; continue; }
    const fm = fenceRe.exec(line);
    if (fm) {
      const closeRe = fm[1].charAt(0) === '`' ? /^\s*```/ : /^\s*~~~/;
      const body = [];
      i++;
      while (i < lines.length && !closeRe.test(lines[i])) { body.push(lines[i]); i++; }
      if (i < lines.length) i++;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    const hm = headingRe.exec(line);
    if (hm) { blocks.push({ type: 'heading', level: hm[1].length, nodes: mdInlineNodes(hm[2]) }); i++; continue; }
    if (hrRe.test(line)) { blocks.push({ type: 'hr' }); i++; continue; }
    if (line.indexOf('|') >= 0 && i + 1 < lines.length && isSepRow(lines[i + 1])) {
      const headerCells = splitRow(line);
      const sepCells = splitRow(lines[i + 1]);
      const aligns = sepCells.map(c => c.charAt(0) === ':' && c.charAt(c.length - 1) === ':' ? 'center' : (c.charAt(c.length - 1) === ':' ? 'right' : 'left'));
      const ncol = Math.max(headerCells.length, sepCells.length);
      while (aligns.length < ncol) aligns.push('left');
      i += 2;
      const rows = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].indexOf('|') >= 0) { rows.push(splitRow(lines[i])); i++; }
      const pad = arr => { const a = arr.slice(0, ncol); while (a.length < ncol) a.push(''); return a; };
      blocks.push({ type: 'table', aligns, header: pad(headerCells).map(mdInlineNodes), rows: rows.map(r => pad(r).map(mdInlineNodes)) });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const parts = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { parts.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      blocks.push({ type: 'quote', nodes: mdInlineNodes(parts.join(' ')) });
      continue;
    }
    if (listRe.test(line)) {
      const items = [];
      let ordered = false, first = true;
      while (i < lines.length) {
        const m2 = listRe.exec(lines[i]);
        if (m2) {
          if (first) { ordered = /\d/.test(m2[2]); first = false; }
          let txt = m2[3];
          let task = null;
          const tm = /^\[([ xX])\]\s+(.*)$/.exec(txt);
          if (tm) { task = tm[1].toLowerCase() === 'x'; txt = tm[2]; }
          items.push({ level: Math.min(2, Math.floor(m2[1].replace(/\t/g, '    ').length / 2)), text: txt, task });
          i++;
        } else if (!isBlank(lines[i]) && items.length && !startsBlock(lines[i], lines[i + 1])) {
          items[items.length - 1].text += ' ' + lines[i].trim();
          i++;
        } else break;
      }
      blocks.push({ type: 'list', ordered, items: items.map(it => ({ level: it.level, task: it.task, nodes: mdInlineNodes(it.text) })) });
      continue;
    }
    const parts = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i], lines[i + 1])) { parts.push(lines[i].trim()); i++; }
    const joined = parts.join(' ');
    const segs = findLatexSegments(joined);
    if (segs.length === 1 && segs[0].display && joined.slice(0, segs[0].start).trim() === '' && joined.slice(segs[0].end).trim() === '') {
      blocks.push({ type: 'display', latex: segs[0].latex });
    } else {
      blocks.push({ type: 'para', nodes: mdInlineNodes(joined) });
    }
  }
  return blocks;
}
async function markdownToDocx(mdText, opts, JSZipLib) {
  const warnings = [];
  opts = Object.assign({}, opts, { warnings });
  const alloc = new PartAllocator('', '');
  alloc.maxRid = 2; // rId1 styles, rId2 numbering (reserved below)
  const blocks = parseMarkdown(mdText);
  const nums = [];
  let converted = 0;
  const DBL_BS = String.fromCharCode(92, 92);
  function runPr(n, base) {
    let rPr = '';
    if (n.code) rPr += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>';
    if (n.b || (base && base.b)) rPr += '<w:b/>';
    if (n.i || (base && base.i)) rPr += '<w:i/>';
    if (n.st || (base && base.st)) rPr += '<w:strike/>';
    if (n.code) rPr += '<w:sz w:val="21"/><w:szCs w:val="21"/>';
    if (base && base.linkStyle) rPr += '<w:color w:val="0563C1"/><w:u w:val="single"/>';
    return rPr;
  }
  function textRun(n, base) {
    const rPr = runPr(n, base);
    const open = '<w:r>' + (rPr ? '<w:rPr>' + rPr + '</w:rPr>' : '');
    let out = '';
    String(n.s).split(DBL_BS).forEach((p, idx) => {
      if (idx > 0) out += open + '<w:br/></w:r>';
      if (p) out += open + '<w:t xml:space="preserve">' + xmlEscape(p) + '</w:t></w:r>';
    });
    return out;
  }
  async function runsXml(nodes, base) {
    let xml = '';
    for (const n of nodes || []) {
      if (n.math != null) { xml += await equationXmlFor(n.math, n.display, opts, alloc); converted++; }
      else if (n.link != null) {
        const inner = await runsXml(n.children, Object.assign({}, base, { linkStyle: true }));
        if (/^(https?:\/\/|mailto:)/i.test(n.link)) {
          const rid = 'rId' + (++alloc.maxRid);
          alloc.newRels.push('<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + xmlEscape(n.link).replace(/"/g, '%22') + '" TargetMode="External"/>');
          xml += '<w:hyperlink r:id="' + rid + '">' + inner + '</w:hyperlink>';
        } else xml += inner;
      } else xml += textRun(n, base);
    }
    return xml;
  }
  const paras = [];
  for (const b of blocks) {
    if (b.type === 'heading') {
      paras.push('<w:p><w:pPr><w:pStyle w:val="Heading' + b.level + '"/></w:pPr>' + await runsXml(b.nodes) + '</w:p>');
    } else if (b.type === 'display') {
      paras.push('<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="120"/></w:pPr>' + await equationXmlFor(b.latex, true, opts, alloc) + '</w:p>');
      converted++;
    } else if (b.type === 'para') {
      paras.push('<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>' + await runsXml(b.nodes) + '</w:p>');
    } else if (b.type === 'quote') {
      paras.push('<w:p><w:pPr><w:ind w:left="720"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="9C2B1E"/></w:pBdr><w:spacing w:after="120"/></w:pPr>' + await runsXml(b.nodes, { i: true }) + '</w:p>');
    } else if (b.type === 'hr') {
      paras.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="C9C4BA"/></w:pBdr><w:spacing w:before="120" w:after="120"/></w:pPr></w:p>');
    } else if (b.type === 'code') {
      const codeLines = b.text.split('\n');
      for (let ci = 0; ci < codeLines.length; ci++) {
        paras.push('<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F1EC"/><w:ind w:left="360"/>' +
          '<w:spacing w:before="' + (ci === 0 ? 120 : 0) + '" w:after="' + (ci === codeLines.length - 1 ? 120 : 0) + '"/></w:pPr>' +
          (codeLines[ci] ? textRun({ s: codeLines[ci], code: true }) : '') + '</w:p>');
      }
    } else if (b.type === 'list') {
      const numId = nums.length + 1;
      nums.push({ numId, abs: b.ordered ? 1 : 0 });
      for (const it of b.items) {
        const runs = await runsXml(it.nodes);
        const pre = it.task != null ? textRun({ s: it.task ? '☑ ' : '☐ ' }) : '';
        paras.push('<w:p><w:pPr><w:numPr><w:ilvl w:val="' + it.level + '"/><w:numId w:val="' + numId + '"/></w:numPr><w:spacing w:after="60"/></w:pPr>' + pre + runs + '</w:p>');
      }
    } else if (b.type === 'table') {
      const ncol = b.header.length;
      const borders = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(x => '<w:' + x + ' w:val="single" w:sz="4" w:space="0" w:color="C9C4BA"/>').join('') + '</w:tblBorders>';
      const cellXml = async (nodes, isHeader, align) => {
        const runs = await runsXml(nodes, isHeader ? { b: true } : null);
        return '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>' + (isHeader ? '<w:shd w:val="clear" w:color="auto" w:fill="F2E3DF"/>' : '') + '</w:tcPr>' +
          '<w:p><w:pPr>' + (align && align !== 'left' ? '<w:jc w:val="' + align + '"/>' : '') + '<w:spacing w:after="40"/></w:pPr>' + runs + '</w:p></w:tc>';
      };
      let tbl = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>' + borders + '<w:tblLayout w:type="autofit"/></w:tblPr>';
      tbl += '<w:tr><w:trPr><w:tblHeader/></w:trPr>';
      for (let c = 0; c < ncol; c++) tbl += await cellXml(b.header[c], true, b.aligns[c]);
      tbl += '</w:tr>';
      for (const row of b.rows) {
        tbl += '<w:tr>';
        for (let c = 0; c < ncol; c++) tbl += await cellXml(row[c], false, b.aligns[c]);
        tbl += '</w:tr>';
      }
      tbl += '</w:tbl>';
      paras.push(tbl);
      paras.push('<w:p/>');
    }
  }
  if (!paras.length) paras.push('<w:p/>');
  function mdLvl(ilvl, fmt, text, font, ind) {
    return '<w:lvl w:ilvl="' + ilvl + '" w:tplc="0409000F" w:tentative="1"><w:start w:val="1"/><w:numFmt w:val="' + fmt + '"/>' +
      '<w:lvlText w:val="' + text + '"/><w:lvlJc w:val="left"/>' +
      '<w:pPr><w:ind w:left="' + ind + '" w:hanging="360"/></w:pPr>' +
      (font ? '<w:rPr><w:rFonts w:ascii="' + font + '" w:hAnsi="' + font + '" w:hint="default"/></w:rPr>' : '') + '</w:lvl>';
  }
  const numberingXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
    mdLvl(0, 'bullet', '•', 'Symbol', 720) + mdLvl(1, 'bullet', '–', 'Courier New', 1440) + mdLvl(2, 'bullet', '·', 'Symbol', 2160) +
    '</w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' +
    mdLvl(0, 'decimal', '%1.', null, 720) + mdLvl(1, 'decimal', '%2.', null, 1440) + mdLvl(2, 'decimal', '%3.', null, 2160) +
    '</w:abstractNum>' +
    nums.map(n => '<w:num w:numId="' + n.numId + '"><w:abstractNumId w:val="' + n.abs + '"/></w:num>').join('') +
    '</w:numbering>';
  const docXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>' +
    paras.join('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    alloc.newRels.join('') + '</Relationships>';
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>';
  const headingStyles = [[1, 32, '7D2015', 360, false], [2, 28, '22252B', 300, false], [3, 26, '22252B', 240, false], [4, 24, '22252B', 200, true], [5, 24, '22252B', 200, false], [6, 24, '646B76', 200, true]]
    .map(h => '<w:style w:type="paragraph" w:styleId="Heading' + h[0] + '"><w:name w:val="heading ' + h[0] + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>' +
      '<w:pPr><w:keepNext/><w:spacing w:before="' + h[3] + '" w:after="100"/></w:pPr>' +
      '<w:rPr><w:b/>' + (h[4] ? '<w:i/>' : '') + '<w:color w:val="' + h[2] + '"/><w:sz w:val="' + h[1] + '"/><w:szCs w:val="' + h[1] + '"/></w:rPr></w:style>').join('');
  const stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' + headingStyles + '</w:styles>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="' + REL_TYPE_DOC + '" Target="word/document.xml"/></Relationships>';
  const zip = new JSZipLib();
  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels').file('.rels', rootRels);
  zip.folder('word').file('document.xml', docXml);
  zip.folder('word').file('styles.xml', stylesXml);
  zip.folder('word').file('numbering.xml', numberingXml);
  zip.folder('word/_rels').file('document.xml.rels', relsXml);
  for (const p of alloc.newParts) zip.file(p.path, p.data);
  const isNode = typeof window === 'undefined';
  const data = await zip.generateAsync({ type: isNode ? 'uint8array' : 'blob', compression: 'DEFLATE' });
  return { data, converted, warnings };
}

const MTCore = { cfbOpen, parseEquationNative, mtefToLatex, oleToLatex, mathmlToOmml, openDocx, exportDocx, exportLatexDocx, parseLatex, latexToEquationNative, cfbWrite, makeMathTypeOle, findLatexSegments, textToDocx, convertDocxLatex, parseMarkdown, markdownToDocx, MTEFError };
if (typeof module !== 'undefined' && module.exports) module.exports = MTCore;
global.MTCore = MTCore;
})(typeof window !== 'undefined' ? window : globalThis);
    