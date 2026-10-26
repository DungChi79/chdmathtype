/* =====================================================================
   MÀN HÌNH KÍCH HOẠT THEO MÃ MÁY — chỉ dùng cho bản native (Tauri).
   Thay cho màn hình đăng nhập Firebase của bản web.
   - Mã máy: lệnh Tauri get_machine_code (băm SHA-256, chỉ mã băm rời máy).
   - Server: __CHD_API_BASE__machine.php (không cần token đăng nhập).
   - Kích hoạt đã lưu trong localStorage: mở lại dùng ngay cả khi không
     mạng; có mạng thì kiểm tra thầm lặng; chỉ khóa khi server trả lời rõ
     đã thu hồi / hết hạn / không còn mã (lỗi mạng KHÔNG khóa).
   - ĐỀ THI đồng bộ cloud cần token Firebase (chỉ có trên web) nên ở bản
     native v1 tab này chạy theo chế độ phiên + JSON thủ công (banner của
     module ĐỀ THI sẽ báo rõ); ChdAuth dưới đây chỉ để module không lỗi
     khi hỏi token.
   File này được chèn vào dist/index.html bởi tools/make_dist_native.py,
   với __CHD_API_BASE__ và __CHD_APP_VERSION__ đã thay bằng giá trị thật.
   ===================================================================== */
(function () {
  'use strict';
  var API_BASE = '__CHD_API_BASE__';
  var APP_VERSION = '__CHD_APP_VERSION__';
  var CACHE_KEY = 'chd_machine_activation_v1';
  var $ = function (id) { return document.getElementById(id); };
  var loginScreen = $('loginScreen'), appWrap = $('appWrap');
  var appLoaded = false, unlocking = false, currentMachine = null;

  /* Cầu nối token cho module ĐỀ THI (bản native v1: không có token nên
     mọi gọi API cloud đi vào nhánh báo lỗi + JSON thủ công của module). */
  window.ChdAuth = {
    user: null,
    getIdToken: function () { return Promise.reject(new Error('Chưa đăng nhập.')); }
  };

  var APP_SCRIPTS = ['assets/js/core.js', 'assets/js/app.js', 'assets/js/word-image.js', 'assets/js/dethi.js'];
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var sc = document.createElement('script');
      sc.src = src; sc.onload = res;
      sc.onerror = function () { rej(new Error('Không tải được ' + src)); };
      document.body.appendChild(sc);
    });
  }
  function loadAppScripts() {
    var p = Promise.resolve();
    APP_SCRIPTS.forEach(function (src) { p = p.then(function () { return loadScript(src); }); });
    return p;
  }

  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  function showErr(msg) {
    var e = $('loginErr'); if (!e) return;
    e.textContent = msg || ''; e.hidden = !msg;
    if (msg) { var n = $('loginNote'); if (n) n.hidden = true; }
  }
  function showNote(msg, ok) {
    var n = $('loginNote'); if (!n) return;
    n.textContent = msg || ''; n.className = ok ? 'login-ok' : 'login-note'; n.hidden = !msg;
    if (msg) { var e = $('loginErr'); if (e) e.hidden = true; }
  }

  function buildActivationScreen() {
    loginScreen.innerHTML =
      '<div class="login-card">' +
      '<img class="login-logo" src="assets/logo.png" alt="" width="56" height="56" />' +
      '<h1>Kích hoạt ChdMathType</h1>' +
      '<p class="login-sub">Ứng dụng chỉ chạy trên máy đã được cấp quyền. Mã máy dưới đây dùng để admin cấp quyền cho máy này — gửi mã này kèm email cho admin một lần, lần sau mở lại dùng ngay.</p>' +
      '<div id="actCode" style="font-family:monospace;font-size:17px;font-weight:700;letter-spacing:1px;text-align:center;border:1px solid var(--line);border-radius:10px;padding:12px 8px;margin:6px 0 10px;">Đang lấy mã máy…</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;">' +
      '<button class="btn" id="actCopy" type="button">Sao chép mã</button>' +
      '<button class="btn" id="actCopyFull" type="button">Sao chép mã đầy đủ</button>' +
      '<button class="btn" id="actRetry" type="button" hidden>Thử lại</button>' +
      '</div>' +
      '<label for="actEmail">Email</label>' +
      '<input id="actEmail" type="email" autocomplete="email" placeholder="ban@example.com" />' +
      '<label for="actLabel">Tên máy (không bắt buộc)</label>' +
      '<input id="actLabel" type="text" placeholder="VD: MacBook của Thầy A" />' +
      '<button class="btn primary" id="actSubmit" type="button" disabled>Gửi yêu cầu kích hoạt</button>' +
      '<button class="btn" id="actCheck" type="button" disabled>Kiểm tra kích hoạt</button>' +
      '<div class="login-err" id="loginErr" hidden></div>' +
      '<div class="login-note" id="loginNote" hidden></div>' +
      '</div>';
  }

  function setCodeReady(code, display) {
    currentMachine = { code: code, display: display };
    var c = $('actCode'); if (c) c.textContent = display;
    var s = $('actSubmit'), k = $('actCheck'), r = $('actRetry');
    if (s) s.disabled = false;
    if (k) k.disabled = false;
    if (r) r.hidden = true;
  }
  function setCodeFailed(msg) {
    currentMachine = null;
    var c = $('actCode'); if (c) c.textContent = 'Không lấy được mã máy';
    var s = $('actSubmit'), k = $('actCheck'), r = $('actRetry');
    if (s) s.disabled = true;
    if (k) k.disabled = true;
    if (r) r.hidden = false;
    showNote(msg || 'Hãy mở bằng app ChdMathType để xem mã máy, rồi bấm Thử lại.');
  }
  function refreshCode() {
    var inv = (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke)
      ? window.__TAURI__.core.invoke : null;
    if (!inv) { setCodeFailed('App chưa sẵn sàng lấy mã máy (thiếu cầu nối Tauri) — hãy mở bằng app ChdMathType, rồi bấm Thử lại.'); return; }
    inv('get_machine_code').then(function (m) {
      if (m && m.code && m.display) setCodeReady(m.code, m.display);
      else setCodeFailed('Mã máy trả về không hợp lệ — bấm Thử lại.');
    }).catch(function (e) { setCodeFailed('Không lấy được mã máy: ' + (e && e.message ? e.message : e)); });
  }

  function copyText(t, okMsg) {
    function done() { showNote(okMsg || 'Đã sao chép.', true); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(done).catch(function () { fallbackCopy(t, done); });
    } else { fallbackCopy(t, done); }
  }
  function fallbackCopy(t, done) {
    try {
      var ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove(); done();
    } catch (e) { showErr('Không sao chép được — hãy chọn mã và copy thủ công.'); }
  }

  function callMachine(action, body) {
    return fetch(API_BASE + 'machine.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) { return { status: res.status, data: data }; });
    });
  }
  function validEmail(e) { return !!e && e.indexOf('@') > 0 && e.indexOf('.') > e.indexOf('@'); }

  function showApp() {
    loginScreen.hidden = true;
    appWrap.hidden = false;
    var aa = $('authArea'); if (aa) aa.hidden = false;
  }
  function showActivation(prefillEmail) {
    if (prefillEmail) { var em = $('actEmail'); if (em) em.value = prefillEmail; }
    appWrap.hidden = true;
    var aa = $('authArea'); if (aa) aa.hidden = true;
    loginScreen.hidden = false;
  }
  function unlock(email, code, display) {
    if (unlocking) return Promise.resolve();
    if (appLoaded) {
      showApp();
      return Promise.resolve();
    }
    unlocking = true;
    showNote('Đã kích hoạt — đang tải ứng dụng…', true);
    lsSet(CACHE_KEY, { email: email, code: code, display: display, activated_at: Date.now() });
    var an = $('authName'), ae = $('authEmail'), av = $('authAvatar');
    if (an) an.textContent = 'Đã kích hoạt';
    if (ae) ae.textContent = email || '';
    if (av) av.hidden = true;
    return loadAppScripts().then(function () {
      appLoaded = true; unlocking = false;
      showNote(''); showErr('');
      showApp();
    }).catch(function (e) {
      unlocking = false;
      showErr('Không tải được ứng dụng: ' + (e && e.message ? e.message : e));
    });
  }
  function lockOut(email, reason) {
    lsDel(CACHE_KEY);
    showActivation(email);
    if (reason) showErr(reason);
    refreshCode();
  }

  /* Trả về true nếu đã kích hoạt (và mở app), false nếu vẫn khóa.
     silent=true: chỉ dùng khi kiểm tra lại kích hoạt đã lưu lúc mở app —
     lỗi mạng thì mở app từ bản lưu (không khóa), mọi trả lời rõ của server
     đều xử lý như bình thường. */
  function doCheck(email, code, silent) {
    return callMachine('check', { action: 'check', email: email, machine_code: code, app_version: APP_VERSION })
      .then(function (r) {
        var d = r.data || {};
        if (r.status === 200 && d.ok && d.status === 'active') {
          return unlock(email, code, (lsGet(CACHE_KEY, {}) || {}).display || '').then(function () { return true; });
        }
        if (r.status === 200 && d.ok && d.status === 'pending') {
          showNote('Yêu cầu kích hoạt đã gửi — đang chờ admin duyệt. Sau khi admin duyệt, bấm “Kiểm tra kích hoạt”.');
          return false;
        }
        if (r.status === 200 && d.ok && d.status === 'expired') {
          showErr('Bản quyền của email này đã hết hạn' + (d.expiry ? ' (' + d.expiry + ')' : '') + ' — liên hệ admin để gia hạn.');
          return false;
        }
        if (r.status === 200 && d.ok && (d.status === 'locked' || d.status === 'revoked')) {
          showErr('Máy này đã bị thu hồi quyền sử dụng — liên hệ admin.');
          return false;
        }
        if (r.status === 200 && d.ok && d.status === 'not_found') {
          showErr('Máy chưa được kích hoạt — hãy bấm “Gửi yêu cầu kích hoạt”, hoặc nhắn mã máy + email cho admin.');
          return false;
        }
        showErr((d && d.error) ? d.error : ('Máy chủ trả lỗi HTTP ' + r.status + ' — thử lại sau.'));
        return false;
      })
      .catch(function (e) {
        if (silent) {
          /* Mất mạng khi kiểm tra lại: mở app từ bản lưu, không khóa. */
          return unlock(email, code, (lsGet(CACHE_KEY, {}) || {}).display || '').then(function () { return true; });
        }
        showErr('Không kết nối được máy chủ kiểm tra kích hoạt: ' + (e && e.message ? e.message : e));
        return false;
      });
  }
  function doSubmit(email, code, label) {
    return callMachine('submit', { action: 'submit', email: email, machine_code: code, label: label || '' })
      .then(function (r) {
        var d = r.data || {};
        if (r.status === 200 && d.ok && d.status === 'active') {
          return unlock(email, code, (lsGet(CACHE_KEY, {}) || {}).display || '').then(function () { return true; });
        }
        if (r.status === 200 && d.ok && d.status === 'pending') {
          showNote('Đã gửi yêu cầu kích hoạt — chờ admin duyệt, sau đó bấm “Kiểm tra kích hoạt”.', true);
          return false;
        }
        showErr((d && d.error) ? d.error : ('Máy chủ trả lỗi HTTP ' + r.status + ' — thử lại sau.'));
        return false;
      })
      .catch(function (e) {
        showErr('Không kết nối được máy chủ: ' + (e && e.message ? e.message : e));
        return false;
      });
  }

  function bindButtons() {
    $('actCopy').addEventListener('click', function () {
      if (!currentMachine) { showErr('Chưa lấy được mã máy — bấm Thử lại.'); return; }
      copyText(currentMachine.display, 'Đã sao chép mã máy.');
    });
    $('actCopyFull').addEventListener('click', function () {
      if (!currentMachine) { showErr('Chưa lấy được mã máy — bấm Thử lại.'); return; }
      copyText(currentMachine.code, 'Đã sao chép mã máy đầy đủ.');
    });
    $('actRetry').addEventListener('click', function () { showErr(''); refreshCode(); });
    $('actSubmit').addEventListener('click', function () {
      var email = ($('actEmail').value || '').trim();
      if (!validEmail(email)) { showErr('Hãy nhập email hợp lệ.'); return; }
      if (!currentMachine) { showErr('Chưa lấy được mã máy — bấm Thử lại.'); return; }
      showErr('');
      doSubmit(email, currentMachine.code, ($('actLabel').value || '').trim());
    });
    $('actCheck').addEventListener('click', function () {
      var email = ($('actEmail').value || '').trim();
      if (!validEmail(email)) { showErr('Hãy nhập email hợp lệ.'); return; }
      if (!currentMachine) { showErr('Chưa lấy được mã máy — bấm Thử lại.'); return; }
      showErr('');
      doCheck(email, currentMachine.code, false);
    });
    var lo = $('btnLogout');
    if (lo) lo.addEventListener('click', function () {
      var cached = lsGet(CACHE_KEY, null);
      lsDel(CACHE_KEY);
      showActivation(cached && cached.email ? cached.email : '');
      showNote('Đã đăng xuất khỏi máy này. Muốn dùng lại, bấm “Kiểm tra kích hoạt”.');
    });
  }

  try {
    buildActivationScreen();
    bindButtons();
    loginScreen.hidden = false;
    var cached = lsGet(CACHE_KEY, null);
    if (cached && cached.code && cached.email) {
      var em = $('actEmail'); if (em) em.value = cached.email;
      showNote('Đang kiểm tra kích hoạt đã lưu…');
      doCheck(cached.email, cached.code, true).then(function (ok) {
        if (!ok) {
          /* Server trả lời rõ (không phải lỗi mạng): khóa lại, giữ email. */
          var wasCached = lsGet(CACHE_KEY, null);
          if (!wasCached) lockOut(cached.email, '');
          else showActivation(cached.email);
        }
      });
    } else {
      refreshCode();
    }
  } catch (e) {
    /* Lỗi khởi tạo: đừng để trang trắng — hiện khối báo lỗi thay màn hình. */
    try {
      loginScreen.innerHTML = '<div class="login-card"><h1>ChdMathType</h1>' +
        '<p class="login-sub">Không khởi tạo được màn hình kích hoạt: ' + (e && e.message ? e.message : e) + '</p></div>';
      loginScreen.hidden = false;
    } catch (e2) {}
  }
})();
