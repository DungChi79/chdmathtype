#!/usr/bin/env python3
"""Dựng dist/ cho app native ChdMathType 1.0.9 từ frontend web đa file đã tải
về (index.html + assets/js/*.js + assets/logo.png), theo hướng kích hoạt
theo mã máy (thay cho đăng nhập Firebase của bản web):
  - mọi CDN -> bản đóng gói trong dist/vendor/ (đường dẫn tương đối theo
    từng file: index.html dùng ./vendor/, assets/js/*.js dùng ../../vendor/)
  - thẻ Firebase SDK + khối auth shell (đăng nhập) -> màn hình kích hoạt
    mã máy (tools/native-activation-shell.js)
  - gọi api/ tương đối trong dethi.js -> tuyệt đối về hosting triển khai
  - gắn cầu nối native-bridge.js trước </body> cuối cùng
  - gỡ thẻ script do hosting chèn (/_osh/collect.js) nếu có
Mọi phép thay đều khẳng định số lần xuất hiện — lệch là dừng ngay, KHÔNG
ghi file nào. Chạy: python3 tools/make_dist_native.py [--src /tmp/chd-web]
[--api-base https://hotrohoctap.com/1ai/chdmathtype/api/] [--version 1.0.9]
"""
import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHELL = ROOT / "tools" / "native-activation-shell.js"
BRIDGE_TAG = '<script type="module" src="./native-bridge.js"></script>'


def replace_once(text, old, new, label):
    n = text.count(old)
    assert n == 1, f"expected exactly 1 occurrence, got {n}: {label}: {old[:80]!r}"
    return text.replace(old, new)


def remove_once(text, old, label):
    return replace_once(text, old, "", label)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/tmp/chd-web")
    ap.add_argument("--api-base", default="https://hotrohoctap.com/1ai/chdmathtype/api/")
    ap.add_argument("--version", default="1.0.9")
    args = ap.parse_args()
    src = pathlib.Path(args.src)
    api_base = args.api_base
    if not api_base.endswith("/"):
        api_base += "/"
    dist = ROOT / "dist"

    shell = SHELL.read_text(encoding="utf-8")
    assert "__CHD_API_BASE__" in shell and "__CHD_APP_VERSION__" in shell
    shell = shell.replace("__CHD_API_BASE__", api_base).replace("__CHD_APP_VERSION__", args.version)
    assert "__CHD_" not in shell, "unsubstituted placeholder left in activation shell"

    # ---------- index.html ----------
    html = (src / "index.html").read_text(encoding="utf-8")
    # Thẻ script do hosting chèn khi phục vụ trang (không thuộc artifact).
    html = re.sub(r'<script src="/_osh/collect\.js"[^>]*></script>', "", html, count=1)
    html = replace_once(html,
        "https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap",
        "./vendor/fonts/fonts.css", "fonts css2")
    html = remove_once(html, '<link rel="preconnect" href="https://fonts.googleapis.com" />', "preconnect googleapis")
    html = remove_once(html, '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />', "preconnect gstatic")
    html = replace_once(html,
        "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.css",
        "./vendor/katex/katex.min.css", "katex css")
    html = replace_once(html,
        "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
        "./vendor/jszip/jszip.min.js", "jszip")
    html = replace_once(html,
        "https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js",
        "./vendor/katex/katex.min.js", "katex js")
    html = replace_once(html,
        "https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js",
        "./vendor/mathjax/es5/tex-svg.js", "mathjax")
    # Gỡ SDK Firebase (bản native không đăng nhập).
    html = remove_once(html,
        '<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js"></script>',
        "firebase app-compat")
    html = remove_once(html,
        '<script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js"></script>',
        "firebase auth-compat")
    # Gỡ chú thích giới thiệu khối auth shell (đã lỗi thời với bản native).
    cstart = html.find("<!-- ================= ĐĂNG NHẬP FIREBASE")
    assert cstart >= 0, "auth shell comment not found"
    cend = html.find("-->", cstart)
    assert cend > cstart
    html = html[:cstart] + html[cend + 3:]
    # Thay khối auth shell IIFE bằng màn hình kích hoạt mã máy.
    fpos = html.find("var firebaseConfig")
    assert fpos >= 0, "firebaseConfig anchor not found"
    sstart = html.rfind("<script>", 0, fpos)
    assert sstart >= 0
    send = html.find("</script>", fpos)
    assert send > sstart
    span = html[sstart:send]
    assert "ChdAuth" in span and "loadAppScripts" in span and "btnLogout" in span, \
        "auth shell span does not look like the auth shell"
    html = html[:sstart] + "<script>\n" + shell + "\n    </script>" + html[send + len("</script>"):]
    # Ẩn sẵn màn hình kích hoạt để không nháy màn hình đăng nhập cũ;
    # shell sẽ tự hiện lại sau khi dựng xong giao diện kích hoạt.
    html = replace_once(html, '<div class="login-screen" id="loginScreen">',
                        '<div class="login-screen" id="loginScreen" hidden>', "loginScreen hidden")
    # Gắn cầu nối native trước </body> cuối cùng (như make_dist.py cũ).
    assert BRIDGE_TAG not in html
    idx = html.rfind("</body>")
    assert idx > 0
    html = html[:idx] + BRIDGE_TAG + "\n" + html[idx:]
    for bad in ("cdnjs.cloudflare.com", "cdn.jsdelivr.net", "fonts.googleapis.com",
                "fonts.gstatic.com", "gstatic", "firebaseConfig",
                "firebase-app-compat", "firebase-auth-compat", "/_osh/"):
        assert bad not in html, f"external ref remains in index.html: {bad}"
    for good in ("./vendor/jszip/jszip.min.js", "./vendor/katex/katex.min.js",
                 "./vendor/katex/katex.min.css", "./vendor/mathjax/es5/tex-svg.js",
                 "./vendor/fonts/fonts.css", "./native-bridge.js",
                 "chd_machine_activation_v1", "get_machine_code",
                 api_base + "machine.php"):
        assert good in html, f"missing expected ref in index.html: {good}"

    # ---------- assets/js/app.js: MathLive ESM -> vendor (tương đối từ assets/js/) ----------
    app = (src / "assets/js/app.js").read_text(encoding="utf-8")
    app = replace_once(app, "https://cdn.jsdelivr.net/npm/mathlive@0.104.2/+esm",
                       "../../vendor/mathlive/mathlive.mjs", "mathlive import")
    for bad in ("cdnjs.cloudflare.com", "cdn.jsdelivr.net", "gstatic"):
        assert bad not in app, f"external ref remains in app.js: {bad}"

    # ---------- assets/js/dethi.js: pdf.js base + api/ tuyệt đối ----------
    dethi = (src / "assets/js/dethi.js").read_text(encoding="utf-8")
    dethi = replace_once(dethi,
        "'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + V + '/'",
        "'../../vendor/pdfjs/'", "pdf.js base")
    dethi, n_api = re.subn(r"([\"'`])api/", r"\1" + api_base, dethi)
    assert n_api >= 5, f"too few api/ rewrites in dethi.js: {n_api}"
    assert not re.search(r"[\"'`]api/", dethi), "relative api/ remains in dethi.js"
    assert api_base + "v1/chat/completions" not in dethi, \
        "AI endpoint wrongly prefixed with hosting api base"
    for bad in ("cdnjs.cloudflare.com", "cdn.jsdelivr.net", "gstatic"):
        assert bad not in dethi, f"external ref remains in dethi.js: {bad}"

    # ---------- core.js / word-image.js: không đổi, chỉ kiểm tra sạch ----------
    core = (src / "assets/js/core.js").read_text(encoding="utf-8")
    word_image = (src / "assets/js/word-image.js").read_text(encoding="utf-8")
    for name, txt in (("core.js", core), ("word-image.js", word_image)):
        for bad in ("cdnjs.cloudflare.com", "cdn.jsdelivr.net", "gstatic", "/_osh/"):
            assert bad not in txt, f"external ref in {name}: {bad}"
        assert not re.search(r"[\"'`]api/", txt), f"relative api/ in {name}"

    # ---------- ghi (chỉ khi mọi khẳng định đã qua) ----------
    out_js = dist / "assets" / "js"
    out_js.mkdir(parents=True, exist_ok=True)
    (dist / "index.html").write_text(html, encoding="utf-8")
    (out_js / "core.js").write_text(core, encoding="utf-8")
    (out_js / "app.js").write_text(app, encoding="utf-8")
    (out_js / "word-image.js").write_text(word_image, encoding="utf-8")
    (out_js / "dethi.js").write_text(dethi, encoding="utf-8")
    logo = (src / "assets/logo.png").read_bytes()
    (dist / "assets" / "logo.png").write_bytes(logo)
    print(f"dist written: index.html {len(html.encode('utf-8'))} bytes, "
          f"app.js {len(app.encode('utf-8'))}, dethi.js {len(dethi.encode('utf-8'))} "
          f"({n_api} api/ rewrites), logo.png {len(logo)} bytes")


if __name__ == "__main__":
    main()
