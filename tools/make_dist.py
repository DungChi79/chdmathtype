#!/usr/bin/env python3
"""Dựng dist/index.html cho app native từ bản xuất HTML độc lập của artifact
ChdMathType: thay mọi thư viện CDN bằng bản đã đóng gói trong dist/vendor/,
gắn cầu nối native (native-bridge.js) trước </body> cuối cùng.
Mỗi phép thay đều khẳng định xuất hiện đúng 1 lần — lệch là dừng ngay."""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = pathlib.Path.home() / "workspace/your_files/chdmathtype/chdmathtype.html"
DST = ROOT / "dist" / "index.html"

html = SRC.read_text(encoding="utf-8")

SWAPS = [
    ("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
     "./vendor/jszip/jszip.min.js"),
    ("https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js",
     "./vendor/katex/katex.min.js"),
    ("https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.css",
     "./vendor/katex/katex.min.css"),
    ("https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-svg.js",
     "./vendor/mathjax/es5/tex-svg.js"),
    ("https://cdn.jsdelivr.net/npm/mathlive@0.104.2/+esm",
     "./vendor/mathlive/mathlive.mjs"),
    ("https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap",
     "./vendor/fonts/fonts.css"),
    ('<link rel="preconnect" href="https://fonts.googleapis.com" />', ""),
    ('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />', ""),
]
for old, new in SWAPS:
    n = html.count(old)
    assert n == 1, f"expected exactly 1 occurrence, got {n}: {old[:70]}"
    html = html.replace(old, new)

BRIDGE = '<script type="module" src="./native-bridge.js"></script>'
assert BRIDGE not in html
idx = html.rfind("</body>")
assert idx > 0
html = html[:idx] + BRIDGE + "\n" + html[idx:]

for bad in ("cdnjs.cloudflare.com", "cdn.jsdelivr.net", "fonts.googleapis.com",
            "fonts.gstatic.com"):
    assert bad not in html, f"external ref remains: {bad}"
for good in ("./vendor/mathlive/mathlive.mjs", "./vendor/katex/katex.min.js",
             "./vendor/mathjax/es5/tex-svg.js", "./vendor/jszip/jszip.min.js",
             "./vendor/fonts/fonts.css", "./native-bridge.js", "__chdNativeCopy"):
    assert good in html, f"missing expected local ref: {good}"

DST.write_text(html, encoding="utf-8")
print(f"dist/index.html written: {len(html.encode('utf-8'))} bytes")
