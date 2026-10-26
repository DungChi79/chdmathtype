use std::process::Command;

#[cfg(target_os = "macos")]
use cocoa::base::{id, nil};
#[cfg(target_os = "macos")]
use cocoa::foundation::NSString;
#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

#[cfg(target_os = "macos")]
/// Chạy một đoạn AppleScript qua osascript; Ok(stdout) nếu thoát 0, Err(stderr) nếu lỗi.
fn run_script(script: &str) -> Result<String, String> {
    let out = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("Không chạy được AppleScript: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Rút gọn một thông báo lỗi thô để nhét vừa bong bóng thông báo.
fn short(s: &str) -> String {
    let t = s.replace('\n', " ");
    if t.chars().count() > 170 {
        format!("{}…", t.chars().take(170).collect::<String>())
    } else {
        t
    }
}

#[cfg(target_os = "macos")]
/// Đặt nội dung RTF (kèm văn bản thuần dự phòng) lên clipboard hệ thống
/// qua NSPasteboard — plugin clipboard của Tauri không có API ghi RTF,
/// nên lệnh này tự ghi trực tiếp bằng AppKit. RTF chứa đối tượng OLE
/// MathType kèm ảnh xem trước: Word dán vào sẽ thành đối tượng MathType
/// thật (trên Mac không có MathType nên hiển thị ảnh xem trước; gửi file
/// cho máy Windows có MathType sẽ mở sửa được như đối tượng MathType).
fn set_clipboard_rtf(rtf: &str, plain: &str) -> Result<(), String> {
    unsafe {
        let pb: id = msg_send![class!(NSPasteboard), generalPasteboard];
        let _: () = msg_send![pb, clearContents];
        let rtf_str = NSString::alloc(nil).init_str(rtf);
        let rtf_type = NSString::alloc(nil).init_str("public.rtf");
        let ok_rtf: bool = msg_send![pb, setString: rtf_str forType: rtf_type];
        if !ok_rtf {
            return Err("Không ghi được nội dung RTF vào clipboard hệ thống.".into());
        }
        // Văn bản thuần dự phòng: dán vào chỗ không nhận RTF sẽ ra mã LaTeX.
        let plain_str = NSString::alloc(nil).init_str(plain);
        let plain_type = NSString::alloc(nil).init_str("public.utf8-plain-text");
        let _: bool = msg_send![pb, setString: plain_str forType: plain_type];
    }
    Ok(())
}

#[cfg(target_os = "macos")]
/// Dán clipboard hiện tại vào tài liệu Word đang mở, bằng hai cách theo
/// thứ tự ưu tiên:
/// 1) Nhờ System Events bấm mục Paste trong menu Edit của Word — điều khiển
///    giao diện (AX), không tổng hợp phím tắt nên tránh được lỗi keystroke
///    (1002). (Lệnh `paste` trần từng dùng ở 1.0.2 đã chết: Word hiện đại
///    không còn lệnh đó, osascript báo -2753 "variable paste is not defined";
///    lớp VBA ở 1.0.1 cũng đã chết với -2741.)
/// 2) Dự phòng: nhờ System Events gửi Cmd+V — cần quyền Trợ năng.
/// Nếu cả hai đều thất bại, trả về cả hai lỗi gốc kèm cả hai cách sửa
/// (Tự động hoá và Trợ năng) để không bao giờ giấu mất một lớp lỗi nữa.
fn paste_into_word() -> Result<String, String> {
    const NO_DOC: &str = "Chưa có tài liệu Word nào đang mở. Hãy mở sẵn một tài liệu Word, đặt con trỏ vào chỗ cần chèn rồi bấm lại.";
    const OK_MSG: &str = "Đã gửi công thức vào Word — công thức nằm tại vị trí con trỏ trong tài liệu.";

    let word_script = r#"
tell application "Microsoft Word"
    if (count of documents) is 0 then
        error "NO_DOC"
    end if
    activate
end tell
delay 0.35
tell application "System Events"
    tell process "Microsoft Word"
        try
            click menu item "Paste" of menu 1 of menu bar item "Edit" of menu bar 1
        on error
            click menu item "Dán" of menu 1 of menu bar item "Sửa" of menu bar 1
        end try
    end tell
end tell
return "ok"
"#;
    let e1 = match run_script(word_script) {
        Ok(_) => return Ok(OK_MSG.into()),
        Err(e) => e,
    };
    if e1.contains("NO_DOC") {
        return Err(NO_DOC.into());
    }

    let events_script = r#"
tell application "Microsoft Word"
    if (count of documents) is 0 then
        error "NO_DOC"
    end if
    activate
end tell
delay 0.35
tell application "System Events"
    keystroke "v" using command down
end tell
return "ok"
"#;
    let e2 = match run_script(events_script) {
        Ok(_) => return Ok(OK_MSG.into()),
        Err(e) => e,
    };
    if e2.contains("NO_DOC") {
        return Err(NO_DOC.into());
    }

    // Cả hai lớp đều thất bại: HIỆN CẢ HAI LỖI, không che lớp nào nữa
    // (bản 1.0.2 chỉ hiện lỗi lớp phím tắt nên lỗi của lớp Word bị giấu).
    let both = format!("{e1} || {e2}").to_lowercase();
    if both.contains("-10810")
        || both.contains("can't be found")
        || both.contains("cannot be found")
    {
        return Err("Không tìm thấy Microsoft Word trên máy này.".into());
    }
    // Luôn hiện cả hai lỗi và cả hai cách sửa — không giấu lớp nào nữa.
    let _ = both;
    Err(format!(
        "Không gửi được vào Word. Lỗi lớp bấm menu Paste: [{}]. Lỗi lớp phím tắt: [{}]. Cách sửa: (1) Tự động hoá — Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Tự động hoá, mở mục ChdMathType và bật Microsoft Word; (2) Trợ năng — trong cùng màn hình Quyền riêng tư & Bảo mật, xóa ChdMathType khỏi danh sách Trợ năng (nút -), thêm lại từ thư mục Applications (đúng bản đang chạy), thoát hẳn app (Cmd+Q) rồi mở lại và thử lần nữa.",
        short(&e1),
        short(&e2)
    ))
}

/// Đặt nội dung RTF (kèm văn bản thuần dự phòng) lên clipboard hệ thống
/// trên Windows bằng Win32 API trực tiếp — plugin clipboard của Tauri
/// không có API ghi RTF. RTF dùng định dạng đăng ký tên
/// "Rich Text Format"; văn bản thuần dùng CF_UNICODETEXT.
#[cfg(target_os = "windows")]
fn set_clipboard_rtf(rtf: &str, plain: &str) -> Result<(), String> {
    use windows::core::s;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatA,
        SetClipboardData,
    };
    use windows::Win32::System::Ole::CF_UNICODETEXT;
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    unsafe {
        if OpenClipboard(HWND::default()).is_err() {
            return Err("Không mở được clipboard hệ thống.".into());
        }
        let result = (|| -> Result<(), String> {
            EmptyClipboard().map_err(|_| "Không xóa được clipboard hệ thống.".to_string())?;
            // RTF (ASCII) + ký tự NUL kết thúc.
            let rtf_fmt = RegisterClipboardFormatA(s!("Rich Text Format"));
            if rtf_fmt == 0 {
                return Err("Không đăng ký được định dạng RTF cho clipboard.".into());
            }
            let rtf_bytes = rtf.as_bytes();
            let h = GlobalAlloc(GMEM_MOVEABLE, rtf_bytes.len() + 1)
                .map_err(|_| "Không cấp được bộ nhớ clipboard cho RTF.".to_string())?;
            let p = GlobalLock(h);
            if p.is_null() {
                return Err("Không khóa được bộ nhớ clipboard cho RTF.".into());
            }
            std::ptr::copy_nonoverlapping(rtf_bytes.as_ptr(), p as *mut u8, rtf_bytes.len());
            *(p as *mut u8).add(rtf_bytes.len()) = 0;
            let _ = GlobalUnlock(h);
            SetClipboardData(rtf_fmt, windows::Win32::Foundation::HANDLE(h.0))
                .map_err(|_| "Không ghi được nội dung RTF vào clipboard hệ thống.".to_string())?;
            // Văn bản thuần dự phòng (UTF-16 + NUL).
            let plain_u16: Vec<u16> = plain.encode_utf16().chain(std::iter::once(0)).collect();
            let h2 = GlobalAlloc(GMEM_MOVEABLE, plain_u16.len() * 2)
                .map_err(|_| "Không cấp được bộ nhớ clipboard cho văn bản thuần.".to_string())?;
            let p2 = GlobalLock(h2);
            if p2.is_null() {
                return Err("Không khóa được bộ nhớ clipboard cho văn bản thuần.".into());
            }
            std::ptr::copy_nonoverlapping(plain_u16.as_ptr(), p2 as *mut u16, plain_u16.len());
            let _ = GlobalUnlock(h2);
            SetClipboardData(CF_UNICODETEXT.0 as u32, windows::Win32::Foundation::HANDLE(h2.0))
                .map_err(|_| "Không ghi được văn bản thuần vào clipboard hệ thống.".to_string())?;
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

/// Dán clipboard hiện tại vào tài liệu Word đang mở trên Windows bằng
/// COM qua PowerShell: lấy Word đang chạy (GetActiveObject), kiểm tra
/// có tài liệu mở, rồi Selection.Paste() tại vị trí con trỏ. Không cần
/// quyền đặc biệt (không như Trợ năng/Tự động hoá trên macOS) và không
/// cần đưa Word lên trước — COM dán thẳng vào tài liệu đang hoạt động.
/// Nếu dán thất bại, nội dung vẫn nằm trong clipboard để dán thủ công.
#[cfg(target_os = "windows")]
fn paste_into_word() -> Result<String, String> {
    const NO_DOC: &str = "Chưa có tài liệu Word nào đang mở. Hãy mở sẵn một tài liệu Word, đặt con trỏ vào chỗ cần chèn rồi bấm lại.";
    const OK_MSG: &str = "Đã gửi công thức vào Word — công thức nằm tại vị trí con trỏ trong tài liệu.";
    let script = r#"
$ErrorActionPreference = 'Stop'
try { $word = [Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application') } catch { throw 'WORD_NOT_RUNNING' }
if ($word.Documents.Count -eq 0) { throw 'NO_DOC' }
$word.Selection.Paste()
"#;
    let out = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script])
        .output()
        .map_err(|e| format!("Không chạy được PowerShell: {e}"))?;
    if out.status.success() {
        return Ok(OK_MSG.into());
    }
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
    let out_txt = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let both = format!("{err} {out_txt}");
    if both.contains("NO_DOC") {
        return Err(NO_DOC.into());
    }
    if both.contains("WORD_NOT_RUNNING") || both.contains("0x800401E3") {
        return Err("Không tìm thấy Microsoft Word đang chạy trên máy này. Hãy mở Word trước rồi bấm lại.".into());
    }
    Err(format!(
        "Không gửi được vào Word. Lỗi: [{}]. Nội dung đã nằm trong clipboard — bạn có thể dán thủ công bằng Ctrl+V trong Word.",
        short(&both)
    ))
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn set_clipboard_rtf(_rtf: &str, _plain: &str) -> Result<(), String> {
    Err("Ghi RTF vào clipboard chưa hỗ trợ trên hệ điều hành này.".into())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn paste_into_word() -> Result<String, String> {
    Err("Gửi thẳng vào Word chưa hỗ trợ trên hệ điều hành này.".into())
}

/// "Gửi thẳng vào Word" (Equation): phía web đã đặt sẵn Equation vào
/// clipboard hệ thống (qua plugin clipboard của chính app); lệnh này chỉ
/// dán vào Word bằng hai lớp đã kiểm chứng.
#[tauri::command]
fn push_to_word() -> Result<String, String> {
    paste_into_word()
}

/// "Gửi thẳng vào Word MathType": phía web đã dựng sẵn RTF chứa đối tượng
/// OLE MathType thật. Lệnh này đặt RTF lên clipboard rồi dán vào Word
/// bằng đúng hai lớp đã kiểm chứng của push_to_word. Nếu lớp dán thất bại,
/// nội dung MathType vẫn nằm trong clipboard nên người dùng dán thủ công
/// bằng menu Sửa > Dán trong Word vẫn được.
#[tauri::command]
fn push_mathtype_to_word(rtf: String, plain: String) -> Result<String, String> {
    set_clipboard_rtf(&rtf, &plain)?;
    match paste_into_word() {
        Ok(_) => Ok("Đã gửi công thức MathType vào Word — trên Mac hiển thị dạng ảnh xem trước; gửi file cho máy Windows có MathType sẽ mở sửa được như đối tượng MathType.".into()),
        Err(e) => Err(format!(
            "{e} Nội dung MathType đã nằm trong clipboard — bạn có thể dán thủ công bằng menu Sửa > Dán trong Word."
        )),
    }
}

/// Mã máy của thiết bị (dùng cho kích hoạt bản quyền theo máy, thay cho
/// đăng nhập): đọc machine-uid của hệ thống (macOS: IOPlatformUUID,
/// Windows: MachineGuid) rồi băm SHA-256 với muối riêng của app. Serial
/// thô không bao giờ rời khỏi máy — chỉ mã băm mới được gửi cho server,
/// và mã hiển thị chỉ là 20 ký tự đầu của mã băm, nhóm 4 ký tự để người
/// dùng đọc/nhắn cho admin.
#[derive(serde::Serialize)]
struct MachineCode {
    code: String,
    display: String,
}

#[tauri::command]
fn get_machine_code() -> Result<MachineCode, String> {
    let uid = machine_uid::get().map_err(|e| format!("Không đọc được mã máy: {e}"))?;
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(b"ChdMathType-machine-v1");
    h.update(uid.as_bytes());
    let code = format!("{:x}", h.finalize());
    let short = &code[..20];
    let display = (0..5)
        .map(|i| &short[i * 4..i * 4 + 4])
        .collect::<Vec<_>>()
        .join("-");
    Ok(MachineCode { code, display })
}

/// Mở một URL ngoài bằng trình duyệt mặc định của hệ thống (dùng cho nút
/// "Hỗ trợ" và các link ngoài khác trong app: webview của app không mở
/// được tab mới nên link ngoài phải đi qua shell).
#[tauri::command]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell().open(url, None).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            push_to_word,
            push_mathtype_to_word,
            open_external_url,
            get_machine_code
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
