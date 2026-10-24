use std::process::Command;

/// "Gửi thẳng vào Word": phía web đã đặt sẵn Equation vào clipboard bằng đúng
/// luồng "Chép cho Word" đã kiểm chứng; lệnh này chỉ việc kích hoạt Microsoft
/// Word và gửi Cmd+V để dán tại vị trí con trỏ trong tài liệu đang mở.
#[tauri::command]
fn push_to_word() -> Result<String, String> {
    let script = r#"
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
    let out = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("Không chạy được AppleScript: {e}"))?;
    if out.status.success() {
        return Ok("Đã gửi công thức vào Word — công thức nằm tại vị trí con trỏ trong tài liệu.".into());
    }
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if err.contains("NO_DOC") {
        Err("Chưa có tài liệu Word nào đang mở. Hãy mở sẵn một tài liệu Word, đặt con trỏ vào chỗ cần chèn rồi bấm lại.".into())
    } else if err.contains("-25211")
        || err.to_lowercase().contains("assistive")
        || err.to_lowercase().contains("not allowed")
    {
        Err("macOS chưa cấp quyền Trợ năng cho ChdMathType nên app chưa điều khiển được Word. Mở Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Trợ năng, bật ChdMathType rồi thử lại.".into())
    } else if err.contains("-10810")
        || err.to_lowercase().contains("can't be found")
        || err.to_lowercase().contains("cannot be found")
    {
        Err("Không tìm thấy Microsoft Word trên máy này.".into())
    } else {
        Err(format!(
            "Không gửi được vào Word. Hãy chắc chắn Word đang mở một tài liệu và thử lại. ({err})"
        ))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![push_to_word])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
