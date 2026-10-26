  /* =====================================================================
     TAB ĐỀ THI — module độc lập (ChdDeThi). Chỉ THÊM mới: không sửa MTCore,
     không sửa logic chuyển tab, không đụng 5 tab hiện có.
     Dữ liệu ĐỀ THI (mã kì thi, ma trận, câu hỏi, chương trình, mã đề đã trộn,
     tùy chọn tex) lưu trên MÁY CHỦ qua api/*.php, gắn với tài khoản Firebase
     đang đăng nhập. Chỉ key AI (chd_aicreator_keys) ở lại localStorage.
     ===================================================================== */
  (function () {
    'use strict';
    var $ = function (id) { return document.getElementById(id); };
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function clamp(n, a, b) { n = parseInt(n, 10); if (!isFinite(n)) n = a; return Math.max(a, Math.min(b, n)); }
    function noAccent(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
    function stamp() { var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; }; return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()); }
    function saveBlob(blob, name) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    }
    function saveText(text, name, mime) { saveBlob(new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' }), name); }
    function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
    function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* het cho / private mode: bo qua */ } }
    function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

    /* ---------------- Lớp API máy chủ (dữ liệu ĐỀ THI theo tài khoản) ----------------
       Mọi request kèm Firebase ID token; server (api/*.php) tự resolve user từ
       token và kiểm tra allowlist — client không gửi user_id. Khi API lỗi /
       không tới được: báo lỗi RÕ bằng banner, dữ liệu chỉ còn trong bộ nhớ
       phiên này (KHÔNG fallback localStorage) — hãy Xuất JSON để sao lưu. */
    var dtApiFailed = false;
    function dtApiBanner(show, msg) {
      var el = $('dtApiErr'); if (!el) return;
      if (msg) el.textContent = msg;
      el.hidden = !show;
    }
    function dtApiFail(e) {
      dtApiFailed = true;
      dtApiBanner(true, '⚠ Không lưu/nạp được dữ liệu ĐỀ THI từ máy chủ: ' + (e && e.message ? e.message : e) +
        ' Dữ liệu hiện chỉ có trong phiên làm việc này và sẽ mất khi tải lại trang — hãy dùng Xuất JSON (mục Ma trận / AI Creator) để sao lưu thủ công. Kiểm tra lại kết nối và chắc chắn thư mục api/ đã được triển khai đúng trên hosting.');
      if (window.console) console.warn('[DeThi API]', e);
    }
    function dtApiOk() { if (dtApiFailed) { dtApiFailed = false; dtApiBanner(false); } }
    function dtApi(method, path, body) {
      var tk = (window.ChdAuth && ChdAuth.getIdToken) ? ChdAuth.getIdToken() : Promise.reject(new Error('Chưa đăng nhập.'));
      return tk.then(function (token) {
        var opts = { method: method, headers: { 'Authorization': 'Bearer ' + token } };
        if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
        return fetch(path, opts);
      }).then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          if (!res.ok || !data || data.ok === false) throw new Error((data && data.error) || ('Máy chủ trả lỗi HTTP ' + res.status + ' tại ' + path));
          dtApiOk();
          return data;
        });
      });
    }
    function apiSaveExam(cfg) { if (cfg) dtApi('POST', 'https://hotrohoctap.com/1ai/chdmathtype/api/exams.php', { exam: cfg }).catch(dtApiFail); }
    function apiSaveMatrixFor(code, slots) { if (code) dtApi('POST', 'https://hotrohoctap.com/1ai/chdmathtype/api/matrix.php', { exam_code: code, slots: slots }).catch(dtApiFail); }
    function apiSaveQuestionsFor(code, qs) { if (code) dtApi('POST', 'https://hotrohoctap.com/1ai/chdmathtype/api/questions.php', { exam_code: code, questions: qs }).catch(dtApiFail); }
    function apiSaveShuffledFor(code, pool) { if (code) dtApi('POST', 'https://hotrohoctap.com/1ai/chdmathtype/api/shuffled.php', { exam_code: code, pool: pool }).catch(dtApiFail); }

    /* ---------------- Hằng số & dữ liệu mẫu (từ dự án cũ) ---------------- */
    var TYPES = ['MC', 'TF', 'SA', 'LA'];
    var TYPE_NAMES = {
      MC: 'TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN', TF: 'TRẮC NGHIỆM ĐÚNG SAI',
      SA: 'TRẢ LỜI NGẮN', LA: 'TỰ LUẬN'
    };
    var TYPE_TITLES = {
      MC: 'Trắc nghiệm nhiều phương án lựa chọn', TF: 'Trắc nghiệm đúng sai',
      SA: 'Trả lời ngắn', LA: 'Tự luận'
    };
    var LEVELS = ['Nhận biết', 'Thông hiểu', 'Vận dụng', 'Vận dụng cao'];
    var LEVEL_ALIAS = { nb: 0, nhan_biet: 0, biet: 0, th: 1, thong_hieu: 1, hieu: 1, vd: 2, van_dung: 2, vdc: 3, van_dung_cao: 3 };
    var COMPS = [
      ['TD', 'Tư duy và lập luận toán học'], ['MH', 'Mô hình hóa'], ['GQ', 'Giải quyết vấn đề'],
      ['GT', 'Giao tiếp toán học'], ['CC', 'Sử dụng công cụ và phương tiện học toán']
    ];
    var ROMAN = ['I', 'II', 'III', 'IV', 'V'];
    var GEM_URL = 'https://gemini.google.com/gem/1h7ZwL5CJkjN_lkHf3-VTjbkO1n95zwyo?usp=sharing';

    var SAMPLE_CURRICULUM = {
      mon: 'Toán học', lop: 'Lớp 12',
      chuong: [
        { ten: 'Chương I. Ứng dụng đạo hàm để khảo sát hàm số', chu_de: [
          { ten: 'Tính đơn điệu và cực trị của hàm số', yccd: [
            'Nhận biết được tính đồng biến, nghịch biến của hàm số dựa vào dấu của đạo hàm.',
            'Tìm được điểm cực trị của hàm số từ bảng biến thiên.' ] },
          { ten: 'Giá trị lớn nhất, giá trị nhỏ nhất của hàm số', yccd: [
            'Tính được giá trị lớn nhất, giá trị nhỏ nhất của hàm số trên một đoạn.' ] } ] },
        { ten: 'Chương II. Vectơ trong không gian', chu_de: [
          { ten: 'Vectơ và các phép toán', yccd: [
            'Thực hiện được phép cộng, trừ vectơ và nhân vectơ với một số.' ] } ] }
      ]
    };
    var SAMPLE_MATRIX = {
      _loai: 'ChdExam-MaTran', _phien_ban: 1,
      _huong_dan: 'File mẫu nhập ma trận (tab Đề thi → Ma trận → Nhập JSON/Excel). Luôn tạo MÃ KÌ THI MỚI, không ghi đè mã cũ. Bắt buộc có: ma_ki_thi, mon, lop, so_cau, diem. Mỗi câu: loai (MC/TF/SA/LA), cau (số thứ tự); các mục muc_do, chuong, chu_de, yccd, nang_luc có thể thiếu – bổ sung sau. muc_do: Nhận biết / Thông hiểu / Vận dụng / Vận dụng cao (hoặc NB/TH/VD/VDC); câu Đúng/Sai có thể ghi riêng từng ý a–d. Khóa bắt đầu bằng _ được bỏ qua.',
      ma_ki_thi: 'HK1_TOAN12_MAU', mon: 'Toán học', lop: 'Lớp 12',
      so_cau: { MC: 4, TF: 2, SA: 2, LA: 0 }, diem: { MC: 1.0, TF: 2.0, SA: 1.0, LA: 0 },
      cau_hoi: [
        { loai: 'MC', cau: 1, muc_do: 'Nhận biết', chuong: 'Chương I. Ứng dụng đạo hàm để khảo sát hàm số', chu_de: 'Tính đơn điệu và cực trị của hàm số', yccd: ['Nhận biết được tính đồng biến, nghịch biến của hàm số dựa vào dấu của đạo hàm.'], nang_luc: ['TD'] },
        { loai: 'MC', cau: 2, muc_do: 'Thông hiểu', chuong: 'Chương I. Ứng dụng đạo hàm để khảo sát hàm số', chu_de: 'Giá trị lớn nhất, giá trị nhỏ nhất của hàm số', yccd: ['Tính được giá trị lớn nhất, giá trị nhỏ nhất của hàm số trên một đoạn.'], nang_luc: ['TD', 'GQ'] },
        { loai: 'MC', cau: 3, muc_do: 'Vận dụng' },
        { loai: 'MC', cau: 4, _ghi_chu: 'Câu chưa gán gì – vẫn nhập được, bổ sung sau' },
        { loai: 'TF', cau: 1, muc_do: { a: 'Nhận biết', b: 'Thông hiểu', c: 'Thông hiểu', d: 'Vận dụng' }, chuong: 'Chương II. Vectơ trong không gian', chu_de: 'Vectơ và các phép toán', yccd: ['Thực hiện được phép cộng, trừ vectơ và nhân vectơ với một số.'], nang_luc: ['MH'] },
        { loai: 'TF', cau: 2, muc_do: 'Thông hiểu' },
        { loai: 'SA', cau: 1, muc_do: 'Vận dụng', chuong: 'Chương I. Ứng dụng đạo hàm để khảo sát hàm số', chu_de: 'Tính đơn điệu và cực trị của hàm số', yccd: [{ chuong: 'Chương I. Ứng dụng đạo hàm để khảo sát hàm số', chu_de: 'Tính đơn điệu và cực trị của hàm số', noi_dung: 'Tìm được điểm cực trị của hàm số từ bảng biến thiên.' }] },
        { loai: 'SA', cau: 2, muc_do: 'Vận dụng cao', nang_luc: ['GQ'] }
      ]
    };

    /* ---------------- Trạng thái ---------------- */
    var K = { keys: 'chd_aicreator_keys' };
    /* Trạng thái khởi đầu trong bộ nhớ; dtBoot() sẽ thay bằng dữ liệu máy chủ. */
    var exams = [];
    var curriculum = [JSON.parse(JSON.stringify(SAMPLE_CURRICULUM))];
    /* Quyền trên DỮ LIỆU CHƯƠNG TRÌNH CHUNG (đợt 7): mọi người có bản quyền
       mặc định được THÊM; Sửa/Xóa chỉ khi admin cấp (hoặc chính là admin).
       Server (api/curriculum.php) là chốt cưỡng chế — đây chỉ để ẩn/vô hiệu nút. */
    var currPerms = { can_add: true, can_edit: false, can_delete: false, is_admin: false };
    function applyCurrPerms(p) {
      if (!p) return;
      currPerms = {
        can_add: !!(+p.can_add || p.can_add === true),
        can_edit: !!(+p.can_edit || p.can_edit === true),
        can_delete: !!(+p.can_delete || p.can_delete === true),
        is_admin: !!(+p.is_admin || p.is_admin === true)
      };
    }
    function currCanAdd() { return currPerms.is_admin || currPerms.can_add; }
    function currCanDelete() { return currPerms.is_admin || currPerms.can_delete; }
    var dtPrefsData = null;
    var dtCache = {}; /* code -> {matrix, questions, shuffled} đã nạp trong phiên */
    var curCode = '';
    var matrix = [];
    var questions = { MC: [], TF: [], SA: [], LA: [] };
    var shuffledPool = {}; // code -> {questions, answersKey}
    var selected = {};     // slotId -> true
    var aiAbort = null;
    var lastPdf = null;    // {blob, url, title, mode, tex, qaList, code, skipIds}

    /* ---------------- Tiện ích mức độ TF ---------------- */
    function levelObj(q) {
      if (!q || typeof q.level !== 'string') return null;
      var s = q.level.trim();
      if (s.charAt(0) === '{') { try { var o = JSON.parse(s); if (o && typeof o === 'object') return o; } catch (e) {} }
      return null;
    }
    function levelLabel(q) {
      var o = levelObj(q);
      if (o) return ['a', 'b', 'c', 'd'].map(function (k) { return k + ': ' + (o[k] || '—'); }).join(' · ');
      return q && q.level ? String(q.level) : '';
    }
    // Trả về mảng [mức cho MC/SA/LA hoặc từng ý TF]; mỗi phần tử là tên mức hoặc null
    function levelUnits(q) {
      var o = levelObj(q);
      if (o) return ['a', 'b', 'c', 'd'].map(function (k) { return o[k] || null; });
      if (q && q.level) return q.type === 'TF' ? [q.level, q.level, q.level, q.level] : [q.level];
      return q && q.type === 'TF' ? [null, null, null, null] : [null];
    }
    function normLevel(v) {
      if (v == null) return null;
      var s = String(v).trim();
      if (!s) return null;
      for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].toLowerCase() === s.toLowerCase()) return LEVELS[i];
      var key = noAccent(s).toLowerCase();
      if (key in LEVEL_ALIAS) return LEVELS[LEVEL_ALIAS[key]];
      return null;
    }

    /* ---------------- Render chữ + công thức $...$ bằng KaTeX ---------------- */
    function renderRich(el, text) {
      el.innerHTML = '';
      var t = String(text == null ? '' : text);
      var segs = null;
      try { if (window.MTCore && MTCore.findLatexSegments) segs = MTCore.findLatexSegments(t); } catch (e) { segs = null; }
      if (!segs || !segs.length) { el.textContent = t; return; }
      var last = 0;
      segs.forEach(function (s) {
        if (s.start > last) el.appendChild(document.createTextNode(t.slice(last, s.start)));
        var span = document.createElement('span');
        if (window.katex) {
          try { window.katex.render(s.latex, span, { displayMode: !!s.display, throwOnError: false, trust: true, strict: false }); }
          catch (e) { span.textContent = '$' + s.latex + '$'; }
        } else span.textContent = '$' + s.latex + '$';
        el.appendChild(span);
        last = s.end;
      });
      if (last < t.length) el.appendChild(document.createTextNode(t.slice(last)));
    }

    /* ---------------- Modal dùng chung ---------------- */
    function dtModal(html) { $('dtModalBox').innerHTML = html; $('dtModalBack').hidden = false; }
    function dtModalClose() { $('dtModalBack').hidden = true; $('dtModalBox').innerHTML = ''; }
    /* Toast góc phải (dùng cho nút Lưu ma trận, bổ sung chương trình…) */
    var dtToastTimer = null;
    function dtToast(msg, isErr) {
      var t = $('dtToast');
      if (!t) { t = document.createElement('div'); t.id = 'dtToast'; document.body.appendChild(t); }
      t.className = 'dt-toast' + (isErr ? ' err' : '');
      t.textContent = msg;
      t.hidden = false;
      if (dtToastTimer) clearTimeout(dtToastTimer);
      dtToastTimer = setTimeout(function () { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(function () { t.hidden = true; t.style.opacity = ''; t.style.transition = ''; }, 320); }, isErr ? 7000 : 4500);
    }
    /* Đóng popup toàn màn hình "Gán nội dung" / hộp thoại phụ — do các hàm mở đăng ký */
    var dtFsCloseFn = null, dtSubCloseFn = null;
    function dtConfirm(title, bodyHtml, okLabel) {
      return new Promise(function (resolve) {
        dtModal('<h3>' + esc(title) + '</h3><div>' + bodyHtml + '</div>' +
          '<div class="dt-mbtns"><button class="btn" id="dtCfNo" type="button">Hủy</button>' +
          '<button class="btn primary" id="dtCfOk" type="button">' + esc(okLabel || 'Đồng ý') + '</button></div>');
        $('dtCfNo').addEventListener('click', function () { dtModalClose(); resolve(false); });
        $('dtCfOk').addEventListener('click', function () { dtModalClose(); resolve(true); });
      });
    }
    function dtPromptCopy(title, text) {
      dtModal('<h3>' + esc(title) + '</h3>' +
        '<p class="sub">Nếu nút sao chép tự động không hoạt động (thường gặp khi mở file trực tiếp), hãy bấm vào ô dưới, chọn tất cả (Ctrl/Cmd+A) rồi sao chép (Ctrl/Cmd+C).</p>' +
        '<div class="dt-field"><textarea id="dtCopyTa" rows="12" readonly>' + esc(text) + '</textarea></div>' +
        '<div class="dt-mbtns"><button class="btn" id="dtCopyClose" type="button">Đóng</button>' +
        '<button class="btn primary" id="dtCopyBtn" type="button">Sao chép</button></div>');
      var ta = $('dtCopyTa'); ta.focus(); ta.select();
      $('dtCopyClose').addEventListener('click', dtModalClose);
      $('dtCopyBtn').addEventListener('click', function () {
        ta.focus(); ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).catch(function () {});
        $('dtCopyBtn').textContent = 'Đã sao chép ✓';
      });
    }
    function copyTextAuto(text, doneMsg, el) {
      function done() { if (el) { el.textContent = doneMsg; el.className = 'dt-msg ok'; } }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { dtPromptCopy('Nội dung cần sao chép', text); });
      } else dtPromptCopy('Nội dung cần sao chép', text);
    }

    /* ---------------- Gắn vào thanh tab chính (không sửa switchTab cũ) ---------------- */
    (function hookTabs() {
      var btn = $('tabBtn5'), panel = $('tab5');
      if (!btn || !panel) return;
      btn.addEventListener('click', function () {
        // switchTab('tab5') của app đã chạy trước (ẩn 5 panel cũ); ở đây chỉ hiện panel mới
        document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
        panel.hidden = false;
        refreshAll();
      });
      document.querySelectorAll('.tab-btn').forEach(function (b) {
        if (b === btn) return;
        b.addEventListener('click', function () { panel.hidden = true; btn.classList.remove('active'); });
      });
      document.querySelectorAll('.dt-subbtn').forEach(function (b) {
        b.addEventListener('click', function () { switchDtView(b.getAttribute('data-dtview')); });
      });
    })();
    function switchDtView(v) {
      document.querySelectorAll('.dt-subbtn').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-dtview') === v); });
      $('dtViewMatrix').hidden = v !== 'matrix';
      $('dtViewAi').hidden = v !== 'ai';
      $('dtViewShuffle').hidden = v !== 'shuffle';
      $('dtViewView').hidden = v !== 'view';
      if (v === 'shuffle') { renderOrigPreview(); renderFixedTf(); renderShufCards(); fillPdfTargets(); }
      if (v === 'view') renderMatrixView();
      if (v === 'ai') renderAiResults();
    }

    /* ---------------- Kỳ thi: nạp / lưu ---------------- */
    function examCfg(code) { for (var i = 0; i < exams.length; i++) if (exams[i].examCode === code) return exams[i]; return null; }
    function saveExams(cfg) { apiSaveExam(cfg || examCfg(curCode)); }
    function cacheTouch() {
      if (!curCode) return;
      dtCache[curCode] = { matrix: matrix, questions: questions, shuffled: shuffledPool };
    }
    function saveMatrix() { cacheTouch(); apiSaveMatrixFor(curCode, matrix); touchExam(); }
    function saveQuestions() { cacheTouch(); apiSaveQuestionsFor(curCode, questions); }
    function saveShuffled() { cacheTouch(); apiSaveShuffledFor(curCode, shuffledPool); }
    function touchExam() { var c = examCfg(curCode); if (c) { c.updatedAt = Date.now(); saveExams(c); } }
    function renderExamAll() { renderExamSelect(); renderExamInfo(); renderGrid(); renderAiResults(); renderOrigPreview(); renderShufCards(); fillPdfTargets(); }
    function loadExam(code) {
      curCode = code || '';
      selected = {};
      var c = curCode ? dtCache[curCode] : null;
      if (c) { matrix = c.matrix; questions = c.questions; shuffledPool = c.shuffled; }
      else { matrix = []; questions = { MC: [], TF: [], SA: [], LA: [] }; shuffledPool = {}; }
      renderExamAll();
      if (curCode && !c) dtLoadExamData(curCode);
    }
    function dtLoadExamData(code) {
      Promise.all([
        dtApi('GET', 'https://hotrohoctap.com/1ai/chdmathtype/api/matrix.php?exam=' + encodeURIComponent(code)),
        dtApi('GET', 'https://hotrohoctap.com/1ai/chdmathtype/api/questions.php?exam=' + encodeURIComponent(code)),
        dtApi('GET', 'https://hotrohoctap.com/1ai/chdmathtype/api/shuffled.php?exam=' + encodeURIComponent(code))
      ]).then(function (r) {
        var qs = { MC: [], TF: [], SA: [], LA: [] };
        var q = (r[1] && r[1].questions) || {};
        TYPES.forEach(function (t) { if (Array.isArray(q[t])) qs[t] = q[t]; });
        /* Tự lành tiêu đề phần bị cắt 16 ký tự trong DB (đợt 6): suy lại từ loại câu
           cho cả ô ma trận lẫn mọi mã đề đã trộn đã lưu. */
        var pool = (r[2] && r[2].pool) || {};
        Object.keys(pool).forEach(function (cd) { if (pool[cd] && Array.isArray(pool[cd].questions)) healSections(pool[cd].questions); });
        dtCache[code] = { matrix: healSections((r[0] && r[0].slots) || []), questions: qs, shuffled: pool };
        if (curCode === code) {
          var cc = dtCache[code];
          matrix = cc.matrix; questions = cc.questions; shuffledPool = cc.shuffled;
          renderExamAll();
        }
      }).catch(dtApiFail);
    }
    /* Nút Nhân bản / Xóa nằm ngay cạnh ô chọn mã đang làm việc — chỉ bật khi đã chọn một mã */
    function syncPickerBtns() {
      var has = !!examCfg(curCode);
      var d1 = $('dtDupExam'), d2 = $('dtDelExam');
      if (d1) d1.disabled = !has;
      if (d2) d2.disabled = !has;
    }
    function renderExamSelect() {
      var sel = $('dtExamSelect');
      sel.innerHTML = '';
      if (!exams.length) { var o = document.createElement('option'); o.value = ''; o.textContent = '— Chưa có mã kì thi —'; sel.appendChild(o); sel.value = ''; syncPickerBtns(); return; }
      if (!curCode) { var o0 = document.createElement('option'); o0.value = ''; o0.textContent = '— Chọn mã kì thi —'; sel.appendChild(o0); }
      exams.forEach(function (e) { var o = document.createElement('option'); o.value = e.examCode; o.textContent = e.examCode + ' · ' + e.subject + ' · ' + e.grade; sel.appendChild(o); });
      sel.value = curCode || '';
      syncPickerBtns();
    }
    function renderExamInfo() {
      var c = examCfg(curCode), el = $('dtExamInfo');
      if (!c) { el.textContent = exams.length ? 'Hãy chọn một mã kì thi.' : 'Chưa có mã kì thi nào — tạo mã mới ở mục Ma trận bên dưới.'; return; }
      var tot = TYPES.reduce(function (s, t) { return s + (c.counts[t] || 0); }, 0);
      var pts = TYPES.reduce(function (s, t) { return s + (c.scores[t] || 0); }, 0);
      var nq = TYPES.reduce(function (s, t) { return s + questions[t].length; }, 0);
      el.textContent = c.examCode + ' — ' + c.subject + ', ' + c.grade + ' · ' + tot + ' câu / ' + pts + ' điểm · đã có nội dung ' + nq + ' câu.';
    }
    function refreshAll() { renderExamSelect(); renderExamInfo(); renderGrid(); renderCurrTree(); fillCurrSelects(); }

    function buildSlots(cfg) {
      var out = [], si = 0;
      TYPES.forEach(function (t) {
        var n = cfg.counts[t] || 0; if (!n) return; si++;
        var sec = 'PHẦN ' + ROMAN[si - 1] + '. ' + TYPE_NAMES[t];
        for (var i = 1; i <= n; i++) out.push({
          id: t + '_' + i, examCode: cfg.examCode, subject: cfg.subject, grade: cfg.grade,
          section: sec, type: t, qNum: i, level: null, chapter: null, topic: null,
          outcomes: [], competencies: []
        });
      });
      return out;
    }
    function sectionOf(type, cfg) {
      var si = 0, found = '';
      TYPES.forEach(function (t) { if ((cfg.counts[t] || 0) > 0) { si++; if (t === type) found = 'PHẦN ' + ROMAN[si - 1] + '. ' + TYPE_NAMES[t]; } });
      return found;
    }
    /* Tiêu đề phần KHÔNG cho sửa tự do — luôn suy ra từ loại câu hỏi (buildSlots /
       sectionOf). Hàm này viết lại trường section cho mọi ô/dòng theo đúng tiêu đề
       chuẩn của loại đó. Nguồn gốc lỗi đợt 6: cột DB matrix_slots.section từng là
       VARCHAR(16) nên tiêu đề bị cắt còn đúng 16 ký tự ("PHẦN I. TRẮC NGH") mỗi
       lần lưu → nạp lại, và lỗi lan sang Word/LaTeX vì export đọc cùng dữ liệu.
       Viết lại section từ type ngay khi nạp dữ liệu = các đề đã import từ trước
       tự lành ở mọi nơi hiển thị/xuất, bất kể chuỗi đã lưu bị cắt thế nào. */
    function healSections(items) {
      if (!Array.isArray(items)) return items;
      var present = {};
      items.forEach(function (it) { if (it && it.type) present[it.type] = true; });
      var idx = {}, si = 0;
      TYPES.forEach(function (t) { if (present[t]) { si++; idx[t] = si; } });
      items.forEach(function (it) {
        if (it && idx[it.type]) it.section = 'PHẦN ' + ROMAN[idx[it.type] - 1] + '. ' + TYPE_NAMES[it.type];
      });
      return items;
    }
    /* Khoảng câu của 1 phần — quy ước của dự án cũ (hàm range trong shuffleExam.js):
       đánh số câu RESET theo từng phần (mỗi phần đếm lại từ 1, khớp số câu hiển thị
       trong thân đề) nên khoảng luôn bắt đầu ở câu 1; n = số CÂU của phần (TF tính
       theo câu, không tính theo ý a–d). n > 1 → "Từ câu 1 đến câu N"; n = 1 → "Câu 1". */
    function sectionRangeText(n) { return n > 1 ? ('Từ câu 1 đến câu ' + n) : 'Câu 1'; }
    function sectionHeading(section, n) { return section + '. ' + sectionRangeText(n) + '.'; }
    /* Đếm số câu theo từng tiêu đề phần trong 1 danh sách (ô ma trận / qaList) */
    function sectionCounts(list) {
      var m = {};
      (list || []).forEach(function (it) { if (it && it.section) m[it.section] = (m[it.section] || 0) + 1; });
      return m;
    }

    /* ---------------- Tạo / nhân bản / xóa mã kì thi ---------------- */
    function dtMsg(id, text, isErr) { var el = $(id); if (!el) return; el.textContent = text || ''; el.className = 'dt-msg' + (text ? (isErr ? ' err' : ' ok') : ''); }
    function readCfgForm() {
      return {
        examCode: $('dtNewCode').value.trim(),
        subject: $('dtNewSubject').value.trim() || 'Toán học',
        grade: $('dtNewGrade').value.trim() || 'Lớp 12',
        counts: { MC: clamp($('dtCntMC').value, 0, 200), TF: clamp($('dtCntTF').value, 0, 200), SA: clamp($('dtCntSA').value, 0, 200), LA: clamp($('dtCntLA').value, 0, 200) },
        scores: { MC: parseFloat($('dtScrMC').value) || 0, TF: parseFloat($('dtScrTF').value) || 0, SA: parseFloat($('dtScrSA').value) || 0, LA: parseFloat($('dtScrLA').value) || 0 }
      };
    }
    /* Thu gọn / mở rộng khối "Cấu hình & sinh ma trận" (mũi tên chevron như dự án cũ) */
    var dtCfgOpen = true;
    function setCfgOpen(open) {
      dtCfgOpen = !!open;
      var body = $('dtCfgBody'), btn = $('dtCfgToggle');
      if (body) body.hidden = !dtCfgOpen;
      if (btn) { btn.textContent = dtCfgOpen ? '▲' : '▼'; btn.setAttribute('aria-expanded', dtCfgOpen ? 'true' : 'false'); }
    }
    $('dtCfgToggle').addEventListener('click', function () { setCfgOpen(!dtCfgOpen); });
    function createExam(cfg, slots, msg, opts) {
      opts = opts || {};
      cfg.createdAt = Date.now(); cfg.updatedAt = Date.now();
      exams.push(cfg);
      var emptyQ = { MC: [], TF: [], SA: [], LA: [] };
      dtCache[cfg.examCode] = { matrix: slots, questions: emptyQ, shuffled: {} };
      if (!opts.noSave) {   // noSave: chỉ tạo trên màn hình (Import bỏ tick "Lưu ngay") — ghi lên hệ thống khi bấm "Lưu ma trận"
        saveExams(cfg);
        apiSaveMatrixFor(cfg.examCode, slots);
        apiSaveQuestionsFor(cfg.examCode, emptyQ);
      }
      loadExam(cfg.examCode);
      setCfgOpen(false);   // sinh / nhân bản / nạp ma trận xong thì thu gọn cấu hình, nhường chỗ cho lưới
      dtMsg('dtMatrixMsg', msg || ('Đã tạo mã kì thi ' + cfg.examCode + ' với ' + slots.length + ' ô câu hỏi trống.'));
    }
    $('dtCreateExam').addEventListener('click', function () {
      var cfg = readCfgForm();
      if (!cfg.examCode) { dtMsg('dtMatrixMsg', 'Vui lòng nhập Mã kì thi.', true); return; }
      if (examCfg(cfg.examCode)) { dtMsg('dtMatrixMsg', 'Mã kì thi "' + cfg.examCode + '" đã tồn tại — hãy chọn mã khác hoặc dùng Nhập JSON (luôn tạo mã mới).', true); return; }
      var tot = TYPES.reduce(function (s, t) { return s + cfg.counts[t]; }, 0);
      if (!tot) { dtMsg('dtMatrixMsg', 'Tổng số câu phải lớn hơn 0.', true); return; }
      createExam(cfg, buildSlots(cfg));
    });
    /* Nhân bản mã đang chọn — tạo ngay mã mới <MÃ>_COPY (trùng thì _COPY2, _COPY3, …),
       sao toàn bộ cấu hình + từng ô ma trận; không mở form cấu hình, không bắt nhập lại. */
    $('dtDupExam').addEventListener('click', function () {
      var c = examCfg(curCode); if (!c) { dtToast('Chưa chọn mã kì thi nào để nhân bản.', true); return; }
      var base = curCode, code = base + '_COPY', n = 2;
      while (examCfg(code)) { code = base + '_COPY' + n; n++; }
      var cfg = JSON.parse(JSON.stringify(c)); cfg.examCode = code;
      var slots = matrix.map(function (q) { var x = JSON.parse(JSON.stringify(q)); x.examCode = code; return x; });
      createExam(cfg, slots, 'Đã nhân bản thành ' + code + ' từ ' + base + ' (chỉ nhân bản ma trận, câu hỏi AI không sao chép).');
      dtToast('Đã nhân bản thành ' + code + ' từ ' + base + '.');
    });
    /* Xóa mã đang chọn — câu chữ xác nhận đúng dự án cũ; xóa xong ô chọn mã về trạng thái chưa chọn. */
    $('dtDelExam').addEventListener('click', function () {
      var c = examCfg(curCode); if (!c) return;
      var delCode = curCode;
      dtConfirm('Xóa mã kì thi', '<p>CẢNH BÁO: BẠN CÓ CHẮC CHẮN MUỐN XÓA TOÀN BỘ CÂU HỎI TRONG MÃ ĐỀ "<b>' + esc(delCode) + '</b>" KHÔNG? Hành động này không thể hoàn tác!</p>', 'Xóa').then(function (ok) {
        if (!ok) return;
        exams = exams.filter(function (e) { return e.examCode !== delCode; });
        delete dtCache[delCode];
        dtApi('DELETE', 'https://hotrohoctap.com/1ai/chdmathtype/api/exams.php?code=' + encodeURIComponent(delCode)).catch(dtApiFail);
        loadExam('');
        dtToast('Đã xóa mã kì thi ' + delCode + '.');
        dtMsg('dtMatrixMsg', 'Đã xóa mã kì thi ' + delCode + '.');
      });
    });
    $('dtExamSelect').addEventListener('change', function () { loadExam(this.value); });

    /* ---------------- Lưới ô ma trận ---------------- */
    function questionIds() { var s = {}; TYPES.forEach(function (t) { questions[t].forEach(function (q) { s[q.Id] = true; }); }); return s; }
    /* Trạng thái gán của 1 ô: mức độ / nội dung / năng lực (như _qMarks của dự án cũ;
       TF có mức độ từng ý thì chỉ cần ít nhất 1 ý có mức là tính đã gán) */
    function qMarks(q) {
      var lv = false, o = levelObj(q);
      if (o) lv = ['a', 'b', 'c', 'd'].some(function (k) { return !!o[k]; });
      else lv = !!q.level;
      var ct = !!(q.chapter || q.topic || (q.outcomes && q.outcomes.length));
      var cp = !!(q.competencies && q.competencies.length);
      return { lv: lv, ct: ct, cp: cp, all: lv && ct && cp };
    }
    function levelTxt(q) {
      var o = levelObj(q);
      if (o) return ['a', 'b', 'c', 'd'].map(function (k) { return k + ') ' + (o[k] || '–'); }).join(' ');
      return q && q.level ? String(q.level) : '';
    }
    var lastClickedId = null;   // ô bấm gần nhất — điểm neo cho Shift+bấm chọn dãy
    function renderGrid() {
      var grid = $('dtGrid'); grid.innerHTML = '';
      var stats = $('dtStats');
      var legend = $('dtMarkLegend');
      if (!curCode || !matrix.length) {
        grid.innerHTML = '<p class="dt-muted">Chưa có ma trận. Tạo mã kì thi mới ở trên, hoặc nhập file JSON/Excel ma trận.</p>';
        stats.textContent = ''; if (legend) legend.innerHTML = ''; updateSelCount(); return;
      }
      var hasQ = questionIds();
      var bySec = {}, order = [];
      matrix.forEach(function (q) { if (!bySec[q.section]) { bySec[q.section] = []; order.push(q.section); } bySec[q.section].push(q); });
      order.forEach(function (sec) {
        var wrap = document.createElement('div');
        var head = document.createElement('div'); head.className = 'dt-sechead';
        var h = document.createElement('span'); h.className = 'dt-sectitle'; h.textContent = sectionHeading(sec, bySec[sec].length); head.appendChild(h);
        var secBtn = document.createElement('button');
        secBtn.className = 'btn small'; secBtn.type = 'button'; secBtn.textContent = 'Chọn tất cả phần này';
        secBtn.title = 'Chọn / bỏ chọn tất cả các câu trong phần này (không đụng các phần khác)';
        secBtn.addEventListener('click', function () {
          var qs = bySec[sec];
          var allSel = qs.every(function (q) { return !!selected[q.id]; });
          qs.forEach(function (q) { if (allSel) delete selected[q.id]; else selected[q.id] = true; });
          renderGrid();
        });
        head.appendChild(secBtn); wrap.appendChild(head);
        var cells = document.createElement('div'); cells.className = 'dt-cells';
        bySec[sec].forEach(function (q) {
          var m = qMarks(q);
          var d = document.createElement('div');
          d.className = 'dt-cell' + (selected[q.id] ? ' sel' : '') + (m.lv ? ' m-lv' : '') + (m.ct ? ' m-ct' : '') + (m.cp ? ' m-cp' : '') + (m.all ? ' m-all' : '');
          d.setAttribute('role', 'button'); d.setAttribute('tabindex', '0');
          d.title = q.type + ' – Câu ' + q.qNum + '\n' +
            '● Mức độ: ' + (m.lv ? levelTxt(q) : 'chưa gán') + '\n' +
            '● Nội dung: ' + (m.ct ? [q.chapter, q.topic].filter(Boolean).join(' › ') + (q.outcomes && q.outcomes.length ? ' (' + q.outcomes.length + ' YCCĐ)' : '') : 'chưa gán') + '\n' +
            '● Năng lực: ' + (m.cp ? q.competencies.join(', ') : 'chưa gán');
          var lv = levelLabel(q);
          var html = '<span class="qd qd-lv"></span><span class="qd qd-ct"></span><span class="qd qd-cp"></span>';
          html += '<div class="cid"><span>' + esc(q.id) + '</span>' + (hasQ[q.id] ? '<span class="hasq" title="Đã có nội dung câu hỏi">✓</span>' : '') + '</div>';
          html += '<div>' + (lv ? '<span class="dt-badge lv">' + esc(lv) + '</span>' : '<span class="dt-badge">chưa gán mức độ</span>') + '</div>';
          html += '<div class="ctopic">' + esc(q.topic || q.chapter || 'Chưa gán nội dung') + '</div>';
          if (q.competencies && q.competencies.length) html += '<div>' + q.competencies.map(function (c) { return '<span class="dt-badge cp">' + esc(c) + '</span>'; }).join(' ') + '</div>';
          if (q.outcomes && q.outcomes.length) html += '<div class="dt-muted dt-small">' + q.outcomes.length + ' YCCĐ</div>';
          d.innerHTML = html;
          d.addEventListener('click', function (ev) {
            // Shift + bấm: chọn cả dãy từ ô bấm trước đến ô này; ô vừa bấm là "ô cuối"
            if (ev.shiftKey && lastClickedId && lastClickedId !== q.id) {
              var ids = matrix.map(function (x) { return x.id; });
              var a = ids.indexOf(lastClickedId), b = ids.indexOf(q.id);
              if (a > -1 && b > -1) {
                var f = Math.min(a, b), t2 = Math.max(a, b);
                for (var k = f; k <= t2; k++) selected[ids[k]] = true;
                try { window.getSelection().removeAllRanges(); } catch (e) {}
                lastClickedId = q.id; renderGrid(); return;
              }
            }
            selected[q.id] = !selected[q.id]; lastClickedId = q.id; renderGrid();
          });
          d.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected[q.id] = !selected[q.id]; lastClickedId = q.id; renderGrid(); } });
          cells.appendChild(d);
        });
        wrap.appendChild(cells); grid.appendChild(wrap);
      });
      var nLv = 0, nCt = 0, nCp = 0;
      matrix.forEach(function (q) { var m = qMarks(q); if (m.lv) nLv++; if (m.ct) nCt++; if (m.cp) nCp++; });
      if (legend) legend.innerHTML =
        '<span class="chip"><span class="dot" style="background:#3b82f6"></span>Mức độ: <b>' + nLv + '/' + matrix.length + '</b></span>' +
        '<span class="chip"><span class="dot" style="background:#f97316"></span>Nội dung: <b>' + nCt + '/' + matrix.length + '</b></span>' +
        '<span class="chip"><span class="dot" style="background:#ec4899"></span>Năng lực: <b>' + nCp + '/' + matrix.length + '</b></span>' +
        '<span class="chip">Ô viền xám đậm = đã gán đủ 3 mục · ô viền xanh lá = đang chọn</span>';
      stats.textContent = 'Tổng ' + matrix.length + ' ô · đã gán mức độ ' + nLv + ' · đã gán nội dung ' + nCt + ' · đã gán năng lực ' + nCp + ' · đã có câu hỏi ' + Object.keys(hasQ).length + '.';
      updateSelCount();
    }
    function updateSelCount() { var n = Object.keys(selected).filter(function (k) { return selected[k]; }).length; $('dtSelCount').textContent = 'Đã chọn: ' + n + ' ô'; }
    function selectedSlots() { return matrix.filter(function (q) { return selected[q.id]; }); }
    $('dtSelAll').addEventListener('click', function () { matrix.forEach(function (q) { selected[q.id] = true; }); renderGrid(); });
    $('dtSelNone').addEventListener('click', function () { selected = {}; lastClickedId = null; renderGrid(); });

    /* ---------------- Nút Lưu ma trận (lưu tường minh lên tài khoản) ---------------- */
    $('dtSaveGrid').addEventListener('click', function () {
      var c = examCfg(curCode);
      if (!c) { dtMsg('dtMatrixMsg', 'Chưa có mã kì thi nào đang mở để lưu.', true); return; }
      var btn = this, old = btn.textContent;
      btn.disabled = true; btn.textContent = '⏳ Đang lưu…';
      cacheTouch();
      Promise.all([
        dtApi('POST', 'https://hotrohoctap.com/1ai/chdmathtype/api/exams.php', { exam: c }),
        dtApi('POST', 'https://hotrohoctap.com/1ai/chdmathtype/api/matrix.php', { exam_code: curCode, slots: matrix })
      ]).then(function () {
        btn.disabled = false; btn.textContent = old;
        dtToast('Đã lưu ma trận ' + curCode + ' vào tài khoản của bạn.');
        dtMsg('dtMatrixMsg', 'Đã lưu ma trận ' + curCode + ' (' + matrix.length + ' ô) lên máy chủ lúc ' + new Date().toLocaleTimeString('vi-VN') + ' — mở lại ở bất kỳ trình duyệt nào sau khi đăng nhập sẽ thấy đúng trạng thái này.');
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = old;
        dtApiFail(e);
        dtMsg('dtMatrixMsg', 'Lưu ma trận thất bại: ' + (e && e.message ? e.message : e) + ' — dữ liệu vẫn còn nguyên trên màn hình, hãy dùng Xuất JSON để sao lưu thủ công rồi thử lại.', true);
      });
    });

    /* ---------------- Gán mức độ ---------------- */
    $('dtBtnLevel').addEventListener('click', function () {
      var sel = selectedSlots();
      if (!sel.length) { dtMsg('dtMatrixMsg', 'Hãy chọn ít nhất một ô trong lưới trước khi gán.', true); return; }
      var hasTF = sel.some(function (q) { return q.type === 'TF'; });
      var radios = LEVELS.map(function (l, i) {
        return '<label class="dt-checkline"><input type="radio" name="dtLv" value="' + esc(l) + '"' + (i === 0 ? ' checked' : '') + ' /> ' + esc(l) + '</label>';
      }).join('');
      var tfBlock = '';
      if (hasTF) {
        var rows = ['a', 'b', 'c', 'd'].map(function (k) {
          return '<div class="dt-field"><label>Ý ' + k + '</label><select id="dtLvTF' + k + '">' +
            LEVELS.map(function (l) { return '<option value="' + esc(l) + '">' + esc(l) + '</option>'; }).join('') + '</select></div>';
        }).join('');
        tfBlock = '<label class="dt-checkline" style="margin-top:10px;"><input type="checkbox" id="dtLvTFToggle" /> Tùy chỉnh mức độ riêng cho các ý a, b, c, d (chỉ áp dụng cho câu TF)</label>' +
          '<div class="dt-grid-form" id="dtLvTFGrid" hidden>' + rows + '</div>';
      }
      dtModal('<h3>Gán mức độ cho ' + sel.length + ' ô đã chọn</h3>' + radios + tfBlock +
        '<div class="dt-mbtns"><button class="btn" id="dtLvClear" type="button">Xóa mức độ</button>' +
        '<button class="btn" id="dtLvCancel" type="button">Hủy</button>' +
        '<button class="btn primary" id="dtLvOk" type="button">Áp dụng</button></div>');
      var tog = $('dtLvTFToggle');
      if (tog) tog.addEventListener('change', function () { $('dtLvTFGrid').hidden = !tog.checked; });
      $('dtLvCancel').addEventListener('click', dtModalClose);
      $('dtLvClear').addEventListener('click', function () {
        sel.forEach(function (q) { q.level = null; });
        saveMatrix(); renderGrid(); dtModalClose(); dtMsg('dtMatrixMsg', 'Đã xóa mức độ của ' + sel.length + ' ô.');
      });
      $('dtLvOk').addEventListener('click', function () {
        var lv = (document.querySelector('input[name="dtLv"]:checked') || {}).value || LEVELS[0];
        var perPart = tog && tog.checked;
        sel.forEach(function (q) {
          if (perPart && q.type === 'TF') {
            var o = {}; ['a', 'b', 'c', 'd'].forEach(function (k) { o[k] = $('dtLvTF' + k).value; });
            q.level = JSON.stringify(o);
          } else q.level = lv;
        });
        saveMatrix(); renderGrid(); dtModalClose(); dtMsg('dtMatrixMsg', 'Đã gán mức độ cho ' + sel.length + ' ô.');
      });
    });

    /* ---------------- Gán năng lực ---------------- */
    $('dtBtnComp').addEventListener('click', function () {
      var sel = selectedSlots();
      if (!sel.length) { dtMsg('dtMatrixMsg', 'Hãy chọn ít nhất một ô trong lưới trước khi gán.', true); return; }
      var quick = COMPS.map(function (c) { return '<button class="btn small dt-quick-comp" type="button" data-code="' + c[0] + '" title="' + esc(c[1]) + '">' + c[0] + '</button>'; }).join(' ');
      dtModal('<h3>Gán năng lực cho ' + sel.length + ' ô đã chọn</h3>' +
        '<p class="sub">' + COMPS.map(function (c) { return '<b>' + c[0] + '</b>: ' + esc(c[1]); }).join('<br>') + '</p>' +
        '<div class="dt-row" style="margin-bottom:8px;">' + quick + '</div>' +
        '<div class="dt-field"><label for="dtCompInput">Mã năng lực (phân tách bằng dấu phẩy, gán mới sẽ thay toàn bộ)</label>' +
        '<input type="text" id="dtCompInput" placeholder="VD: TD, GQ" /></div>' +
        '<div class="dt-mbtns"><button class="btn" id="dtCpCancel" type="button">Hủy</button>' +
        '<button class="btn primary" id="dtCpOk" type="button">Áp dụng</button></div>');
      document.querySelectorAll('.dt-quick-comp').forEach(function (b) {
        b.addEventListener('click', function () {
          var inp = $('dtCompInput'), cur = inp.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          if (cur.indexOf(b.getAttribute('data-code')) < 0) cur.push(b.getAttribute('data-code'));
          inp.value = cur.join(', ');
        });
      });
      $('dtCpCancel').addEventListener('click', dtModalClose);
      $('dtCpOk').addEventListener('click', function () {
        var comps = $('dtCompInput').value.split(/[,;]/).map(function (s) { return s.trim().slice(0, 60); }).filter(Boolean).slice(0, 20);
        sel.forEach(function (q) { q.competencies = comps.slice(); });
        saveMatrix(); renderGrid(); dtModalClose(); dtMsg('dtMatrixMsg', 'Đã gán năng lực [' + comps.join(', ') + '] cho ' + sel.length + ' ô.');
      });
    });

    /* ---------------- Dữ liệu chương trình ---------------- */
    function currDoc() {
      var c = examCfg(curCode); if (!c) return null;
      for (var i = 0; i < curriculum.length; i++) {
        if (curriculum[i].mon === c.subject && curriculum[i].lop === c.grade) return curriculum[i];
      }
      var d = { mon: c.subject, lop: c.grade, chuong: [] };
      curriculum.push(d); return d;
    }
    /* Lưu theo nghĩa THÊM vào cây CHUNG (đợt 7): server chỉ chèn mục chưa có,
       không bao giờ xóa/ghi đè dữ liệu chung từ đường này. Xóa đi qua currDelete(). */
    function saveCurr() {
      if (!currCanAdd()) { dtToast('Bạn không có quyền thêm dữ liệu chương trình — liên hệ admin.'); return; }
      dtApi('POST', 'https://hotrohoctap.com/1ai/chdmathtype/api/curriculum.php', { docs: curriculum }).then(function (r) {
        if (r && r.perms) applyCurrPerms(r.perms);
      }).catch(dtApiFail);
    }
    /* Xóa 1 mục khỏi cây chung qua API riêng (server bắt buộc quyền Xóa/admin),
       xong nạp lại cây thật từ server để giao diện khớp dữ liệu chung. */
    function currDelete(payload) {
      payload.op = 'delete';
      dtApi('POST', 'https://hotrohoctap.com/1ai/chdmathtype/api/curriculum.php', payload).then(function (r) {
        if (r && Array.isArray(r.docs)) curriculum = r.docs;
        if (r && r.perms) applyCurrPerms(r.perms);
        renderCurrTree(); fillCurrSelects();
        dtToast('Đã xóa khỏi dữ liệu chương trình chung.');
      }).catch(dtApiFail);
    }
    function renderCurrTree() {
      var box = $('dtCuTree'); if (!box) return;
      var d = currDoc();
      if (!d || !d.chuong.length) { box.innerHTML = '<p class="dt-muted">Chưa có dữ liệu chương trình cho môn/lớp này. Thêm chương bên trên, nhập JSON, hoặc tải file mẫu.</p>'; return; }
      var canDel = currCanDelete();
      var noDelTitle = 'Bạn chỉ được thêm, không được sửa/xóa dữ liệu chương trình — liên hệ admin để được cấp quyền';
      function delBtn(attr, title) {
        return canDel
          ? ' <button class="dt-x" type="button" ' + attr + ' title="' + title + '">×</button>'
          : ' <button class="dt-x" type="button" disabled title="' + noDelTitle + '">×</button>';
      }
      var html = '';
      d.chuong.forEach(function (ch, ci) {
        html += '<div class="ch">' + esc(ch.ten) + delBtn('data-delch="' + ci + '"', 'Xóa chương') + '</div>';
        (ch.chu_de || []).forEach(function (tp, ti) {
          html += '<div class="tp">' + esc(tp.ten) + delBtn('data-deltp="' + ci + ':' + ti + '"', 'Xóa chủ đề') + '</div>';
          (tp.yccd || []).forEach(function (y, yi) {
            html += '<div class="yc">– ' + esc(y) + delBtn('data-delyc="' + ci + ':' + ti + ':' + yi + '"', 'Xóa YCCĐ') + '</div>';
          });
        });
      });
      box.innerHTML = html;
      if (!canDel) return;
      box.querySelectorAll('[data-delch]').forEach(function (b) { b.addEventListener('click', function () { var ch = d.chuong[+b.getAttribute('data-delch')]; if (ch) currDelete({ subject: d.mon, grade: d.lop, chapter: ch.ten }); }); });
      box.querySelectorAll('[data-deltp]').forEach(function (b) { b.addEventListener('click', function () { var p = b.getAttribute('data-deltp').split(':'); var ch = d.chuong[+p[0]]; if (ch && ch.chu_de[+p[1]]) currDelete({ subject: d.mon, grade: d.lop, chapter: ch.ten, topic: ch.chu_de[+p[1]].ten }); }); });
      box.querySelectorAll('[data-delyc]').forEach(function (b) { b.addEventListener('click', function () { var p = b.getAttribute('data-delyc').split(':'); var ch = d.chuong[+p[0]]; if (ch && ch.chu_de[+p[1]]) currDelete({ subject: d.mon, grade: d.lop, chapter: ch.ten, topic: ch.chu_de[+p[1]].ten, outcome: ch.chu_de[+p[1]].yccd[+p[2]] }); }); });
    }
    function fillCurrSelects() {
      var d = currDoc(); if (!d) return;
      var chSel = $('dtCuTopicChapter'); chSel.innerHTML = '';
      d.chuong.forEach(function (ch, i) { var o = document.createElement('option'); o.value = i; o.textContent = ch.ten; chSel.appendChild(o); });
      var tpSel = $('dtCuYccdTopic'); tpSel.innerHTML = '';
      d.chuong.forEach(function (ch, ci) { (ch.chu_de || []).forEach(function (tp, ti) { var o = document.createElement('option'); o.value = ci + ':' + ti; o.textContent = ch.ten + ' → ' + tp.ten; tpSel.appendChild(o); }); });
    }
    $('dtCuAddChapter').addEventListener('click', function () {
      var d = currDoc(); if (!d) { dtMsg('dtCuMsg', 'Hãy tạo/chọn một mã kì thi trước.', true); return; }
      var name = $('dtCuChapter').value.trim(); if (!name) return;
      d.chuong.push({ ten: name, chu_de: [] }); $('dtCuChapter').value = '';
      saveCurr(); renderCurrTree(); fillCurrSelects(); dtMsg('dtCuMsg', 'Đã thêm chương.');
    });
    $('dtCuAddTopic').addEventListener('click', function () {
      var d = currDoc(); if (!d || !d.chuong.length) { dtMsg('dtCuMsg', 'Chưa có chương nào.', true); return; }
      var name = $('dtCuTopic').value.trim(); if (!name) return;
      var ci = +$('dtCuTopicChapter').value || 0;
      d.chuong[ci].chu_de = d.chuong[ci].chu_de || []; d.chuong[ci].chu_de.push({ ten: name, yccd: [] });
      $('dtCuTopic').value = ''; saveCurr(); renderCurrTree(); fillCurrSelects(); dtMsg('dtCuMsg', 'Đã thêm chủ đề.');
    });
    $('dtCuAddYccd').addEventListener('click', function () {
      var d = currDoc(); if (!d) return;
      var v = $('dtCuYccdTopic').value; if (!v) { dtMsg('dtCuMsg', 'Chưa có chủ đề nào.', true); return; }
      var p = v.split(':'); var tp = d.chuong[+p[0]].chu_de[+p[1]];
      var lines = $('dtCuYccd').value.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
      if (!lines.length) return;
      tp.yccd = (tp.yccd || []).concat(lines); $('dtCuYccd').value = '';
      saveCurr(); renderCurrTree(); dtMsg('dtCuMsg', 'Đã thêm ' + lines.length + ' YCCĐ.');
    });
    function parseCurriculumJson(obj) {
      // Chấp nhận dạng lồng nhau {mon, lop, chuong:[{ten, chu_de:[{ten, yccd}]}]} hoặc dạng phẳng {items:[{subject, grade, chapter, topic, outcome}]}
      var docs = [];
      function one(o) {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o.chuong)) {
          docs.push({ mon: o.mon || o.subject || 'Toán học', lop: o.lop || o.grade || 'Lớp 12', chuong: o.chuong.map(function (ch) {
            return { ten: ch.ten || ch.name || '', chu_de: (ch.chu_de || ch.topics || []).map(function (tp) {
              return { ten: tp.ten || tp.name || '', yccd: (tp.yccd || tp.outcomes || []).map(String) };
            }) };
          }) });
        } else if (Array.isArray(o.items)) {
          var map = {};
          o.items.forEach(function (it) {
            var key = (it.subject || o.mon || 'Toán học') + '|' + (it.grade || o.lop || 'Lớp 12');
            if (!map[key]) map[key] = { mon: it.subject || o.mon || 'Toán học', lop: it.grade || o.lop || 'Lớp 12', chuong: [] };
            var doc = map[key];
            var ch = null, tp = null;
            doc.chuong.forEach(function (c) { if (c.ten === it.chapter) ch = c; });
            if (!ch) { ch = { ten: it.chapter || '', chu_de: [] }; doc.chuong.push(ch); }
            ch.chu_de.forEach(function (t) { if (t.ten === it.topic) tp = t; });
            if (!tp) { tp = { ten: it.topic || '', yccd: [] }; ch.chu_de.push(tp); }
            String(it.outcome || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (s) { tp.yccd.push(s); });
          });
          Object.keys(map).forEach(function (k) { docs.push(map[k]); });
        }
      }
      if (Array.isArray(obj)) obj.forEach(one); else one(obj);
      return docs;
    }
    $('dtCuExp').addEventListener('click', function () {
      var d = currDoc(); if (!d) { dtMsg('dtCuMsg', 'Chưa có mã kì thi nào.', true); return; }
      saveText(JSON.stringify(d, null, 2), 'ChuongTrinh_' + noAccent(d.mon + '_' + d.lop) + '.json', 'application/json');
    });
    $('dtCuSample').addEventListener('click', function () { saveText(JSON.stringify(SAMPLE_CURRICULUM, null, 2), 'ChuongTrinh_mau.json', 'application/json'); });
    $('dtCuImp').addEventListener('click', function () { $('dtCuImpFile').click(); });
    $('dtCuImpFile').addEventListener('change', function () {
      var f = this.files[0]; this.value = ''; if (!f) return;
      f.text().then(function (txt) {
        var docs = parseCurriculumJson(JSON.parse(txt));
        if (!docs.length) { dtMsg('dtCuMsg', 'Không đọc được dữ liệu chương trình trong file.', true); return; }
        /* Đợt 7: import chỉ THÊM vào cây chung (gộp, bỏ qua trùng) — không còn
           thay thế/ghi đè dữ liệu chương trình của môn/lớp như trước. */
        var rep = currMergeReport(curriculum, docs);
        saveCurr(); renderCurrTree(); fillCurrSelects();
        dtMsg('dtCuMsg', 'Đã thêm ' + rep.added + ' mục mới vào dữ liệu chương trình chung' + (rep.skipped ? ' (bỏ qua ' + rep.skipped + ' mục trùng)' : '') + '.');
      }).catch(function (e) { dtMsg('dtCuMsg', 'Lỗi đọc file: ' + e.message, true); });
    });

    /* ---------------- Gán nội dung: popup TOÀN MÀN HÌNH 2 cột + Giỏ hàng YCCĐ (như dự án cũ) ---------------- */
    function dtNormKey(s) { return String(s == null ? '' : s).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase(); }
    /* Hộp thoại phụ nổi trên popup Gán nội dung. Bấm nền KHÔNG đóng (tránh mất chữ đang gõ); đóng bằng X / Hủy / Esc. */
    function dtSubDialog(title, bodyHtml, footHtml, wide) {
      if (dtSubCloseFn) dtSubCloseFn();
      var back = document.createElement('div'); back.className = 'dt-sub-back';
      back.innerHTML = '<div class="dt-sub-card' + (wide ? ' wide' : '') + '">' +
        '<div class="dt-sub-head"><span>' + title + '</span><button type="button" class="dt-fs-x" data-x title="Đóng">✕</button></div>' +
        '<div class="dt-sub-body">' + bodyHtml + '</div>' +
        (footHtml ? '<div class="dt-sub-foot">' + footHtml + '</div>' : '') + '</div>';
      document.body.appendChild(back);
      var closed = false;
      function close() { if (closed) return; closed = true; back.remove(); if (dtSubCloseFn === close) dtSubCloseFn = null; }
      dtSubCloseFn = close;
      back.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-x]')) close(); });
      return { el: back, close: close, $: function (s) { return back.querySelector(s); }, $$: function (s) { return back.querySelectorAll(s); } };
    }
    /* Gộp dữ liệu chương trình đã parse vào mảng docs (thêm mới, bỏ qua trùng theo khóa
       không phân biệt hoa/thường + khoảng trắng thừa). Trả báo cáo từng dòng YCCĐ. */
    function currMergeReport(targetDocs, parsedDocs) {
      var rep = { added: 0, skipped: 0, rows: [] };
      parsedDocs.forEach(function (pd) {
        var doc = null;
        targetDocs.forEach(function (x) { if (dtNormKey(x.mon) === dtNormKey(pd.mon) && dtNormKey(x.lop) === dtNormKey(pd.lop)) doc = x; });
        if (!doc) { doc = { mon: pd.mon, lop: pd.lop, chuong: [] }; targetDocs.push(doc); }
        (pd.chuong || []).forEach(function (pch) {
          var ch = null;
          doc.chuong.forEach(function (x) { if (dtNormKey(x.ten) === dtNormKey(pch.ten)) ch = x; });
          if (!ch) { ch = { ten: pch.ten, chu_de: [] }; doc.chuong.push(ch); }
          ch.chu_de = ch.chu_de || [];
          (pch.chu_de || []).forEach(function (ptp) {
            var tp = null;
            ch.chu_de.forEach(function (x) { if (dtNormKey(x.ten) === dtNormKey(ptp.ten)) tp = x; });
            var isNewTp = !tp;
            if (!tp) { tp = { ten: ptp.ten, yccd: [] }; ch.chu_de.push(tp); }
            tp.yccd = tp.yccd || [];
            var outs = (ptp.yccd || []).map(String);
            if (isNewTp && !outs.length) { rep.added++; rep.rows.push({ act: 'add', chapter: ch.ten, topic: tp.ten, outcome: '(chủ đề mới, chưa có YCCĐ)' }); }
            outs.forEach(function (y) {
              var dup = tp.yccd.some(function (e) { return dtNormKey(e) === dtNormKey(y); });
              if (dup) { rep.skipped++; rep.rows.push({ act: 'skip', chapter: ch.ten, topic: tp.ten, outcome: y }); }
              else { tp.yccd.push(y); rep.added++; rep.rows.push({ act: 'add', chapter: ch.ten, topic: tp.ten, outcome: y }); }
            });
          });
        });
      });
      return rep;
    }
    function downloadCurriculumSample() {
      var c = examCfg(curCode);
      saveText(JSON.stringify({
        _huong_dan: 'Mỗi Chương gồm nhiều Chủ đề; mỗi Chủ đề có danh sách Yêu cầu cần đạt (yccd). Có thể bỏ "mon", "lop" để dùng Môn/Lớp đang chọn ở ma trận. Nội dung đã có trong dữ liệu chương trình sẽ tự bỏ qua. Các khóa bắt đầu bằng dấu _ được bỏ qua.',
        mon: (c && c.subject) || 'Toán học', lop: (c && c.grade) || 'Lớp 12',
        chuong: JSON.parse(JSON.stringify(SAMPLE_CURRICULUM.chuong)),
        _vi_du_dang_phang: [
          { chuong: 'Chương I. Ứng dụng đạo hàm để khảo sát hàm số', chu_de: 'Đường tiệm cận', yccd: 'Nhận biết được đường tiệm cận đứng, tiệm cận ngang của đồ thị hàm số.' }
        ]
      }, null, 2), 'Curriculum_mau.json', 'application/json');
    }
    /* Dialog "Bổ sung": thêm Chương / Chủ đề / YCCĐ vào dữ liệu chương trình của môn/lớp đang mở */
    function openAddCurr(d, presetCh, presetTp, onAdded) {
      var chNames = d.chuong.map(function (c) { return c.ten; });
      var dlg = dtSubDialog('➕ Bổ sung dữ liệu chương trình',
        '<div class="dt-field"><label for="dtAdChap">Chương *</label>' +
        '<input type="text" id="dtAdChap" list="dtAdChapList" placeholder="Chọn chương có sẵn hoặc gõ tên chương mới" value="' + esc(presetCh || '') + '" />' +
        '<datalist id="dtAdChapList">' + chNames.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></div>' +
        '<div class="dt-field"><label for="dtAdTopic">Chủ đề *</label>' +
        '<input type="text" id="dtAdTopic" list="dtAdTopicList" placeholder="Chọn chủ đề có sẵn hoặc gõ tên chủ đề mới" value="' + esc(presetTp || '') + '" />' +
        '<datalist id="dtAdTopicList"></datalist></div>' +
        '<div class="dt-field"><label for="dtAdOuts">Yêu cầu cần đạt (mỗi dòng 1 YCCĐ — có thể để trống nếu chỉ thêm Chương/Chủ đề)</label>' +
        '<textarea id="dtAdOuts" rows="6" placeholder="Nhận biết được tính đồng biến, nghịch biến của hàm số dựa vào dấu của đạo hàm.&#10;Tìm được điểm cực trị của hàm số từ bảng biến thiên."></textarea></div>' +
        '<p class="dt-muted dt-small" id="dtAdHint"></p>' +
        '<label class="dt-checkline"><input type="checkbox" id="dtAdToCart" checked /> Đưa các YCCĐ vừa thêm vào Giỏ hàng</label>',
        '<button class="btn" type="button" data-x>Hủy</button>' +
        '<button class="btn dt-fs-apply" type="button" id="dtAdSave">Lưu vào dữ liệu chương trình</button>');
      var $a = function (s) { return dlg.$(s); };
      function findCh(name) { var k = dtNormKey(name); for (var i = 0; i < d.chuong.length; i++) if (dtNormKey(d.chuong[i].ten) === k) return d.chuong[i]; return null; }
      function findTp(ch, name) { var k = dtNormKey(name); var l = (ch && ch.chu_de) || []; for (var i = 0; i < l.length; i++) if (dtNormKey(l[i].ten) === k) return l[i]; return null; }
      function refresh() {
        var ch = findCh($a('#dtAdChap').value);
        $a('#dtAdTopicList').innerHTML = ch ? (ch.chu_de || []).map(function (t) { return '<option value="' + esc(t.ten) + '">'; }).join('') : '';
        var tp = ch ? findTp(ch, $a('#dtAdTopic').value) : null;
        var lines = $a('#dtAdOuts').value.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
        var nNew = 0, nDup = 0, seen = {};
        lines.forEach(function (l) {
          var k = dtNormKey(l);
          var dup = seen[k] || (tp && (tp.yccd || []).some(function (e) { return dtNormKey(e) === k; }));
          if (dup) nDup++; else { nNew++; seen[k] = true; }
        });
        var h = '';
        if ($a('#dtAdChap').value.trim()) h += ch ? 'Chương: đã có, dùng lại. ' : 'Chương: sẽ tạo mới. ';
        if ($a('#dtAdTopic').value.trim()) h += tp ? 'Chủ đề: đã có, dùng lại. ' : 'Chủ đề: sẽ tạo mới. ';
        if (lines.length) h += nNew + ' YCCĐ mới' + (nDup ? ', ' + nDup + ' dòng trùng (sẽ bỏ qua)' : '') + '.';
        $a('#dtAdHint').textContent = h;
      }
      ['#dtAdChap', '#dtAdTopic', '#dtAdOuts'].forEach(function (s) { $a(s).addEventListener('input', refresh); });
      refresh();
      $a('#dtAdSave').addEventListener('click', function () {
        var chName = $a('#dtAdChap').value.trim(), tpName = $a('#dtAdTopic').value.trim();
        if (!chName || !tpName) { $a('#dtAdHint').textContent = 'Vui lòng nhập Chương và Chủ đề.'; return; }
        var ch = findCh(chName);
        if (!ch) { ch = { ten: chName, chu_de: [] }; d.chuong.push(ch); }
        ch.chu_de = ch.chu_de || [];
        var tp = findTp(ch, tpName);
        if (!tp) { tp = { ten: tpName, yccd: [] }; ch.chu_de.push(tp); }
        tp.yccd = tp.yccd || [];
        var addedItems = [], skipped = 0;
        $a('#dtAdOuts').value.split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (l) {
          if (tp.yccd.some(function (e) { return dtNormKey(e) === dtNormKey(l); })) { skipped++; return; }
          tp.yccd.push(l); addedItems.push({ chapter: ch.ten, topic: tp.ten, content: l });
        });
        var toCart = $a('#dtAdToCart').checked;
        saveCurr(); renderCurrTree(); fillCurrSelects();
        dlg.close();
        dtToast('Đã bổ sung dữ liệu chương trình: ' + addedItems.length + ' YCCĐ mới' + (skipped ? ', bỏ qua ' + skipped + ' dòng trùng' : '') + '.');
        if (onAdded) onAdded(ch.ten, tp.ten, addedItems, toCart);
      });
    }
    /* Dialog "Import JSON" cho dữ liệu chương trình: kiểm tra trước (Mới/Trùng) rồi mới thêm */
    function openImportCurr(d, onDone) {
      var dlg = dtSubDialog('📥 Import dữ liệu chương trình từ JSON',
        '<p class="sub">Chọn file <b>.json</b> (hoặc dán nội dung) theo mẫu: <b>Chương → Chủ đề → danh sách YCCĐ</b>. Bấm <b>Kiểm tra</b> để xem trước — nội dung đã có sẽ tự bỏ qua, chỉ phần mới được thêm. ' +
        '<button class="btn small" type="button" id="dtImSample">Tải JSON mẫu</button> ' +
        '<button class="btn small" type="button" id="dtImCurrent">Tải Curriculum hiện có (JSON)</button></p>' +
        '<div class="dt-row"><label class="btn small" for="dtImFile">Chọn file .json</label>' +
        '<input type="file" id="dtImFile" accept=".json,application/json" hidden />' +
        '<span class="dt-muted dt-small" id="dtImFileName"></span></div>' +
        '<div class="dt-field"><label for="dtImJson">…hoặc dán nội dung JSON vào đây</label>' +
        '<textarea id="dtImJson" rows="8" spellcheck="false" placeholder="{\n  &quot;mon&quot;: &quot;Toán học&quot;, &quot;lop&quot;: &quot;Lớp 12&quot;,\n  &quot;chuong&quot;: [ { &quot;ten&quot;: &quot;Chương I...&quot;, &quot;chu_de&quot;: [ { &quot;ten&quot;: &quot;...&quot;, &quot;yccd&quot;: [&quot;...&quot;] } ] } ]\n}"></textarea></div>' +
        '<div id="dtImPreview"></div>',
        '<button class="btn" type="button" data-x>Hủy</button>' +
        '<button class="btn" type="button" id="dtImCheck">Kiểm tra</button>' +
        '<button class="btn dt-fs-apply" type="button" id="dtImApply" disabled>Thêm vào Curriculum</button>', true);
      var $i = function (s) { return dlg.$(s); };
      var checkedDocs = null;
      function invalidate() { checkedDocs = null; $i('#dtImApply').disabled = true; $i('#dtImApply').textContent = 'Thêm vào Curriculum'; }
      $i('#dtImSample').addEventListener('click', downloadCurriculumSample);
      $i('#dtImCurrent').addEventListener('click', function () {
        saveText(JSON.stringify(d, null, 2), 'Curriculum_' + noAccent(d.mon + '_' + d.lop) + '.json', 'application/json');
      });
      $i('#dtImFile').addEventListener('change', function () {
        var f = this.files[0]; this.value = ''; if (!f) return;
        if (f.size > 5 * 1024 * 1024) { $i('#dtImPreview').innerHTML = '<p class="dt-msg err">File quá lớn (tối đa 5 MB).</p>'; return; }
        f.text().then(function (txt) { $i('#dtImJson').value = txt; $i('#dtImFileName').textContent = f.name; invalidate(); });
      });
      $i('#dtImJson').addEventListener('input', invalidate);
      $i('#dtImCheck').addEventListener('click', function () {
        var txt = $i('#dtImJson').value.replace(/^\uFEFF/, '').trim();
        if (!txt) { $i('#dtImPreview').innerHTML = '<p class="dt-msg err">Chưa có nội dung JSON.</p>'; return; }
        var docs;
        try { docs = parseCurriculumJson(JSON.parse(txt)); }
        catch (e) { $i('#dtImPreview').innerHTML = '<p class="dt-msg err">JSON không hợp lệ: ' + esc(e.message) + '</p>'; invalidate(); return; }
        if (!docs.length) { $i('#dtImPreview').innerHTML = '<p class="dt-msg err">Không tìm thấy Chương/Chủ đề/YCCĐ nào trong nội dung. Hãy xem file JSON mẫu.</p>'; invalidate(); return; }
        var clone = JSON.parse(JSON.stringify(curriculum));
        var rep = currMergeReport(clone, docs);
        checkedDocs = docs;
        var shown = rep.rows.slice(0, 600);
        $i('#dtImPreview').innerHTML =
          '<p class="dt-small"><b style="color:#059669;">' + rep.added + ' mới</b> · <b style="color:#b45309;">' + rep.skipped + ' trùng (bỏ qua)</b>' +
          (rep.rows.length > shown.length ? ' · chỉ hiện ' + shown.length + ' dòng đầu' : '') + '</p>' +
          '<div class="dt-prev-table"><table><thead><tr><th></th><th>Chương</th><th>Chủ đề</th><th>Yêu cầu cần đạt</th></tr></thead><tbody>' +
          shown.map(function (r) {
            return '<tr><td><span class="dt-tag ' + (r.act === 'add' ? 'new' : 'dup') + '">' + (r.act === 'add' ? 'Mới' : 'Trùng') + '</span></td><td>' + esc(r.chapter) + '</td><td>' + esc(r.topic) + '</td><td>' + esc(r.outcome) + '</td></tr>';
          }).join('') + '</tbody></table></div>';
        $i('#dtImApply').disabled = !rep.added;
        $i('#dtImApply').textContent = rep.added ? ('Thêm ' + rep.added + ' mục vào Curriculum') : 'Thêm vào Curriculum';
      });
      $i('#dtImApply').addEventListener('click', function () {
        if (!checkedDocs) return;
        var rep = currMergeReport(curriculum, checkedDocs);   // gộp thật (kiểm tra trùng lại lần nữa)
        saveCurr(); renderCurrTree(); fillCurrSelects();
        dlg.close();
        dtToast('Đã thêm ' + rep.added + ' mục mới vào dữ liệu chương trình' + (rep.skipped ? ' (bỏ qua ' + rep.skipped + ' mục trùng)' : '') + '.');
        if (onDone) onDone();
      });
    }

    $('dtBtnContent').addEventListener('click', function () {
      var sel = selectedSlots();
      if (!sel.length) { dtMsg('dtMatrixMsg', 'Hãy chọn ít nhất một ô trong lưới trước khi gán.', true); return; }
      var d = currDoc();
      if (!d) { dtMsg('dtMatrixMsg', 'Hãy tạo/chọn một mã kì thi trước khi gán nội dung.', true); return; }
      openContentFs(sel, d);
    });

    function openContentFs(sel, d) {
      if (dtFsCloseFn) dtFsCloseFn();
      var cart = [];   // [{chapter, topic, content}] — khử trùng theo bộ ba
      function inCart(ch, tp, ct) { return cart.some(function (x) { return x.chapter === ch && x.topic === tp && x.content === ct; }); }
      // Nạp sẵn giỏ từ YCCĐ hiện có của các câu đang chọn
      sel.forEach(function (q) {
        (q.outcomes || []).forEach(function (x) {
          var it = typeof x === 'string'
            ? { chapter: q.chapter || '', topic: q.topic || '', content: x }
            : { chapter: x.chapter || x.chuong || q.chapter || '', topic: x.topic || x.chu_de || q.topic || '', content: x.content || x.noi_dung || '' };
          if (it.content && !inCart(it.chapter, it.topic, it.content)) cart.push(it);
        });
      });
      var back = document.createElement('div');
      back.className = 'dt-fs-back';
      back.innerHTML =
        '<div class="dt-fs-head"><span>📖 Gán nội dung kiến thức</span><button type="button" class="dt-fs-x" id="dtFsClose" title="Đóng">✕</button></div>' +
        '<div class="dt-fs-main"><div class="dt-fs-inner">' +
        '<p class="dt-fs-sub">Đang gán nội dung cho <b>' + sel.length + '</b> câu hỏi đang chọn.</p>' +
        '<div class="dt-fs-cols">' +
          '<div class="dt-fs-left">' +
            '<div class="dt-fs-tools"><span class="dt-fs-title">🔍 Bộ lọc Yêu cầu Cần đạt</span><span>' +
            '<button class="btn small dt-fs-apply" type="button" id="dtFsAdd">＋ Bổ sung</button> ' +
            '<button class="btn small" type="button" id="dtFsImport">Import JSON</button> ' +
            '<button class="btn small" type="button" id="dtFsSample">JSON mẫu</button></span></div>' +
            '<div class="dt-fs-selects">' +
              '<div class="dt-field"><label for="dtFsChapter">Chương <button type="button" class="dt-mini-add" id="dtFsAddCh" title="Thêm Chương mới">+</button></label><select id="dtFsChapter"></select></div>' +
              '<div class="dt-field"><label for="dtFsTopic">Chủ đề (Nội dung gốc) <button type="button" class="dt-mini-add" id="dtFsAddTp" title="Thêm Chủ đề mới vào Chương đang chọn">+</button></label><select id="dtFsTopic" disabled></select></div>' +
            '</div>' +
            '<div class="dt-fs-list" id="dtFsYccd"></div>' +
          '</div>' +
          '<div class="dt-fs-right">' +
            '<div class="dt-fs-title">🛒 Giỏ hàng YCCĐ đã tick</div>' +
            '<p class="dt-fs-note">Tất cả YCCĐ trong này sẽ được lưu và chèn vào câu hỏi.</p>' +
            '<div class="dt-fs-cart" id="dtFsCart"></div>' +
          '</div>' +
        '</div>' +
        '<div class="dt-fs-foot"><span class="dt-fs-err" id="dtFsErr"></span>' +
        '<button class="btn" type="button" id="dtFsCancel">Hủy bỏ</button>' +
        '<button class="btn dt-fs-apply" type="button" id="dtFsApply">Áp dụng Giỏ hàng</button></div>' +
        '</div></div>';
      document.body.appendChild(back);
      var closed = false;
      function close() { if (closed) return; closed = true; if (dtSubCloseFn) dtSubCloseFn(); back.remove(); if (dtFsCloseFn === close) dtFsCloseFn = null; }
      dtFsCloseFn = close;
      var $f = function (id) { return back.querySelector('#' + id); };
      function findCh(name) { for (var i = 0; i < d.chuong.length; i++) if (d.chuong[i].ten === name) return d.chuong[i]; return null; }
      function findTp(ch, name) { var l = (ch && ch.chu_de) || []; for (var i = 0; i < l.length; i++) if (l[i].ten === name) return l[i]; return null; }
      function emptyMsg(html) { return '<div class="dt-fs-empty">' + html + '</div>'; }
      function fillChapters(keepCh, keepTp) {
        var chSel = $f('dtFsChapter');
        chSel.innerHTML = '<option value="">-- Chọn Chương --</option>' + d.chuong.map(function (c) { return '<option value="' + esc(c.ten) + '">' + esc(c.ten) + '</option>'; }).join('');
        if (keepCh && findCh(keepCh)) chSel.value = keepCh;
        fillTopics(keepTp);
      }
      function fillTopics(keepTp) {
        var ch = findCh($f('dtFsChapter').value), tpSel = $f('dtFsTopic');
        tpSel.innerHTML = '<option value="">-- Chọn Chủ đề --</option>' + (ch ? (ch.chu_de || []).map(function (t) { return '<option value="' + esc(t.ten) + '">' + esc(t.ten) + '</option>'; }).join('') : '');
        tpSel.disabled = !ch;
        if (keepTp && ch && findTp(ch, keepTp)) tpSel.value = keepTp;
        fillYccd();
      }
      function fillYccd() {
        var box = $f('dtFsYccd');
        var chName = $f('dtFsChapter').value, tpName = $f('dtFsTopic').value;
        var ch = findCh(chName), tp = ch ? findTp(ch, tpName) : null;
        if (!ch) {
          box.innerHTML = emptyMsg(d.chuong.length ? 'Vui lòng chọn Chương và Chủ đề.' :
            'Chưa có dữ liệu chương trình cho môn/lớp này.<br>Bấm <b>Bổ sung</b> hoặc <b>Import JSON</b> ở trên để thêm Chương / Chủ đề / YCCĐ.');
          return;
        }
        if (!tp) { box.innerHTML = emptyMsg('Vui lòng chọn Chủ đề.'); return; }
        box.innerHTML = '';
        if (!(tp.yccd || []).length) box.innerHTML = emptyMsg('Chưa có Yêu cầu cần đạt nào cho Chủ đề này.');
        (tp.yccd || []).forEach(function (y) {
          var lab = document.createElement('label'); lab.className = 'dt-fs-yitem';
          var cb = document.createElement('input'); cb.type = 'checkbox';
          cb.checked = inCart(chName, tpName, y);
          cb.dataset.k = chName + '' + tpName + '' + y;
          cb.addEventListener('change', function () {
            if (cb.checked) { if (!inCart(chName, tpName, y)) cart.push({ chapter: chName, topic: tpName, content: y }); }
            else cart = cart.filter(function (x) { return !(x.chapter === chName && x.topic === tpName && x.content === y); });
            renderCart();
          });
          var sp = document.createElement('span'); sp.textContent = y;
          lab.appendChild(cb); lab.appendChild(sp); box.appendChild(lab);
        });
        var addBtn = document.createElement('button');
        addBtn.type = 'button'; addBtn.className = 'dt-fs-addy'; addBtn.textContent = '＋ Thêm Yêu cầu cần đạt cho Chủ đề này';
        addBtn.addEventListener('click', function () { openAddCurr(d, chName, tpName, afterCurrChange); });
        box.appendChild(addBtn);
      }
      function renderCart() {
        var box = $f('dtFsCart');
        if (!cart.length) { box.innerHTML = '<div class="dt-fs-empty" style="color:#ea580c;">Bạn chưa thêm dòng YCCĐ nào.</div>'; return; }
        box.innerHTML = '';
        cart.forEach(function (x) {
          var row = document.createElement('div'); row.className = 'dt-fs-citem';
          var left = document.createElement('div');
          var cap = document.createElement('div'); cap.className = 'cap'; cap.textContent = (x.chapter || '—') + ' › ' + (x.topic || '—');
          var cnt = document.createElement('div'); cnt.className = 'cnt'; cnt.textContent = x.content;
          left.appendChild(cap); left.appendChild(cnt); row.appendChild(left);
          var del = document.createElement('button');
          del.type = 'button'; del.className = 'dt-fs-cdel'; del.textContent = '🗑'; del.title = 'Gỡ bỏ YCCĐ';
          del.addEventListener('click', function () {
            cart = cart.filter(function (y2) { return !(y2.chapter === x.chapter && y2.topic === x.topic && y2.content === x.content); });
            var key = x.chapter + '' + x.topic + '' + x.content;
            $f('dtFsYccd').querySelectorAll('input[type="checkbox"]').forEach(function (cb) { if (cb.dataset.k === key) cb.checked = false; });
            renderCart();
          });
          row.appendChild(del); box.appendChild(row);
        });
      }
      /* Sau khi Bổ sung/Import làm thay đổi dữ liệu chương trình: giữ Chương/Chủ đề đang chọn, làm mới danh sách */
      function afterCurrChange(chName, tpName, addedItems, toCart) {
        if (toCart && addedItems) addedItems.forEach(function (it) { if (!inCart(it.chapter, it.topic, it.content)) cart.push(it); });
        fillChapters(chName || $f('dtFsChapter').value, tpName || $f('dtFsTopic').value);
        renderCart();
      }
      $f('dtFsChapter').addEventListener('change', function () { fillTopics(); });
      $f('dtFsTopic').addEventListener('change', fillYccd);
      $f('dtFsClose').addEventListener('click', close);
      $f('dtFsCancel').addEventListener('click', close);
      $f('dtFsAdd').addEventListener('click', function () { openAddCurr(d, $f('dtFsChapter').value, $f('dtFsTopic').value, afterCurrChange); });
      $f('dtFsAddCh').addEventListener('click', function () { openAddCurr(d, '', '', afterCurrChange); });
      $f('dtFsAddTp').addEventListener('click', function () {
        var chName = $f('dtFsChapter').value;
        if (!chName) { $f('dtFsErr').textContent = 'Hãy chọn Chương trước khi thêm Chủ đề mới.'; return; }
        $f('dtFsErr').textContent = '';
        openAddCurr(d, chName, '', afterCurrChange);
      });
      $f('dtFsSample').addEventListener('click', downloadCurriculumSample);
      $f('dtFsImport').addEventListener('click', function () { openImportCurr(d, function () { afterCurrChange(); }); });
      $f('dtFsApply').addEventListener('click', function () {
        var chName = $f('dtFsChapter').value, tpName = $f('dtFsTopic').value;
        if (!chName || !tpName) { $f('dtFsErr').textContent = 'Vui lòng chọn một Chương và Chủ đề đại diện (Nội dung gốc) để thống kê ma trận!'; return; }
        sel.forEach(function (q) {
          q.chapter = chName; q.topic = tpName;
          q.outcomes = cart.map(function (x) { return { chapter: x.chapter, topic: x.topic, content: x.content }; });
        });
        saveMatrix(); close(); renderGrid();
        dtMsg('dtMatrixMsg', 'Đã gán nội dung (' + tpName + ', ' + cart.length + ' YCCĐ) cho ' + sel.length + ' ô.');
      });
      // Nạp ban đầu: chọn sẵn Chương/Chủ đề của ô cuối cùng đang chọn (như dự án cũ)
      var last = sel[sel.length - 1];
      fillChapters(last && last.chapter ? last.chapter : '', last && last.topic ? last.topic : '');
      renderCart();
    }

    /* ---------------- Ma trận JSON: xuất / nhập (định dạng dự án cũ) ---------------- */
    function matrixToJson(cfg, slots) {
      return {
        _loai: 'ChdExam-MaTran', _phien_ban: 1, _xuat_luc: new Date().toISOString(), _xuat_boi: 'ChdMathType',
        ma_ki_thi: cfg.examCode, mon: cfg.subject, lop: cfg.grade,
        so_cau: cfg.counts, diem: cfg.scores,
        cau_hoi: slots.map(function (q) {
          var o = { loai: q.type, cau: q.qNum };
          if (q.level) { var lo = levelObj(q); o.muc_do = lo || q.level; }
          if (q.chapter) o.chuong = q.chapter;
          if (q.topic) o.chu_de = q.topic;
          if (q.outcomes && q.outcomes.length) o.yccd = q.outcomes.map(function (x) { return typeof x === 'string' ? x : x.content; });
          if (q.competencies && q.competencies.length) o.nang_luc = q.competencies.slice();
          return o;
        })
      };
    }
    function parseMatrixJson(obj) {
      if (!obj || typeof obj !== 'object') throw new Error('File JSON không hợp lệ.');
      var K2 = function (o, names) { for (var i = 0; i < names.length; i++) if (o[names[i]] != null) return o[names[i]]; return undefined; };
      var code = K2(obj, ['ma_ki_thi', 'maKiThi', 'examCode', 'exam_code']);
      var subject = K2(obj, ['mon', 'subject']);
      var grade = K2(obj, ['lop', 'grade']);
      var countsRaw = K2(obj, ['so_cau', 'soCau', 'counts']) || {};
      var scoresRaw = K2(obj, ['diem', 'scores']) || {};
      var rows = K2(obj, ['cau_hoi', 'cauHoi', 'questions', 'matrix']) || [];
      if (!Array.isArray(rows)) rows = [];
      var counts = {}, scores = {};
      TYPES.forEach(function (t) {
        counts[t] = clamp(countsRaw[t] != null ? countsRaw[t] : rows.filter(function (r) { return (r.loai || r.type) === t; }).length, 0, 200);
        scores[t] = parseFloat(scoresRaw[t]) || 0;
      });
      return { examCode: code ? String(code) : '', subject: subject ? String(subject) : '', grade: grade ? String(grade) : '', counts: counts, scores: scores, rows: rows };
    }
    function slotsFromParsed(p, cfg) {
      var slots = buildSlots(cfg);
      var byKey = {};
      slots.forEach(function (q) { byKey[q.type + '_' + q.qNum] = q; });
      var warns = [];
      p.rows.forEach(function (r) {
        var t = r.loai || r.type, n = r.cau || r.qNum;
        var q = byKey[t + '_' + n];
        if (!q) return;
        var lv = r.muc_do != null ? r.muc_do : r.level;
        if (lv != null) {
          if (typeof lv === 'object') {
            var o = {}, okAll = true;
            ['a', 'b', 'c', 'd'].forEach(function (k) { var v = normLevel(lv[k]); if (lv[k] != null && !v) okAll = false; o[k] = v; });
            q.level = JSON.stringify(o);
            if (!okAll) warns.push(q.id + ': có mức độ ý lạ đã để trống');
          } else {
            var nl = normLevel(lv);
            if (nl) q.level = nl; else warns.push(q.id + ': mức độ "' + lv + '" không nhận ra, đã để trống');
          }
        }
        var ch = r.chuong || r.chapter, tp = r.chu_de || r.topic;
        if (ch) q.chapter = String(ch);
        if (tp) q.topic = String(tp);
        var yc = r.yccd || r.outcomes;
        if (Array.isArray(yc)) q.outcomes = yc.map(function (x) {
          if (typeof x === 'string') return { chapter: q.chapter || '', topic: q.topic || '', content: x };
          return { chapter: x.chuong || x.chapter || q.chapter || '', topic: x.chu_de || x.topic || q.topic || '', content: x.noi_dung || x.content || '' };
        }).filter(function (x) { return x.content; });
        var cp = r.nang_luc || r.competencies;
        if (Array.isArray(cp)) q.competencies = cp.map(function (s) { return String(s).trim().slice(0, 60); }).filter(Boolean).slice(0, 20);
        else if (typeof cp === 'string') q.competencies = cp.split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean);
      });
      return { slots: slots, warns: warns };
    }
    /* ---------------- Nhập ma trận: popup kiểu openImportMatrix của dự án cũ ----------------
       Cả hai nút Nhập JSON / Nhập Excel đều mở popup này (chỉ khác màu / tiêu đề / lời dẫn);
       hộp nào cũng đọc được CẢ Excel (.xlsx) lẫn JSON (tự nhận theo đuôi file).
       Luôn tạo mã kì thi MỚI — không ghi đè mã đã có. App đơn người dùng nên KHÔNG có
       checkbox Phân công như dự án cũ, chỉ còn Mức độ / Nội dung / Năng lực. */
    var DT_DEF_SCORES = { MC: 3, TF: 4, SA: 3, LA: 0 };
    var DT_PART_LABELS = { MC: 'Nhiều lựa chọn (MC)', TF: 'Đúng/Sai (TF)', SA: 'Trả lời ngắn (SA)', LA: 'Tự luận (LA)' };
    function codeExistsCI(code) { var u = String(code || '').toUpperCase(); return !!u && exams.some(function (e) { return String(e.examCode).toUpperCase() === u; }); }
    function suggestImportCode(code) {
      if (!code) return '';
      var s = code + '_IMPORT'; if (!codeExistsCI(s)) return s;
      var i = 2; while (codeExistsCI(code + '_' + i)) i++;
      return code + '_' + i;
    }
    function impRowLevel(r) { var v = r.muc_do != null ? r.muc_do : r.level; if (v == null || v === '') return false; if (typeof v === 'object') return ['a', 'b', 'c', 'd'].some(function (k) { return v[k] != null && v[k] !== ''; }); return true; }
    function impRowContent(r) { var yc = r.yccd || r.outcomes; return !!(r.chuong || r.chapter || r.chu_de || r.topic || (Array.isArray(yc) && yc.length)); }
    function impRowComp(r) { var cp = r.nang_luc || r.competencies; return Array.isArray(cp) ? cp.length > 0 : (typeof cp === 'string' && cp.trim() !== ''); }
    function parseImportData(obj) {
      var p = parseMatrixJson(obj);
      var rawCounts = obj && (obj.so_cau || obj.soCau || obj.counts);
      var rawScores = obj && (obj.diem || obj.scores);
      var countsGiven = {}, scoresGiven = {}, byType = { MC: 0, TF: 0, SA: 0, LA: 0 };
      TYPES.forEach(function (t) {
        countsGiven[t] = !!(rawCounts && rawCounts[t] != null && rawCounts[t] !== '');
        scoresGiven[t] = !!(rawScores && rawScores[t] != null && rawScores[t] !== '');
      });
      p.rows.forEach(function (r) { var t = r.loai || r.type; if (byType[t] != null) byType[t]++; });
      return { code: p.examCode, subject: p.subject, grade: p.grade, counts: p.counts, scores: p.scores, countsGiven: countsGiven, scoresGiven: scoresGiven, rows: p.rows, byType: byType };
    }
    function openImportMatrix(mode) {
      var isJson = mode === 'json';
      var C = isJson ? 'violet' : 'emerald';
      if (dtSubCloseFn) dtSubCloseFn();
      var subjects = [], grades = [];
      curriculum.forEach(function (d) { if (d.mon && subjects.indexOf(d.mon) < 0) subjects.push(d.mon); if (d.lop && grades.indexOf(d.lop) < 0) grades.push(d.lop); });
      var back = document.createElement('div'); back.className = 'dt-sub-back';
      back.innerHTML =
        '<div class="dt-sub-card wide">' +
          '<div class="dt-mx-head ' + C + '"><span>Import ma trận từ ' + (isJson ? 'JSON' : 'Excel') + ' → tạo mã kì thi MỚI</span><button type="button" class="dt-fs-x" data-x title="Đóng">✕</button></div>' +
          '<div class="dt-sub-body">' +
            '<div class="dt-mx-guide ' + C + '">' +
              (isJson ? 'Chọn file <b>.json</b> xuất từ nút <b>Xuất JSON</b> (hoặc sửa từ file mẫu, hoặc dán nội dung JSON ở dưới).'
                      : 'Chọn file <b>.xlsx</b> xuất từ nút <b>Xuất Excel</b> (hoặc sửa từ file mẫu).') +
              ' Hệ thống <b>luôn tạo mã kì thi mới</b> – không ghi đè mã đã có. Mục nào thiếu (mức độ, nội dung, năng lực) vẫn nhập được, bổ sung sau.' +
              ' <span style="opacity:.75">Hộp này nhận <b>cả Excel lẫn JSON</b> (tự nhận theo loại file).</span>' +
              ' <button type="button" id="mxSample">Tải file mẫu (' + (isJson ? '.json' : '.xlsx') + ')</button>' +
            '</div>' +
            '<div class="dt-mx-drop" id="mxDrop">' +
              '<label class="btn small" style="cursor:pointer;">Chọn file ' + (isJson ? 'JSON' : 'Excel') + '<input type="file" id="mxFile" accept="' + (isJson ? '.json,application/json,.xlsx' : '.xlsx,.json,application/json') + '" hidden /></label>' +
              '<span class="dt-muted" id="mxFileName">…hoặc kéo-thả file vào khung này</span>' +
            '</div>' +
            (isJson ? '<div class="dt-row" style="align-items:flex-start;"><div class="dt-field" style="flex:1 1 420px;"><label for="mxJson">…hoặc dán nội dung JSON</label><textarea id="mxJson" rows="3" placeholder=\'{ "ma_ki_thi": "...", "mon": "...", "lop": "...", "so_cau": {...}, "cau_hoi": [...] }\'></textarea></div><button type="button" class="btn small" id="mxRead" style="margin-top:20px;">Đọc</button></div>' : '') +
            '<div id="mxParseMsg"></div>' +
            '<div class="dt-grid-form" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr));">' +
              '<div class="dt-field"><label for="mxCode">Mã kì thi mới *</label><input type="text" id="mxCode" class="dt-mx-code" maxlength="80" autocomplete="off" spellcheck="false" placeholder="VD: HK1_TOAN12" /><div class="dt-mx-hint" id="mxCodeHint"></div></div>' +
              '<div class="dt-field"><label for="mxSubject">Môn học *</label><input type="text" id="mxSubject" list="mxSubjectList" maxlength="100" autocomplete="off" placeholder="Chọn hoặc gõ" /><datalist id="mxSubjectList">' + subjects.map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join('') + '</datalist><div class="dt-mx-hint" id="mxSubjectHint"></div></div>' +
              '<div class="dt-field"><label for="mxGrade">Lớp *</label><input type="text" id="mxGrade" list="mxGradeList" maxlength="50" autocomplete="off" placeholder="Chọn hoặc gõ" /><datalist id="mxGradeList">' + grades.map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join('') + '</datalist><div class="dt-mx-hint" id="mxGradeHint"></div></div>' +
            '</div>' +
            '<div><div class="dt-field"><label>Số câu &amp; điểm từng phần <span style="font-weight:400">(ô trái: số câu · ô phải: điểm)</span></label></div>' +
            '<div class="dt-mx-parts">' + TYPES.map(function (t) {
              return '<div class="dt-mx-part"><div class="nm">' + DT_PART_LABELS[t] + '</div><div class="inps"><input type="number" id="mxCount' + t + '" min="0" max="200" value="0" title="Số câu" /><input type="number" id="mxScore' + t + '" min="0" step="0.1" value="' + DT_DEF_SCORES[t] + '" title="Tổng điểm phần này" /></div><div class="dt-mx-diff" id="mxDiff' + t + '"></div></div>';
            }).join('') + '</div></div>' +
            '<div><div class="dt-field"><label>Nhập kèm dữ liệu từng câu</label></div>' +
            '<div class="dt-mx-cps">' +
              '<label class="dt-mx-cp"><input type="checkbox" id="mxCpLevel" checked /><span class="dot" style="background:#3b82f6"></span>Mức độ<span class="st" id="mxStatLv"></span></label>' +
              '<label class="dt-mx-cp"><input type="checkbox" id="mxCpContent" checked /><span class="dot" style="background:#f97316"></span>Nội dung<span class="st" id="mxStatCt"></span></label>' +
              '<label class="dt-mx-cp"><input type="checkbox" id="mxCpComp" checked /><span class="dot" style="background:#ec4899"></span>Năng lực<span class="st" id="mxStatCp"></span></label>' +
            '</div></div>' +
            '<div id="mxWarn"></div>' +
            '<label class="dt-checkline"><input type="checkbox" id="mxSaveNow" checked /> Lưu lên hệ thống ngay sau khi nhập <span class="dt-muted">(bỏ tick để xem trước trên màn hình, bấm «Lưu ma trận» sau)</span></label>' +
            '<div class="dt-mx-sum" id="mxSummary"></div>' +
          '</div>' +
          '<div class="dt-sub-foot"><button type="button" class="btn" data-x>Hủy</button><button type="button" class="btn primary" id="mxOk" disabled>Nhập ma trận</button></div>' +
        '</div>';
      document.body.appendChild(back);
      var closed = false;
      function close() { if (closed) return; closed = true; back.remove(); if (dtSubCloseFn === close) dtSubCloseFn = null; document.removeEventListener('keydown', onKey, true); }
      dtSubCloseFn = close;
      function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-x]')) close(); });
      var $f = function (s) { return back.querySelector(s); };
      var codeIn = $f('#mxCode'), subjIn = $f('#mxSubject'), gradeIn = $f('#mxGrade');
      var cntIn = {}, scrIn = {};
      TYPES.forEach(function (t) { cntIn[t] = $f('#mxCount' + t); scrIn[t] = $f('#mxScore' + t); });
      var parsed = { code: '', subject: '', grade: '', counts: { MC: 0, TF: 0, SA: 0, LA: 0 }, scores: {}, countsGiven: {}, scoresGiven: {}, rows: [], byType: { MC: 0, TF: 0, SA: 0, LA: 0 } };
      var fileCode = '';
      function read() {
        var counts = {}, scores = {};
        TYPES.forEach(function (t) {
          counts[t] = clamp(cntIn[t].value, 0, 200);
          var sv = parseFloat(scrIn[t].value); scores[t] = isNaN(sv) ? DT_DEF_SCORES[t] : sv;
        });
        return { examCode: codeIn.value.trim().toUpperCase(), subject: subjIn.value.trim(), grade: gradeIn.value.trim(), counts: counts, scores: scores };
      }
      function applyCopyFlags(rows) {
        var lv = $f('#mxCpLevel').checked, ct = $f('#mxCpContent').checked, cp = $f('#mxCpComp').checked;
        if (lv && ct && cp) return rows;
        return rows.map(function (r) {
          var x = JSON.parse(JSON.stringify(r));
          if (!lv) { delete x.muc_do; delete x.level; }
          if (!ct) { delete x.chuong; delete x.chapter; delete x.chu_de; delete x.topic; delete x.yccd; delete x.outcomes; }
          if (!cp) { delete x.nang_luc; delete x.competencies; }
          return x;
        });
      }
      function refresh() {
        var c = read();
        var exists = codeExistsCI(c.examCode);
        var ch = $f('#mxCodeHint');
        if (!c.examCode) {
          ch.className = 'dt-mx-hint err';
          ch.innerHTML = fileCode && codeExistsCI(fileCode)
            ? 'Mã gốc «' + esc(fileCode) + '» đã tồn tại – không ghi đè. Hãy đặt mã mới, hoặc <button type="button" id="mxUseSuggest">Dùng «' + esc(suggestImportCode(fileCode)) + '»</button>'
            : 'Bắt buộc';
        } else if (exists) {
          ch.className = 'dt-mx-hint err';
          ch.innerHTML = 'Mã đã tồn tại – không ghi đè. <button type="button" id="mxUseSuggest">Dùng «' + esc(suggestImportCode(c.examCode)) + '»</button>';
        } else { ch.className = 'dt-mx-hint ok'; ch.textContent = 'Mã mới hợp lệ'; }
        var sug = $f('#mxUseSuggest');
        if (sug) sug.addEventListener('click', function () { codeIn.value = suggestImportCode(c.examCode || fileCode); refresh(); });
        var known = function (list, v) { return list.some(function (x) { return dtNormKey(x) === dtNormKey(v); }); };
        var sh = $f('#mxSubjectHint');
        if (!c.subject) { sh.className = 'dt-mx-hint'; sh.textContent = 'Bắt buộc'; }
        else if (!known(subjects, c.subject)) { sh.className = 'dt-mx-hint warn'; sh.textContent = 'Môn chưa có trong Curriculum (vẫn nhập được)'; }
        else { sh.className = 'dt-mx-hint'; sh.textContent = ''; }
        var gh = $f('#mxGradeHint');
        if (!c.grade) { gh.className = 'dt-mx-hint'; gh.textContent = 'Bắt buộc'; }
        else if (!known(grades, c.grade)) { gh.className = 'dt-mx-hint warn'; gh.textContent = 'Lớp chưa có trong Curriculum (vẫn nhập được)'; }
        else { gh.className = 'dt-mx-hint'; gh.textContent = ''; }
        TYPES.forEach(function (t) {
          var a = parsed.byType[t] || 0, b = c.counts[t], el = $f('#mxDiff' + t);
          if (!a) { el.className = 'dt-mx-diff mut'; el.textContent = b ? b + ' câu trống' : ''; }
          else if (a === b) { el.className = 'dt-mx-diff mut'; el.textContent = a + ' câu từ file'; }
          else if (b < a) { el.className = 'dt-mx-diff err'; el.textContent = 'file ' + a + ' câu → bỏ câu ' + (b + 1) + (a - b > 1 ? '–' + a : ''); }
          else { el.className = 'dt-mx-diff ok'; el.textContent = 'file ' + a + ' câu, +' + (b - a) + ' câu trống'; }
        });
        var kept = [];
        TYPES.forEach(function (t) { var n = 0; parsed.rows.forEach(function (r) { if ((r.loai || r.type) === t && n < c.counts[t]) { kept.push(r); n++; } }); });
        var total = TYPES.reduce(function (s, t) { return s + c.counts[t]; }, 0);
        var stLv = kept.filter(impRowLevel).length, stCt = kept.filter(impRowContent).length, stCp = kept.filter(impRowComp).length;
        $f('#mxStatLv').textContent = total ? stLv + '/' + total : '';
        $f('#mxStatCt').textContent = total ? stCt + '/' + total : '';
        $f('#mxStatCp').textContent = total ? stCp + '/' + total : '';
        var warns = [];
        if (parsed.rows.length) {
          var probe = slotsFromParsed({ rows: applyCopyFlags(parsed.rows) }, { examCode: c.examCode || 'MX', subject: c.subject, grade: c.grade, counts: c.counts, scores: c.scores });
          warns = probe.warns.slice(0, 6);
        }
        var missing = [];
        if (total) {
          if (stLv < total) missing.push((total - stLv) + ' câu chưa có mức độ');
          if (stCt < total) missing.push((total - stCt) + ' câu chưa có nội dung');
          if (stCp < total) missing.push((total - stCp) + ' câu chưa có năng lực');
        }
        $f('#mxWarn').innerHTML = (warns.length || missing.length)
          ? '<div class="dt-mx-warn">' + warns.map(function (w) { return '<div>⚠ ' + esc(w) + '</div>'; }).join('') +
            (missing.length ? '<div>Còn thiếu: ' + esc(missing.join(' · ')) + ' – <b>vẫn nhập được</b>, bổ sung sau trong Exam Manager.</div>' : '') + '</div>'
          : '';
        var pts = TYPES.reduce(function (s, t) { return s + (c.counts[t] ? c.scores[t] : 0); }, 0);
        $f('#mxSummary').innerHTML = 'Sẽ tạo mã <b>' + esc(c.examCode || '…') + '</b>: <b>' + total + '</b> câu · tổng <b>' + (Math.round(pts * 100) / 100) + '</b> điểm · ' + esc(c.subject || '…') + ' – ' + esc(c.grade || '…') + '.';
        $f('#mxOk').disabled = !c.examCode || exists || !c.subject || !c.grade || total === 0;
      }
      function fail(msg) { $f('#mxParseMsg').innerHTML = '<div class="dt-mx-err">' + esc(msg) + '</div>'; }
      function load(obj, name, given) {
        $f('#mxParseMsg').innerHTML = '';
        var d;
        try { d = parseImportData(obj); } catch (e) { fail(e.message); return; }
        if (given) { d.countsGiven = given.counts; d.scoresGiven = given.scores; }
        parsed = d; fileCode = d.code || '';
        codeIn.value = (d.code && !codeExistsCI(d.code)) ? d.code : '';   // mã gốc đã tồn tại → để trống cho user tự đặt
        subjIn.value = d.subject || '';
        gradeIn.value = d.grade || '';
        TYPES.forEach(function (t) { cntIn[t].value = d.counts[t] || 0; scrIn[t].value = d.scoresGiven[t] ? d.scores[t] : DT_DEF_SCORES[t]; });
        var miss = [];
        if (!d.code) miss.push('Mã kì thi');
        if (!d.subject) miss.push('Môn');
        if (!d.grade) miss.push('Lớp');
        if (!TYPES.some(function (t) { return d.countsGiven[t]; }) && !d.rows.length) miss.push('Số câu');
        var missScore = !TYPES.some(function (t) { return d.scoresGiven[t]; });
        if (missScore) miss.push('Điểm');
        $f('#mxParseMsg').innerHTML = '<div class="dt-mx-okmsg">Đã đọc ' + (name ? '<b>' + esc(name) + '</b>: ' : '') + d.rows.length + ' câu' +
          (d.code ? ' · mã gốc ' + esc(d.code) : '') + '.' +
          (miss.length ? ' <span class="warnpart">File thiếu: ' + miss.join(', ') + ' – hãy nhập bên dưới' + (missScore ? ' (điểm đang để mặc định)' : '') + '.</span>' : '') + '</div>';
        refresh();
        if (!codeIn.value) codeIn.focus();
      }
      function loadFile(f) {
        if (!f) return;
        $f('#mxFileName').textContent = f.name;
        if (f.size > 5 * 1024 * 1024) { fail('File quá lớn (tối đa 5 MB).'); return; }
        var ext = (f.name.split('.').pop() || '').toLowerCase();
        if (ext === 'json') {
          f.text().then(function (txt) {
            var data;
            try { data = JSON.parse(txt.replace(/^\uFEFF/, '').trim()); } catch (e) { fail('File JSON không hợp lệ: ' + e.message); return; }
            load(data, f.name);
          }, function () { fail('Không đọc được file.'); });
          return;
        }
        if (ext === 'xlsx') {
          f.arrayBuffer().then(function (ab) { return readXlsx(ab); }).then(function (book) {
            if (!book['Ma trận'] && !book['Ma tran'] && !book['Cấu hình'] && !book['Cau hinh']) { fail('Không tìm thấy trang "Ma trận" hay trang "Cấu hình" trong file Excel. Hãy dùng file mẫu.'); return; }
            var given = null;
            if (!book['Cấu hình'] && !book['Cau hinh']) { var cg = {}, sg = {}; TYPES.forEach(function (t) { cg[t] = false; sg[t] = false; }); given = { counts: cg, scores: sg }; }
            load(matrixFromWorkbook(book), f.name, given);
          }).catch(function (e) { fail('Không đọc được file Excel: ' + e.message); });
          return;
        }
        fail('Định dạng ".' + ext + '" chưa đọc được trong bản này — hãy dùng file .xlsx hoặc .json (mở file bằng Excel rồi Lưu thành .xlsx nếu cần).');
      }
      $f('#mxSample').addEventListener('click', function () { downloadSample(isJson ? 'json' : 'xlsx'); });
      $f('#mxFile').addEventListener('change', function () { loadFile(this.files && this.files[0]); this.value = ''; });
      var drop = $f('#mxDrop');
      ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
      drop.addEventListener('drop', function (e) { loadFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
      var readBtn = $f('#mxRead');
      if (readBtn) readBtn.addEventListener('click', function () {
        var t = String($f('#mxJson').value || '').replace(/^\uFEFF/, '').trim();
        if (!t) { fail('Chưa có nội dung JSON để đọc.'); return; }
        var data; try { data = JSON.parse(t); } catch (e) { fail('JSON không hợp lệ: ' + e.message); return; }
        $f('#mxFileName').textContent = 'Nội dung dán vào';
        load(data, '');
      });
      back.querySelectorAll('input, textarea').forEach(function (el) { el.addEventListener('input', refresh); el.addEventListener('change', refresh); });
      codeIn.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !$f('#mxOk').disabled) $f('#mxOk').click(); });
      refresh();
      $f('#mxOk').addEventListener('click', function () {
        var c = read();
        if (!c.examCode || codeExistsCI(c.examCode) || !c.subject || !c.grade) { refresh(); return; }
        var cfg = { examCode: c.examCode, subject: c.subject, grade: c.grade, counts: c.counts, scores: c.scores };
        var res = slotsFromParsed({ rows: applyCopyFlags(parsed.rows) }, cfg);
        var saveNow = $f('#mxSaveNow').checked;
        var warnTxt = res.warns.length ? ' Cảnh báo: ' + res.warns.slice(0, 5).join('; ') : '';
        close();
        if (saveNow) {
          createExam(cfg, res.slots, 'Đã nhập ma trận → mã mới ' + cfg.examCode + ' (' + res.slots.length + ' ô) và đã lưu lên hệ thống.' + warnTxt);
          dtToast('Đã nhập ma trận ' + cfg.examCode + ' (' + res.slots.length + ' ô).');
        } else {
          createExam(cfg, res.slots, 'Đã nhập ma trận → mã mới ' + cfg.examCode + ' (' + res.slots.length + ' ô) — CHƯA lưu lên hệ thống. Kiểm tra rồi bấm «Lưu ma trận» để ghi lại.' + warnTxt, { noSave: true });
          dtToast('Đã nhập ' + cfg.examCode + ' (xem trước) — bấm «Lưu ma trận» để ghi lên hệ thống.');
        }
      });
    }
    /* File mẫu ma trận: 2 định dạng từ cùng một object mẫu (như dự án cũ) — radio chọn Excel (.xlsx) hoặc JSON (.json) */
    function sampleMatrixObj() {
      var o = JSON.parse(JSON.stringify(SAMPLE_MATRIX));
      var c = examCfg(curCode);
      if (c) { o.mon = c.subject || o.mon; o.lop = c.grade || o.lop; }   // môn/lớp theo cấu hình đang mở
      return o;
    }
    function downloadSample(fmt) {
      var o = sampleMatrixObj();
      if (fmt === 'json') {
        saveText(JSON.stringify(o, null, 2), 'MaTran_mau.json', 'application/json');
        dtMsg('dtMatrixMsg', 'Đã tải file mẫu MaTran_mau.json — sửa nội dung rồi dùng nút "Nhập JSON" (luôn tạo mã kì thi mới, không ghi đè).');
        return;
      }
      if (!window.JSZip) { dtMsg('dtMatrixMsg', 'Thư viện JSZip chưa tải được — kiểm tra mạng rồi thử lại.', true); return; }
      var p = parseMatrixJson(o);
      var cfg = { examCode: p.examCode, subject: p.subject, grade: p.grade, counts: p.counts, scores: p.scores };
      var slots = slotsFromParsed(p, cfg).slots;   // chuyển object mẫu → slot nội bộ (khóa _ghi_chu tự bị bỏ qua)
      buildXlsx(matrixWorkbookSheets(cfg, slots, { 'Ghi chú': 'File mẫu – sửa rồi dùng Import Excel' })).then(function (blob) {
        saveBlob(blob, 'MaTran_mau.xlsx');
        dtMsg('dtMatrixMsg', 'Đã tải file mẫu MaTran_mau.xlsx — sửa nội dung rồi dùng nút "Nhập Excel" (luôn tạo mã kì thi mới, không ghi đè).');
      }).catch(function (e) { dtMsg('dtMatrixMsg', 'Lỗi tạo file mẫu Excel: ' + e.message, true); });
    }
    $('dtSampleDl').addEventListener('click', function () {
      var fmt = (document.querySelector('input[name="dtSampleFmt"]:checked') || {}).value || 'xlsx';
      downloadSample(fmt);
    });
    $('dtExpJson').addEventListener('click', function () {
      var c = examCfg(curCode); if (!c) { dtMsg('dtMatrixMsg', 'Chưa có mã kì thi nào để xuất.', true); return; }
      saveText(JSON.stringify(matrixToJson(c, matrix), null, 2), 'MaTran_' + noAccent(curCode) + '_' + stamp() + '.json', 'application/json');
    });
    $('dtImpJson').addEventListener('click', function () { openImportMatrix('json'); });

    /* ---------------- XLSX tối thiểu (ghi bằng JSZip, đọc bằng DOMParser) ---------------- */
    function xEsc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    // sheets: [{name, rows: [[{v, s}] | primitive], merges: ['A1:B2'], widths: [w,...]}]
    // style index s: 0 thường, 1 đậm, 2 đậm + nền vàng, 3 nền xám nhạt, 4 đậm + nền xanh nhạt
    function buildXlsx(sheets) {
      var zip = new window.JSZip();
      var ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'];
      sheets.forEach(function (sh, i) { ct.push('<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'); });
      ct.push('</Types>');
      zip.file('[Content_Types].xml', ct.join(''));
      zip.folder('_rels').file('.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
      var wb = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'];
      var rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'];
      sheets.forEach(function (sh, i) {
        wb.push('<sheet name="' + xEsc(sh.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>');
        rels.push('<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>');
      });
      rels.push('<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
      wb.push('</sheets></workbook>'); rels.push('</Relationships>');
      zip.folder('xl').file('workbook.xml', wb.join(''));
      zip.folder('xl/_rels').file('workbook.xml.rels', rels.join(''));
      /* Bảng style dùng chung. Chỉ số s của ô:
         0 thường · 1 đậm · 2 đậm+nền kem · 3 nền xám · 4 đậm+nền xanh nhạt
         5 tiêu đề xanh lá (chữ trắng) · 6 tiêu đề slate #1E293B (chữ trắng) · 7 nhãn đậm có viền · 8 giá trị nền vàng nhạt có viền
         9 ghi chú nghiêng xám có viền · 10 dữ liệu có viền + wrap · 11 dữ liệu có viền, không wrap
         12–15 ô Loại đậm tô nền theo loại (MC/TF/SA/LA) · 16–19 ô Câu tô nền theo loại · 20 tiêu đề Hướng dẫn · 21 dòng hướng dẫn · 22 chữ xám nhỏ
         23 dữ liệu có viền, căn giữa · 24 hàng tổng: nhãn đậm có viền · 25 hàng tổng: số đậm có viền, căn giữa
         26–39: bộ style cho Excel "Xem & tải ma trận" bám file mẫu dự án cũ — toàn bộ Times New Roman:
         26 tiêu đề lớn (đậm 14, căn giữa) · 27 tiêu đề khaki F0E68C · 28/29/30 tiêu đề tô theo loại MC/TF/SA
         31/32/33 ô đếm tô theo loại MC/TF/SA · 34 ô đếm không tô · 35 chữ căn trái · 36 chữ căn trái đậm (chương)
         37 TT/tổng cột đậm căn giữa · 38 hàng tổng nhãn (nền F8FAFC, căn giữa như mẫu) · 39 hàng tổng số (nền F8FAFC, căn giữa)
         Ô giàu chữ (rich text): cell = { rich: [{t:'…'}, {t:'…', p:1}], s: 23 } — đoạn p:1 in màu tím (năng lực, như bảng trên màn hình) */
      zip.folder('xl').file('styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="9">' +
        '<font><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>' +
        '<font><i/><color rgb="FF64748B"/><sz val="11"/><name val="Calibri"/></font>' +
        '<font><b/><color rgb="FF059669"/><sz val="13"/><name val="Calibri"/></font>' +
        '<font><color rgb="FF94A3B8"/><sz val="11"/><name val="Calibri"/></font>' +
        '<font><sz val="11"/><name val="Times New Roman"/></font>' +
        '<font><b/><sz val="11"/><name val="Times New Roman"/></font>' +
        '<font><b/><sz val="14"/><name val="Times New Roman"/></font>' +
        '</fonts>' +
        '<fills count="17"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFEDEDED"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF059669"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF1E293B"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFEFCE8"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFEEF2FF"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF7ED"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFF1F2"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF0E68C"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFE0F2FE"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFD1FAE5"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFCE7F3"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/></patternFill></fill></fills>' +
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="40">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="4" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="2" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>' +
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="10" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="11" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="11" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="8" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="7" fillId="12" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="7" fillId="13" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="7" fillId="14" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="7" fillId="15" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="6" fillId="13" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="6" fillId="14" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="6" fillId="15" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>' +
        '<xf numFmtId="0" fontId="7" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>' +
        '<xf numFmtId="0" fontId="7" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="7" fillId="16" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '<xf numFmtId="0" fontId="7" fillId="16" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf>' +
        '</cellXfs></styleSheet>');
      function colName(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
      sheets.forEach(function (sh, si) {
        var x = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];
        // Đóng băng khung (freeze panes) nếu sheet yêu cầu
        var fz = sh.freeze || {};
        if (fz.x || fz.y) {
          var tl = colName(fz.x || 0) + ((fz.y || 0) + 1);
          var pane = fz.x && fz.y ? 'bottomRight' : (fz.x ? 'topRight' : 'bottomLeft');
          x.push('<sheetViews><sheetView workbookViewId="0"><pane' +
            (fz.x ? ' xSplit="' + fz.x + '"' : '') + (fz.y ? ' ySplit="' + fz.y + '"' : '') +
            ' topLeftCell="' + tl + '" activePane="' + pane + '" state="frozen"/>' +
            '<selection pane="' + pane + '" activeCell="' + tl + '" sqref="' + tl + '"/></sheetView></sheetViews>');
        } else x.push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
        if (sh.widths) { x.push('<cols>'); sh.widths.forEach(function (w, i) { x.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'); }); x.push('</cols>'); }
        x.push('<sheetData>');
        (sh.rows || []).forEach(function (row, ri) {
          var rh = sh.rowH && sh.rowH[ri] ? ' ht="' + sh.rowH[ri] + '" customHeight="1"' : '';
          x.push('<row r="' + (ri + 1) + '"' + rh + '>');
          (row || []).forEach(function (cell, ci) {
            if (cell == null || cell === '') return;
            var ref = colName(ci) + (ri + 1);
            var st = (typeof cell === 'object' && cell.s) ? ' s="' + cell.s + '"' : '';
            if (typeof cell === 'object' && cell.rich) {   // rich text: nhiều đoạn chữ, đoạn p=1 màu tím
              var runs = cell.rich.map(function (rn) {
                return '<r>' + (rn.p ? '<rPr><color rgb="FF7B3FA0"/><sz val="11"/><rFont val="Calibri"/></rPr>' : '') + '<t xml:space="preserve">' + xEsc(rn.t) + '</t></r>';
              }).join('');
              x.push('<c r="' + ref + '"' + st + ' t="inlineStr"><is>' + runs + '</is></c>');
              return;
            }
            var v = (typeof cell === 'object') ? cell.v : cell;
            if (v == null || v === '') { x.push('<c r="' + ref + '"' + st + '/>'); return; }   // ô trống nhưng vẫn giữ style/viền
            if (typeof v === 'number' && isFinite(v)) x.push('<c r="' + ref + '"' + st + '><v>' + v + '</v></c>');
            else x.push('<c r="' + ref + '"' + st + ' t="inlineStr"><is><t xml:space="preserve">' + xEsc(v) + '</t></is></c>');
          });
          x.push('</row>');
        });
        x.push('</sheetData>');
        if (sh.filter) x.push('<autoFilter ref="' + sh.filter + '"/>');
        if (sh.merges && sh.merges.length) {
          x.push('<mergeCells count="' + sh.merges.length + '">');
          sh.merges.forEach(function (m) { x.push('<mergeCell ref="' + m + '"/>'); });
          x.push('</mergeCells>');
        }
        if (sh.validations && sh.validations.length) {
          x.push('<dataValidations count="' + sh.validations.length + '">');
          sh.validations.forEach(function (dv) {
            x.push('<dataValidation type="list" allowBlank="1"' +
              (dv.showError ? ' showErrorMessage="1" errorTitle="' + xEsc(dv.errorTitle || '') + '" error="' + xEsc(dv.error || '') + '"' : ' showErrorMessage="0"') +
              ' sqref="' + dv.ref + '"><formula1>"' + xEsc(dv.list) + '"</formula1></dataValidation>');
          });
          x.push('</dataValidations>');
        }
        x.push('</worksheet>');
        zip.folder('xl/worksheets').file('sheet' + (si + 1) + '.xml', x.join(''));
      });
      return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    }
    function parseXmlText(txt) { return new DOMParser().parseFromString(txt, 'text/xml'); }
    function readXlsx(arrayBuffer) {
      return window.JSZip.loadAsync(arrayBuffer).then(function (zip) {
        var shared = [];
        var ssFile = zip.file('xl/sharedStrings.xml');
        var p = ssFile ? ssFile.async('string').then(function (txt) {
          var doc = parseXmlText(txt);
          var sis = doc.getElementsByTagName('si');
          for (var i = 0; i < sis.length; i++) {
            var ts = sis[i].getElementsByTagName('t'), s = '';
            for (var j = 0; j < ts.length; j++) s += ts[j].textContent;
            shared.push(s);
          }
        }) : Promise.resolve();
        return p.then(function () {
          return zip.file('xl/workbook.xml').async('string').then(function (wbTxt) {
            var wb = parseXmlText(wbTxt);
            var sheetEls = wb.getElementsByTagName('sheet');
            var names = [];
            for (var i = 0; i < sheetEls.length; i++) names.push(sheetEls[i].getAttribute('name') || ('Sheet' + (i + 1)));
            var out = {};
            var chain = Promise.resolve();
            names.forEach(function (nm, i) {
              chain = chain.then(function () {
                var f = zip.file('xl/worksheets/sheet' + (i + 1) + '.xml');
                if (!f) { out[nm] = []; return; }
                return f.async('string').then(function (txt) {
                  var doc = parseXmlText(txt);
                  var rows = [];
                  var rowEls = doc.getElementsByTagName('row');
                  for (var r = 0; r < rowEls.length; r++) {
                    var cells = [], cEls = rowEls[r].getElementsByTagName('c');
                    for (var c = 0; c < cEls.length; c++) {
                      var ref = cEls[c].getAttribute('r') || '';
                      var col = 0; var mm = /^([A-Z]+)/.exec(ref);
                      if (mm) { col = 0; for (var k = 0; k < mm[1].length; k++) col = col * 26 + (mm[1].charCodeAt(k) - 64); col--; }
                      var t = cEls[c].getAttribute('t');
                      var val = '';
                      if (t === 'inlineStr') { var is = cEls[c].getElementsByTagName('t'); val = ''; for (var q = 0; q < is.length; q++) val += is[q].textContent; }
                      else { var v = cEls[c].getElementsByTagName('v')[0]; val = v ? v.textContent : ''; if (t === 's') val = shared[parseInt(val, 10)] || ''; }
                      while (cells.length < col) cells.push('');
                      cells[col] = val;
                    }
                    rows.push(cells);
                  }
                  out[nm] = rows;
                });
              });
            });
            return chain.then(function () { return out; });
          });
        });
      });
    }

    /* ---------------- Excel ma trận (3 sheet, phong cách buildMatrixWorkbook của dự án cũ) ---------------- */
    /* YCCĐ → ô Excel: mỗi dòng 1 YCCĐ; YCCĐ thuộc Chương/Chủ đề khác với chương/chủ đề của câu
       thì ghi dạng "[Chương | Chủ đề] nội dung" (đúng outsToCell của dự án cũ). */
    function outsToCell(q) {
      return (q.outcomes || []).map(function (x) {
        if (typeof x === 'string') return x;
        var c = x.content || x.noi_dung || '';
        var ch = x.chapter || x.chuong || '', tp = x.topic || x.chu_de || '';
        if ((ch && ch !== (q.chapter || '')) || (tp && tp !== (q.topic || ''))) return '[' + ch + ' | ' + tp + '] ' + c;
        return c;
      }).join('\n');
    }
    var MX_TYPE_STYLE = { MC: 12, TF: 13, SA: 14, LA: 15 };   // ô Loại (đậm, tô nền theo loại)
    var MX_NUM_STYLE = { MC: 16, TF: 17, SA: 18, LA: 19 };    // ô Câu (tô nền theo loại)
    function matrixWorkbookSheets(cfg, slots, info) {
      // 1) Cấu hình — đúng CFG_ROWS của dự án cũ
      var CFG_ROWS = [
        ['Mã kì thi', cfg.examCode, 'Mã khi nhập phải là mã MỚI (không trùng mã đã có)'],
        ['Môn', cfg.subject, 'VD: Toán học'], ['Lớp', cfg.grade, 'VD: Lớp 12'],
        ['Số câu MC', cfg.counts.MC, 'Nhiều lựa chọn'], ['Số câu TF', cfg.counts.TF, 'Đúng/Sai'],
        ['Số câu SA', cfg.counts.SA, 'Trả lời ngắn'], ['Số câu LA', cfg.counts.LA, 'Tự luận'],
        ['Điểm MC', cfg.scores.MC, 'Tổng điểm phần MC'], ['Điểm TF', cfg.scores.TF, 'Tổng điểm phần TF'],
        ['Điểm SA', cfg.scores.SA, 'Tổng điểm phần SA'], ['Điểm LA', cfg.scores.LA, 'Tổng điểm phần LA']
      ];
      var cfgSheet = [[{ v: 'Mục', s: 5 }, { v: 'Giá trị', s: 5 }, { v: 'Ghi chú', s: 5 }]];
      CFG_ROWS.forEach(function (r) { cfgSheet.push([{ v: r[0], s: 7 }, { v: r[1], s: 8 }, { v: r[2], s: 9 }]); });
      cfgSheet.push([]);
      cfgSheet.push([{ v: 'Loại file', s: 22 }, { v: 'ChdExam-MaTran v1', s: 22 }, { v: 'Không sửa dòng này', s: 22 }]);
      if (info) Object.keys(info).forEach(function (k) { cfgSheet.push([{ v: k, s: 22 }, { v: info[k], s: 22 }, { v: '', s: 22 }]); });
      // 2) Ma trận — 14 cột như dự án cũ (3 cột GV/Ngân hàng giữ để tương thích 2 chiều, để trống)
      var head = ['Loại', 'Câu', 'Mức độ', 'Ý a', 'Ý b', 'Ý c', 'Ý d', 'Chương', 'Chủ đề', 'Yêu cầu cần đạt', 'Năng lực', 'Email GV', 'Tên GV', 'Ngân hàng'];
      var rows = [head.map(function (h) { return { v: h, s: 6 }; })];
      slots.forEach(function (q) {
        var lo = levelObj(q);
        var E = function (s) { return { v: '', s: s }; };
        rows.push([
          { v: q.type, s: MX_TYPE_STYLE[q.type] || 12 }, { v: q.qNum, s: MX_NUM_STYLE[q.type] || 16 },
          lo ? E(11) : { v: q.level || '', s: 11 },
          { v: lo ? (lo.a || '') : '', s: 11 }, { v: lo ? (lo.b || '') : '', s: 11 }, { v: lo ? (lo.c || '') : '', s: 11 }, { v: lo ? (lo.d || '') : '', s: 11 },
          { v: q.chapter || '', s: 10 }, { v: q.topic || '', s: 10 }, { v: outsToCell(q), s: 10 },
          { v: (q.competencies || []).join(', '), s: 10 }, E(10), E(10), E(10)
        ]);
      });
      var lastRow = Math.max(rows.length + 200, 300);
      // 3) Hướng dẫn — nội dung của dự án cũ; 3 ghi chú vốn là comment ở ô tiêu đề (ExcelJS)
      //    được đưa thành dòng hướng dẫn ở cuối trang này vì bộ ghi XLSX tối thiểu không hỗ trợ comment.
      var guideLines = [
        'HƯỚNG DẪN NHẬP MA TRẬN TỪ EXCEL (tab Đề thi → Ma trận → Nhập Excel)',
        '',
        '• Nhập luôn tạo MÃ KÌ THI MỚI, không ghi đè mã đã có. Nếu mã trùng, hệ thống gợi ý mã khác.',
        '• Trang "Cấu hình": chỉ sửa cột "Giá trị". Thiếu Mã/Môn/Lớp/Số câu/Điểm thì có thể nhập trực tiếp trong hộp thoại khi Import.',
        '• Trang "Ma trận": mỗi câu 1 dòng. Bắt buộc: Loại (MC/TF/SA/LA). Cột "Câu" để trống thì đánh số theo thứ tự dòng.',
        '• Mức độ: Nhận biết / Thông hiểu / Vận dụng / Vận dụng cao (hoặc viết tắt NB / TH / VD / VDC). Câu Đúng/Sai có thể ghi riêng từng ý ở cột Ý a – Ý d.',
        '• Yêu cầu cần đạt: mỗi dòng trong ô là 1 YCCĐ (Alt+Enter để xuống dòng; trên Mac: Option+Enter).',
        '• Năng lực: nhiều mã cách nhau bằng dấu phẩy, VD: TD, GQ.   Email GV: email giáo viên phụ trách (nhiều GV: cách nhau bằng dấu phẩy).',
        '• Mục nào chưa có (mức độ, nội dung, phân công, năng lực) cứ để trống – vẫn nhập được, bổ sung sau trong tab Đề thi.',
        '• Có thể thêm/xóa dòng câu hỏi. Số câu trong "Cấu hình" khác số dòng: hộp thoại cho chỉnh lại trước khi nhập.',
        '• Không đổi tên các trang "Cấu hình", "Ma trận" và dòng tiêu đề của trang "Ma trận".',
        '• Ghi chú cột "Mức độ": mức độ chung của câu. Câu Đúng/Sai (TF) có thể bỏ trống ô này và ghi riêng từng ý ở cột Ý a – Ý d.',
        '• Ghi chú cột "Yêu cầu cần đạt": mỗi dòng 1 YCCĐ (Alt+Enter để xuống dòng trong ô). YCCĐ thuộc Chương/Chủ đề khác: [Chương | Chủ đề] nội dung.'
      ];
      var guide = guideLines.map(function (l, i) { return [{ v: l, s: i === 0 ? 20 : 21 }]; });
      return [
        { name: 'Cấu hình', rows: cfgSheet, widths: [16, 30, 50], freeze: { y: 1 }, rowH: { 0: 22 } },
        {
          name: 'Ma trận', rows: rows, widths: [8, 6, 15, 13, 13, 13, 13, 34, 34, 62, 14, 28, 22, 16],
          freeze: { x: 2, y: 1 }, rowH: { 0: 22 }, filter: 'A1:N1',
          validations: [
            { ref: 'A2:A' + lastRow, list: 'MC,TF,SA,LA', showError: true, errorTitle: 'Loại câu', error: 'Chọn MC, TF, SA hoặc LA' },
            { ref: 'C2:G' + lastRow, list: LEVELS.join(','), showError: false }
          ]
        },
        { name: 'Hướng dẫn', rows: guide, widths: [120] }
      ];
    }
    $('dtExpXlsx').addEventListener('click', function () {
      var c = examCfg(curCode); if (!c) { dtMsg('dtMatrixMsg', 'Chưa có mã kì thi nào để xuất.', true); return; }
      if (!window.JSZip) { dtMsg('dtMatrixMsg', 'Thư viện JSZip chưa tải được — kiểm tra mạng rồi thử lại.', true); return; }
      var info = { 'Xuất lúc': new Date().toLocaleString('vi-VN'), 'Người xuất': (window.ChdAuth && ChdAuth.user && ChdAuth.user.email) || '' };
      buildXlsx(matrixWorkbookSheets(c, matrix, info)).then(function (blob) {
        saveBlob(blob, 'MaTran_' + noAccent(curCode) + '_' + stamp() + '.xlsx');
        dtMsg('dtMatrixMsg', 'Đã xuất Excel ma trận ' + curCode + ' (' + matrix.length + ' câu, 3 trang: Cấu hình / Ma trận / Hướng dẫn).');
      }).catch(function (e) { dtMsg('dtMatrixMsg', 'Lỗi xuất Excel: ' + e.message, true); });
    });
    function matrixFromWorkbook(book) {
      var cfgRows = book['Cấu hình'] || book['Cau hinh'] || [];
      var kv = {};
      cfgRows.forEach(function (r) { if (r && r[0] != null) kv[String(r[0]).trim()] = r[1]; });
      var counts = { MC: 0, TF: 0, SA: 0, LA: 0 }, scores = { MC: 0, TF: 0, SA: 0, LA: 0 };
      cfgRows.forEach(function (r) {
        if (!r) return;
        var k0 = String(r[0] || '').trim();
        if (TYPES.indexOf(k0) >= 0) { counts[k0] = clamp(r[1], 0, 200); scores[k0] = parseFloat(r[2]) || 0; return; }
        // Nhãn dạng mới (đúng CFG_ROWS của dự án cũ): "Số câu MC", "Điểm TF", …
        var mCnt = /^Số câu (MC|TF|SA|LA)$/.exec(k0); if (mCnt) { counts[mCnt[1]] = clamp(r[1], 0, 200); return; }
        var mScr = /^Điểm (MC|TF|SA|LA)$/.exec(k0); if (mScr) { scores[mScr[1]] = parseFloat(r[1]) || 0; }
      });
      var rows = [];
      var mrows = book['Ma trận'] || book['Ma tran'] || [];
      mrows.forEach(function (r, i) {
        if (i === 0 || !r) return;
        var t = String(r[0] || '').trim(); if (TYPES.indexOf(t) < 0) return;
        var per = { a: r[3], b: r[4], c: r[5], d: r[6] };
        var hasPer = ['a', 'b', 'c', 'd'].some(function (k) { return per[k] != null && String(per[k]).trim() !== ''; });
        var o = { loai: t, cau: parseInt(r[1], 10) || 0, chuong: r[7] || '', chu_de: r[8] || '',
          yccd: String(r[9] || '').split(/\n+/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
            var mm = /^\[([^\]|]*)\|([^\]]*)\]\s*(.+)$/.exec(s);   // "[Chương | Chủ đề] nội dung" → YCCĐ có chương/chủ đề riêng
            return mm ? { chuong: mm[1].trim(), chu_de: mm[2].trim(), noi_dung: mm[3].trim() } : s;
          }),
          nang_luc: String(r[10] || '').split(/[,;]/).map(function (s) { return s.trim(); }).filter(Boolean) };
        if (t === 'TF' && hasPer) o.muc_do = per; else o.muc_do = r[2] || '';
        rows.push(o);
      });
      TYPES.forEach(function (t) { if (!counts[t]) counts[t] = rows.filter(function (r) { return r.loai === t; }).length; });
      return {
        ma_ki_thi: kv['Mã kì thi'] || kv['Ma ki thi'] || '',
        mon: kv['Môn'] || kv['Mon'] || 'Toán học', lop: kv['Lớp'] || kv['Lop'] || 'Lớp 12',
        so_cau: counts, diem: scores, cau_hoi: rows
      };
    }
    $('dtImpXlsx').addEventListener('click', function () { openImportMatrix('excel'); });

    /* ================= AI CREATOR ================= */
    var AI_SOURCES = [
      ['gemini', 'Gemini (Google)'], ['openrouter', 'OpenRouter'], ['deepseek', 'DeepSeek']
    ];
    function buildAiSlots() {
      var box = $('dtAiSlots'); box.innerHTML = '';
      for (var i = 1; i <= 4; i++) {
        var t = TYPES[i - 1];
        var d = document.createElement('div'); d.className = 'dt-slotcfg';
        d.innerHTML = '<h4>Cấu hình phần ' + (i) + ' (' + t + ')</h4>' +
          '<div class="dt-grid-form">' +
          '<div class="dt-field"><label>Nguồn AI</label><select id="dtAiSrc' + i + '">' +
          AI_SOURCES.map(function (s) { return '<option value="' + s[0] + '">' + s[1] + '</option>'; }).join('') + '</select></div>' +
          '<div class="dt-field"><label>API key</label><input type="password" id="dtAiKey' + i + '" placeholder="API key cho phần ' + t + '" autocomplete="off" /></div>' +
          '<div class="dt-field"><label>Model</label><input type="text" id="dtAiModel' + i + '" value="gemini-2.5-flash" autocomplete="off" spellcheck="false" /></div>' +
          '</div>';
        box.appendChild(d);
      }
      loadAiKeys();
      $('dtAiSave').addEventListener('change', saveAiKeys);
      for (var j = 1; j <= 4; j++) {
        ['dtAiSrc' + j, 'dtAiKey' + j, 'dtAiModel' + j].forEach(function (id) {
          $(id).addEventListener('change', function () { if ($('dtAiSave').checked) saveAiKeys(); });
        });
      }
    }
    function saveAiKeys() {
      if (!$('dtAiSave').checked) { lsDel(K.keys); return; }
      var o = { save: true };
      for (var i = 1; i <= 4; i++) { o['s' + i] = $('dtAiSrc' + i).value; o['k' + i] = $('dtAiKey' + i).value; o['m' + i] = $('dtAiModel' + i).value; }
      lsSet(K.keys, o);
    }
    function loadAiKeys() {
      var o = lsGet(K.keys, null); if (!o) return;
      for (var i = 1; i <= 4; i++) {
        if (o['s' + i]) $('dtAiSrc' + i).value = o['s' + i];
        if (o['k' + i] != null) $('dtAiKey' + i).value = o['k' + i];
        $('dtAiModel' + i).value = o['m' + i] || 'gemini-2.5-flash';
      }
      $('dtAiSave').checked = !!o.save;
    }
    function getApiConfig(idx) {
      var s = $('dtAiSrc' + idx).value, k = $('dtAiKey' + idx).value.trim(), m = $('dtAiModel' + idx).value.trim() || 'gemini-2.5-flash';
      if (!k && idx !== 1) { // slot trống key -> fallback toàn bộ cấu hình Phần 1
        return { source: $('dtAiSrc1').value, key: $('dtAiKey1').value.trim(), model: $('dtAiModel1').value.trim() || 'gemini-2.5-flash' };
      }
      return { source: s, key: k, model: m };
    }
    function slotMeta(q) {
      return {
        Id: q.id, Type: q.type,
        Chapter: q.chapter || '', Topic: q.topic || '', Level: levelLabel(q),
        Requirement: (q.outcomes || []).map(function (o) { return typeof o === 'string' ? o : o.content; }).join('; '),
        Competency: (q.competencies || []).join(', ')
      };
    }
    function aiInputData(type) {
      return matrix.filter(function (q) { return q.type === type; }).map(function (q) {
        var m = slotMeta(q); var c = examCfg(curCode);
        m.Grade = c ? c.grade : ''; m.Subject = c ? c.subject : '';
        return m;
      });
    }
    function systemInstruction(type) {
      var tmpl;
      if (type === 'MC') tmpl = '[\n  {\n    "Id": "MC_1",\n    "Question": "Nội dung câu (công thức toán bọc trong dấu $...$)",\n    "Options": {"A": "...", "B": "...", "C": "...", "D": "..."},\n    "CorrectAnswer": "A",\n    "Explain": "Lời giải chi tiết"\n  }\n]';
      else if (type === 'TF') tmpl = '[\n  {\n    "Id": "TF_1",\n    "Question": "Nội dung câu (công thức toán bọc trong dấu $...$)",\n    "Options": {"a": "...", "b": "...", "c": "...", "d": "..."},\n    "CorrectAnswer": "SDDS",\n    "Explain": "Lời giải chi tiết, giải thích rõ từng ý"\n  }\n]\nChú ý TF: CorrectAnswer là chuỗi đúng 4 ký tự cho 4 ý a, b, c, d — mỗi ký tự là Đ (ý đúng) hoặc S (ý sai).';
      else if (type === 'SA') tmpl = '[\n  {\n    "Id": "SA_1",\n    "Question": "Nội dung câu (công thức toán bọc trong dấu $...$)",\n    "CorrectAnswer": "-1",\n    "Explain": "Lời giải chi tiết"\n  }\n]\nChú ý SA: CorrectAnswer là đáp số cuối cùng (số hoặc biểu thức ngắn, công thức bọc trong $...$ nếu cần).';
      else tmpl = '[\n  {\n    "Id": "LA_1",\n    "Question": "Nội dung câu (công thức toán bọc trong dấu $...$)",\n    "Explain": "Lời giải / hướng dẫn chấm chi tiết"\n  }\n]\nChú ý LA (tự luận): không có Options và không có CorrectAnswer.';
      return 'Bạn là một giáo viên tinh hoa, giàu kinh nghiệm ra đề kiểm tra. Hãy soạn nội dung chi tiết cho các câu hỏi phần thi ' + type + ' dựa trên đầu vào dưới đây.\n' +
        'Quan trọng nhất:\n' +
        '1. Trả về ĐÚNG SỐ LƯỢNG câu và đúng Id như đầu vào (Id dạng ' + type + '_1, ' + type + '_2, ...).\n' +
        '2. Trả về kết quả CHỈ LÀ MỘT MẢNG JSON HỢP LỆ (bọc trong []). KHÔNG in thêm bất kỳ văn bản nào khác, không bọc trong ```.\n' +
        '3. Mỗi câu phải BÁM SÁT Level (mức độ), Requirement (yêu cầu cần đạt) và Competency (năng lực) của chính câu đó trong đầu vào; nội dung thuộc đúng Chapter/Topic đã cho.\n' +
        '4. Công thức toán học LUÔN bọc trong dấu $...$ (không dùng \\(...\\)). Trong chuỗi JSON, mọi dấu gạch chéo của LaTeX phải viết gấp đôi (ví dụ \\frac viết thành \\\\frac trong JSON) để JSON hợp lệ.\n' +
        '5. Phân bổ đáp án đúng cân bằng giữa các phương án (với MC: rải đều A/B/C/D; với TF: không để cả 4 ý cùng Đ hoặc cùng S, trừ khi nội dung bắt buộc).\n' +
        '6. Số liệu trong câu phải nhất quán, tính toán phải đúng, lời giải Explain trình bày rõ ràng từng bước.\n' +
        'Định dạng mỗi phần tử của mảng:\n' + tmpl + '\n' +
        'Chú ý: KHÔNG cần tự sinh lại các metadata (Type, Chapter, Topic, Level...) — chỉ tập trung sinh Question, Options, CorrectAnswer và Explain.';
    }
    function extractJsonArray(text) {
      var t = String(text || '').trim().replace(/```json/gi, '').replace(/```/g, '').trim();
      var a = t.indexOf('['), b = t.lastIndexOf(']');
      if (a !== -1 && b > a) t = t.substring(a, b + 1);
      var arr = JSON.parse(t);
      if (!Array.isArray(arr)) throw new Error('Kết quả không phải là một mảng JSON [].');
      return arr;
    }
    function normTfAnswer(s) {
      var t = String(s || '').toUpperCase().replace(/Đ/g, 'D');
      t = t.replace(/[^DS]/g, '');
      return t; // dạng D/S nội bộ cho bước trộn
    }
    function mergeAiItems(type, arr) {
      var byId = {};
      matrix.forEach(function (q) { byId[q.id] = q; });
      var warns = [];
      var out = [];
      arr.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        var meta = byId[item.Id] || null;
        var tp = item.Type || (meta ? meta.type : type);
        if (TYPES.indexOf(tp) < 0) return;
        var q = {
          Id: item.Id || (meta ? meta.id : type + '_' + (out.length + 1)),
          Type: tp,
          Level: meta ? levelLabel(meta) : (item.Level || ''),
          Grade: (examCfg(curCode) || {}).grade || item.Grade || '',
          Subject: (examCfg(curCode) || {}).subject || item.Subject || '',
          Chapter: meta ? (meta.chapter || '') : (item.Chapter || ''),
          Topic: meta ? (meta.topic || '') : (item.Topic || ''),
          Requirement: meta ? slotMeta(meta).Requirement : (item.Requirement || ''),
          Competency: meta ? slotMeta(meta).Competency : (item.Competency || ''),
          Question: item.Question || '',
          Options: item.Options || null,
          CorrectAnswer: item.CorrectAnswer != null ? String(item.CorrectAnswer) : '',
          Explain: item.Explain || ''
        };
        if (tp === 'TF') q.CorrectAnswer = normTfAnswer(q.CorrectAnswer).split('').map(function (c) { return c === 'D' ? 'Đ' : 'S'; }).join('');
        out.push(q);
      });
      // kiểm chứng cơ bản
      var expect = matrix.filter(function (x) { return x.type === type; }).length;
      if (type !== 'ALL' && expect && out.length !== expect) warns.push('Phần ' + type + ': ma trận có ' + expect + ' câu nhưng kết quả có ' + out.length + ' câu.');
      out.forEach(function (q) {
        if (!q.Question) warns.push(q.Id + ': thiếu nội dung câu hỏi.');
        if (q.Type === 'MC') {
          if (!q.Options || ['A', 'B', 'C', 'D'].some(function (k) { return !q.Options[k]; })) warns.push(q.Id + ': MC chưa đủ 4 phương án A–D.');
          if (['A', 'B', 'C', 'D'].indexOf(q.CorrectAnswer) < 0) warns.push(q.Id + ': đáp án MC phải là A/B/C/D.');
        }
        if (q.Type === 'TF') {
          if (!q.Options || ['a', 'b', 'c', 'd'].some(function (k) { return !q.Options[k]; })) warns.push(q.Id + ': TF chưa đủ 4 ý a–d.');
          if (normTfAnswer(q.CorrectAnswer).length !== 4) warns.push(q.Id + ': đáp án TF phải có đúng 4 ký tự Đ/S.');
        }
        if (q.Type === 'SA' && !q.CorrectAnswer) warns.push(q.Id + ': SA thiếu đáp số.');
      });
      return { items: out, warns: warns };
    }
    function callAiApi(config, prompt) {
      return new Promise(function (resolve, reject) {
        aiAbort = new AbortController();
        var timer = setTimeout(function () { if (aiAbort) aiAbort.abort(); reject(new Error('Quá thời gian chờ 120 giây.')); }, 120000);
        var done = function (fn, v) { clearTimeout(timer); aiAbort = null; fn(v); };
        var p;
        if (config.source === 'gemini') {
          var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(config.model) + ':generateContent?key=' + encodeURIComponent(config.key);
          p = fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: aiAbort.signal,
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7 } }) })
            .then(function (res) { return res.json().then(function (data) {
              if (!res.ok) throw new Error('Gemini API Error: ' + res.status + ' - ' + ((data.error && data.error.message) || ''));
              var txt = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
              if (!txt) throw new Error('Gemini không trả về nội dung.');
              return txt;
            }); });
        } else {
          var url2 = config.source === 'deepseek' ? 'https://api.deepseek.com/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
          var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + config.key };
          if (config.source === 'openrouter') { headers['X-Title'] = 'ChdExam'; }
          p = fetch(url2, { method: 'POST', headers: headers, signal: aiAbort.signal,
            body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: prompt }], temperature: 0.7 }) })
            .then(function (res) { return res.json().then(function (data) {
              if (!res.ok) throw new Error('API Error: ' + res.status + ' - ' + ((data.error && (data.error.message || data.error)) || ''));
              var txt = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
              if (!txt) throw new Error('API không trả về nội dung.');
              return txt;
            }); });
        }
        p.then(function (t) { done(resolve, t); }, function (e) {
          if (e && e.name === 'AbortError') done(reject, new Error('Đã hủy / quá thời gian chờ.'));
          else done(reject, e);
        });
      });
    }
    function generatePart(type) {
      var cfg0 = examCfg(curCode);
      if (!cfg0) { dtMsg('dtAiStatus', 'Hãy chọn một mã kì thi trước.', true); return; }
      var idx = TYPES.indexOf(type) + 1;
      var config = getApiConfig(idx);
      if (!config.key) { dtMsg('dtAiStatus', 'Vui lòng nhập API Key cho cấu hình (Phần ' + type + ' hoặc Phần 1)!', true); return; }
      var input = aiInputData(type);
      if (!input.length) { dtMsg('dtAiStatus', 'Phần ' + type + ' không có câu nào trong ma trận.', true); return; }
      var fullPrompt = systemInstruction(type) + '\n\nDanh sách câu cần soạn (Input Data):\n' + JSON.stringify(input, null, 2);
      $('dtAiCancel').hidden = false;
      dtMsg('dtAiStatus', 'Đang kết nối tới ' + config.source + ' (' + config.model + ')... Vui lòng đợi, có thể tới vài phút.');
      callAiApi(config, fullPrompt).then(function (text) {
        $('dtAiCancel').hidden = true;
        var arr = extractJsonArray(text);
        var res = mergeAiItems(type, arr);
        questions[type] = res.items;
        saveQuestions(); renderAiResults(); renderExamInfo(); renderGrid();
        dtMsg('dtAiStatus', 'Đã tạo ' + res.items.length + ' câu phần ' + type + '.' + (res.warns.length ? ' Cảnh báo: ' + res.warns.join(' ') : ''));
        if (res.warns.length) $('dtAiStatus').className = 'dt-msg err';
      }).catch(function (e) {
        $('dtAiCancel').hidden = true;
        dtMsg('dtAiStatus', 'Lỗi phần ' + type + ': ' + e.message, true);
      });
    }
    TYPES.forEach(function (t) { $('dtGen' + t).addEventListener('click', function () { generatePart(t); }); });
    $('dtAiCancel').addEventListener('click', function () { if (aiAbort) aiAbort.abort(); $('dtAiCancel').hidden = true; });

    /* --- Copy JSON ra trợ lý ngoài --- */
    document.querySelectorAll('[data-dtcopy]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!examCfg(curCode)) { dtMsg('dtAiMsg', 'Hãy chọn một mã kì thi trước.', true); return; }
        var part = b.getAttribute('data-dtcopy');
        var input, head;
        if (part === 'ALL') {
          input = []; TYPES.forEach(function (t) { input = input.concat(aiInputData(t)); });
          head = systemInstruction('MC') + '\n\n(Lưu ý: dữ liệu dưới đây gồm nhiều phần MC/TF/SA/LA — hãy áp dụng đúng định dạng của từng phần theo trường Type của mỗi câu: MC có Options A–D và CorrectAnswer là một chữ cái; TF có Options a–d và CorrectAnswer là chuỗi 4 ký tự Đ/S; SA chỉ có CorrectAnswer là đáp số; LA chỉ có Question và Explain.)';
          head += '\n\nHãy tiến hành soạn nội dung chi tiết cho toàn bộ đề thi dựa trên khung ma trận JSON sau đây. Chỉ trả về ĐÚNG DUY NHẤT một mảng JSON, không thêm bất kỳ văn bản nào khác.\n\nDữ liệu đầu vào (Input):\n';
        } else {
          input = aiInputData(part);
          head = systemInstruction(part) + '\n\nDanh sách câu cần soạn (Input Data):\n';
        }
        if (!input.length) { dtMsg('dtAiMsg', 'Không có câu nào để sao chép.', true); return; }
        copyTextAuto(head + JSON.stringify(input, null, 2), 'Đã sao chép JSON (' + input.length + ' câu) — dán vào trợ lý AI của bạn.', $('dtAiMsg'));
      });
    });

    /* --- Dán JSON kết quả về --- */
    $('dtBtnImportQ').addEventListener('click', function () {
      if (!examCfg(curCode)) { dtMsg('dtAiMsg', 'Hãy chọn một mã kì thi trước.', true); return; }
      dtModal('<h3>Dán JSON câu hỏi</h3>' +
        '<p class="sub">Dán mảng JSON do AI trả về. "Thay thế toàn bộ" xóa hết câu hỏi cũ của đề; "Nhập nối tiếp" ghi đè câu trùng Id và thêm câu mới.</p>' +
        '<div class="dt-field"><textarea id="dtImpQTa" rows="12" placeholder="[{ &quot;Id&quot;: &quot;MC_1&quot;, ... }]"></textarea></div>' +
        '<p class="dt-msg" id="dtImpQMsg"></p>' +
        '<div class="dt-mbtns"><button class="btn" id="dtImpQCancel" type="button">Đóng</button>' +
        '<button class="btn" id="dtImpQAppend" type="button">Nhập nối tiếp</button>' +
        '<button class="btn primary" id="dtImpQReplace" type="button">Thay thế toàn bộ</button></div>');
      $('dtImpQCancel').addEventListener('click', dtModalClose);
      function doImport(append) {
        try {
          var arr = extractJsonArray($('dtImpQTa').value);
          var grouped = { MC: [], TF: [], SA: [], LA: [] };
          var allWarns = [];
          TYPES.forEach(function (t) {
            var sub = arr.filter(function (x) { return x && (x.Type === t || (x.Id && x.Id.indexOf(t + '_') === 0)); });
            if (sub.length) { var r = mergeAiItems(t, sub); grouped[t] = r.items; allWarns = allWarns.concat(r.warns); }
          });
          var count = 0;
          if (!append) { questions = grouped; count = TYPES.reduce(function (s, t) { return s + grouped[t].length; }, 0); }
          else {
            TYPES.forEach(function (t) {
              var byId = {};
              questions[t].forEach(function (q, i) { byId[q.Id] = i; });
              grouped[t].forEach(function (q) { if (byId[q.Id] != null) questions[t][byId[q.Id]] = q; else questions[t].push(q); count++; });
            });
          }
          saveQuestions(); renderAiResults(); renderExamInfo(); renderGrid();
          dtModalClose();
          dtMsg('dtAiMsg', (append ? 'Nhập nối tiếp' : 'Thay thế toàn bộ') + ' thành công ' + count + ' câu hỏi!' + (allWarns.length ? ' Cảnh báo: ' + allWarns.slice(0, 6).join(' ') : ''));
          if (allWarns.length) $('dtAiMsg').className = 'dt-msg err';
        } catch (e) { dtMsg('dtImpQMsg', 'Lỗi parse JSON: ' + e.message, true); }
      }
      $('dtImpQAppend').addEventListener('click', function () { doImport(true); });
      $('dtImpQReplace').addEventListener('click', function () { doImport(false); });
    });

    /* --- Hiển thị / sửa / xóa câu hỏi --- */
    function optKeys(type) { return type === 'MC' ? ['A', 'B', 'C', 'D'] : ['a', 'b', 'c', 'd']; }
    function renderAiResults() {
      var box = $('dtAiResults'); if (!box) return;
      box.innerHTML = '';
      if (!curCode) { box.innerHTML = '<p class="dt-muted">Chọn một mã kì thi để xem câu hỏi đã tạo.</p>'; return; }
      var any = false;
      TYPES.forEach(function (t) {
        if (!questions[t].length) return;
        any = true;
        var h = document.createElement('h3');
        h.textContent = 'Phần ' + t + ' — ' + TYPE_TITLES[t] + ' (' + questions[t].length + ' câu)';
        h.style.marginTop = '16px'; box.appendChild(h);
        questions[t].forEach(function (q) { box.appendChild(questionCard(q, true)); });
      });
      if (!any) box.innerHTML = '<p class="dt-muted">Chưa có câu hỏi nào cho mã kì thi này. Dùng các nút "Tạo phần..." ở trên hoặc copy JSON sang trợ lý AI rồi dán kết quả về.</p>';
    }
    function questionCard(q, editable) {
      var card = document.createElement('div'); card.className = 'dt-qcard';
      var head = document.createElement('div');
      head.innerHTML = '<span class="qid">' + esc(q.Id) + '</span> <span class="dt-badge lv">' + esc(q.Level || '—') + '</span> ' +
        (q.Topic ? '<span class="dt-muted dt-small">' + esc(q.Topic) + '</span>' : '');
      if (editable) {
        var sp = document.createElement('span'); sp.style.float = 'right';
        var be = document.createElement('button'); be.className = 'btn small'; be.type = 'button'; be.textContent = 'Sửa';
        be.addEventListener('click', function () { editQuestion(q); });
        var bd = document.createElement('button'); bd.className = 'btn small'; bd.type = 'button'; bd.textContent = 'Xóa';
        bd.addEventListener('click', function () {
          dtConfirm('Xóa câu hỏi', '<p>Xóa câu <b>' + esc(q.Id) + '</b> khỏi đề?</p>', 'Xóa').then(function (ok) {
            if (!ok) return;
            questions[q.Type] = questions[q.Type].filter(function (x) { return x.Id !== q.Id; });
            saveQuestions(); renderAiResults(); renderExamInfo(); renderGrid();
          });
        });
        sp.appendChild(be); sp.appendChild(document.createTextNode(' ')); sp.appendChild(bd);
        head.appendChild(sp);
      }
      card.appendChild(head);
      var body = document.createElement('div'); body.className = 'dt-katex'; renderRich(body, q.Question); card.appendChild(body);
      if (q.Options && (q.Type === 'MC' || q.Type === 'TF')) {
        var ul = document.createElement('div'); ul.className = 'dt-opts-grid';
        optKeys(q.Type).forEach(function (k) {
          var isC = q.Type === 'MC' ? (q.CorrectAnswer === k) : (normTfAnswer(q.CorrectAnswer).charAt(optKeys('TF').indexOf(k)) === 'D');
          var item = document.createElement('div');
          var lbl = document.createElement('span'); lbl.textContent = k + '. ';
          if (isC) lbl.className = 'correct';
          item.appendChild(lbl);
          var v = document.createElement('span'); renderRich(v, q.Options[k] || ''); item.appendChild(v);
          ul.appendChild(item);
        });
        card.appendChild(ul);
      }
      if (q.Type === 'SA' && q.CorrectAnswer) {
        var da = document.createElement('div'); da.innerHTML = '<span class="correct">Đáp án: </span>';
        var dv = document.createElement('span'); renderRich(dv, q.CorrectAnswer); da.appendChild(dv); card.appendChild(da);
      }
      if (q.Explain) {
        var ex = document.createElement('div'); ex.className = 'explain';
        var et = document.createElement('span'); et.innerHTML = '<b>' + (q.Type === 'LA' ? 'Hướng dẫn chấm: ' : 'Lời giải: ') + '</b>';
        ex.appendChild(et);
        var ev = document.createElement('span'); renderRich(ev, q.Explain); ex.appendChild(ev);
        card.appendChild(ex);
      }
      return card;
    }
    function editQuestion(q) {
      var keys = optKeys(q.Type);
      var optHtml = '';
      if (q.Type === 'MC' || q.Type === 'TF') {
        optHtml = '<div class="dt-grid-form">' + keys.map(function (k) {
          return '<div class="dt-field"><label>Phương án ' + k + '</label><textarea id="dtEqOpt' + k + '" rows="2" class="dt-opt-ta">' + esc(q.Options ? q.Options[k] || '' : '') + '</textarea></div>';
        }).join('') + '</div>';
      }
      dtModal('<h3>Sửa câu ' + esc(q.Id) + '</h3>' +
        '<div class="dt-grid-form">' +
        '<div class="dt-field"><label>Mức độ</label><input type="text" id="dtEqLevel" value="' + esc(q.Level || '') + '" /></div>' +
        '<div class="dt-field"><label>Chương</label><input type="text" id="dtEqChapter" value="' + esc(q.Chapter || '') + '" /></div>' +
        '<div class="dt-field"><label>Chủ đề</label><input type="text" id="dtEqTopic" value="' + esc(q.Topic || '') + '" /></div></div>' +
        '<div class="dt-field"><label>Nội dung câu hỏi (công thức trong $...$)</label><textarea id="dtEqQuestion" rows="4">' + esc(q.Question) + '</textarea></div>' +
        optHtml +
        '<div class="dt-grid-form">' +
        (q.Type !== 'LA' ? '<div class="dt-field"><label>Đáp án đúng ' + (q.Type === 'TF' ? '(4 ký tự Đ/S, VD: SDDS)' : '') + '</label><input type="text" id="dtEqAnswer" value="' + esc(q.CorrectAnswer || '') + '" /></div>' : '') +
        '</div>' +
        '<div class="dt-field"><label>' + (q.Type === 'LA' ? 'Hướng dẫn chấm' : 'Lời giải') + '</label><textarea id="dtEqExplain" rows="4">' + esc(q.Explain || '') + '</textarea></div>' +
        '<div class="dt-mbtns"><button class="btn" id="dtEqCancel" type="button">Hủy</button>' +
        '<button class="btn primary" id="dtEqSave" type="button">Lưu câu hỏi</button></div>');
      $('dtEqCancel').addEventListener('click', dtModalClose);
      $('dtEqSave').addEventListener('click', function () {
        q.Level = $('dtEqLevel').value; q.Chapter = $('dtEqChapter').value; q.Topic = $('dtEqTopic').value;
        q.Question = $('dtEqQuestion').value; q.Explain = $('dtEqExplain').value;
        if (q.Type === 'MC' || q.Type === 'TF') {
          q.Options = q.Options || {};
          keys.forEach(function (k) { q.Options[k] = $('dtEqOpt' + k).value; });
        }
        if (q.Type !== 'LA') q.CorrectAnswer = $('dtEqAnswer').value.trim();
        saveQuestions(); renderAiResults(); renderOrigPreview(); dtModalClose();
        dtMsg('dtAiMsg', 'Đã lưu câu ' + q.Id + '.');
      });
    }
    $('dtExpQuestions').addEventListener('click', function () {
      if (!curCode) { dtMsg('dtAiMsg', 'Chưa có mã kì thi nào.', true); return; }
      var all = []; TYPES.forEach(function (t) { all = all.concat(questions[t]); });
      if (!all.length) { dtMsg('dtAiMsg', 'Chưa có câu hỏi nào để xuất.', true); return; }
      saveText(JSON.stringify(all, null, 2), 'AI_Data_' + noAccent(curCode) + '.json', 'application/json');
    });
    buildAiSlots();

    /* ================= XEM & TRỘN ĐỀ ================= */
    function questionById() { var m = {}; TYPES.forEach(function (t) { questions[t].forEach(function (q) { m[q.Id] = q; }); }); return m; }
    function contentOf(q) {
      if (!q) return null;
      var c = { type: q.Type, question: q.Question || '', opt1: '', opt2: '', opt3: '', opt4: '', correctAns: '', explain: q.Explain || '' };
      if (q.Type === 'MC' && q.Options) { c.opt1 = q.Options.A || ''; c.opt2 = q.Options.B || ''; c.opt3 = q.Options.C || ''; c.opt4 = q.Options.D || ''; c.correctAns = q.CorrectAnswer || ''; }
      if (q.Type === 'TF' && q.Options) { c.opt1 = q.Options.a || ''; c.opt2 = q.Options.b || ''; c.opt3 = q.Options.c || ''; c.opt4 = q.Options.d || ''; c.correctAns = normTfAnswer(q.CorrectAnswer); }
      if (q.Type === 'SA') c.correctAns = q.CorrectAnswer || '';
      return c;
    }
    function origQA() {
      var byId = questionById();
      return matrix.map(function (slot) {
        return { slotId: slot.id, section: slot.section, type: slot.type, num: slot.qNum, content: contentOf(byId[slot.id]) };
      });
    }
    function partLabel(section) { var m = /^PHẦN\s+(\S+?)\./.exec(section || ''); return m ? ('Phần ' + m[1]) : (section || ''); }
    function qaCard(item, showAns) {
      var card = document.createElement('div'); card.className = 'dt-qcard';
      var head = document.createElement('div');
      head.innerHTML = '<span class="qid">Câu ' + item.num + '.</span> <span class="dt-badge">' + esc(item.slotId) + '</span>';
      card.appendChild(head);
      var c = item.content;
      if (!c) {
        var p = document.createElement('div'); p.className = 'dt-warnbox'; p.style.marginTop = '6px';
        p.textContent = '[CÂU HỎI TRỐNG — chưa có nội dung, hãy tạo ở AI Creator]';
        card.appendChild(p); return card;
      }
      var body = document.createElement('div'); body.className = 'dt-katex'; renderRich(body, c.question); card.appendChild(body);
      if (item.type === 'MC' || item.type === 'TF') {
        var keys = item.type === 'MC' ? ['A', 'B', 'C', 'D'] : ['a', 'b', 'c', 'd'];
        var grid = document.createElement('div'); grid.className = 'dt-opts-grid';
        keys.forEach(function (k, i) {
          var isC = item.type === 'MC' ? (c.correctAns === k) : (c.correctAns.charAt(i) === 'D');
          var d = document.createElement('div');
          var lbl = document.createElement('span'); lbl.textContent = k + '. '; if (isC && showAns) lbl.className = 'correct';
          d.appendChild(lbl);
          var v = document.createElement('span'); renderRich(v, c['opt' + (i + 1)]); d.appendChild(v);
          grid.appendChild(d);
        });
        card.appendChild(grid);
      }
      if (showAns && item.type === 'TF') {
        var tf = document.createElement('div'); tf.innerHTML = '<span class="correct">Đáp án: </span>' + esc(tfDisplay(c.correctAns));
        card.appendChild(tf);
      }
      if (showAns && item.type === 'MC') {
        var mc = document.createElement('div'); mc.innerHTML = '<span class="correct">Đáp án: </span>' + esc(c.correctAns);
        card.appendChild(mc);
      }
      if (showAns && item.type === 'SA' && c.correctAns) {
        var sa = document.createElement('div'); sa.innerHTML = '<span class="correct">Đáp án: </span>';
        var sv = document.createElement('span'); renderRich(sv, c.correctAns); sa.appendChild(sv); card.appendChild(sa);
      }
      if (showAns && c.explain) {
        var ex = document.createElement('div'); ex.className = 'explain';
        ex.innerHTML = '<b>' + (item.type === 'LA' ? 'Hướng dẫn chấm: ' : 'Lời giải: ') + '</b>';
        var ev = document.createElement('span'); renderRich(ev, c.explain); ex.appendChild(ev);
        card.appendChild(ex);
      }
      return card;
    }
    function renderQaList(box, qaList, showAns) {
      box.innerHTML = '';
      if (!qaList.length) { box.innerHTML = '<p class="dt-muted">Chưa có dữ liệu đề.</p>'; return; }
      var counts = sectionCounts(qaList);
      var curSec = null;
      qaList.forEach(function (item) {
        if (item.section !== curSec) {
          curSec = item.section;
          var h = document.createElement('h3'); h.textContent = sectionHeading(curSec, counts[curSec] || 0); h.style.margin = '14px 0 4px';
          box.appendChild(h);
        }
        box.appendChild(qaCard(item, showAns));
      });
    }
    function renderOrigPreview() {
      var box = $('dtOrigPreview'); if (!box) return;
      if (!curCode) { box.innerHTML = '<p class="dt-muted">Chọn một mã kì thi để xem đề gốc.</p>'; return; }
      box.innerHTML = '';
      box.appendChild(headerPreviewEl(curCode));
      var list = document.createElement('div'); box.appendChild(list);
      renderQaList(list, origQA(), true);
    }
    function tfDisplay(ds) {
      return String(ds || '').split('').map(function (c, i) { return 'abcd'[i] + ') ' + (c === 'D' ? 'Đúng' : 'Sai'); }).join('   ');
    }

    /* ---------------- Trộn đề ---------------- */
    function arrShuffle(a) {
      for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }
    function renderFixedTf() {
      var box = $('dtFixedTf'); if (!box) return;
      var tf = origQA().filter(function (x) { return x.type === 'TF'; });
      if (!tf.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<p class="dt-muted dt-small" style="margin:8px 0 2px;">Câu TF cố định (không xáo các ý khi trộn, nếu bật xáo TF):</p>' +
        tf.map(function (x) { return '<label class="dt-checkline"><input type="checkbox" class="dt-fixed-tf" value="' + esc(x.slotId) + '" /> ' + esc(x.slotId) + ' — Câu ' + x.num + '</label>'; }).join('');
    }
    function answersKeyOf(code, qaList) {
      var key = { MC_TF_SA: [], LA: [] };
      qaList.forEach(function (item) {
        var ans = item.content ? item.content.correctAns : '';
        if (item.type === 'LA') key.LA.push({ mock: code, qNum: item.num, ans: '' });
        else key.MC_TF_SA.push({ mock: code, qNum: item.num, ans: ans });
      });
      return key;
    }
    $('dtDoShuffle').addEventListener('click', function () {
      if (!examCfg(curCode)) { dtMsg('dtShufMsg', 'Hãy chọn một mã kì thi trước.', true); return; }
      var base = origQA();
      if (!base.length) { dtMsg('dtShufMsg', 'Ma trận trống — chưa có câu nào để trộn.', true); return; }
      var missing = base.filter(function (x) { return !x.content; });
      function proceed() {
        var start = parseInt($('dtShufStart').value, 10); if (!isFinite(start)) start = 1201;
        var count = clamp($('dtShufCount').value, 1, 30);
        var shMC = $('dtShufMC').checked, shTF = $('dtShufTF').checked;
        var fixed = {};
        document.querySelectorAll('.dt-fixed-tf:checked').forEach(function (cb) { fixed[cb.value] = true; });
        // nhóm theo phần, giữ thứ tự phần
        var secOrder = [], parts = {};
        base.forEach(function (item) { if (!parts[item.section]) { parts[item.section] = []; secOrder.push(item.section); } parts[item.section].push(item); });
        shuffledPool = {};
        for (var ci = 0; ci < count; ci++) {
          var code = String(start + ci);
          var finalQ = [];
          secOrder.forEach(function (sec) {
            var partArr = parts[sec].map(function (item) {
              return { slotId: item.slotId, section: item.section, type: item.type, num: 0,
                content: item.content ? JSON.parse(JSON.stringify(item.content)) : null };
            });
            arrShuffle(partArr);
            partArr.forEach(function (item, ix) {
              item.num = ix + 1;
              var c = item.content; if (!c) return;
              if (item.type === 'MC' && shMC && c.opt1) {
                var letters = ['A', 'B', 'C', 'D'];
                var optArr = [1, 2, 3, 4].map(function (n, i) { return { txt: c['opt' + n], isTrue: c.correctAns === letters[i] }; });
                arrShuffle(optArr);
                var nk = '';
                optArr.forEach(function (o, i) { c['opt' + (i + 1)] = o.txt; if (o.isTrue) nk = letters[i]; });
                c.correctAns = nk;
              }
              if (item.type === 'TF' && shTF && c.opt1 && !fixed[item.slotId]) {
                var oArr = [1, 2, 3, 4].map(function (n, i) { return { txt: c['opt' + n], ansLetter: c.correctAns.charAt(i) || 'S' }; });
                arrShuffle(oArr);
                var ns = '';
                oArr.forEach(function (o, i) { c['opt' + (i + 1)] = o.txt; ns += o.ansLetter; });
                c.correctAns = ns;
              }
            });
            finalQ = finalQ.concat(partArr);
          });
          shuffledPool[code] = { questions: finalQ, answersKey: answersKeyOf(code, finalQ) };
        }
        saveShuffled(); renderShufCards(); fillPdfTargets();
        dtMsg('dtShufMsg', 'Đã trộn xong ' + count + ' mã đề: ' + Object.keys(shuffledPool).join(', ') + '.');
      }
      if (missing.length) {
        dtConfirm('Còn ô chưa có câu hỏi',
          '<p>Các ô sau chưa có nội dung câu hỏi: <b>' + missing.map(function (x) { return esc(x.slotId); }).join(', ') + '</b>.</p>' +
          '<p>Nếu vẫn trộn, những ô này sẽ xuất hiện trong đề dưới dạng "[CÂU HỎI TRỐNG]".</p>',
          'Vẫn trộn').then(function (ok) { if (ok) proceed(); });
      } else proceed();
    });
    function renderShufCards() {
      var box = $('dtShufCards'); if (!box) return;
      box.innerHTML = '';
      var codes = Object.keys(shuffledPool).sort(function (a, b) { return (+a) - (+b); });
      if (!codes.length) { box.innerHTML = '<p class="dt-muted">Chưa trộn mã đề nào cho kì thi này.</p>'; return; }
      codes.forEach(function (code) {
        var card = document.createElement('div'); card.className = 'dt-codecard'; card.style.marginTop = '10px';
        card.innerHTML = '<h4>Mã đề: ' + esc(code) + ' <span class="dt-muted dt-small">(' + shuffledPool[code].questions.length + ' câu)</span></h4>';
        var row = document.createElement('div'); row.className = 'dt-row';
        [['word-ans', 'Word — có đáp án'], ['word-hs', 'Word — học sinh'], ['tex', 'Tải .tex'], ['zip', 'Tải .zip'], ['preview', 'Xem trước']].forEach(function (a) {
          var b = document.createElement('button'); b.className = 'btn small'; b.type = 'button'; b.textContent = a[1];
          b.addEventListener('click', function () { shufAction(code, a[0]); });
          row.appendChild(b);
        });
        card.appendChild(row); box.appendChild(card);
      });
    }
    function shufAction(code, act) {
      var qa = shuffledPool[code] ? shuffledPool[code].questions : null;
      if (!qa) return;
      if (act === 'word-ans') downloadWord(qa, code, true);
      else if (act === 'word-hs') downloadWord(qa, code, false);
      else if (act === 'tex') downloadTex(qa, code);
      else if (act === 'zip') downloadZip(qa, code);
      else if (act === 'preview') {
        dtModal('<h3>Xem trước — Mã đề ' + esc(code) + '</h3><div id="dtPrevBox"></div><div class="dt-mbtns"><button class="btn" id="dtPrevClose" type="button">Đóng</button></div>');
        var pb = $('dtPrevBox');
        pb.appendChild(headerPreviewEl(code));
        var lst = document.createElement('div'); pb.appendChild(lst);
        renderQaList(lst, qa, true);
        $('dtPrevClose').addEventListener('click', dtModalClose);
      }
    }
    document.querySelectorAll('[data-dtdl]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!examCfg(curCode)) { dtMsg('dtShufMsg', 'Hãy chọn một mã kì thi trước.', true); return; }
        var act = b.getAttribute('data-dtdl'), qa = origQA();
        if (act === 'orig-word-ans') downloadWord(qa, 'GOC', true);
        else if (act === 'orig-word-hs') downloadWord(qa, 'GOC', false);
        else if (act === 'orig-tex') downloadTex(qa, 'GOC');
        else if (act === 'orig-zip') downloadZip(qa, 'GOC');
      });
    });

    /* ---------------- LaTeX thuần (không cần gói ex_test) ---------------- */
    /* ---------------- Thông tin in trên đầu đề (khối ở đầu tab "3. Xem & trộn đề") ----------------
       Áp dụng cho MỌI file tải từ tab này (Word Equation/MathType, .tex, .zip; đề gốc + đề trộn;
       bản có đáp án + bản học sinh) và cho bản xem trước. Giá trị lưu vào tex_prefs theo user qua API.
       Riêng toggle "In dòng Họ tên…" và trường "Nhãn đề" không có cột trong tex_prefs nên giữ ở localStorage. */
    var HDR_STUDENT_KEY = 'chd_dethi_hdr_student';
    var HDR_LABEL_KEY = 'chd_dethi_hdr_label';
    var HDR_LABEL_DEFAULT = 'ĐỀ CHÍNH THỨC';
    function subjectPlain(s) { return String(s || '').replace(/^\s*Môn\s*:\s*/i, '').trim(); }
    function timeDisp(t) { var s = String(t || '').trim(); if (!s) return ''; return /phút/i.test(s) ? s : s + ' phút'; }
    /* Dòng môn cho cột phải đầu đề: "Môn: <môn> – <lớp>" (lớp lấy từ cấu hình mã kì thi đang làm việc) */
    function subjectLine(p) {
      var sp = subjectPlain(p.subject); if (!sp) return '';
      var cfg = examCfg(curCode);
      var g = cfg && cfg.grade ? String(cfg.grade).trim() : '';
      return 'Môn: ' + sp + (g ? ' – ' + g : '');
    }
    /* Dòng thời gian cột phải (in nghiêng trong file): hậu tố cố định theo mẫu đề quen thuộc */
    function timeLine(p) { var td = timeDisp(p.time); return td ? 'Thời gian làm bài: ' + td + ', không kể thời gian phát đề.' : ''; }
    function formPrefs() {
      return { school1: $('dtHdSchool1').value.trim(), school2: $('dtHdSchool2').value.trim(), title: $('dtHdTitle').value.trim(),
        subject: $('dtHdSubject').value.trim(), time: $('dtHdTime').value.trim(), year: $('dtHdYear').value.trim(),
        label: $('dtHdLabel').value.trim(), student: $('dtHdStudent').checked };
    }
    function readPrefs() {
      var p = formPrefs();
      dtPrefsData = p;
      lsSet(HDR_STUDENT_KEY, p.student);
      lsSet(HDR_LABEL_KEY, p.label);
      dtApi('POST', 'https://hotrohoctap.com/1ai/chdmathtype/api/texprefs.php', { prefs: p }).catch(dtApiFail);
      return p;
    }
    function loadPrefs() {
      var st = lsGet(HDR_STUDENT_KEY, null);
      var lb = lsGet(HDR_LABEL_KEY, null);
      if (lb != null) $('dtHdLabel').value = lb;
      var p = dtPrefsData;
      if (!p) {
        // Chưa từng lưu: gợi ý từ mã kì thi đầu tiên (Môn) + mặc định 90 phút; Trường để trống — không in tên trường của người khác
        var c = examCfg(curCode) || exams[0];
        if (c && !$('dtHdSubject').value) $('dtHdSubject').value = subjectPlain(c.subject);
        if (!$('dtHdTime').value) $('dtHdTime').value = '90';
        if (st != null) $('dtHdStudent').checked = !!st;
        return;
      }
      if (p.school1 != null) $('dtHdSchool1').value = p.school1;
      if (p.school2 != null) $('dtHdSchool2').value = p.school2;
      if (p.title != null) $('dtHdTitle').value = p.title;
      if (p.subject != null) $('dtHdSubject').value = subjectPlain(p.subject);
      if (p.time != null) $('dtHdTime').value = String(p.time).replace(/\s*phút\s*$/i, '');
      if (p.year != null) $('dtHdYear').value = p.year;
      $('dtHdStudent').checked = p.student != null ? !!p.student : (st == null ? true : !!st);
    }
    ['dtHdSchool1', 'dtHdSchool2', 'dtHdTitle', 'dtHdSubject', 'dtHdTime', 'dtHdYear', 'dtHdLabel', 'dtHdStudent'].forEach(function (id) {
      $(id).addEventListener('change', function () { readPrefs(); renderOrigPreview(); });
    });
    $('dtHdSave').addEventListener('click', function () {
      readPrefs(); renderOrigPreview();
      dtMsg('dtHdMsg', 'Đã lưu thông tin đầu đề vào tài khoản của bạn — áp dụng cho mọi lần tải Word / LaTeX từ mục này.');
      dtToast('Đã lưu thông tin đầu đề.');
    });
    /* Khối đầu đề xem trước — 2 cột như mẫu đề quen thuộc, cùng nội dung sẽ in trong file tải về */
    function headerPreviewEl(code) {
      var p = formPrefs();
      var wrap = document.createElement('div'); wrap.className = 'dt-hdrprev';
      var left = '', right = '';
      if (p.school1) left += '<div class="s">' + esc(p.school1) + '</div>';
      if (p.school2) left += '<div class="s">' + esc(p.school2) + '</div>';
      if (p.school1 || p.school2) left += '<div class="rule"></div>';
      if (p.label) left += '<div class="s">' + esc(p.label) + '</div>';
      left += '<div class="pg">(Đề thi có … trang)</div>';
      if (p.title) right += '<div class="t">' + esc(p.title) + '</div>';
      if (p.year) right += '<div class="s">Năm học: ' + esc(String(p.year).trim()) + '</div>';
      var sl = subjectLine(p); if (sl) right += '<div class="s">' + esc(sl) + '</div>';
      var tl = timeLine(p); if (tl) right += '<div class="tm">' + esc(tl) + '</div>';
      right += '<div class="mc">Mã đề ' + esc(code) + '</div>';
      var h = '<div class="cols"><div class="col">' + left + '</div><div class="col">' + right + '</div></div>';
      if (p.student) h += '<div class="st">Họ và tên học sinh: …………………… Lớp: ………… Số báo danh: …………</div>';
      wrap.innerHTML = h;
      return wrap;
    }
    function texEsc(s) {
      return String(s == null ? '' : s)
        .replace(/\\/g, '\\textbackslash{}').replace(/&/g, '\\&').replace(/%/g, '\\%')
        .replace(/\$/g, '\\$').replace(/#/g, '\\#').replace(/_/g, '\\_')
        .replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/~/g, '\\textasciitilde{}')
        .replace(/\^/g, '\\textasciicircum{}').replace(/\s*\n\s*/g, ' ');
    }
    var DT_IMGMAP = {};
    function texProtect(text) {
      var t = String(text == null ? '' : text);
      var segs = [];
      try { if (window.MTCore && MTCore.findLatexSegments) segs = MTCore.findLatexSegments(t) || []; } catch (e) { segs = []; }
      var out = '', last = 0;
      function plain(s) {
        return texEsc(s).replace(/https?:\/\/[^\s{}]+?\.(?:png|jpe?g|gif|webp)/gi, function (u) {
          var fn = DT_IMGMAP[u];
          return fn ? ('\\begin{center}\\includegraphics[width=0.6\\textwidth]{' + fn + '}\\end{center}') : u;
        });
      }
      segs.forEach(function (sg) {
        out += plain(t.slice(last, sg.start));
        out += t.slice(sg.start, sg.end).replace(/(?<!\\)%/g, '\\%');
        last = sg.end;
      });
      out += plain(t.slice(last));
      return out;
    }
    function buildImageMap(qaList) {
      var map = {}, n = 0;
      var re = /https?:\/\/[^\s)"']+?\.(?:png|jpe?g|gif|webp)/gi;
      qaList.forEach(function (item) {
        if (!item.content) return;
        var all = [item.content.question, item.content.opt1, item.content.opt2, item.content.opt3, item.content.opt4, item.content.explain].join('\n');
        var m; re.lastIndex = 0;
        while ((m = re.exec(all))) { if (!map[m[0]]) { n++; map[m[0]] = 'image' + (n < 10 ? '0' : '') + n + '.png'; } }
      });
      return map;
    }
    function buildLaTeXCode(code, qaList, withAnswers, opts) {
      opts = opts || {};
      var prefs = readPrefs();
      DT_IMGMAP = buildImageMap(qaList);
      var L = [];
      L.push('\\documentclass[12pt,a4paper]{article}');
      L.push('\\usepackage[utf8]{vietnam}');
      L.push('\\usepackage{graphicx}');
      L.push('\\usepackage{lastpage}');
      L.push('\\usepackage{amsmath, amssymb, fancyhdr}');
      L.push('\\usepackage[top=1.5cm, bottom=1.75cm, left=1.5cm, right=1.25cm]{geometry}');
      L.push('% --- Moi truong de thi dung GOI THAT ex_test.sty (nhu du an cu) ---');
      L.push('% File .tex nay can dat canh cac file .sty: ex_test.sty, tkz-linknodes.sty, tkz-tab-vn.sty (tai .zip o tab Tron de se kem san cac file nay tu api/sty/)');
      L.push('% Khi bien dich PDF trong app, proxy tren hosting tu dinh kem MOI file .sty trong api/sty/.');
      L.push('\\usepackage[many]{tcolorbox}');
      L.push('\\usepackage[' + (withAnswers ? 'loigiai' : 'dethi') + ']{ex_test}');
      L.push('\\usepackage{tkz-euclide,tikz,tkz-tab,tkz-linknodes}');
      L.push('\\usepackage{pgf}');
      L.push('\\usetikzlibrary{shapes.geometric,arrows,snakes,calc,intersections,angles}');
      L.push('\\usepackage{pgfplots}');
      L.push('\\usepgfplotslibrary{fillbetween}');
      L.push('\\usetikzlibrary{patterns}');
      L.push('\\pgfplotsset{compat=1.9}');
      L.push('\\newcommand{\\de}[2]{');
      L.push('\\setcounter{ex}{0}');
      L.push('\\vspace*{-1cm}\\hspace{-0.75cm}\\begin{minipage}{.5\\textwidth}');
      L.push('\\begin{center}');
      if (prefs.school1) L.push('\\textbf{' + texEsc(prefs.school1) + '}\\\\');
      if (prefs.school2) L.push('\\textbf{' + texEsc(prefs.school2) + '}\\\\');
      if (prefs.school1 || prefs.school2) L.push('\\rule{\\linewidth}{0.5pt}\\\\');
      if (prefs.label) L.push('\\textbf{' + texEsc(prefs.label) + '}\\\\');
      L.push('\\textit{(Đề thi có \\pageref{LastPage} trang)}');
      L.push('\\end{center}');
      L.push('\\end{minipage}');
      L.push('\\begin{minipage}{0.5\\textwidth}');
      L.push('\\begin{center}');
      L.push('\\textbf{\\large #1}\\\\');
      if (prefs.year) L.push('\\textbf{Năm học: ' + texEsc(prefs.year) + '}\\\\');
      L.push('\\def\\hdsub{#2}\\ifx\\hdsub\\empty\\else\\textbf{\\hdsub}\\\\\\fi');
      var tline = timeLine(prefs);
      if (tline) L.push('\\textit{' + texEsc(tline) + '}');
      L.push('\\end{center}');
      L.push('\\begin{flushright}\\textbf{Mã đề \\made}\\end{flushright}');
      L.push('\\end{minipage}');
      L.push('\\vspace{0.3cm}');
      if (prefs.student) L.push('\\par\\noindent Họ và tên học sinh: \\ldots\\ldots\\ldots\\ldots\\ldots\\ldots\\ldots\\ldots\\ldots\\ldots Lớp: \\ldots\\ldots\\ldots\\ldots\\ldots Số báo danh: \\dotfill');
      L.push('\\vspace{0.1cm}');
      L.push('}');
      L.push('\\pagestyle{fancy}');
      L.push('\\fancyhf{}');
      L.push('\\renewcommand{\\footrulewidth}{0.1pt}');
      L.push('\\renewcommand{\\headrulewidth}{0pt}');
      L.push('\\fancyfoot[R]{Trang \\thepage\\ -- Mã đề \\made}');
      L.push('\\begin{document}');
      L.push('\\def\\made{' + texEsc(code) + '}');
      L.push('\\de{' + texEsc(prefs.title) + '}{' + texEsc(subjectLine(prefs)) + '}');
      var curSec = null, partIx = 0;
      var secCounts = sectionCounts(qaList);
      qaList.forEach(function (item) {
        if (item.section !== curSec) {
          curSec = item.section; partIx++;
          if (partIx > 1) L.push('\\setcounter{ex}{0}');
          L.push('');
          L.push('\\noindent\\textbf{' + texEsc(sectionHeading(curSec, secCounts[curSec] || 0)) + '}');
          L.push('');
        }
        if (opts.markers) L.push('% [CHD-CAU] ' + item.slotId + ' | ' + partLabel(curSec) + ' – câu ' + item.num);
        L.push('\\begin{ex}');
        var c = item.content;
        var skipped = opts.skipIds && opts.skipIds[item.slotId];
        if (!c || skipped) {
          L.push(skipped ? 'Câu hỏi bị bỏ qua do lỗi biên dịch.' : '[CÂU HỎI TRỐNG - CHƯA SOẠN]');
        } else {
          L.push(texProtect(c.question));
          if (item.type === 'MC') {
            L.push('\\choice');
            L.push('{' + (c.correctAns === 'A' ? '\\True ' : '') + texProtect(c.opt1) + '}');
            L.push('{' + (c.correctAns === 'B' ? '\\True ' : '') + texProtect(c.opt2) + '}');
            L.push('{' + (c.correctAns === 'C' ? '\\True ' : '') + texProtect(c.opt3) + '}');
            L.push('{' + (c.correctAns === 'D' ? '\\True ' : '') + texProtect(c.opt4) + '}');
          } else if (item.type === 'TF') {
            L.push('\\choiceTF');
            [1, 2, 3, 4].forEach(function (n, i) {
              L.push('{' + (c.correctAns.charAt(i) === 'D' ? '\\True ' : '') + texProtect(c['opt' + n]) + '}');
            });
          } else if (item.type === 'SA') {
            if (withAnswers && c.correctAns) L.push('\\shortans{' + texProtect(c.correctAns) + '}');
          }
          if (withAnswers && c.explain) L.push('\\loigiai{\n' + texProtect(c.explain) + '\n}');
        }
        L.push('\\end{ex}');
        L.push('');
      });
      L.push('\\vspace*{0.5cm}');
      L.push('\\begin{center}\\textbf{===HẾT===}\\end{center}');
      L.push('\\end{document}');
      return L.join('\n');
    }
    function texBaseName(code) { return 'De_' + noAccent(curCode) + '_' + code; }
    function downloadTex(qaList, code) {
      var tex = buildLaTeXCode(code, qaList, true, {});
      saveText(tex, texBaseName(code) + '.tex', 'text/x-tex');
    }
    /* Tên các gói .sty TỰ CHẾ luôn thử kèm vào .zip (tex+ảnh) — đợt 6. Ngoài 4 tên
       cố định này, mọi tên gói trong các lệnh \usepackage{...} của chính file .tex
       vừa sinh cũng được thử tải từ api/sty/ trên hosting: gói tùy chỉnh nào user
       đã upload lên api/sty/ thì đều được kèm theo ở GỐC .zip (cùng thư mục với
       file .tex để pdflatex tìm thấy), không cần sửa code khi thêm gói mới.
       Thiếu file nào trong 4 tên cố định thì ghi rõ tên trong thông báo sau khi
       tải (các gói chuẩn của TeX Live không có trên hosting là bình thường —
       pdflatex đã có sẵn, chỉ ghi ra console). .zip vẫn tải bình thường. */
    var DT_STY_FIXED = ['ex_test', 'tkz-linknodes', 'tkz-tab-vn', 'slashbox'];
    function styNamesForTex(tex) {
      var names = {}, out = [];
      function add(n) { n = String(n || '').trim(); if (/^[A-Za-z0-9_-]+$/.test(n) && !names[n]) { names[n] = true; out.push(n); } }
      DT_STY_FIXED.forEach(add);
      var re = /\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/g, m;
      while ((m = re.exec(String(tex || '')))) m[1].split(',').forEach(add);
      return out;
    }
    function downloadZip(qaList, code) {
      if (!window.JSZip) { dtMsg('dtShufMsg', 'Thư viện JSZip chưa tải được.', true); return; }
      var tex = buildLaTeXCode(code, qaList, true, {});
      var map = buildImageMap(qaList);
      var zip = new window.JSZip();
      zip.file(texBaseName(code) + '.tex', tex);
      var urls = Object.keys(map);
      var jobs = urls.map(function (u) {
        return fetch(u).then(function (r) { if (!r.ok) throw new Error('http'); return r.blob(); })
          .then(function (b) { zip.file(map[u], b); }).catch(function () { /* bo qua anh loi */ });
      });
      var styGot = [], styMissingFixed = [];
      var styJobs = styNamesForTex(tex).map(function (nm) {
        return fetch('https://hotrohoctap.com/1ai/chdmathtype/api/sty/' + nm + '.sty').then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.blob();
        }).then(function (b) { zip.file(nm + '.sty', b); styGot.push(nm + '.sty'); })
          .catch(function () {
            if (DT_STY_FIXED.indexOf(nm) >= 0) styMissingFixed.push(nm + '.sty');
            else if (window.console) console.info('[ChdMathType] .zip: không có api/sty/' + nm + '.sty trên hosting (gói chuẩn TeX Live hoặc chưa upload) — bỏ qua.');
          });
      });
      Promise.all(jobs.concat(styJobs)).then(function () {
        return zip.generateAsync({ type: 'blob' });
      }).then(function (blob) {
        saveBlob(blob, texBaseName(code) + '_LaTeX.zip');
        var msg = 'Đã tải .zip (tex + ảnh) cho mã ' + code + (styGot.length ? ' — kèm ' + styGot.length + ' file .sty ở gốc zip: ' + styGot.join(', ') + '.' : '.');
        if (styMissingFixed.length) msg += ' Không kèm được: ' + styMissingFixed.join(', ') + ' — chưa có trên hosting, hãy upload file này vào thư mục api/sty/ trên hosting, hoặc tự đặt cạnh file .tex khi biên dịch.';
        dtMsg('dtShufMsg', msg, styMissingFixed.length > 0);
      })
        .catch(function (e) { dtMsg('dtShufMsg', 'Lỗi tạo ZIP: ' + e.message, true); });
    }

    /* ---------------- Word Equation / MathType qua MTCore ---------------- */
    function wordMode() { var r = document.querySelector('input[name="dtWordMode"]:checked'); return r ? r.value : 'omml'; }
    /* Chọn định dạng Word có ở 2 chỗ (Đề gốc + Cài đặt trộn đề) nhưng là MỘT trạng thái
       chung: đổi ở chỗ nào thì chỗ kia cập nhật ngay; lựa chọn được nhớ cho lần mở sau. */
    var WORDMODE_KEY = 'chd_dethi_wordmode';
    function setWordMode(v, save) {
      document.querySelectorAll('input[name="dtWordMode"], input[name="dtWordMode2"]').forEach(function (r) { r.checked = (r.value === v); });
      if (save !== false) lsSet(WORDMODE_KEY, v);
    }
    document.querySelectorAll('input[name="dtWordMode"], input[name="dtWordMode2"]').forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) setWordMode(r.value); });
    });
    function applyWordMode() { var v = lsGet(WORDMODE_KEY, null); if (v === 'omml' || v === 'mathtype') setWordMode(v, false); }
    function dtLatexToMathml(latex) {
      if (!window.katex || typeof window.katex.renderToString !== 'function') throw new Error('KaTeX chưa tải được nên chưa tạo được MathML để xuất Word.');
      var out = window.katex.renderToString(latex, { output: 'mathml', throwOnError: false, trust: true });
      var a = out.indexOf('<math'), b = out.lastIndexOf('</math>');
      if (a < 0 || b < 0) throw new Error('KaTeX không tạo được MathML cho công thức này.');
      return out.slice(a, b + '</math>'.length);
    }
    function dtPreviewFor(latex, display) {
      var MJ = window.MathJax;
      if (!MJ || typeof MJ.tex2svg !== 'function') return Promise.resolve(null);
      var node = null, svg = null;
      try { node = MJ.tex2svg(latex, { display: !!display }); } catch (e) { return Promise.resolve(null); }
      if (!node) return Promise.resolve(null);
      if (node.querySelector) svg = node.querySelector('svg');
      if (!svg && node.tagName && String(node.tagName).toLowerCase() === 'svg') svg = node;
      if (!svg) return Promise.resolve(null);
      var measure = $('dtMeasure');
      measure.innerHTML = ''; measure.appendChild(svg);
      var rect = svg.getBoundingClientRect();
      var w = rect.width, h = rect.height;
      if (!w || !h) { measure.innerHTML = ''; return Promise.resolve(null); }
      var wPt = Math.max(6, w * 72 / 96), hPt = Math.max(6, h * 72 / 96);
      var hEx = parseFloat(svg.getAttribute('height')), vaEx = parseFloat(svg.style.verticalAlign);
      var sizeOnly = { wPt: wPt, hPt: hPt };
      if (isFinite(hEx) && hEx > 0 && isFinite(vaEx)) {
        var dpt = hPt * (-vaEx / hEx);
        if (isFinite(dpt) && dpt >= 0) sizeOnly.descentPt = dpt;
      }
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
        var hv = uses[ui].getAttribute('href');
        if (hv && !uses[ui].getAttribute('xlink:href')) uses[ui].setAttribute('xlink:href', hv);
      }
      var svgText;
      try { svgText = new XMLSerializer().serializeToString(clone); } catch (e) { return Promise.resolve(sizeOnly); }
      return dtRasterize(svgText, w, h, scale).then(function (png) {
        if (!png) return sizeOnly;
        var r = { png: png, wPt: wPt, hPt: hPt };
        if (sizeOnly.descentPt !== undefined) r.descentPt = sizeOnly.descentPt;
        return r;
      });
    }
    function dtRasterize(svgText, wPx, hPx, scale) {
      return new Promise(function (resolve) {
        var img = new Image(), url = null, done = false;
        function fin(v) { if (done) return; done = true; if (url) URL.revokeObjectURL(url); resolve(v); }
        img.onload = function () {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(wPx * scale));
            canvas.height = Math.max(1, Math.round(hPx * scale));
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'source-over';
            if (canvas.toBlob) canvas.toBlob(function (b) {
              if (!b) { fin(null); return; }
              b.arrayBuffer().then(function (ab) { fin(new Uint8Array(ab)); }, function () { fin(null); });
            }, 'image/png'); else fin(null);
          } catch (e) { fin(null); }
        };
        img.onerror = function () { fin(null); };
        try { url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })); img.src = url; }
        catch (e) { fin(null); return; }
        setTimeout(function () { fin(null); }, 6000);
      });
    }
    function examToText(qaList, code, withAnswers) {
      var prefs = readPrefs();
      /* Đầu đề Word KHÔNG đi qua text nữa: downloadWord chèn bảng 2 cột không viền vào
         đầu document.xml từ dữ liệu cấu trúc này (examToText.hdr) — dòng nào trống thì bỏ.
         Nội dung câu hỏi nối tiếp nhau trực tiếp, KHÔNG chèn dòng trắng giữa các câu. */
      examToText.hdr = { school1: prefs.school1, school2: prefs.school2, label: prefs.label,
        title: prefs.title, year: prefs.year, subjLine: subjectLine(prefs), timeLine: timeLine(prefs),
        student: prefs.student, code: code };
      var lines = [];
      var curSec = null;
      var secCounts = sectionCounts(qaList);
      qaList.forEach(function (item) {
        if (item.section !== curSec) { curSec = item.section; lines.push(sectionHeading(curSec, secCounts[curSec] || 0)); }
        var c = item.content;
        if (!c) { lines.push('Câu ' + item.num + '. [CÂU HỎI TRỐNG - CHƯA SOẠN]'); return; }
        lines.push('Câu ' + item.num + '. ' + c.question);
        if (item.type === 'MC') {
          lines.push('A. ' + c.opt1); lines.push('B. ' + c.opt2); lines.push('C. ' + c.opt3); lines.push('D. ' + c.opt4);
          if (withAnswers && c.correctAns) lines.push('Đáp án: ' + c.correctAns);
        } else if (item.type === 'TF') {
          lines.push('a. ' + c.opt1); lines.push('b. ' + c.opt2); lines.push('c. ' + c.opt3); lines.push('d. ' + c.opt4);
          if (withAnswers && c.correctAns) lines.push('Đáp án: ' + tfDisplay(c.correctAns));
        } else if (item.type === 'SA') {
          if (withAnswers && c.correctAns) lines.push('Đáp án: ' + c.correctAns);
        }
        if (withAnswers && c.explain) lines.push((item.type === 'LA' ? 'Hướng dẫn chấm: ' : 'Lời giải: ') + c.explain);
      });
      lines.push('===HẾT===');
      return lines.join('\n');
    }
    function colorizeAnswersDocx(blob) {
      return window.JSZip.loadAsync(blob).then(function (zip) {
        var f = zip.file('word/document.xml');
        if (!f) return blob;
        return f.async('string').then(function (xml) {
          var out = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, function (para) {
            var text = para.replace(/<[^>]+>/g, '');
            if (!/^\s*(Đáp án|Lời giải|Hướng dẫn chấm)/.test(text)) return para;
            return para.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, function (run) {
              if (run.indexOf('<w:object') >= 0 || run.indexOf('<w:color') >= 0) return run;
              if (run.indexOf('<w:rPr>') >= 0) return run.replace('<w:rPr>', '<w:rPr><w:color w:val="C00000"/>');
              return run.replace(/^(<w:r\b[^>]*>)/, '$1<w:rPr><w:color w:val="C00000"/></w:rPr>');
            });
          });
          if (window.ChdWordImage && ChdWordImage.xmlWellFormed && !ChdWordImage.xmlWellFormed(out)) return blob;
          zip.file('word/document.xml', out);
          return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        });
      }).catch(function () { return blob; });
    }
    /* Chèn đầu đề Word dạng BẢNG 1 hàng 2 cột KHÔNG VIỀN vào ngay đầu document.xml
       (trước câu 1), theo mẫu đề quen thuộc: cột trái = trường + kẻ ngang + nhãn đề;
       cột phải = tên kì thi + năm học + môn–lớp + thời gian (nghiêng) + "Mã đề" căn phải.
       Sau bảng là dòng học sinh (theo toggle).
       LƯU Ý (đợt 4): file Word KHÔNG chèn field nào (kể cả NUMPAGES) và KHÔNG bật
       updateFields — chỉ cần một field + updateFields là Word bật hộp thoại
       "This document contains fields that may refer to other files…" mỗi lần mở file.
       Dòng "(Đề thi có N trang)" vì thế chỉ còn ở bản LaTeX/PDF (lastpage, không có
       hộp thoại tương đương). Lỗi ở bất kỳ bước nào thì giữ nguyên file gốc. */
    function hdrRunXml(txt, o) {
      o = o || {};
      var inner = (o.b ? '<w:b/><w:bCs/>' : '') + (o.i ? '<w:i/><w:iCs/>' : '') + (o.sz ? '<w:sz w:val="' + o.sz + '"/><w:szCs w:val="' + o.sz + '"/>' : '');
      return '<w:r>' + (inner ? '<w:rPr>' + inner + '</w:rPr>' : '') + '<w:t xml:space="preserve">' + esc(txt) + '</w:t></w:r>';
    }
    function hdrParaXml(content, jc, rule) {
      var pPr = '';
      if (jc) pPr += '<w:jc w:val="' + jc + '"/>';
      if (rule) pPr += '<w:pBdr><w:bottom w:val="single" w:sz="12" w:space="1" w:color="000000"/></w:pBdr>';
      return '<w:p>' + (pPr ? '<w:pPr>' + pPr + '</w:pPr>' : '') + content + '</w:p>';
    }
    function wordHeaderXml(hdr) {
      var left = '', right = '';
      if (hdr.school1) left += hdrParaXml(hdrRunXml(hdr.school1, { b: 1 }), 'center');
      if (hdr.school2) left += hdrParaXml(hdrRunXml(hdr.school2, { b: 1 }), 'center');
      if (hdr.school1 || hdr.school2) left += hdrParaXml('', 'center', true);
      if (hdr.label) left += hdrParaXml(hdrRunXml(hdr.label, { b: 1 }), 'center');
      if (hdr.title) right += hdrParaXml(hdrRunXml(hdr.title, { b: 1, sz: 32 }), 'center');
      if (hdr.year) right += hdrParaXml(hdrRunXml('Năm học: ' + String(hdr.year).trim(), { b: 1 }), 'center');
      if (hdr.subjLine) right += hdrParaXml(hdrRunXml(hdr.subjLine, { b: 1 }), 'center');
      if (hdr.timeLine) right += hdrParaXml(hdrRunXml(hdr.timeLine, { i: 1 }), 'center');
      right += hdrParaXml(hdrRunXml('Mã đề ' + hdr.code, { b: 1 }), 'right');
      var borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (b) {
        return '<w:' + b + ' w:val="none" w:sz="0" w:space="0" w:color="auto"/>';
      }).join('');
      var tbl = '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="fixed"/><w:tblBorders>' + borders + '</w:tblBorders></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="4513"/><w:gridCol w:w="4513"/></w:tblGrid>' +
        '<w:tr><w:tc><w:tcPr><w:tcW w:w="4513" w:type="dxa"/></w:tcPr>' + left + '</w:tc>' +
        '<w:tc><w:tcPr><w:tcW w:w="4513" w:type="dxa"/></w:tcPr>' + right + '</w:tc></w:tr></w:tbl>';
      if (hdr.student) tbl += hdrParaXml(hdrRunXml('Họ và tên học sinh: .............................. Lớp: ............ Số báo danh: ........', {}), '');
      return tbl;
    }
    function insertWordHeaderDocx(blob, hdr) {
      if (!hdr || !window.JSZip) return Promise.resolve(blob);
      return window.JSZip.loadAsync(blob).then(function (zip) {
        var fDoc = zip.file('word/document.xml');
        if (!fDoc) return blob;
        return fDoc.async('string').then(function (xml) {
          var insert = wordHeaderXml(hdr);
          var out = xml.replace(/(<w:body[^>]*>)/, function (m) { return m + insert; });
          if (out === xml) return blob;
          if (window.ChdWordImage && ChdWordImage.xmlWellFormed && !ChdWordImage.xmlWellFormed(out)) return blob;
          zip.file('word/document.xml', out);
          /* KHÔNG ghi word/settings.xml và KHÔNG bật updateFields (đợt 4): đó là nguyên
             nhân Word hiện hộp thoại cập nhật field khi mở file tải về. */
          return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        });
      }).catch(function () { return blob; });
    }
    /* ================= HÌNH TikZ → ẢNH THẬT TRONG FILE WORD (đợt 6) =================
       Câu hỏi có hình vẽ dạng mã TikZ (môi trường tikzpicture / circuitikz / tikzcd /
       forest — đúng nhóm COMPILE_ENVS của dự án cũ) thì khi tải file Word: biên dịch
       từng hình thành ảnh PNG qua chính proxy api/compile.php (proxy tự kèm mọi file
       .sty trong api/sty/) + pdf.js, rồi nhúng ảnh vào .docx thay đúng vị trí khối
       TikZ. FAIL-SAFE tuyệt đối: hình nào lỗi ở bất kỳ khâu nào cũng giữ nguyên mã
       TikZ gốc dạng chữ tại vị trí đó + có bản tóm tắt sau khi tải — không bao giờ
       làm hỏng cả lần tải Word. File LaTeX giữ nguyên mã TikZ (pdflatex tự xử lý). */
    var TIKZ_ENV_RE = /\\begin\{(tikzpicture|circuitikz|tikzcd|forest)\}[\s\S]*?\\end\{\1\}/g;
    function findTikzBlocks(text) {
      var out = [], s = String(text == null ? '' : text), m;
      TIKZ_ENV_RE.lastIndex = 0;
      while ((m = TIKZ_ENV_RE.exec(s))) out.push(m[0]);
      return out;
    }
    /* ---- Comment LaTeX trong mã hình (đợt 7) ----
       Khi biên dịch hình lấy ảnh cho Word: bỏ comment % thường (ký tự \% — dấu %
       đứng sau số LẺ dấu \ — là % thật nên được GIỮ), và các dòng directive dạng
       %!<\usepackage{...}> / %!<\usetikzlibrary{...}> được tách ra thành khai báo
       gửi kèm cho texlive rồi xóa khỏi mã. CHỈ áp dụng cho đường lấy ảnh Word
       (mã gửi biên dịch + text giữ lại khi hình fail) — file .tex xuất ra và dữ
       liệu câu hỏi đã lưu giữ nguyên comment như cũ. */
    function texUnescapedPercent(line) {
      for (var i = 0; i < line.length; i++) {
        if (line.charAt(i) !== '%') continue;
        var bs = 0, j = i - 1;
        while (j >= 0 && line.charAt(j) === '\\') { bs++; j--; }
        if (bs % 2 === 0) return i;   // số \ chẵn (kể cả 0) → % này mở đầu comment
      }
      return -1;
    }
    var TEX_DIRECTIVE_RE = /^\s*%!<\s*\\(usepackage|usetikzlibrary)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}\s*>\s*$/;
    /* Tách các dòng directive khỏi văn bản; trả { text, pkgs, libs }. */
    function extractTexDirectives(text) {
      var pkgs = [], libs = [], kept = [];
      String(text == null ? '' : text).split('\n').forEach(function (line) {
        var m = TEX_DIRECTIVE_RE.exec(line);
        if (!m) { kept.push(line); return; }
        m[2].split(',').forEach(function (x) {
          x = x.trim(); if (!x) return;
          var arr = m[1] === 'usepackage' ? pkgs : libs;
          if (arr.indexOf(x) < 0) arr.push(x);
        });
      });
      return { text: kept.join('\n'), pkgs: pkgs, libs: libs };
    }
    /* Cắt comment % khỏi từng dòng; dòng vốn chỉ chứa comment thì bỏ hẳn cả dòng
       để text giữ lại trong Word không còn dòng comment/dòng trống rác. */
    function stripTexComments(text) {
      var out = [];
      String(text == null ? '' : text).split('\n').forEach(function (line) {
        var i = texUnescapedPercent(line);
        if (i < 0) { out.push(line); return; }
        var head = line.slice(0, i);
        if (head.trim() === '') return;
        out.push(head.replace(/\s+$/, ''));
      });
      return out.join('\n');
    }
    /* Làm sạch 1 trường văn bản chứa hình TikZ: bỏ directive + comment. */
    function cleanTikzField(text) {
      var d = extractTexDirectives(text);
      return { text: stripTexComments(d.text), pkgs: d.pkgs, libs: d.libs };
    }
    /* Quét mọi trường nội dung của qaList, khử trùng lặp theo đúng mã hình ĐÃ
       làm sạch (bỏ comment/directive trước khi tìm khối — nhờ vậy khối \begin
       nằm trong comment cũng không bị nhận nhầm là hình);
       label = vị trí xuất hiện đầu tiên ("Phần I câu 3") để báo tóm tắt khi fail.
       Directive thu được từ mọi trường gắn vào figs.directives để gửi kèm khi
       biên dịch (gói/thư viện texlive khai báo thêm). */
    function collectTikzFigures(qaList) {
      var seen = {}, figs = [], dirPkgs = [], dirLibs = [];
      (qaList || []).forEach(function (item) {
        if (!item.content) return;
        var c = item.content;
        [c.question, c.opt1, c.opt2, c.opt3, c.opt4, c.explain].forEach(function (t) {
          if (!t) return;
          var d = cleanTikzField(t);
          d.pkgs.forEach(function (p) { if (dirPkgs.indexOf(p) < 0) dirPkgs.push(p); });
          d.libs.forEach(function (l) { if (dirLibs.indexOf(l) < 0) dirLibs.push(l); });
          findTikzBlocks(d.text).forEach(function (code) {
            if (!seen[code]) { seen[code] = true; figs.push({ code: code, label: partLabel(item.section) + ' câu ' + item.num }); }
          });
        });
      });
      figs.directives = { pkgs: dirPkgs, libs: dirLibs };
      return figs;
    }
    /* Port scanPreamble + buildTikzDocument của dự án cũ (js/latex-import.js):
       tài liệu standalone, font tiếng Việt T5, gói đoán theo lệnh dùng trong hình,
       thư viện TikZ mặc định + \usetikzlibrary / \usepackage an toàn quét từ mã gốc.
       Gói .sty riêng (tkz-linknodes, tkz-tab-vn) chỉ \usepackage khi mã gốc có nhắc
       tới — proxy tự đính kèm mọi file .sty trong api/sty/ nên file có trên hosting
       là biên dịch được. */
    var TIKZ_SAFE_PKGS = ['tkz-tab', 'tkz-euclide', 'tkz-base', 'pgf-pie', 'forest', 'chemfig', 'circuitikz', 'tikz-cd', 'tikz-3dplot',
      'tabularray', 'nicematrix', 'makecell', 'mathrsfs', 'esvect', 'xlop', 'pgfplots', 'amsmath', 'amssymb', 'amsfonts', 'tkz-linknodes', 'tkz-tab-vn'];
    var TIKZ_STY_PKGS = ['tkz-linknodes', 'tkz-tab-vn'];
    function scanTikzPreamble(tex) {
      var libs = ['calc', 'arrows', 'arrows.meta', 'patterns', 'positioning', 'decorations.markings', 'angles', 'quotes',
        'intersections', 'through', 'backgrounds', 'math', 'shapes.geometric', '3d'];
      var pkgs = [];
      function addLib(x) { x = String(x || '').trim(); if (x && libs.indexOf(x) < 0) libs.push(x); }
      function addPkg(x) { x = String(x || '').trim(); if (x && pkgs.indexOf(x) < 0) pkgs.push(x); }
      var noComment = String(tex || '').split('\n').map(function (l) { var i = l.search(/(^|[^\\])%/); return i < 0 ? l : l.slice(0, i + 1); }).join('\n');
      var m, re;
      re = /\\usetikzlibrary\{([^}]*)\}/g; while ((m = re.exec(noComment))) m[1].split(',').forEach(addLib);
      re = /\\usepgfplotslibrary\{([^}]*)\}/g; while ((m = re.exec(noComment))) m[1].split(',').forEach(function (x) { addPkg('pgfplotslib:' + x); });
      re = /\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/g; while ((m = re.exec(noComment))) m[1].split(',').forEach(function (x) { if (TIKZ_SAFE_PKGS.indexOf(String(x || '').trim()) >= 0) addPkg(x); });
      return { libs: libs, pkgs: pkgs };
    }
    function buildTikzDoc(code, preamble) {
      var pkgs = ((preamble && preamble.pkgs) || []).slice();
      function addPkg(x) { if (pkgs.indexOf(x) < 0) pkgs.push(x); }
      if (/\\tkzTab/.test(code)) addPkg('tkz-tab');
      if (/\\tkz(Def|Draw|Mark|Label|Fill|Find|Get|Clip|Show|Init|Grid|Axe)/.test(code)) addPkg('tkz-euclide');
      if (/\\pie\b/.test(code)) addPkg('pgf-pie');
      if (/\\chemfig/.test(code)) addPkg('chemfig');
      if (/\\begin\{circuitikz\}/.test(code)) addPkg('circuitikz');
      if (/\\begin\{tikzcd\}/.test(code)) addPkg('tikz-cd');
      if (/\\begin\{forest\}/.test(code)) addPkg('forest');
      var base = ['amsmath', 'amssymb', 'amsfonts', 'mathrsfs', 'tikz', 'pgfplots'];
      var list = pkgs.filter(function (p) { return p.indexOf('pgfplotslib:') !== 0 && base.indexOf(p) < 0; });
      var pgfLibs = ['fillbetween'];
      pkgs.forEach(function (p) { if (p.indexOf('pgfplotslib:') === 0) pgfLibs.push(p.slice(12)); });
      var L = [
        '\\documentclass[border=4pt]{standalone}',
        '\\usepackage[T5]{fontenc}',
        '\\usepackage[utf8]{inputenc}',
        '\\usepackage{amsmath,amssymb,amsfonts,mathrsfs}',
        '\\usepackage{tikz}',
        '\\usepackage{pgfplots}',
        '\\pgfplotsset{compat=1.18}',
        '\\usepgfplotslibrary{' + pgfLibs.join(',') + '}'
      ];
      list.forEach(function (p) { L.push('\\usepackage{' + p + '}'); });
      L.push('\\usetikzlibrary{' + ((preamble && preamble.libs) || []).join(',') + '}');
      L.push('\\begin{document}');
      L.push(code);
      L.push('\\end{document}');
      return L.join('\n');
    }
    /* pdf.js nạp lười từ CDN (như dự án cũ, bản 3.11.174) — chỉ khi có hình TikZ. */
    var pdfjsPromise = null;
    function loadPdfJs() {
      if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
      if (pdfjsPromise) return pdfjsPromise;
      var V = '3.11.174', BASE = '../../vendor/pdfjs/';
      pdfjsPromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = BASE + 'pdf.min.js';
        s.onload = function () {
          if (!window.pdfjsLib) { pdfjsPromise = null; reject(new Error('Không nạp được pdf.js')); return; }
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = BASE + 'pdf.worker.min.js';
          resolve(window.pdfjsLib);
        };
        s.onerror = function () { pdfjsPromise = null; reject(new Error('Không tải được thư viện pdf.js (kiểm tra mạng)')); };
        document.head.appendChild(s);
      });
      return pdfjsPromise;
    }
    /* Cắt lề trắng quanh nội dung (port trimCanvas của dự án cũ, giữ pad điểm ảnh) */
    function trimCanvas(canvas, pad) {
      try {
        var w = canvas.width, h = canvas.height;
        var data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
        var top = h, left = w, right = -1, bottom = -1;
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
          var i = (y * w + x) * 4;
          if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
            if (x < left) left = x; if (x > right) right = x;
            if (y < top) top = y; if (y > bottom) bottom = y;
          }
        }
        if (right < 0) return canvas;
        left = Math.max(0, left - pad); top = Math.max(0, top - pad);
        right = Math.min(w - 1, right + pad); bottom = Math.min(h - 1, bottom + pad);
        if (left === 0 && top === 0 && right === w - 1 && bottom === h - 1) return canvas;
        var out = document.createElement('canvas');
        out.width = right - left + 1; out.height = bottom - top + 1;
        out.getContext('2d').drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
        return out;
      } catch (e) { return canvas; }
    }
    function canvasToPngBytes(canvas) {
      return new Promise(function (resolve) {
        if (!canvas.toBlob) { resolve(null); return; }
        canvas.toBlob(function (b) {
          if (!b) { resolve(null); return; }
          b.arrayBuffer().then(function (ab) { resolve(new Uint8Array(ab)); }, function () { resolve(null); });
        }, 'image/png');
      });
    }
    /* PDF (trang 1) → PNG ~216 DPI (scale 3) + kích thước in thật (pt), rộng tối đa
       452pt (A4 trừ lề của mẫu Word) giữ nguyên tỉ lệ. */
    function pdfBlobToFigure(blob) {
      return blob.arrayBuffer().then(function (ab) {
        return loadPdfJs().then(function (pdfjs) {
          return pdfjs.getDocument({ data: new Uint8Array(ab) }).promise.then(function (pdf) {
            return pdf.getPage(1).then(function (page) {
              var scale = 3;
              var vp = page.getViewport({ scale: scale });
              var canvas = document.createElement('canvas');
              canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
              var ctx = canvas.getContext('2d');
              ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
              return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
                try { pdf.destroy(); } catch (e) {}
                var trimmed = trimCanvas(canvas, 12);
                return canvasToPngBytes(trimmed).then(function (bytes) {
                  if (!bytes) return null;
                  var wPt = trimmed.width / scale * 72, hPt = trimmed.height / scale * 72;
                  if (wPt > 452) { hPt = hPt * 452 / wPt; wPt = 452; }
                  return { bytes: bytes, wPt: wPt, hPt: hPt };
                });
              });
            });
          });
        });
      });
    }
    /* Cache theo đúng mã hình trong cả phiên: cùng 1 hình ở nhiều mã đề / cả 2 bản
       (đáp án + học sinh) chỉ biên dịch 1 lần. Chỉ cache THÀNH CÔNG — hình fail sẽ
       được thử lại ở lần tải sau (user sửa hosting/.sty xong tải lại là có ảnh). */
    var tikzPngCache = {};
    function compileOneTikz(code, scanText, directives) {
      var doc;
      try {
        var pre = scanTikzPreamble(String(scanText || '') + '\n' + code);
        /* Directive %!<...> (đợt 7): khai báo gói/thư viện người soạn gửi thêm —
           hợp nhất vào tập biên dịch để texlive không thiếu gói/thư viện đó. */
        if (directives) {
          directives.pkgs.forEach(function (p) { if (pre.pkgs.indexOf(p) < 0) pre.pkgs.push(p); });
          directives.libs.forEach(function (l) { if (pre.libs.indexOf(l) < 0) pre.libs.push(l); });
        }
        doc = buildTikzDoc(code, pre);
      }
      catch (e) { return Promise.resolve({ reason: 'Không dựng được tài liệu TikZ: ' + e.message }); }
      return compileViaPhp(doc, {}).then(function (r) {
        if (r.pdf) return pdfBlobToFigure(r.pdf).then(function (fig) {
          return fig || { reason: 'Không chuyển được PDF của hình sang PNG (pdf.js).' };
        });
        var msg = (r.errors && r.errors[0]) || r.message || 'Proxy biên dịch báo lỗi.';
        if (window.console) console.error('[ChdMathType] Biên dịch hình TikZ thất bại:', r);
        return { reason: msg };
      }).catch(function (e) {
        if (window.console) console.error('[ChdMathType] Biên dịch hình TikZ thất bại:', e);
        return { reason: e && e.message ? e.message : String(e) };
      });
    }
    /* Biên dịch song song tối đa 3 hình cùng lúc; mỗi hình tự có timeout theo proxy
       (180s) — hình quá hạn tính là fail, không treo cả lần tải. */
    function compileTikzFigures(figs, onProgress) {
      var byCode = {}, fails = [];
      var scanText = figs.map(function (f) { return f.code; }).join('\n');
      var queue = figs.slice();
      function worker() {
        var fig = queue.shift();
        if (!fig) return Promise.resolve();
        var p = tikzPngCache[fig.code] ? Promise.resolve(tikzPngCache[fig.code])
          : compileOneTikz(fig.code, scanText, figs.directives).then(function (res) {
              if (res && res.bytes) tikzPngCache[fig.code] = res;
              return res;
            });
        return p.then(function (res) {
          if (res && res.bytes) byCode[fig.code] = res;
          else { byCode[fig.code] = null; fails.push({ label: fig.label, reason: (res && res.reason) || 'không rõ lý do' }); }
          if (onProgress) onProgress();
        }).then(worker);
      }
      var workers = [];
      for (var i = 0; i < Math.min(3, figs.length); i++) workers.push(worker());
      return Promise.all(workers).then(function () { return { byCode: byCode, fails: fails }; });
    }
    /* Thay các khối TikZ ĐÃ biên dịch được bằng token giữ chỗ trong 1 bản sao của
       qaList (bản gốc không đổi); khối fail giữ nguyên mã chữ. Token không chứa ký
       tự đặc biệt nên đi qua textToDocx nguyên vẹn trong 1 run chữ. */
    function substituteTikz(qaList, byCode) {
      var jobs = [], tokenOf = {}, n = 0;
      var copy = JSON.parse(JSON.stringify(qaList || []));
      copy.forEach(function (item) {
        if (!item.content) return;
        ['question', 'opt1', 'opt2', 'opt3', 'opt4', 'explain'].forEach(function (k) {
          var t = item.content[k];
          if (!t) return;
          /* Trường có hình TikZ hoặc dòng directive %!<...>: dùng bản đã bỏ
             comment + directive (đợt 7) — hình biên dịch được thì thay token,
             hình fail giữ lại dạng chữ cũng không còn dòng comment nào. */
          if (findTikzBlocks(t).length || t.indexOf('%!<') >= 0) t = cleanTikzField(t).text;
          findTikzBlocks(t).forEach(function (code) {
            var fig = byCode[code];
            if (!fig) return;
            if (!tokenOf[code]) { n++; tokenOf[code] = 'CHDTIKZFIG' + n + 'ZZ'; jobs.push({ token: tokenOf[code], fig: fig }); }
            t = t.split(code).join(tokenOf[code]);
          });
          item.content[k] = t;
        });
      });
      return { list: copy, jobs: jobs };
    }
    function tikzDrawingRun(rid, cx, cy, name, docPrId) {
      return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
        '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
        '<wp:docPr id="' + docPrId + '" name="Hinh TikZ ' + docPrId + '"/>' +
        '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
        '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
        '<pic:nvPicPr><pic:cNvPr id="0" name="' + name + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
        '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>' +
        '</wp:inline></w:drawing></w:r>';
    }
    /* Thay 1 token trong document.xml bằng run ảnh, giữ nguyên chữ trước/sau token
       trong cùng run (kèm rPr nếu có). Trả null nếu cấu trúc lạ — caller hủy toàn bộ
       việc nhúng và tải bản giữ mã chữ thay vì để sót token trong file. */
    function replaceFigToken(xml, token, makeDrawing) {
      var out = xml, guard = 0;
      while (out.indexOf(token) >= 0) {
        if (++guard > 60) return null;
        var idx = out.indexOf(token);
        var rStart = Math.max(out.lastIndexOf('<w:r>', idx), out.lastIndexOf('<w:r ', idx));
        if (rStart < 0) return null;
        if (out.slice(rStart, idx).indexOf('</w:r>') >= 0) return null;
        var rEnd = out.indexOf('</w:r>', idx);
        if (rEnd < 0) return null;
        var runXml = out.slice(rStart, rEnd + 6);
        var tOpen = runXml.indexOf('<w:t');
        var tTagEnd = tOpen < 0 ? -1 : runXml.indexOf('>', tOpen);
        var tClose = runXml.indexOf('</w:t>');
        if (tOpen < 0 || tTagEnd < 0 || tClose < 0 || tClose < tTagEnd) return null;
        var head = runXml.slice(0, tTagEnd + 1);
        var inner = runXml.slice(tTagEnd + 1, tClose);
        var ti = inner.indexOf(token);
        if (ti < 0) return null;
        var before = inner.slice(0, ti), after = inner.slice(ti + token.length);
        var rep = '';
        if (before) rep += head + before + '</w:t></w:r>';
        rep += makeDrawing();
        if (after) rep += head + after + '</w:t></w:r>';
        out = out.slice(0, rStart) + rep + out.slice(rEnd + 6);
      }
      return out;
    }
    /* Nhúng PNG vào .docx đã tạo: thêm word/media/*.png + relationship + content
       type (textToDocx đã khai sẵn Default png) + khai namespace wp/a/pic cho
       document.xml (bản gốc chưa có) rồi thay từng token bằng <w:drawing>.
       Mọi lỗi / sót token → trả null để caller tải bản giữ nguyên mã TikZ dạng chữ. */
    function embedTikzDocx(blob, jobs) {
      if (!jobs.length || !window.JSZip) return Promise.resolve(null);
      return window.JSZip.loadAsync(blob).then(function (zip) {
        var fDoc = zip.file('word/document.xml');
        var fRels = zip.file('word/_rels/document.xml.rels');
        var fCt = zip.file('[Content_Types].xml');
        if (!fDoc || !fRels || !fCt) return null;
        return Promise.all([fDoc.async('string'), fRels.async('string'), fCt.async('string')]).then(function (parts) {
          var xml = parts[0], rels = parts[1], ct = parts[2];
          /* Chỉ nhúng các hình mà token THẬT SỰ có trong văn bản của bản này
             (hình chỉ nằm ở lời giải thì bản học sinh không in lời giải → không có
             token → bỏ qua, không thêm media/rel thừa). Không hình nào có mặt
             thì trả null để caller giữ nguyên file gốc. */
          jobs = jobs.filter(function (job) { return xml.indexOf(job.token) >= 0; });
          if (!jobs.length) return blob;   // không hình nào thuộc bản này → file gốc đã đúng, giữ nguyên
          if (xml.indexOf('xmlns:wp=') < 0) {
            var nx = xml.replace(/<w:document\b([^>]*)>/, function (m, attrs) {
              return '<w:document' + attrs + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">';
            });
            if (nx === xml) return null;
            xml = nx;
          }
          var maxId = 0;
          rels.replace(/Id="rId(\d+)"/g, function (m, nn) { maxId = Math.max(maxId, parseInt(nn, 10)); return m; });
          var relAdds = '';
          jobs.forEach(function (job, i) {
            job.media = 'chdtikz' + (i + 1) + '.png';
            job.rid = 'rId' + (++maxId);
            relAdds += '<Relationship Id="' + job.rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + job.media + '"/>';
          });
          rels = rels.replace('</Relationships>', relAdds + '</Relationships>');
          if (rels.indexOf(relAdds) < 0) return null;
          if (ct.indexOf('Extension="png"') < 0) {
            ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
            if (ct.indexOf('Extension="png"') < 0) return null;
          }
          var docPr = 9000;
          var sorted = jobs.slice().sort(function (a, b) { return b.token.length - a.token.length; });
          for (var i = 0; i < sorted.length; i++) {
            var job = sorted[i];
            var cx = Math.max(1, Math.round(job.fig.wPt * 12700)), cy = Math.max(1, Math.round(job.fig.hPt * 12700));
            var out = replaceFigToken(xml, job.token, function () {
              docPr++;
              return tikzDrawingRun(job.rid, cx, cy, job.media, docPr);
            });
            if (out == null) return null;
            xml = out;
          }
          if (xml.indexOf('CHDTIKZFIG') >= 0) return null;
          if (window.ChdWordImage && ChdWordImage.xmlWellFormed) {
            if (!ChdWordImage.xmlWellFormed(xml) || !ChdWordImage.xmlWellFormed(rels) || !ChdWordImage.xmlWellFormed(ct)) return null;
          }
          zip.file('word/document.xml', xml);
          zip.file('word/_rels/document.xml.rels', rels);
          zip.file('[Content_Types].xml', ct);
          jobs.forEach(function (job) { zip.file('word/media/' + job.media, job.fig.bytes); });
          return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        });
      }).catch(function (e) {
        if (window.console) console.error('[ChdMathType] Nhúng ảnh TikZ vào Word lỗi:', e);
        return null;
      });
    }

    function downloadWord(qaList, code, withAnswers) {
      if (!window.MTCore || !window.JSZip) { dtMsg('dtShufMsg', 'Thư viện lõi chưa sẵn sàng (MTCore/JSZip) — kiểm tra mạng rồi thử lại.', true); return; }
      var figs = collectTikzFigures(qaList);
      if (!figs.length) { buildWordFile(qaList, code, withAnswers, null); return; }
      /* Có hình TikZ: biên dịch thành ảnh trước (có tiến trình), xong mới tạo Word.
         Hình fail → giữ mã chữ + ghi vào bản tóm tắt cuối (tikzRes.fails). */
      var done = 0;
      dtMsg('dtShufMsg', 'Đang biên dịch ' + figs.length + ' hình TikZ thành ảnh cho file Word (0/' + figs.length + ')…');
      compileTikzFigures(figs, function () {
        done++;
        dtMsg('dtShufMsg', 'Đang biên dịch ' + figs.length + ' hình TikZ thành ảnh cho file Word (' + done + '/' + figs.length + ')…');
      }).then(function (res) {
        var sub = substituteTikz(qaList, res.byCode);
        buildWordFile(sub.list, code, withAnswers, { jobs: sub.jobs, fails: res.fails, total: figs.length, origList: qaList });
      }).catch(function (e) {
        if (window.console) console.error('[ChdMathType] Biên dịch hình TikZ lỗi ngoài dự kiến:', e);
        buildWordFile(qaList, code, withAnswers, { jobs: [], fails: figs.map(function (f) { return { label: f.label, reason: e && e.message ? e.message : String(e) }; }), total: figs.length, origList: qaList });
      });
    }
    function buildWordFile(qaList, code, withAnswers, tikzRes) {
      var mode = wordMode();
      dtMsg('dtShufMsg', 'Đang tạo file Word (' + (mode === 'omml' ? 'Equation' : 'MathType') + ') cho mã ' + code + '...');
      var text = examToText(qaList, code, withAnswers);
      var hdr = examToText.hdr;
      return window.MTCore.textToDocx(text, { mode: mode, latexToMathml: dtLatexToMathml, previewFor: dtPreviewFor }, window.JSZip)
        .then(function (res) {
          var name = texBaseName(code) + (withAnswers ? '_DaCoi.docx' : '_HocSinh.docx');
          var styled = insertWordHeaderDocx(res.data, hdr);
          var chain = withAnswers ? styled.then(function (b) { return colorizeAnswersDocx(b); }) : styled;
          return chain.then(function (b) {
            if (!tikzRes || !tikzRes.jobs.length) return b;
            return embedTikzDocx(b, tikzRes.jobs).then(function (bx) {
              if (bx) return bx;
              /* Nhúng ảnh thất bại ở khâu đóng gói: tạo lại bản giữ nguyên mã TikZ
                 dạng chữ (không để sót token giữ chỗ trong file người dùng nhận). */
              if (window.console) console.error('[ChdMathType] Nhúng ảnh TikZ thất bại — tải bản giữ mã TikZ dạng chữ.');
              tikzRes.jobs.forEach(function (j) { tikzRes.fails.push({ label: '(hình đã biên dịch)', reason: 'Không nhúng được ảnh vào file Word, đã giữ mã TikZ dạng chữ.' }); });
              tikzRes.jobs = [];
              tikzRes.rebuilt = true;   // bản tạo lại sẽ tự hiện thông báo cuối — bản này không hiện nữa
              return buildWordFile(tikzRes.origList, code, withAnswers, tikzRes).then(function () { return null; });
            });
          }).then(function (b) { if (b) saveBlob(b, name); });
        })
        .then(function () {
          if (tikzRes && tikzRes.rebuilt) return;
          var msg = 'Đã tải file Word cho mã ' + code + '.';
          if (tikzRes && tikzRes.total) {
            var okN = tikzRes.total - tikzRes.fails.length;
            if (okN > 0) msg += ' Đã nhúng ' + okN + '/' + tikzRes.total + ' hình TikZ thành ảnh thật.';
            if (tikzRes.fails.length) {
              msg += ' Các hình chưa biên dịch được (đã giữ nguyên mã TikZ dạng chữ trong file): ' +
                tikzRes.fails.map(function (f) { return f.label; }).join(', ') + ' — chi tiết lý do trong console (F12).';
            }
          }
          dtMsg('dtShufMsg', msg, !!(tikzRes && tikzRes.fails.length));
        })
        .catch(function (e) { dtMsg('dtShufMsg', 'Lỗi xuất Word: ' + e.message, true); });
    }

    /* ---------------- Excel bảng đáp án ---------------- */
    $('dtExpAnsXlsx').addEventListener('click', function () {
      if (!window.JSZip) { dtMsg('dtShufMsg', 'Thư viện JSZip chưa tải được.', true); return; }
      var codes = Object.keys(shuffledPool);
      var entries = [];
      if (codes.length) codes.forEach(function (cd) { entries.push([cd, shuffledPool[cd].answersKey]); });
      else if (curCode) entries.push(['GOC', answersKeyOf('GOC', origQA())]);
      if (!entries.length) { dtMsg('dtShufMsg', 'Chưa có mã đề nào để xuất bảng đáp án.', true); return; }
      var s1 = [[{ v: 'Mã đề', s: 2 }, { v: 'Câu', s: 2 }, { v: 'Đáp án', s: 2 }]];
      var s2 = [[{ v: 'Mã đề', s: 2 }, { v: 'Câu', s: 2 }, { v: 'Đáp án', s: 2 }]];
      entries.forEach(function (en) {
        en[1].MC_TF_SA.forEach(function (a) { s1.push([en[0], a.qNum, a.ans]); });
        en[1].LA.forEach(function (a) { s2.push([en[0], a.qNum, '']); });
      });
      buildXlsx([
        { name: 'Sheet1', rows: s1, widths: [12, 8, 20] },
        { name: 'Sheet2', rows: s2, widths: [12, 8, 20] }
      ]).then(function (blob) { saveBlob(blob, 'DanhSachDapAn_' + noAccent(curCode) + '.xlsx'); })
        .catch(function (e) { dtMsg('dtShufMsg', 'Lỗi xuất Excel đáp án: ' + e.message, true); });
    });

    /* ================= BIÊN DỊCH PDF ================= */
    function fillPdfTargets() {
      var sel = $('dtPdfTarget'); if (!sel) return;
      var cur = sel.value;
      sel.innerHTML = '';
      var o0 = document.createElement('option'); o0.value = 'GOC'; o0.textContent = 'Đề gốc (GOC)'; sel.appendChild(o0);
      Object.keys(shuffledPool).sort(function (a, b) { return (+a) - (+b); }).forEach(function (cd) {
        var o = document.createElement('option'); o.value = cd; o.textContent = 'Mã đề ' + cd; sel.appendChild(o);
      });
      if (cur && (cur === 'GOC' || shuffledPool[cur])) sel.value = cur;
    }
    function pdfModeVal() { var r = document.querySelector('input[name="dtPdfMode"]:checked'); return r ? r.value : 'loigiai'; }
    function compileTargetQa(code) { return code === 'GOC' ? origQA() : (shuffledPool[code] ? shuffledPool[code].questions : []); }
    function fetchWithTimeout(url, opts, ms) {
      var ctrl = new AbortController();
      var to = setTimeout(function () { ctrl.abort(); }, ms);
      opts = opts || {}; opts.signal = ctrl.signal;
      return fetch(url, opts).then(function (r) { clearTimeout(to); return r; }, function (e) { clearTimeout(to); throw e; });
    }
    /* ---------- Ảnh → "PDF dạng chữ" (port từ pdf-compile.js của dự án cũ) ----------
       texlive.net chỉ nhận tệp văn bản, nên ảnh JPEG được gói thành 1 trang PDF chỉ gồm
       ký tự ASCII (ASCIIHex + DCTDecode) đặt tên imageNN.pdf; \includegraphics đọc bình thường. */
    function jpegInfo(b) {
      if (!b || b[0] !== 0xFF || b[1] !== 0xD8) return null;
      var i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xFF) { i++; continue; }
        var m = b[i + 1];
        if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
        var len = (b[i + 2] << 8) | b[i + 3];
        if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) || (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF)) {
          return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], comps: b[i + 9] };
        }
        i += 2 + len;
      }
      return null;
    }
    function asciiPdfFromJpeg(bytes, info) {
      var w = info.w, h = info.h, comps = info.comps;
      var cs = comps === 1 ? '/DeviceGray' : comps === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
      var HEX = '0123456789ABCDEF';
      var parts = [], line = '';
      for (var k = 0; k < bytes.length; k++) {
        line += HEX[bytes[k] >> 4] + HEX[bytes[k] & 15];
        if (line.length >= 120) { parts.push(line); line = ''; }
      }
      if (line) parts.push(line);
      var NL = '\r\n';
      var data = parts.join(NL) + '>';
      var content = 'q ' + w + ' 0 0 ' + h + ' 0 0 cm /Im1 Do Q';
      var objs = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + w + ' ' + h + '] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
        '<< /Length ' + content.length + ' >>' + NL + 'stream' + NL + content + NL + 'endstream',
        '<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace ' + cs + ' /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ' + data.length + ' >>' + NL + 'stream' + NL + data + NL + 'endstream'
      ];
      var out = '%PDF-1.4' + NL, offs = [];
      objs.forEach(function (o, n) { offs.push(out.length); out += (n + 1) + ' 0 obj' + NL + o + NL + 'endobj' + NL; });
      var x = out.length;
      out += 'xref' + NL + '0 ' + (objs.length + 1) + NL + '0000000000 65535 f\r\n' + offs.map(function (o) { return String(o).padStart(10, '0') + ' 00000 n\r\n'; }).join('');
      out += 'trailer' + NL + '<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>' + NL + 'startxref' + NL + x + NL + '%%EOF' + NL;
      return out;
    }
    function cloudinaryJpegUrl(url) {
      return /res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(url) ? url.replace('/image/upload/', '/image/upload/f_jpg,q_85,w_1600,c_limit/') : url;
    }
    function blobToJpegBytes(blob) {
      function viaCanvas(img, w, h) {
        var scale = Math.min(1, 1600 / w);
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        return new Promise(function (res, rej) {
          if (!c.toBlob) { rej(new Error('no toBlob')); return; }
          c.toBlob(function (b) { if (!b) { rej(new Error('canvas trống')); return; } b.arrayBuffer().then(function (ab) { res(new Uint8Array(ab)); }, rej); }, 'image/jpeg', 0.88);
        });
      }
      if (window.createImageBitmap) {
        return createImageBitmap(blob).then(function (bmp) { return viaCanvas(bmp, bmp.width, bmp.height); });
      }
      return new Promise(function (resolve, reject) {
        var u = URL.createObjectURL(blob), im = new Image();
        im.onload = function () { URL.revokeObjectURL(u); viaCanvas(im, im.naturalWidth || im.width, im.naturalHeight || im.height).then(resolve, reject); };
        im.onerror = function () { URL.revokeObjectURL(u); reject(new Error('Không đọc được ảnh')); };
        im.src = u;
      });
    }
    function imageToAsciiPdf(url) {
      var tryUrls = [cloudinaryJpegUrl(url)];
      if (tryUrls[0] !== url) tryUrls.push(url);
      var chain = Promise.resolve(null);
      tryUrls.forEach(function (u) {
        chain = chain.then(function (got) {
          if (got) return got;
          return fetch(u).then(function (r) {
            if (!r.ok) return null;
            return r.blob().then(function (blob) {
              return blob.arrayBuffer().then(function (ab) {
                var bytes = new Uint8Array(ab), info = jpegInfo(bytes);
                if (info && info.comps !== 4) return { bytes: bytes, info: info };
                return blobToJpegBytes(blob).then(function (jb) {
                  var ji = jpegInfo(jb);
                  return (ji && ji.w && ji.h) ? { bytes: jb, info: ji } : null;
                }).catch(function () { return null; });
              });
            });
          }).catch(function () { return null; });
        });
      });
      return chain.then(function (got) { return got ? asciiPdfFromJpeg(got.bytes, got.info) : null; });
    }
    /* Chuẩn bị bản tex GỬI BIÊN DỊCH: đổi \includegraphics{imageNN.png} → {imageNN.pdf}
       + tải từng ảnh thành file PDF dạng chữ. Ảnh tải hỏng → thay bằng khung ghi chú. */
    function prepareCompileTex(tex) {
      var urls = Object.keys(DT_IMGMAP || {});
      if (!urls.length) return Promise.resolve({ tex: tex, files: {} });
      var files = {}, missing = [];
      var jobs = urls.map(function (u) {
        var pdfName = DT_IMGMAP[u].replace(/\.png$/i, '.pdf');
        return imageToAsciiPdf(u).then(function (pdf) {
          if (pdf) files[pdfName] = pdf; else missing.push(pdfName);
        });
      });
      return Promise.all(jobs).then(function () {
        var out = tex.replace(/\\includegraphics(\[[^\]]*\])?\{image(\d+)\.png\}/g, function (m, opt, num) {
          var name = 'image' + num + '.pdf';
          return files[name] ? ('\\includegraphics' + (opt || '') + '{' + name + '}') : '\\fbox{\\parbox{0.5\\textwidth}{\\centering\\small [Ảnh ' + (+num) + ' không tải được]}}';
        });
        return { tex: out, files: files, missing: missing };
      });
    }
    /* Gọi proxy api/compile.php (CÙNG ORIGIN). Proxy tự đính kèm MỌI file .sty trong
       api/sty/ trên hosting rồi chuyển tiếp texlive.net. KHÔNG còn đường gọi thẳng texlive.net từ
       trình duyệt (bị CORS + không đính kèm được .sty phía server).
       Resolve: {pdf: Blob} khi thành công; {errors:[], http, message, raw} khi proxy trả lỗi.
       Reject: Error có .httpStatus (0 = mất mạng/timeout) khi không lấy được phản hồi. */
    function compileViaPhp(tex, files) {
      var fd = new FormData();
      fd.append('code', tex); fd.append('engine', 'pdflatex');
      Object.keys(files || {}).forEach(function (name) {
        fd.append('sty_names[]', name); fd.append('sty_contents[]', files[name]);
      });
      return fetchWithTimeout('https://hotrohoctap.com/1ai/chdmathtype/api/compile.php', { method: 'POST', body: fd }, 180000)
        .then(function (res) {
          return res.text().then(function (txt) {
            var j = null;
            try { j = JSON.parse(txt); } catch (e) { j = null; }
            if (j && j.status === 'success' && j.pdf_base64) {
              var bin = atob(j.pdf_base64), arr = new Uint8Array(bin.length);
              for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
              return { pdf: new Blob([arr], { type: 'application/pdf' }), http: res.status };
            }
            if (j) return { errors: (j.errors && j.errors.length ? j.errors : [j.message || 'Biên dịch thất bại.']), http: res.status, message: j.message || '', raw: txt };
            var hint = res.status === 404 ? 'Chưa có file api/compile.php trên hosting (HTTP 404) — hãy upload gói zip bản mới nhất.' :
              res.status === 413 ? 'Dữ liệu gửi đi quá lớn so với giới hạn của hosting (HTTP 413, post_max_size).' :
              'Proxy api/compile.php trả về dữ liệu không đọc được (HTTP ' + res.status + ').';
            return { errors: [hint], http: res.status, message: hint, raw: String(txt || '').slice(0, 800) };
          });
        }, function (e) {
          var err = new Error(e && e.name === 'AbortError' ? 'Quá thời gian chờ proxy biên dịch (3 phút).' : 'Không kết nối được tới proxy api/compile.php: ' + (e && e.message ? e.message : e));
          err.httpStatus = 0;
          throw err;
        });
    }
    /* Map lỗi của proxy (mỗi lỗi dạng "… (dòng N)") về câu hỏi nhờ dấu % [CHD-CAU] trong tex. */
    function mapProxyErrors(errStrings, tex) {
      var texLines = String(tex || '').split('\n');
      var markers = [];
      texLines.forEach(function (ln, i) {
        var m = /% \[CHD-CAU\] (\S+) \| (.+)/.exec(ln);
        if (m) markers.push({ line: i + 1, slotId: m[1], label: m[2] });
      });
      var firstEx = markers.length ? markers[0].line : -1;
      return (errStrings || []).map(function (msg) {
        msg = String(msg);
        var lm = /\(dòng (\d+)\)/.exec(msg) || /\bl\.(\d+)\b/.exec(msg);
        var line = lm ? parseInt(lm[1], 10) : null;
        var label = null, slotId = null;
        if (line) { for (var k = markers.length - 1; k >= 0; k--) { if (markers[k].line <= line) { label = markers[k].label; slotId = markers[k].slotId; break; } } }
        if (line && firstEx > 0 && line < firstEx) { label = null; slotId = null; }
        return { msg: msg, line: line, label: label, slotId: slotId };
      });
    }
    /* Hiện lỗi biên dịch ĐẦY ĐỦ: câu chung + lỗi đã map về câu + khối "Chi tiết lỗi" mở rộng
       (HTTP status, thông báo proxy, toàn bộ dòng lỗi) + console.error toàn bộ phản hồi.
       Không bao giờ chỉ hiện câu chung chung như trước. */
    function showCompileError(detail, tex) {
      try { console.error('[ChdMathType] Biên dịch PDF thất bại:', detail); } catch (e) {}
      var errs = mapProxyErrors(detail.errors || [], tex);
      lastPdf.errors = errs;
      var box = $('dtPdfErrors');
      var html = '<b>Biên dịch thất bại.</b> Hãy tải file .tex về kiểm tra, hoặc thử lại.';
      if (errs.length) {
        html += '<br>' + errs.map(function (e) {
          return '• ' + (e.label ? '&lt;' + esc(e.label) + '&gt;: ' : '') + esc(e.msg);
        }).join('<br>');
      }
      var det = [];
      det.push('HTTP status (proxy api/compile.php): ' + (detail.http != null ? detail.http : 'không có phản hồi (mất mạng / quá thời gian chờ)'));
      if (detail.message && detail.message !== (detail.errors || [])[0]) det.push('Thông báo proxy: ' + detail.message);
      (detail.errors || []).forEach(function (e, i) { det.push('Lỗi ' + (i + 1) + ': ' + e); });
      if (detail.raw && detail.errors && detail.raw.indexOf(detail.errors.join('')) < 0) det.push('Phản hồi thô (rút gọn): ' + String(detail.raw).slice(0, 800));
      html += '<details class="dt-errdetail"><summary>Chi tiết lỗi (bấm để mở — gửi phần này khi cần hỗ trợ)</summary><pre>' + esc(det.join('\n')) + '</pre></details>';
      box.innerHTML = html;
      box.hidden = false;
      var skipBtn = $('dtPdfSkip');
      var skippable = errs.filter(function (e) { return e.slotId; });
      if (skippable.length) {
        skipBtn.hidden = false;
        skipBtn.textContent = 'Bỏ qua ' + skippable.length + ' câu lỗi & biên dịch lại';
      } else skipBtn.hidden = true;
      dtMsg('dtPdfStatus', 'Biên dịch thất bại — xem chi tiết lỗi bên dưới.', true);
    }
    /* Chạy 1 lượt biên dịch trọn gói: chuẩn bị ảnh → gửi proxy → PDF hoặc khối lỗi chi tiết.
       Dùng chung cho nút "Biên dịch PDF" và nút "Bỏ qua câu lỗi & biên dịch lại". */
    function runCompile(tex, onPdf) {
      dtMsg('dtPdfStatus', 'Đang chuẩn bị ảnh & biên dịch PDF qua proxy trên hosting (api/compile.php)... có thể mất 10–60 giây.');
      prepareCompileTex(tex).then(function (prep) {
        lastPdf.sentTex = prep.tex;
        if (prep.missing && prep.missing.length) {
          try { console.warn('[ChdMathType] Ảnh không tải được khi biên dịch:', prep.missing); } catch (e) {}
        }
        return compileViaPhp(prep.tex, prep.files);
      }).then(function (r) {
        if (r.pdf) { onPdf(r.pdf); return; }
        showCompileError({ errors: r.errors, http: r.http, message: r.message, raw: r.raw }, tex);
      }).catch(function (e) {
        showCompileError({ errors: [e && e.message ? e.message : String(e)], http: (e && e.httpStatus != null) ? e.httpStatus : 0, message: e && e.message ? e.message : '' }, tex);
      });
    }
    function doCompile(skipIds) {
      if (!examCfg(curCode)) { dtMsg('dtPdfStatus', 'Hãy chọn một mã kì thi trước.', true); return; }
      var code = $('dtPdfTarget').value || 'GOC';
      var mode = pdfModeVal();
      var qaList = compileTargetQa(code);
      if (!qaList.length) { dtMsg('dtPdfStatus', 'Không có dữ liệu đề để biên dịch.', true); return; }
      var tex = buildLaTeXCode(code, qaList, mode !== 'dethi', { markers: true, skipIds: skipIds || {} });
      lastPdf = { tex: tex, sentTex: null, code: code, qaList: qaList, mode: mode, skipIds: skipIds || {}, title: texBaseName(code), blob: null, url: null, errors: null };
      $('dtPdfErrors').hidden = true; $('dtPdfSkip').hidden = true;
      var started = Date.now();
      runCompile(tex, function (blob) {
        if (lastPdf.url) URL.revokeObjectURL(lastPdf.url);
        lastPdf.blob = blob; lastPdf.url = URL.createObjectURL(blob);
        $('dtPdfFrame').src = lastPdf.url;
        $('dtPdfViewer').hidden = false; $('dtPdfTools').hidden = false;
        var secs = ((Date.now() - started) / 1000).toFixed(1);
        dtMsg('dtPdfStatus', 'Xong (' + secs + 's) · bản ' + (mode === 'dethi' ? 'học sinh' : 'có lời giải') + ' · mã ' + code + '.');
      });
    }
    $('dtCompile').addEventListener('click', function () { doCompile({}); });
    $('dtPdfSkip').addEventListener('click', function () {
      if (!lastPdf || !lastPdf.errors) return;
      var skip = JSON.parse(JSON.stringify(lastPdf.skipIds || {}));
      lastPdf.errors.forEach(function (e) { if (e.slotId) skip[e.slotId] = true; });
      // biên dịch lại đúng target/mode đã lưu, thêm các câu lỗi vừa gặp vào danh sách bỏ qua
      var qaList = lastPdf.qaList, code = lastPdf.code, mode = lastPdf.mode;
      var tex = buildLaTeXCode(code, qaList, mode !== 'dethi', { markers: true, skipIds: skip });
      lastPdf.tex = tex; lastPdf.skipIds = skip; lastPdf.errors = null;
      $('dtPdfErrors').hidden = true; $('dtPdfSkip').hidden = true;
      runCompile(tex, function (blob) {
        if (lastPdf.url) URL.revokeObjectURL(lastPdf.url);
        lastPdf.blob = blob; lastPdf.url = URL.createObjectURL(blob);
        $('dtPdfFrame').src = lastPdf.url; $('dtPdfViewer').hidden = false; $('dtPdfTools').hidden = false;
        dtMsg('dtPdfStatus', 'Biên dịch lại thành công (đã bỏ qua câu lỗi).');
      });
    });
    $('dtPdfDownload').addEventListener('click', function () {
      if (lastPdf && lastPdf.blob) saveBlob(lastPdf.blob, lastPdf.title + '_' + (lastPdf.mode === 'dethi' ? 'HocSinh' : 'LoiGiai') + '.pdf');
    });
    $('dtPdfOpen').addEventListener('click', function () { if (lastPdf && lastPdf.url) window.open(lastPdf.url, '_blank'); });
    $('dtPdfTex').addEventListener('click', function () { if (lastPdf) saveText(lastPdf.sentTex || lastPdf.tex, lastPdf.title + '_DaGuiBienDich.tex', 'text/x-tex'); });
    $('dtPdfFull').addEventListener('click', function () {
      var v = $('dtPdfViewer');
      if (v.requestFullscreen) v.requestFullscreen().catch(function () {});
    });
    /* ================= XEM & TẢI MA TRẬN (2 bảng) ================= */
    function aggregateMatrix() {
      var cfg = examCfg(curCode);
      var groups = {}; // chapter -> topic -> data
      var order = [];
      function gq(ch, tp) {
        var key = ch + ' ' + tp;
        if (!groups[key]) { groups[key] = { chapter: ch, topic: tp, cells: {}, spec: {} }; order.push(groups[key]); }
        return groups[key];
      }
      matrix.forEach(function (q) {
        if (!q.level) return;
        var g = gq(q.chapter || 'Chưa gán', q.topic || 'Chưa gán');
        var units = levelUnits(q);
        units.forEach(function (lv, ui) {
          if (!lv) return;
          var ck = q.type + '|' + lv;
          if (!g.cells[ck]) g.cells[ck] = { count: 0, notes: [] };
          g.cells[ck].count += 1;
          if (q.type === 'TF') g.cells[ck].notes.push(q.qNum + 'abcd'[ui]);
          if (!g.spec[lv]) g.spec[lv] = { yccd: [], count: {}, comps: {} };
          var sp = g.spec[lv];
          sp.count[q.type] = (sp.count[q.type] || 0) + 1;
          (q.competencies || []).forEach(function (c) { sp.comps[c] = true; });
        });
        // YCCĐ cho đặc tả: gắn theo từng mức riêng của câu (TF: mọi mức phân biệt xuất hiện)
        var lvSet = {};
        units.forEach(function (lv) { if (lv) lvSet[lv] = true; });
        Object.keys(lvSet).forEach(function (lv) {
          var sp = g.spec[lv]; if (!sp) return;
          (q.outcomes || []).forEach(function (o) {
            var content = typeof o === 'string' ? o : o.content;
            if (content && sp.yccd.indexOf(content) < 0) sp.yccd.push(content);
          });
        });
      });
      return { cfg: cfg, groups: order };
    }
    function unitPoint(cfg, type) {
      if (!cfg) return 0;
      var cnt = cfg.counts[type] || 0, sc = cfg.scores[type] || 0;
      if (!cnt) return 0;
      return type === 'TF' ? sc / (cnt * 4) : sc / cnt;
    }
    function fmtNum(x) { var v = Math.round(x * 100) / 100; return String(v); }
    function matrixTablesData() {
      var agg = aggregateMatrix(), cfg = agg.cfg;
      var lvHeads = [];
      TYPES.forEach(function (t) { LEVELS.forEach(function (l) { lvHeads.push({ type: t, level: l }); }); });
      // Bảng 1
      var t1Head1 = ['TT', 'Chủ đề/Chương', 'Nội dung/đơn vị kiến thức'];
      var t1 = { head1: null, head2: [], rows: [], totalQ: [], totalP: [], totalPct: [] };
      var colTotals = lvHeads.map(function () { return 0; });
      var rowSpans = [];
      agg.groups.forEach(function (g, gi) {
        var row = [gi + 1, g.chapter, g.topic];
        var sumQ = 0;
        lvHeads.forEach(function (h, hi) {
          var cell = g.cells[h.type + '|' + h.level];
          var n = cell ? cell.count : 0;
          colTotals[hi] += n;
          sumQ += h.type === 'TF' ? n / 4 : n;
          row.push(cell ? (cell.notes.length ? n + ' (' + cell.notes.join(', ') + ')' : String(n)) : '');
        });
        row.push(fmtNum(sumQ));
        var pts = 0;
        lvHeads.forEach(function (h, hi) { var cell = g.cells[h.type + '|' + h.level]; if (cell) pts += cell.count * unitPoint(cfg, h.type); });
        var totPts = cfg ? TYPES.reduce(function (s, t) { return s + (cfg.scores[t] || 0); }, 0) : 0;
        row.push(totPts ? fmtNum(pts / totPts * 100) + '%' : '');
        t1.rows.push(row);
        rowSpans.push(g.chapter);
      });
      var totQAll = 0, totPAll = 0;
      var totPtsAll = cfg ? TYPES.reduce(function (s, t) { return s + (cfg.scores[t] || 0); }, 0) : 0;
      t1.totalQ = ['Tổng số câu', '', ''];
      t1.totalP = ['Tổng điểm', '', ''];
      t1.totalPct = ['Tỉ lệ %', '', ''];
      lvHeads.forEach(function (h, hi) {
        var n = colTotals[hi];
        var qv = h.type === 'TF' ? n / 4 : n;
        totQAll += qv;
        var pts = n * unitPoint(cfg, h.type);
        totPAll += pts;
        t1.totalQ.push(fmtNum(qv)); t1.totalP.push(fmtNum(pts));
        t1.totalPct.push(totPtsAll ? fmtNum(pts / totPtsAll * 100) + '%' : '');
      });
      t1.totalQ.push(fmtNum(totQAll)); t1.totalQ.push('');
      t1.totalP.push(''); t1.totalP.push(fmtNum(totPAll));
      t1.totalPct.push(''); t1.totalPct.push(totPtsAll ? fmtNum(totPAll / totPtsAll * 100) + '%' : '');
      // Bảng 2 (đặc tả)
      var t2 = { rows: [] };
      agg.groups.forEach(function (g, gi) {
        var lvs = LEVELS.filter(function (l) { return g.spec[l]; });
        if (!lvs.length) {
          var r0 = [gi + 1, g.chapter, g.topic, '(Chưa có đặc tả)'];
          lvHeads.forEach(function () { r0.push(''); });
          t2.rows.push(r0);
          return;
        }
        lvs.forEach(function (lv) {
          var sp = g.spec[lv];
          var r = [gi + 1, g.chapter, g.topic, lv + ': ' + sp.yccd.map(function (y) { return '- ' + y; }).join(' ')];
          lvHeads.forEach(function (h) {
            if (h.level !== lv) { r.push(''); return; }
            var cell = g.cells[h.type + '|' + lv];
            if (!cell) { r.push(''); return; }
            var comps = Object.keys(sp.comps);
            r.push(String(cell.count) + (comps.length ? ' (' + comps.join(', ') + ')' : ''));
          });
          t2.rows.push(r);
        });
      });
      return { t1: t1, t2: t2, lvHeads: lvHeads, rowSpans: rowSpans, cfg: cfg };
    }
    function renderMatrixView() {
      var box = $('dtMvTables'); if (!box) return;
      if (!curCode) { box.innerHTML = '<p class="dt-muted">Chọn một mã kì thi để xem ma trận.</p>'; return; }
      var d = matrixTablesData();
      function headHtml(extra) {
        var h1 = '<tr><th rowspan="2">TT</th><th rowspan="2" class="l">Chủ đề/Chương</th><th rowspan="2" class="l">Nội dung/đơn vị kiến thức</th>' +
          (extra ? '<th rowspan="2" class="l">Yêu cầu cần đạt</th>' : '') +
          '<th colspan="4">TNKQ — MC</th><th colspan="4">TNKQ — TF</th><th colspan="4">TNKQ — SA</th><th colspan="4">Tự luận — LA</th>' +
          (extra ? '' : '<th rowspan="2">Tổng số câu</th><th rowspan="2">Tỉ lệ %</th>') + '</tr>';
        var h2 = '<tr>' + LEVELS.concat(LEVELS, LEVELS, LEVELS).map(function (l) { return '<th>' + (l === 'Nhận biết' ? 'NB' : l === 'Thông hiểu' ? 'TH' : l === 'Vận dụng' ? 'VD' : 'VDC') + '</th>'; }).join('') + '</tr>';
        return h1 + h2;
      }
      function bodyRows(rows, spans, isSpec) {
        var out = '', lastCh = null, spanLeft = 0;
        rows.forEach(function (r, ri) {
          out += '<tr>';
          r.forEach(function (v, ci) {
            if (ci === 1 && spans) {
              if (v === lastCh && spanLeft > 0) { spanLeft--; return; }
              var cnt = 1; for (var k = ri + 1; k < rows.length; k++) { if (rows[k][1] === v) cnt++; else break; }
              lastCh = v; spanLeft = cnt - 1;
              out += '<td class="l" rowspan="' + cnt + '">' + esc(v) + '</td>'; return;
            }
            if (isSpec && ci === 3) {
              var sv = String(v), ix = sv.indexOf(': ');
              var hd = ix > 0 ? sv.slice(0, ix) : '', rest = ix > 0 ? sv.slice(ix + 2) : sv;
              var hv = (hd ? '<b>' + esc(hd) + ':</b> ' : '') + esc(rest).replace(/ - /g, '<br>- ');
              out += '<td class="l">' + hv + '</td>';
              return;
            }
            if (isSpec && ci >= 4) {
              var mv = /^(.*) \(([^()]*)\)$/.exec(String(v));
              if (mv) { out += '<td>' + esc(mv[1]) + ' <span class="comp">(' + esc(mv[2]) + ')</span></td>'; return; }
            }
            out += '<td class="' + (ci >= 1 && ci <= 2 ? 'l' : '') + '">' + esc(v) + '</td>';
          });
          out += '</tr>';
        });
        return out;
      }
      var html = '<details class="dt-collapse" open><summary>1. MA TRẬN ĐỀ KIỂM TRA — MÃ ĐỀ: ' + esc(curCode) + '</summary>' +
        '<div class="dt-tablewrap"><table class="dt-table"><thead>' + headHtml(false) + '</thead><tbody>' +
        bodyRows(d.t1.rows, d.rowSpans, false) +
        '<tr><th colspan="3" class="l">Tổng số câu</th>' + d.t1.totalQ.slice(3).map(function (v) { return '<th>' + esc(v) + '</th>'; }).join('') + '</tr>' +
        '<tr><th colspan="3" class="l">Tổng điểm</th>' + d.t1.totalP.slice(3).map(function (v) { return '<th>' + esc(v) + '</th>'; }).join('') + '</tr>' +
        '<tr><th colspan="3" class="l">Tỉ lệ %</th>' + d.t1.totalPct.slice(3).map(function (v) { return '<th>' + esc(v) + '</th>'; }).join('') + '</tr>' +
        '</tbody></table></div></details>';
      html += '<details class="dt-collapse" style="margin-top:14px;"><summary>2. BẢN ĐẶC TẢ ĐỀ KIỂM TRA</summary>' +
        '<div class="dt-tablewrap"><table class="dt-table"><thead>' + headHtml(true) + '</thead><tbody>' +
        bodyRows(d.t2.rows, d.t2.rows.map(function (r) { return r[1]; }), true) +
        '</tbody></table></div></details>';
      box.innerHTML = html;
    }
    $('dtMvXlsx').addEventListener('click', function () {
      if (!curCode || !window.JSZip) { dtMsg('dtShufMsg', 'Chưa có mã kì thi hoặc JSZip chưa sẵn sàng.', true); return; }
      var d = matrixTablesData();
      /* Trình bày bám ĐÚNG file mẫu user gửi từ dự án cũ (MaTran_DacTa_L10_GIUA_HKI_2627.xlsx):
         - Dòng 1: tiêu đề lớn Times New Roman đậm 14, merge toàn chiều rộng (cả 2 sheet đều A1:U1 như mẫu).
         - Khối tiêu đề 3 dòng (dòng 2–4): merge dọc TT/Chương/Nội dung[/YCCĐ], merge ngang nhóm
           "Mức độ đánh giá"/"Số câu hỏi…" + TNKQ/Tự luận, dòng 4 là "NB\n(MC)"…; nền khaki F0E68C.
         - Màu theo LOẠI cho cả tiêu đề dòng 4 lẫn ô đếm dữ liệu: MC E0F2FE · TF D1FAE5 · SA FCE7F3 · LA không tô.
         - Dữ liệu Times New Roman 11 (TT + chương đậm); ô đếm TF dạng "1\n(1a)" như mẫu; cột Tổng số câu đậm.
         - Merge dọc TT + chương theo từng chương, merge dọc nội dung theo từng chủ đề (sheet Đặc tả);
           TT ghi số thứ tự CHƯƠNG (như mẫu), không phải số dòng.
         - 3 dòng tổng (chỉ sheet Ma trận, như bảng trên màn hình): nhãn merge A:C, nền xám nhạt F8FAFC.
         - Không autoFilter (mẫu không có); freeze ngay dưới khối tiêu đề (dưới dòng 4).
         Dữ liệu lấy nguyên từ matrixTablesData (cùng nguồn với bảng hiển thị) — chỉ đổi trình bày + merge. */
      var S = { title: 26, khaki: 27, hMC: 28, hTF: 29, hSA: 30, cMC: 31, cTF: 32, cSA: 33, cPlain: 34, txt: 35, txtB: 36, tt: 37, totL: 38, totC: 39 };
      var LV_AB = { 'Nhận biết': 'NB', 'Thông hiểu': 'TH', 'Vận dụng': 'VD', 'Vận dụng cao': 'VDC' };
      var TYPE_HDR = { MC: S.hMC, TF: S.hTF, SA: S.hSA, LA: S.khaki };
      var TYPE_CNT = { MC: S.cMC, TF: S.cTF, SA: S.cSA, LA: S.cPlain };
      function colL(n) { var s = ''; n++; while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
      function noteCell(v, style) {   // "2 (1c, 1d)" -> "2\n(1c, 1d)" đúng dạng ô TF trong file mẫu
        var m = /^(\S+) \((.+)\)$/.exec(String(v == null ? '' : v));
        return { v: m ? m[1] + '\n(' + m[2] + ')' : (v == null ? '' : v), s: style };
      }
      function titleRow(text, totalCols) {
        var r = [{ v: text, s: S.title }];
        for (var i = 1; i < totalCols; i++) r.push({ v: '', s: S.title });
        return r;
      }
      function headerRows(hasYccd, hasTotals) {   // 3 dòng tiêu đề (Excel dòng 2,3,4) + merge của khối tiêu đề
        var base = hasYccd ? 4 : 3, nLv = d.lvHeads.length;
        var totalCols = base + nLv + (hasTotals ? 2 : 0);
        var r2 = [], r3 = [], r4 = [], i;
        for (i = 0; i < totalCols; i++) { r2.push({ v: '', s: S.khaki }); r3.push({ v: '', s: S.khaki }); r4.push({ v: '', s: S.khaki }); }
        r2[0] = { v: 'TT', s: S.khaki };
        r2[1] = { v: 'Chủ đề/Chương', s: S.khaki };
        r2[2] = { v: 'Nội dung/đơn vị kiến thức', s: S.khaki };
        if (hasYccd) r2[3] = { v: 'Yêu cầu cần đạt', s: S.khaki };
        r2[base] = { v: hasYccd ? 'Số câu hỏi ở các mức độ đánh giá' : 'Mức độ đánh giá', s: S.khaki };
        if (hasTotals) { r2[base + nLv] = { v: 'Tổng\nsố câu', s: S.khaki }; r2[base + nLv + 1] = { v: 'Tỉ lệ\n%', s: S.khaki }; }
        r3[base] = { v: 'TNKQ', s: S.khaki };
        r3[base + 12] = { v: 'Tự luận', s: S.khaki };
        d.lvHeads.forEach(function (h, hi) { r4[base + hi] = { v: (LV_AB[h.level] || h.level) + '\n(' + h.type + ')', s: TYPE_HDR[h.type] }; });
        var merges = [];
        for (i = 0; i < base; i++) merges.push(colL(i) + '2:' + colL(i) + '4');
        merges.push(colL(base) + '2:' + colL(base + nLv - 1) + '2');
        merges.push(colL(base) + '3:' + colL(base + 11) + '3');
        merges.push(colL(base + 12) + '3:' + colL(base + nLv - 1) + '3');
        if (hasTotals) { merges.push(colL(base + nLv) + '2:' + colL(base + nLv) + '4'); merges.push(colL(base + nLv + 1) + '2:' + colL(base + nLv + 1) + '4'); }
        return { rows: [r2, r3, r4], merges: merges, totalCols: totalCols };
      }
      function runsOf(rows, keyFn) {   // các đoạn dòng liên tiếp có cùng khóa (để merge dọc)
        var runs = [];
        rows.forEach(function (r, i) {
          var k = keyFn(r), last = runs[runs.length - 1];
          if (last && last.key === k && last.start + last.len === i) last.len++;
          else runs.push({ key: k, start: i, len: 1 });
        });
        return runs;
      }
      function estH(pairs) {   // ước lượng chiều cao dòng dữ liệu theo nội dung wrap: [{t, w}] w = độ rộng cột
        var lines = 1;
        pairs.forEach(function (x) {
          var s = String(x.t == null ? '' : x.t); if (!s) return;
          var n = 0;
          s.split('\n').forEach(function (seg) { n += Math.max(1, Math.ceil(seg.length / (x.w * 1.12))); });
          if (n > lines) lines = n;
        });
        return Math.min(360, Math.max(30, lines * 15));
      }
      /* ---- Sheet "Ma trận" ---- */
      var h1 = headerRows(false, true);
      var t1rows = [titleRow('1. MA TRẬN ĐỀ KIỂM TRA - MÃ ĐỀ: ' + curCode, h1.totalCols)].concat(h1.rows);
      var merges1 = ['A1:U1'].concat(h1.merges);
      var rowH1 = { 0: 36, 1: 34, 2: 34, 3: 34 };
      var runs1 = runsOf(d.t1.rows, function (r) { return String(r[1]); });
      var ttOf1 = {}, covered1 = {};
      runs1.forEach(function (run, ri) {
        ttOf1[run.start] = ri + 1;
        if (run.len > 1) {
          merges1.push('A' + (5 + run.start) + ':A' + (5 + run.start + run.len - 1), 'B' + (5 + run.start) + ':B' + (5 + run.start + run.len - 1));
          for (var k = 1; k < run.len; k++) covered1[run.start + k] = true;
        }
      });
      d.t1.rows.forEach(function (r, ri) {
        var row = [covered1[ri] ? { v: '', s: S.tt } : { v: ttOf1[ri], s: S.tt },
          covered1[ri] ? { v: '', s: S.txtB } : { v: r[1], s: S.txtB },
          { v: r[2], s: S.txt }];
        var hp = [{ t: r[1], w: 20 }, { t: r[2], w: 28 }];
        d.lvHeads.forEach(function (h, hi) { var c = noteCell(r[3 + hi], TYPE_CNT[h.type]); row.push(c); hp.push({ t: c.v, w: 8 }); });
        row.push({ v: r[19], s: S.tt }, { v: r[20], s: S.cPlain });
        t1rows.push(row);
        rowH1[4 + ri] = estH(hp);
      });
      [d.t1.totalQ, d.t1.totalP, d.t1.totalPct].forEach(function (tr, ti) {
        var row = [{ v: tr[0], s: S.totL }];
        for (var i = 1; i < h1.totalCols; i++) row.push({ v: tr[i] == null ? '' : tr[i], s: S.totC });
        t1rows.push(row);
        merges1.push('A' + (5 + d.t1.rows.length + ti) + ':C' + (5 + d.t1.rows.length + ti));
        rowH1[4 + d.t1.rows.length + ti] = 24;
      });
      /* ---- Sheet "Đặc tả" ---- */
      var h2 = headerRows(true, false);
      var t2rows = [titleRow('2. BẢN ĐẶC TẢ ĐỀ KIỂM TRA ĐỊNH KÌ', h2.totalCols)].concat(h2.rows);
      var merges2 = ['A1:U1'].concat(h2.merges);
      var rowH2 = { 0: 36, 1: 34, 2: 34, 3: 34 };
      var runs2 = runsOf(d.t2.rows, function (r) { return String(r[1]); });
      var ttOf2 = {}, coveredAB2 = {};
      runs2.forEach(function (run, ri) {
        ttOf2[run.start] = ri + 1;
        if (run.len > 1) {
          merges2.push('A' + (5 + run.start) + ':A' + (5 + run.start + run.len - 1), 'B' + (5 + run.start) + ':B' + (5 + run.start + run.len - 1));
          for (var k = 1; k < run.len; k++) coveredAB2[run.start + k] = true;
        }
      });
      var coveredC2 = {};
      runsOf(d.t2.rows, function (r) { return String(r[1]) + ' ' + String(r[2]); }).forEach(function (run) {
        if (run.len > 1) {
          merges2.push('C' + (5 + run.start) + ':C' + (5 + run.start + run.len - 1));
          for (var k = 1; k < run.len; k++) coveredC2[run.start + k] = true;
        }
      });
      function yccdText(v) {   // "Nhận biết: - A - B" -> "Nhận biết:- A\n- B" đúng dạng file mẫu
        var s = String(v == null ? '' : v);
        var m = /^([^:]+): (.*)$/.exec(s);
        if (!m || m[2].indexOf('- ') !== 0) return s;
        return m[1] + ':- ' + m[2].replace(/^- /, '').split(' - ').join('\n- ');
      }
      d.t2.rows.forEach(function (r, ri) {
        var yc = yccdText(r[3]);
        var row = [coveredAB2[ri] ? { v: '', s: S.tt } : { v: ttOf2[ri], s: S.tt },
          coveredAB2[ri] ? { v: '', s: S.txtB } : { v: r[1], s: S.txtB },
          coveredC2[ri] ? { v: '', s: S.txt } : { v: r[2], s: S.txt },
          { v: yc, s: S.txt }];
        var hp = [{ t: r[1], w: 16 }, { t: r[2], w: 20 }, { t: yc, w: 50 }];
        d.lvHeads.forEach(function (h, hi) { var c = noteCell(r[4 + hi], TYPE_CNT[h.type]); row.push(c); hp.push({ t: c.v, w: 8 }); });
        t2rows.push(row);
        rowH2[4 + ri] = estH(hp);
      });
      buildXlsx([
        { name: 'Ma trận', rows: t1rows, widths: [5, 20, 28].concat(d.lvHeads.map(function () { return 8; })).concat([8, 8]), merges: merges1, freeze: { y: 4 }, rowH: rowH1 },
        { name: 'Đặc tả', rows: t2rows, widths: [5, 16, 20, 50].concat(d.lvHeads.map(function () { return 8; })), merges: merges2, freeze: { y: 4 }, rowH: rowH2 }
      ]).then(function (blob) { saveBlob(blob, 'MaTran_DacTa_' + noAccent(curCode) + '.xlsx'); })
        .catch(function (e) { dtMsg('dtShufMsg', 'Lỗi xuất Excel ma trận: ' + e.message, true); });
    });
    function simpleTableDocx(title, header, rows, landscape) {
      function cellXml(v, isHead, span) {
        var shd = isHead ? '<w:shd w:val="clear" w:fill="D9E2F3"/>' : '';
        var vm = span === 'restart' ? '<w:vMerge w:val="restart"/>' : (span === 'cont' ? '<w:vMerge/>' : '');
        var txt = span === 'cont' ? '' : esc(v);
        return '<w:tc><w:tcPr>' + shd + vm + '<w:tcMar><w:top w:w="30" w:type="dxa"/><w:bottom w:w="30" w:type="dxa"/><w:left w:w="60" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tcMar></w:tcPr>' +
          '<w:p><w:r>' + (isHead ? '<w:rPr><w:b/></w:rPr>' : '') + '<w:t xml:space="preserve">' + txt + '</w:t></w:r></w:p></w:tc>';
      }
      function tableXml(header, rows, mergeCol) {
        var x = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' +
          ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (b) { return '<w:' + b + ' w:val="single" w:sz="4" w:color="808080"/>'; }).join('') +
          '</w:tblBorders></w:tblPr>';
        x += '<w:tr>' + header.map(function (h) { return cellXml(h, true); }).join('') + '</w:tr>';
        var lastV = null;
        rows.forEach(function (r) {
          x += '<w:tr>';
          r.forEach(function (v, ci) {
            if (ci === mergeCol) {
              if (v === lastV) { x += cellXml(v, false, 'cont'); return; }
              lastV = v; x += cellXml(v, false, 'restart'); return;
            }
            x += cellXml(v, false);
          });
          x += '</w:tr>';
        });
        return x + '</w:tbl>';
      }
      var body = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>' + esc(title) + '</w:t></w:r></w:p>';
      body += tableXml(header, rows, 1);
      var sect = landscape
        ? '<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>'
        : '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>';
      var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + sect + '</w:body></w:document>';
      var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
      var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
      var zip = new window.JSZip();
      zip.file('[Content_Types].xml', ct);
      zip.folder('_rels').file('.rels', rels);
      zip.folder('word').file('document.xml', doc);
      return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    }
    $('dtMvWord').addEventListener('click', function () {
      if (!curCode || !window.JSZip) { dtMsg('dtShufMsg', 'Chưa có mã kì thi hoặc JSZip chưa sẵn sàng.', true); return; }
      var d = matrixTablesData();
      var head = ['TT', 'Chủ đề/Chương', 'Nội dung/đơn vị kiến thức'];
      d.lvHeads.forEach(function (x) { head.push(x.type + '-' + (x.level === 'Nhận biết' ? 'NB' : x.level === 'Thông hiểu' ? 'TH' : x.level === 'Vận dụng' ? 'VD' : 'VDC')); });
      var rows1 = d.t1.rows.map(function (r) { return r.map(String); });
      rows1.push(d.t1.totalQ.map(String)); rows1.push(d.t1.totalP.map(String)); rows1.push(d.t1.totalPct.map(String));
      var head2 = ['TT', 'Chủ đề/Chương', 'Nội dung/đơn vị kiến thức', 'Yêu cầu cần đạt'].concat(head.slice(3));
      var rows2 = d.t2.rows.map(function (r) { return r.map(String); });
      // Gộp 2 bảng vào một tài liệu: tạo tài liệu bảng 1 rồi nối bảng 2 bằng cách sinh lại với builder đơn giản thứ hai
      simpleTableDocx('1. MA TRẬN ĐỀ KIỂM TRA — MÃ ĐỀ: ' + curCode, head.concat(['Tổng số câu', 'Tỉ lệ %']), rows1, true)
        .then(function (blob1) {
          // Tài liệu thứ hai cho đặc tả — tải riêng để giữ đơn giản và chắc chắn mở được
          return simpleTableDocx('2. BẢN ĐẶC TẢ ĐỀ KIỂM TRA — MÃ ĐỀ: ' + curCode, head2, rows2, true)
            .then(function (blob2) {
              saveBlob(blob1, 'MaTran_' + noAccent(curCode) + '.docx');
              setTimeout(function () { saveBlob(blob2, 'DacTa_' + noAccent(curCode) + '.docx'); }, 600);
            });
        })
        .catch(function (e) { dtMsg('dtShufMsg', 'Lỗi xuất Word ma trận: ' + e.message, true); });
    });

    /* ---------------- Khởi tạo: nạp dữ liệu ĐỀ THI từ máy chủ ---------------- */
    $('dtModalBack').addEventListener('click', function (e) { if (e.target === this) dtModalClose(); });

    /* Bấm ra vùng trống trong workspace Ma trận → bỏ chọn tất cả (như dự án cũ).
       KHÔNG bỏ chọn khi bấm vào ô câu hỏi, nút, link, ô nhập, nhãn, hộp thoại,
       popup Gán nội dung, banner lỗi API — hoặc khi đang bôi đen chữ / đang mở hộp thoại. */
    function dtAnySelected() { return Object.keys(selected).some(function (k) { return selected[k]; }); }
    function dtClearSelection() { if (!dtAnySelected()) return; selected = {}; lastClickedId = null; renderGrid(); }
    document.addEventListener('click', function (e) {
      if (!dtAnySelected() || e.button !== 0) return;
      var view = $('dtViewMatrix'), tab = $('tab5');
      if (!view || view.hidden || !tab || tab.hidden) return;
      var t = e.target;
      if (!(t instanceof Element) || !t.isConnected) return;
      if (t.closest('.dt-cell, button, a, input, select, textarea, label, option, [role="button"], [contenteditable="true"], .dt-modal-back, .dt-fs-back, .dt-sub-back, #dtApiErr, #dtToast')) return;
      if (!$('dtModalBack').hidden || dtFsCloseFn || dtSubCloseFn) return;
      try { if (String(window.getSelection() || '').trim()) return; } catch (err) {}
      dtClearSelection();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (dtSubCloseFn) { dtSubCloseFn(); return; }              // đóng hộp thoại phụ trước
      if (dtFsCloseFn) { dtFsCloseFn(); return; }                // rồi đến popup Gán nội dung
      if (!$('dtModalBack').hidden) return;                      // hộp thoại thường đang mở: giữ nguyên chọn
      var view = $('dtViewMatrix'), tab = $('tab5');
      if (!view || view.hidden || !tab || tab.hidden) return;
      var a = document.activeElement;
      if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
      dtClearSelection();
    });
    function dtBootFallback() {
      loadPrefs(); applyWordMode();
      if (exams.length) loadExam(exams[0].examCode);
      else { renderExamSelect(); renderExamInfo(); renderGrid(); renderCurrTree(); }
    }
    function dtBoot() {
      Promise.all([
        dtApi('GET', 'https://hotrohoctap.com/1ai/chdmathtype/api/exams.php'),
        dtApi('GET', 'https://hotrohoctap.com/1ai/chdmathtype/api/curriculum.php'),
        dtApi('GET', 'https://hotrohoctap.com/1ai/chdmathtype/api/texprefs.php')
      ]).then(function (r) {
        if (r[0] && Array.isArray(r[0].exams)) exams = r[0].exams;
        if (r[1] && r[1].perms) applyCurrPerms(r[1].perms);
        if (r[1] && Array.isArray(r[1].docs) && r[1].docs.length) curriculum = r[1].docs;
        if (r[2] && r[2].prefs) dtPrefsData = r[2].prefs;
        dtBootFallback();
        renderCurrTree(); fillCurrSelects();
      }).catch(function (e) { dtApiFail(e); dtBootFallback(); });
    }
    dtBoot();
  })();

    