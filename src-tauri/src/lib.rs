use std::process::Command;

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

/// "Gửi thẳng vào Word": phía web đã đặt sẵn Equation vào clipboard hệ thống
/// (qua plugin clipboard của chính app). Lệnh này dán vào Word bằng hai cách,
/// theo thứ tự ưu tiên:
/// 1) Lệnh `paste` của chính Word tại vùng chọn — chỉ cần quyền Tự động hoá,
///    không cần Trợ năng. (Lớp VBA "do Visual Basic" từng dùng ở 1.0.1 đã
///    bị Word hiện đại loại bỏ: osascript báo lỗi cú pháp -2741 tại đó.)
/// 2) Dự phòng: nhờ System Events gửi Cmd+V — cần quyền Trợ năng.
/// Nếu cả hai đều thất bại, trả về hướng dẫn theo đúng loại quyền còn thiếu
/// kèm chi tiết lỗi gốc để người dùng chụp màn hình gửi lại khi cần.
#[tauri::command]
fn push_to_word() -> Result<String, String> {
    const NO_DOC: &str = "Chưa có tài liệu Word nào đang mở. Hãy mở sẵn một tài liệu Word, đặt con trỏ vào chỗ cần chèn rồi bấm lại.";
    const OK_MSG: &str = "Đã gửi công thức vào Word — công thức nằm tại vị trí con trỏ trong tài liệu.";

    let word_script = r#"
tell application "Microsoft Word"
    if (count of documents) is 0 then
        error "NO_DOC"
    end if
    activate
    paste
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
    let mut msg = format!(
        "Không gửi được vào Word. Lỗi lớp dán của Word: [{}]. Lỗi lớp phím tắt: [{}].",
        short(&e1),
        short(&e2)
    );
    if both.contains("-1743") || both.contains("not authorized") {
        msg.push_str(" Cách sửa (1) — Tự động hoá: mở Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Tự động hoá, mở mục ChdMathType và bật Microsoft Word.");
    }
    if both.contains("-25211")
        || both.contains("assistive")
        || both.contains("send keystrokes")
        || both.contains("1002")
    {
        msg.push_str(" Cách sửa (2) — Trợ năng: macOS coi mỗi bản build mới như một app mới, nên mục đã bật từ bản cũ có thể không còn khớp bản đang chạy. Mở Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Trợ năng, xóa ChdMathType khỏi danh sách (nút -), thêm lại từ thư mục Applications, thoát hẳn app (Cmd+Q) rồi mở lại và thử lần nữa.");
    }
    Err(msg)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![push_to_word])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
