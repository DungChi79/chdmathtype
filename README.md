# ChdMathType — bản app cho macOS (Tauri)

Bọc ứng dụng web ChdMathType (đã hoàn thiện và kiểm chứng) thành app macOS native
bằng Tauri: dùng WebKit có sẵn của macOS nên app rất nhẹ, giao diện và tính năng
giữ nguyên 100% so với bản web. Toàn bộ thư viện (MathLive, KaTeX, MathJax, JSZip,
font chữ) đã được đóng gói trong thư mục `dist/vendor/` nên app **chạy hoàn toàn
offline**.

## Tính năng riêng của bản native

- Nút **“⇢ Gửi thẳng vào Word”** (do `dist/native-bridge.js` thêm vào, cạnh nút
  “Chép cho Word”): dùng lại đúng luồng chép Equation của app, sau đó lệnh Rust
  `push_to_word` (AppleScript) kích hoạt Microsoft Word và dán tại vị trí con trỏ.
- Điều kiện: Word đang mở sẵn một tài liệu. Lần đầu dùng, macOS sẽ hỏi cấp quyền
  **Trợ năng** (và có thể cả quyền Tự động hoá) cho ChdMathType trong
  *Cài đặt hệ thống → Quyền riêng tư & Bảo mật* — cấp một lần là xong.

## Build tự động (khuyên dùng)

Đẩy repo lên GitHub, workflow **Build macOS (universal)** sẽ tự chạy (hoặc bấm
*Run workflow* trong tab Actions). Kết quả: file `.dmg` universal (chạy cả Apple
Silicon và Intel) nằm trong mục **Releases** của repo và trong Artifacts của lần chạy.

## Build ngay trên máy Mac (thủ công)

Yêu cầu: Xcode Command Line Tools, Rust (rustup), Node 20.

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm install
npx tauri icon src-tauri/icons/icon.png
npx tauri build --target universal-apple-darwin
# file .dmg ở src-tauri/target/universal-apple-darwin/release/bundle/dmg/
```

## Cài đặt

Mở `.dmg`, kéo **ChdMathType** vào thư mục **Applications**. App chưa có chứng chỉ
Apple nên lần mở đầu tiên hãy nhấp chuột phải vào app → **Mở** → **Mở** để xác nhận.

## Cập nhật nội dung app

Khi bản web ChdMathType có thay đổi: thay `dist/index.html` bằng bản mới và chạy
lại quy trình đóng gói vendor (các tham chiếu CDN phải được trỏ về `dist/vendor/`)
rồi build lại. Phần vỏ Tauri (`src-tauri/`) hầu như không bao giờ phải đổi.
