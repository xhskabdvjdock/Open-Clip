// Open Clip — Tauri 2 backend
// Real system clipboard monitoring, local SQLite, tray, global shortcut.
// No network, no cloud, no AI. Everything local.

// Prevents the extra console (CMD) window on Windows release builds.
// Debug builds keep the console so logs stay visible during development.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use arboard::{Clipboard, ImageData};
use chrono::Utc;
use regex::Regex;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{borrow::Cow, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, Manager, State};

// ============================== Types ==============================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ContentType {
    #[serde(rename = "text")]
    Text,
    #[serde(rename = "url")]
    Url,
    #[serde(rename = "code")]
    Code,
    #[serde(rename = "number")]
    Number,
    #[serde(rename = "email")]
    Email,
    #[serde(rename = "image")]
    Image,
}

impl ContentType {
    fn as_str(&self) -> &'static str {
        match self {
            ContentType::Text => "text",
            ContentType::Url => "url",
            ContentType::Code => "code",
            ContentType::Number => "number",
            ContentType::Email => "email",
            ContentType::Image => "image",
        }
    }
    fn from_str(s: &str) -> Self {
        match s {
            "url" => ContentType::Url,
            "code" => ContentType::Code,
            "number" => ContentType::Number,
            "email" => ContentType::Email,
            "image" => ContentType::Image,
            _ => ContentType::Text,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardItem {
    pub id: String,
    pub content: String,
    pub content_type: String,
    pub created_at: i64,
    pub last_copied_at: i64,
    pub is_pinned: bool,
    pub is_sensitive: bool,
    pub content_hash: String,
    pub char_count: i64,
    pub word_count: i64,
    pub image_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub start_on_startup: bool,
    #[serde(default = "default_true")]
    pub minimize_to_tray: bool,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_lang")]
    pub lang: String,
    #[serde(default = "default_limit")]
    pub history_limit: i64,
    #[serde(default = "default_autodelete")]
    pub auto_delete: String,
    #[serde(default)]
    pub monitoring_paused: bool,
    #[serde(default = "default_sensitive")]
    pub sensitive_mode: String,
    #[serde(default = "default_shortcut")]
    pub quick_paste_shortcut: String,
    #[serde(default)]
    pub paste_automatically: bool,
    #[serde(default = "default_true")]
    pub start_minimized: bool,
    #[serde(default)]
    pub onboarding_done: bool,
}

fn default_true() -> bool {
    true
}
fn default_theme() -> String {
    "system".into()
}
fn default_lang() -> String {
    "en".into()
}
fn default_limit() -> i64 {
    500
}
fn default_autodelete() -> String {
    "never".into()
}
fn default_sensitive() -> String {
    "never".into()
}
fn default_shortcut() -> String {
    "Alt+V".into()
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            start_on_startup: false,
            minimize_to_tray: true,
            theme: "system".into(),
            lang: "en".into(),
            history_limit: 500,
            auto_delete: "never".into(),
            monitoring_paused: false,
            sensitive_mode: "never".into(),
            quick_paste_shortcut: "Alt+V".into(),
            paste_automatically: false,
            start_minimized: true,
            onboarding_done: false,
        }
    }
}

struct Paths {
    db_path: PathBuf,
    settings_path: PathBuf,
    images_dir: PathBuf,
}

struct MonitorState {
    last_hash: Mutex<String>,
    self_copy_until: Mutex<i64>,
    /// Foreground window captured before the picker steals focus,
    /// so auto-paste can return to it. Windows-only (HWND as isize).
    paste_target: Mutex<Option<isize>>,
}

/// Windows foreground-window save/restore so auto-paste lands in the app
/// the user was working in — not in our picker. Manual FFI keeps the
/// dependency tree small (three user32 calls, no extra crates).
#[cfg(target_os = "windows")]
mod win_focus {
    type HWND = isize;
    type BOOL = i32;
    type DWORD = u32;

    #[link(name = "user32")]
    unsafe extern "system" {
        fn GetForegroundWindow() -> HWND;
        fn SetForegroundWindow(h_wnd: HWND) -> BOOL;
        fn GetWindowThreadProcessId(h_wnd: HWND, lpdw_process_id: *mut DWORD) -> DWORD;
        fn AttachThreadInput(id_attach: DWORD, id_attach_to: DWORD, f_attach: BOOL) -> BOOL;
        fn BringWindowToTop(h_wnd: HWND) -> BOOL;
        fn SetFocus(h_wnd: HWND) -> HWND;
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCurrentThreadId() -> DWORD;
    }

    /// Handle of the currently-foreground window (None if unavailable).
    pub fn current() -> Option<isize> {
        unsafe {
            let h = GetForegroundWindow();
            if h == 0 {
                None
            } else {
                Some(h)
            }
        }
    }

    /// Best-effort restore of a previously saved foreground window.
    pub fn restore(h: isize) {
        unsafe {
            if SetForegroundWindow(h) != 0 {
                return;
            }
            // Foreground-lock fallback: briefly attach our input thread to the
            // foreground thread, then force the target window to the front.
            let fg = GetForegroundWindow();
            let mut _pid = 0u32;
            let fg_tid = GetWindowThreadProcessId(fg, &mut _pid);
            let cur_tid = GetCurrentThreadId();
            if fg_tid != 0 && cur_tid != 0 && AttachThreadInput(cur_tid, fg_tid, 1) != 0 {
                BringWindowToTop(h);
                SetFocus(h);
                SetForegroundWindow(h);
                AttachThreadInput(cur_tid, fg_tid, 0);
            }
        }
    }
}

/// Remember which window was in front before the picker steals focus.
/// The picker itself is never a valid paste target.
fn capture_paste_target(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        if let Some(ms) = app.try_state::<MonitorState>() {
            let picker_focused = app
                .get_webview_window("picker")
                .map(|w| w.is_focused().unwrap_or(false))
                .unwrap_or(false);
            if !picker_focused {
                *ms.paste_target.lock().unwrap() = win_focus::current();
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
    }
}

/// Simulate the OS paste shortcut (Ctrl+V, Cmd+V on macOS).
/// Errors are non-fatal: the clipboard already holds the content,
/// so a failure degrades gracefully to copy-only behavior.
fn send_paste_keys() -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;
    enigo
        .key(modifier, Direction::Press)
        .map_err(|e| e.to_string())?;
    // Physical V key: layout-safe paste shortcut (not Unicode typing).
    let r = enigo.key(Key::V, Direction::Click);
    let _ = enigo.key(modifier, Direction::Release);
    r.map_err(|e| e.to_string())
}

// ============================== Paths / DB ==============================

fn resolve_paths(app: &AppHandle) -> Paths {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("open-clip"));
    let dir = base.join("OpenClip");
    let _ = std::fs::create_dir_all(&dir);
    let images_dir = dir.join("clip_images");
    let _ = std::fs::create_dir_all(&images_dir);
    Paths {
        db_path: dir.join("clipboard.db"),
        settings_path: dir.join("settings.json"),
        images_dir,
    }
}

fn init_db(path: &PathBuf) -> rusqlite::Result<()> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS clipboard_items (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            content_type TEXT NOT NULL DEFAULT 'text',
            created_at INTEGER NOT NULL,
            last_copied_at INTEGER NOT NULL,
            is_pinned INTEGER NOT NULL DEFAULT 0,
            is_sensitive INTEGER NOT NULL DEFAULT 0,
            content_hash TEXT NOT NULL,
            char_count INTEGER NOT NULL DEFAULT 0,
            word_count INTEGER NOT NULL DEFAULT 0,
            image_path TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_clip_hash ON clipboard_items(content_hash);
        CREATE INDEX IF NOT EXISTS idx_clip_last ON clipboard_items(last_copied_at DESC);
        CREATE INDEX IF NOT EXISTS idx_clip_pinned ON clipboard_items(is_pinned);",
    )?;
    Ok(())
}

fn open_conn(paths: &Paths) -> rusqlite::Result<Connection> {
    let conn = Connection::open(&paths.db_path)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(conn)
}

// ============================== Settings ==============================

fn load_settings(paths: &Paths) -> AppSettings {
    let mut s: AppSettings = std::fs::read_to_string(&paths.settings_path)
        .ok()
        .and_then(|s| serde_json::from_str::<AppSettings>(&s).ok())
        .unwrap_or_default();
    // One-time migration: the old default shortcut was Ctrl+Shift+V.
    // Existing installs that never customized it move to the new default Alt+V.
    if s.quick_paste_shortcut == "Ctrl+Shift+V" {
        s.quick_paste_shortcut = "Alt+V".into();
    }
    s
}

fn save_settings(paths: &Paths, s: &AppSettings) -> anyhow::Result<()> {
    let json = serde_json::to_string_pretty(s)?;
    std::fs::write(&paths.settings_path, json)?;
    Ok(())
}

// helper to allow anyhow without adding dep: tiny alias
mod anyhow {
    pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
}

// ============================== Classification (local) ==============================

fn classify_content(content: &str) -> ContentType {
    let t = content.trim();
    if t.is_empty() {
        return ContentType::Text;
    }
    // URL: single token looking like link
    if t.len() <= 4000 && is_url_token(t) {
        return ContentType::Url;
    }
    // Email
    if t.len() <= 320 && is_email(t) {
        return ContentType::Email;
    }
    // Number / IP
    if t.len() <= 120 && (is_number_token(t) || is_ipv4(t)) {
        return ContentType::Number;
    }
    if looks_like_code(t) {
        return ContentType::Code;
    }
    ContentType::Text
}

fn is_url_token(t: &str) -> bool {
    if t.contains(char::is_whitespace) {
        // allow single-token only; multi-word with URL inside -> text
        return false;
    }
    let low = t.to_lowercase();
    if low.starts_with("http://") || low.starts_with("https://") || low.starts_with("www.") {
        return t.contains('.') && t.len() >= 6;
    }
    false
}

fn is_email(t: &str) -> bool {
    if t.contains(char::is_whitespace) {
        return false;
    }
    let parts: Vec<&str> = t.split('@').collect();
    if parts.len() != 2 {
        return false;
    }
    let domain = parts[1];
    !parts[0].is_empty() && domain.contains('.') && domain.len() >= 3 && !domain.starts_with('.')
}

fn is_number_token(t: &str) -> bool {
    let c: String = t.chars().filter(|c| ![',', ' ', '_'].contains(c)).collect();
    if c.is_empty() {
        return false;
    }
    // strip leading +/-
    let s = c.trim_start_matches(['+', '-']);
    if s.is_empty() {
        return false;
    }
    let mut dots = 0;
    let mut digits = 0;
    for ch in s.chars() {
        if ch.is_ascii_digit() {
            digits += 1;
        } else if ch == '.' {
            dots += 1;
            if dots > 1 {
                return false;
            }
        } else if ch == 'e' || ch == 'E' {
            // exponent: rest must be valid int
            break;
        } else {
            return false;
        }
    }
    digits > 0
}

fn is_ipv4(t: &str) -> bool {
    let parts: Vec<&str> = t.split('.').collect();
    if parts.len() != 4 {
        return false;
    }
    parts.iter().all(|p| {
        !p.is_empty()
            && p.len() <= 3
            && p.chars().all(|c| c.is_ascii_digit())
            && p.parse::<u8>().is_ok()
    })
}

fn looks_like_code(s: &str) -> bool {
    let t = s.trim();
    if t.len() < 3 {
        return false;
    }
    let mut score = 0;
    let checks: &[&str] = &[
        "npm ", "npx ", "yarn ", "pnpm ", "pip ", "cargo ", "git ", "docker ", "kubectl ", "brew ",
        "sudo ", "apt ",
    ];
    for c in checks {
        if t.starts_with(c) || t.contains(&format!("\n{}", c)) {
            score += 2;
            break;
        }
    }
    if t.contains('{') && t.contains('}') {
        score += 1;
    }
    if t.contains("=>") || t.contains("->") || t.contains("::") || t.contains("&&") {
        score += 1;
    }
    if (t.contains(';') && t.contains('\n')) || t.trim_end().ends_with(';') {
        score += 1;
    }
    if t.contains("#include") || t.contains("import ") && t.contains("from ") {
        score += 1;
    }
    if Regex::new(
        r"(?m)^\s*(const|let|var|function|class|def |fn |public |private |if |for |while )",
    )
    .map(|re| re.is_match(t))
    .unwrap_or(false)
    {
        score += 1;
    }
    if t.contains('\n') && (t.contains('=') || t.contains('(') && t.contains(')')) {
        score += 1;
    }
    // single-line command like `npm install next`
    if !t.contains('\n') && score == 0 {
        return false;
    }
    score >= 2 || (t.contains('\n') && score >= 1)
}

// ============================== Sensitive detection (local) ==============================

fn is_sensitive(content: &str) -> (bool, Option<String>) {
    let t = content.trim();
    if t.is_empty() {
        return (false, None);
    }
    // bare OTP
    if Regex::new(r"^\d{4,8}$")
        .map(|re| re.is_match(t))
        .unwrap_or(false)
    {
        return (true, Some("otp-code".into()));
    }
    let patterns: &[(&str, &str)] = &[
        (
            r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
            "private-key",
        ),
        (r"sk-(live|test)-[A-Za-z0-9]{8,}", "api-key"),
        (r"sk_live_[A-Za-z0-9]{8,}", "api-key"),
        (r"xox[bap]-?[A-Za-z0-9-]{8,}", "token"),
        (r"gh[pousr]_[A-Za-z0-9]{20,}", "github-token"),
        (r"AIza[0-9A-Za-z\-_]{20,}", "google-api-key"),
        (r"(AKIA|ASIA)[0-9A-Z]{16}", "aws-key"),
        (
            r"(?i)aws_secret_access_key\s*[:=]\s*[A-Za-z0-9/+=]{20,}",
            "aws-secret",
        ),
        (r#"(?i)["']?password["']?\s*[:=]\s*["']?\S{4,}"#, "password"),
        (
            r#"(?i)["']?(passwd|pwd|secret|token|api[_-]?key|auth[_-]?token|access[_-]?token)["']?\s*[:=]\s*\S{4,}"#,
            "secret",
        ),
        (r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b", "card-like"),
        (r"\b\d{3}-\d{2}-\d{4}\b", "ssn-like"),
        (
            r"(?i)(?:otp|one[-_ ]?time|verification|2fa)[^\d]{0,20}(\d{4,8})",
            "otp-context",
        ),
        (
            r"eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+",
            "jwt",
        ),
    ];
    for (pat, label) in patterns {
        if Regex::new(pat).map(|re| re.is_match(t)).unwrap_or(false) {
            return (true, Some(label.to_string()));
        }
    }
    // high-entropy token-like
    let nospace: String = t.chars().filter(|c| !c.is_whitespace()).collect();
    if (32..=4096).contains(&nospace.len())
        && nospace
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_+/=.".contains(c))
    {
        let e = shannon_entropy(&nospace.chars().take(256).collect::<String>());
        if e > 4.5 {
            return (true, Some("high-entropy-token".into()));
        }
    }
    (false, None)
}

fn shannon_entropy(s: &str) -> f64 {
    if s.is_empty() {
        return 0.0;
    }
    use std::collections::HashMap;
    let mut freq: HashMap<char, usize> = HashMap::new();
    let total = s.chars().count() as f64;
    for c in s.chars() {
        *freq.entry(c).or_insert(0) += 1;
    }
    let mut e = 0.0;
    for n in freq.values() {
        let p = *n as f64 / total;
        e -= p * p.log2();
    }
    e
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex_encode(&hasher.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

fn count_words_chars(s: &str) -> (i64, i64) {
    let chars = s.chars().count() as i64;
    let words = if s.trim().is_empty() {
        0
    } else {
        s.split_whitespace().count() as i64
    };
    (chars, words)
}

// ============================== DB helpers ==============================

fn row_to_item(row: &rusqlite::Row) -> rusqlite::Result<ClipboardItem> {
    Ok(ClipboardItem {
        id: row.get(0)?,
        content: row.get(1)?,
        content_type: row.get(2)?,
        created_at: row.get(3)?,
        last_copied_at: row.get(4)?,
        is_pinned: row.get::<_, i64>(5)? != 0,
        is_sensitive: row.get::<_, i64>(6)? != 0,
        content_hash: row.get(7)?,
        char_count: row.get(8)?,
        word_count: row.get(9)?,
        image_path: row.get(10)?,
    })
}

fn fetch_items(conn: &Connection, limit: i64) -> rusqlite::Result<Vec<ClipboardItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, content, content_type, created_at, last_copied_at, is_pinned, is_sensitive, content_hash, char_count, word_count, image_path
         FROM clipboard_items ORDER BY last_copied_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], row_to_item)?;
    rows.collect()
}

fn enforce_limits(conn: &Connection, history_limit: i64) -> rusqlite::Result<()> {
    let limit = history_limit.clamp(10, 5000);
    // delete oldest unpinned beyond limit
    conn.execute(
        "DELETE FROM clipboard_items WHERE id IN (
            SELECT id FROM clipboard_items WHERE is_pinned = 0
            ORDER BY last_copied_at DESC LIMIT -1 OFFSET ?1
        )",
        params![limit],
    )?;
    Ok(())
}

fn auto_delete_ms(mode: &str) -> Option<i64> {
    match mode {
        "1h" => Some(3_600_000),
        "1d" => Some(86_400_000),
        "7d" => Some(7 * 86_400_000),
        "30d" => Some(30 * 86_400_000),
        _ => None,
    }
}

fn run_auto_delete(conn: &Connection, mode: &str) -> rusqlite::Result<()> {
    if let Some(ms) = auto_delete_ms(mode) {
        let cutoff = Utc::now().timestamp_millis() - ms;
        conn.execute(
            "DELETE FROM clipboard_items WHERE is_pinned = 0 AND last_copied_at < ?1",
            params![cutoff],
        )?;
    }
    Ok(())
}

/// Insert or touch-duplicate. Returns (item, is_new).
fn upsert_text(
    conn: &Connection,
    paths: &Paths,
    settings: &AppSettings,
    text: &str,
) -> rusqlite::Result<Option<(ClipboardItem, bool)>> {
    let trimmed_check = text.trim();
    if trimmed_check.is_empty() || text.len() > 500_000 {
        return Ok(None);
    }
    let (sensitive, _reason) = is_sensitive(text);
    if sensitive {
        match settings.sensitive_mode.as_str() {
            "allow" => { /* save anyway, flagged */ }
            "ask" => {
                // Rust can't show a blocking ask from monitor thread;
                // frontend handles 'ask' by emitting blocked event with pending content.
                // Default here: do not save, let frontend decide via event.
                return Ok(None);
            }
            _ => return Ok(None), // "never"
        }
    }
    let hash = sha256_hex(text.as_bytes());
    let now = Utc::now().timestamp_millis();
    // duplicate?
    let existing: Option<ClipboardItem> = conn
        .query_row(
            "SELECT id, content, content_type, created_at, last_copied_at, is_pinned, is_sensitive, content_hash, char_count, word_count, image_path FROM clipboard_items WHERE content_hash = ?1",
            params![hash],
            row_to_item,
        )
        .ok();
    if let Some(mut item) = existing {
        conn.execute(
            "UPDATE clipboard_items SET last_copied_at = ?1 WHERE id = ?2",
            params![now, item.id],
        )?;
        item.last_copied_at = now;
        let _ = paths;
        return Ok(Some((item, false)));
    }
    let ctype = classify_content(text);
    let (chars, words) = count_words_chars(text);
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO clipboard_items (id, content, content_type, created_at, last_copied_at, is_pinned, is_sensitive, content_hash, char_count, word_count, image_path)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?7, ?8, ?9, NULL)",
        params![
            id,
            text,
            ctype.as_str(),
            now,
            now,
            if sensitive { 1 } else { 0 },
            hash,
            chars,
            words
        ],
    )?;
    let _ = enforce_limits(conn, settings.history_limit);
    let _ = run_auto_delete(conn, &settings.auto_delete);
    Ok(Some((
        ClipboardItem {
            id,
            content: text.to_string(),
            content_type: ctype.as_str().to_string(),
            created_at: now,
            last_copied_at: now,
            is_pinned: false,
            is_sensitive: sensitive,
            content_hash: hash,
            char_count: chars,
            word_count: words,
            image_path: None,
        },
        true,
    )))
}

fn upsert_image(
    conn: &Connection,
    paths: &Paths,
    settings: &AppSettings,
    img: &ImageData,
) -> rusqlite::Result<Option<(ClipboardItem, bool)>> {
    if img.width == 0 || img.height == 0 || img.bytes.is_empty() {
        return Ok(None);
    }
    if img.width * img.height > 4000 * 4000 {
        return Ok(None); // too big, skip
    }
    let hash = sha256_hex(&img.bytes);
    let now = Utc::now().timestamp_millis();
    let existing: Option<ClipboardItem> = conn
        .query_row(
            "SELECT id, content, content_type, created_at, last_copied_at, is_pinned, is_sensitive, content_hash, char_count, word_count, image_path FROM clipboard_items WHERE content_hash = ?1",
            params![hash],
            row_to_item,
        )
        .ok();
    if let Some(mut item) = existing {
        conn.execute(
            "UPDATE clipboard_items SET last_copied_at = ?1 WHERE id = ?2",
            params![now, item.id],
        )?;
        item.last_copied_at = now;
        return Ok(Some((item, false)));
    }
    // save PNG
    let id = uuid::Uuid::new_v4().to_string();
    let file_name = format!("{}.png", &hash[..16]);
    let file_path = paths.images_dir.join(&file_name);
    if let Some(raw) = image::RgbaImage::from_raw(
        img.width as u32,
        img.height as u32,
        img.bytes.clone().into_owned(),
    ) {
        let _ = raw.save(&file_path);
    } else {
        return Ok(None);
    }
    let label = format!("Image {}×{}", img.width, img.height);
    conn.execute(
        "INSERT INTO clipboard_items (id, content, content_type, created_at, last_copied_at, is_pinned, is_sensitive, content_hash, char_count, word_count, image_path)
         VALUES (?1, ?2, 'image', ?3, ?4, 0, 0, ?5, 0, 0, ?6)",
        params![id, label, now, now, hash, file_path.to_string_lossy().to_string()],
    )?;
    let _ = enforce_limits(conn, settings.history_limit);
    let _ = run_auto_delete(conn, &settings.auto_delete);
    Ok(Some((
        ClipboardItem {
            id,
            content: label,
            content_type: "image".into(),
            created_at: now,
            last_copied_at: now,
            is_pinned: false,
            is_sensitive: false,
            content_hash: hash,
            char_count: 0,
            word_count: 0,
            image_path: Some(file_path.to_string_lossy().to_string()),
        },
        true,
    )))
}

// ============================== Clipboard monitor ==============================

fn spawn_monitor(app: AppHandle) {
    std::thread::spawn(move || {
        // gentle poll: 800ms idle, low CPU
        let mut last_text_hash = String::new();
        let mut clipboard = Clipboard::new().ok();
        if clipboard.is_none() {
            let _ = app.emit("clipboard://monitor-error", ());
            // retry once after delay (e.g. Wayland / permissions)
            std::thread::sleep(Duration::from_secs(3));
            clipboard = Clipboard::new().ok();
            if clipboard.is_none() {
                return;
            }
        }
        let mut cb = clipboard.unwrap();
        loop {
            std::thread::sleep(Duration::from_millis(800));
            let paths = resolve_paths(&app);
            let settings = load_settings(&paths);

            if settings.monitoring_paused {
                continue;
            }

            // periodic auto-delete every ~60 ticks
            // text first
            match cb.get_text() {
                Ok(text) => {
                    let h = sha256_hex(text.as_bytes());
                    // skip if our own copy-back (avoid instant re-touch loops being noisy)
                    let skip_self = app
                        .try_state::<MonitorState>()
                        .map(|s| {
                            let until = *s.self_copy_until.lock().unwrap();
                            Utc::now().timestamp_millis() < until
                                && *s.last_hash.lock().unwrap() == h
                        })
                        .unwrap_or(false);
                    if h != last_text_hash && !skip_self && !text.trim().is_empty() {
                        last_text_hash = h.clone();
                        if let Ok(conn) = open_conn(&paths) {
                            // sensitive check for notifications
                            let (sens, _reason) = is_sensitive(&text);
                            let ask_mode = sens && settings.sensitive_mode == "ask";
                            let blocked = sens && settings.sensitive_mode == "never";
                            if ask_mode {
                                // Don't save; ask frontend once (with full content for Save-once).
                                #[derive(serde::Serialize, Clone)]
                                struct AskPayload {
                                    content: String,
                                }
                                let _ = app.emit(
                                    "clipboard://sensitive-ask",
                                    &AskPayload {
                                        content: text.clone(),
                                    },
                                );
                                continue;
                            }
                            match upsert_text(&conn, &paths, &settings, &text) {
                                Ok(Some((item, _))) => {
                                    if let Some(ms) = app.try_state::<MonitorState>() {
                                        *ms.last_hash.lock().unwrap() = h;
                                    }
                                    let _ = app.emit("clipboard://new-item", &item);
                                }
                                Ok(None) if blocked => {
                                    let _ = app.emit("clipboard://sensitive-blocked", ());
                                    // notify only for blocked sensitive (important event)
                                    #[cfg(desktop)]
                                    {
                                        use tauri_plugin_notification::NotificationExt;
                                        let _ = app
                                            .notification()
                                            .builder()
                                            .title("Open Clip")
                                            .body("Potentially sensitive content detected. This item was not saved.")
                                            .show();
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Err(_) => {
                    // maybe an image in clipboard
                    match cb.get_image() {
                        Ok(img) => {
                            let h = sha256_hex(&img.bytes);
                            if h != last_text_hash {
                                last_text_hash = h.clone();
                                if let Ok(conn) = open_conn(&paths) {
                                    if let Ok(Some((item, _))) =
                                        upsert_image(&conn, &paths, &settings, &img)
                                    {
                                        if let Some(ms) = app.try_state::<MonitorState>() {
                                            *ms.last_hash.lock().unwrap() = h;
                                        }
                                        let _ = app.emit("clipboard://new-item", &item);
                                    }
                                }
                            }
                        }
                        Err(_) => { /* empty / unsupported format */ }
                    }
                }
            }
        }
    });
}

fn spawn_janitor(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(120));
        let paths = resolve_paths(&app);
        let settings = load_settings(&paths);
        if let Ok(conn) = open_conn(&paths) {
            let _ = run_auto_delete(&conn, &settings.auto_delete);
            let _ = enforce_limits(&conn, settings.history_limit);
        }
    });
}

// ============================== Commands ==============================

#[tauri::command]
fn get_items(state: State<Paths>, limit: Option<i64>) -> Result<Vec<ClipboardItem>, String> {
    let conn = open_conn(&state).map_err(|e| e.to_string())?;
    fetch_items(&conn, limit.unwrap_or(1000).clamp(1, 5000)).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(state: State<Paths>) -> AppSettings {
    load_settings(&state)
}

#[tauri::command]
fn set_settings(app: AppHandle, state: State<Paths>, settings: AppSettings) -> Result<(), String> {
    let mut s = settings;
    // clamp history limit to allowed values
    if ![100, 500, 1000].contains(&s.history_limit) {
        s.history_limit = 500;
    }
    save_settings(&state, &s).map_err(|e| e.to_string())?;
    apply_autostart(&app, s.start_on_startup);
    register_shortcut(&app, &s.quick_paste_shortcut);
    // enforce limit immediately
    if let Ok(conn) = open_conn(&state) {
        let _ = enforce_limits(&conn, s.history_limit);
        let _ = run_auto_delete(&conn, &s.auto_delete);
    }
    let _ = app.emit("settings://changed", &s);
    Ok(())
}

#[tauri::command]
fn set_monitoring_paused(app: AppHandle, state: State<Paths>, paused: bool) -> Result<(), String> {
    let mut s = load_settings(&state);
    s.monitoring_paused = paused;
    save_settings(&state, &s).map_err(|e| e.to_string())?;
    let _ = app.emit("settings://changed", &s);
    // tray label update happens on next tray rebuild; emit event for frontend
    Ok(())
}

#[tauri::command]
fn copy_to_clipboard(app: AppHandle, state: State<Paths>, content: String) -> Result<(), String> {
    // mark self-copy window so monitor doesn't treat it as brand-new external copy loop
    if let Some(ms) = app.try_state::<MonitorState>() {
        *ms.self_copy_until.lock().unwrap() = Utc::now().timestamp_millis() + 600;
        *ms.last_hash.lock().unwrap() = sha256_hex(content.as_bytes());
    }
    // If content matches an image item label? Look up by content to copy image bytes when needed.
    let image_src: Option<String> = open_conn(&state)
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT image_path FROM clipboard_items WHERE content = ?1 AND content_type = 'image' LIMIT 1",
                params![content],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
        });
    // Also direct lookup: if content is an image label with path stored separately, handled above.
    if let Some(p) = image_src {
        if let Ok(bytes) = std::fs::read(&p) {
            if let Ok(dyn_img) = image::load_from_memory(&bytes) {
                let rgba = dyn_img.to_rgba8();
                let (w, h) = (rgba.width() as usize, rgba.height() as usize);
                let data = ImageData {
                    width: w,
                    height: h,
                    bytes: Cow::Owned(rgba.into_raw()),
                };
                if let Ok(mut cb) = Clipboard::new() {
                    cb.set_image(data).map_err(|e| e.to_string())?;
                    // touch duplicate timestamp
                    if let Ok(conn) = open_conn(&state) {
                        let now = Utc::now().timestamp_millis();
                        let _ = conn.execute(
                            "UPDATE clipboard_items SET last_copied_at = ?1 WHERE image_path = ?2",
                            params![now, p],
                        );
                        if let Ok(items) = fetch_items(&conn, 1000) {
                            let _ = app.emit("clipboard://list-changed", &items);
                        }
                    }
                    return Ok(());
                }
            }
        }
    }
    // image_path passed directly (picker passes content string; details passes content too).
    // Fallback: text copy via arboard (more reliable than plugin for large text).
    if let Ok(mut cb) = Clipboard::new() {
        cb.set_text(content.clone()).map_err(|e| e.to_string())?;
    } else {
        return Err("clipboard unavailable".into());
    }
    // update last_copied_at for duplicates (copy-back refresh)
    if let Ok(conn) = open_conn(&state) {
        let hash = sha256_hex(content.as_bytes());
        let now = Utc::now().timestamp_millis();
        let _ = conn.execute(
            "UPDATE clipboard_items SET last_copied_at = ?1 WHERE content_hash = ?2",
            params![now, hash],
        );
        if let Ok(items) = fetch_items(&conn, 1000) {
            let _ = app.emit("clipboard://list-changed", &items);
        }
    }
    Ok(())
}

#[tauri::command]
fn copy_item_by_id(app: AppHandle, state: State<Paths>, id: String) -> Result<(), String> {
    let (content, image_path): (String, Option<String>) = open_conn(&state)
        .map_err(|e| e.to_string())?
        .query_row(
            "SELECT content, image_path FROM clipboard_items WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    if let Some(p) = image_path {
        // copy image bytes
        if let Ok(bytes) = std::fs::read(&p) {
            if let Ok(dyn_img) = image::load_from_memory(&bytes) {
                let rgba = dyn_img.to_rgba8();
                let data = ImageData {
                    width: rgba.width() as usize,
                    height: rgba.height() as usize,
                    bytes: Cow::Owned(rgba.into_raw()),
                };
                if let Ok(mut cb) = Clipboard::new() {
                    let _ = cb.set_image(data);
                }
            }
        }
    } else if let Ok(mut cb) = Clipboard::new() {
        cb.set_text(content).map_err(|e| e.to_string())?;
    }
    if let Some(ms) = app.try_state::<MonitorState>() {
        *ms.self_copy_until.lock().unwrap() = Utc::now().timestamp_millis() + 600;
    }
    if let Ok(conn) = open_conn(&state) {
        let now = Utc::now().timestamp_millis();
        let _ = conn.execute(
            "UPDATE clipboard_items SET last_copied_at = ?1 WHERE id = ?2",
            params![now, id],
        );
        if let Ok(items) = fetch_items(&conn, 1000) {
            let _ = app.emit("clipboard://list-changed", &items);
        }
    }
    Ok(())
}

#[tauri::command]
fn paste_item_by_id(app: AppHandle, state: State<Paths>, id: String) -> Result<(), String> {
    // 1. Look up the item.
    let (content, image_path): (String, Option<String>) = open_conn(&state)
        .map_err(|e| e.to_string())?
        .query_row(
            "SELECT content, image_path FROM clipboard_items WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    // 2. Write it to the system clipboard (text or image).
    if let Some(p) = image_path {
        if let Ok(bytes) = std::fs::read(&p) {
            if let Ok(dyn_img) = image::load_from_memory(&bytes) {
                let rgba = dyn_img.to_rgba8();
                let data = ImageData {
                    width: rgba.width() as usize,
                    height: rgba.height() as usize,
                    bytes: Cow::Owned(rgba.into_raw()),
                };
                if let Ok(mut cb) = Clipboard::new() {
                    let _ = cb.set_image(data);
                }
            }
        }
    } else if let Ok(mut cb) = Clipboard::new() {
        cb.set_text(content.clone()).map_err(|e| e.to_string())?;
    } else {
        return Err("clipboard unavailable".into());
    }
    if let Some(ms) = app.try_state::<MonitorState>() {
        *ms.self_copy_until.lock().unwrap() = Utc::now().timestamp_millis() + 1500;
        *ms.last_hash.lock().unwrap() = sha256_hex(content.as_bytes());
    }

    // 3. Refresh last_copied_at + notify the UI.
    if let Ok(conn) = open_conn(&state) {
        let now = Utc::now().timestamp_millis();
        let _ = conn.execute(
            "UPDATE clipboard_items SET last_copied_at = ?1 WHERE id = ?2",
            params![now, id],
        );
        if let Ok(items) = fetch_items(&conn, 1000) {
            let _ = app.emit("clipboard://list-changed", &items);
        }
    }

    // 4. Hide the picker immediately so focus can return to the target app.
    if let Some(w) = app.get_webview_window("picker") {
        let _ = w.hide();
    }

    // 5. Auto-paste: restore the previous window, then send Ctrl/Cmd+V.
    //    Any failure here silently keeps the copy-only behavior.
    if load_settings(&state).paste_automatically {
        #[cfg(target_os = "windows")]
        {
            std::thread::sleep(Duration::from_millis(80));
            let target = app
                .try_state::<MonitorState>()
                .and_then(|ms| *ms.paste_target.lock().unwrap());
            if let Some(h) = target {
                win_focus::restore(h);
                std::thread::sleep(Duration::from_millis(120));
                let _ = send_paste_keys();
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::thread::sleep(Duration::from_millis(120));
            let _ = send_paste_keys();
        }
    }
    Ok(())
}

/// Image preview as a data URL, resized on demand with a size cap.
/// Only files inside our own images dir are served (traversal guard),
/// so a crafted DB row can never leak arbitrary local files to the UI.
#[tauri::command]
fn get_image_preview(
    state: State<Paths>,
    id: String,
    max_side: Option<u32>,
) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    use std::io::Cursor;

    let path: Option<String> = open_conn(&state)
        .map_err(|e| e.to_string())?
        .query_row(
            "SELECT image_path FROM clipboard_items WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let p = path.filter(|s| !s.is_empty()).ok_or("no image")?;
    let canonical = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
    let dir = std::fs::canonicalize(&state.images_dir).map_err(|e| e.to_string())?;
    if !canonical.starts_with(&dir) {
        return Err("forbidden".into());
    }
    let bytes = std::fs::read(&canonical).map_err(|e| e.to_string())?;
    let dyn_img = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
    let side = max_side.unwrap_or(320).clamp(32, 1024);
    // thumbnail() only shrinks, never enlarges — small images stay sharp.
    let thumb = dyn_img.thumbnail(side, side);
    let mut buf = Cursor::new(Vec::new());
    thumb
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/png;base64,{}",
        B64.encode(buf.into_inner())
    ))
}

#[tauri::command]
fn force_save_text(
    app: AppHandle,
    state: State<Paths>,
    content: String,
) -> Result<ClipboardItem, String> {
    // Explicit user consent ("Save once"): store even if sensitive.
    if content.trim().is_empty() || content.len() > 500_000 {
        return Err("empty content".into());
    }
    let conn = open_conn(&state).map_err(|e| e.to_string())?;
    let settings = load_settings(&state);
    let hash = sha256_hex(content.as_bytes());
    let now = Utc::now().timestamp_millis();
    if let Ok(item) = conn.query_row(
        "SELECT id, content, content_type, created_at, last_copied_at, is_pinned, is_sensitive, content_hash, char_count, word_count, image_path FROM clipboard_items WHERE content_hash = ?1",
        params![hash],
        row_to_item,
    ) as rusqlite::Result<ClipboardItem> {
        conn.execute(
            "UPDATE clipboard_items SET last_copied_at = ?1 WHERE id = ?2",
            params![now, item.id],
        )
        .map_err(|e| e.to_string())?;
        if let Ok(items) = fetch_items(&conn, 1000) {
            let _ = app.emit("clipboard://list-changed", &items);
        }
        return Ok(item);
    }
    let ctype = classify_content(&content);
    let (chars, words) = count_words_chars(&content);
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO clipboard_items (id, content, content_type, created_at, last_copied_at, is_pinned, is_sensitive, content_hash, char_count, word_count, image_path)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, 1, ?6, ?7, ?8, NULL)",
        params![id, content, ctype.as_str(), now, now, hash, chars, words],
    )
    .map_err(|e| e.to_string())?;
    let _ = enforce_limits(&conn, settings.history_limit);
    let item = ClipboardItem {
        id,
        content,
        content_type: ctype.as_str().to_string(),
        created_at: now,
        last_copied_at: now,
        is_pinned: false,
        is_sensitive: true,
        content_hash: hash,
        char_count: chars,
        word_count: words,
        image_path: None,
    };
    let _ = app.emit("clipboard://new-item", &item);
    Ok(item)
}

#[tauri::command]
fn toggle_pin(app: AppHandle, state: State<Paths>, id: String) -> Result<(), String> {
    let conn = open_conn(&state).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE clipboard_items SET is_pinned = 1 - is_pinned WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    if let Ok(items) = fetch_items(&conn, 1000) {
        let _ = app.emit("clipboard://list-changed", &items);
    }
    Ok(())
}

#[tauri::command]
fn delete_item(app: AppHandle, state: State<Paths>, id: String) -> Result<(), String> {
    let conn = open_conn(&state).map_err(|e| e.to_string())?;
    // remove image file if any
    let img: Option<String> = conn
        .query_row(
            "SELECT image_path FROM clipboard_items WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .ok()
        .flatten();
    conn.execute("DELETE FROM clipboard_items WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    if let Some(p) = img {
        // only delete file if no other item references it
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clipboard_items WHERE image_path = ?1",
                params![p],
                |r| r.get(0),
            )
            .unwrap_or(1);
        if count == 0 {
            let _ = std::fs::remove_file(p);
        }
    }
    if let Ok(items) = fetch_items(&conn, 1000) {
        let _ = app.emit("clipboard://list-changed", &items);
    }
    Ok(())
}

#[tauri::command]
fn clear_history(app: AppHandle, state: State<Paths>) -> Result<(), String> {
    let conn = open_conn(&state).map_err(|e| e.to_string())?;
    // delete image files of unpinned image items
    let paths: Vec<String> = conn
        .query_row("SELECT 1", [], |_| Ok(1))
        .ok()
        .map(|_| {
            conn.prepare("SELECT image_path FROM clipboard_items WHERE is_pinned = 0 AND image_path IS NOT NULL")
                .and_then(|mut s| s.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>())
                .unwrap_or_default()
        })
        .unwrap_or_default();
    conn.execute("DELETE FROM clipboard_items WHERE is_pinned = 0", [])
        .map_err(|e| e.to_string())?;
    for p in paths {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clipboard_items WHERE image_path = ?1",
                params![p],
                |r| r.get(0),
            )
            .unwrap_or(1);
        if count == 0 {
            let _ = std::fs::remove_file(p);
        }
    }
    if let Ok(items) = fetch_items(&conn, 1000) {
        let _ = app.emit("clipboard://list-changed", &items);
    }
    Ok(())
}

#[tauri::command]
fn delete_all_data(app: AppHandle, state: State<Paths>) -> Result<(), String> {
    let conn = open_conn(&state).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM clipboard_items", [])
        .map_err(|e| e.to_string())?;
    let _ = std::fs::remove_dir_all(&state.images_dir);
    let _ = std::fs::create_dir_all(&state.images_dir);
    let _ = std::fs::remove_file(&state.settings_path);
    let fresh = AppSettings {
        onboarding_done: true,
        ..Default::default()
    };
    let _ = save_settings(&state, &fresh);
    let _ = app.emit("clipboard://list-changed", &Vec::<ClipboardItem>::new());
    let _ = app.emit("settings://changed", &fresh);
    Ok(())
}

#[tauri::command]
fn show_picker(app: AppHandle) -> Result<(), String> {
    capture_paste_target(&app);
    if let Some(w) = app.get_webview_window("picker") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        w.center().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_picker(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("picker") {
        w.hide().map_err(|e| e.to_string())?;
    }
    // return focus to main? leave to OS so user can paste immediately
    Ok(())
}

#[derive(Serialize, Deserialize)]
struct BackupFile {
    version: u32,
    app: String,
    exported_at: i64,
    items: Vec<ClipboardItem>,
    settings: Option<AppSettings>,
}

#[tauri::command]
fn export_json(state: State<Paths>) -> Result<String, String> {
    let conn = open_conn(&state).map_err(|e| e.to_string())?;
    let items = fetch_items(&conn, 5000).map_err(|e| e.to_string())?;
    let settings = load_settings(&state);
    let backup = BackupFile {
        version: 1,
        app: "open-clip".into(),
        exported_at: Utc::now().timestamp_millis(),
        items,
        settings: Some(settings),
    };
    serde_json::to_string_pretty(&backup).map_err(|e| e.to_string())
}

#[tauri::command]
fn export_csv(state: State<Paths>) -> Result<String, String> {
    let conn = open_conn(&state).map_err(|e| e.to_string())?;
    let items = fetch_items(&conn, 5000).map_err(|e| e.to_string())?;
    let mut out = String::from("content,type,created_at,last_copied_at,pinned\n");
    for i in &items {
        let esc = i.content.replace('"', "\"\"");
        out.push_str(&format!(
            "\"{}\",{},{},{},{}\n",
            esc, i.content_type, i.created_at, i.last_copied_at, i.is_pinned
        ));
    }
    Ok(out)
}

#[tauri::command]
fn import_backup(app: AppHandle, state: State<Paths>, json: String) -> Result<u32, String> {
    let backup: BackupFile = serde_json::from_str(&json)
        .map_err(|_| "Invalid backup file. Version, schema or records check failed.".to_string())?;
    if backup.app != "open-clip" || backup.version != 1 {
        return Err("Invalid backup file. Version, schema or records check failed.".into());
    }
    if backup.items.len() > 5000 {
        return Err("Invalid backup file. Version, schema or records check failed.".into());
    }
    let conn = open_conn(&state).map_err(|e| e.to_string())?;
    let mut count = 0u32;
    for item in backup.items.into_iter().take(1000) {
        if item.content.len() > 500_000 {
            continue;
        }
        if item.id.is_empty() || item.content_hash.is_empty() {
            continue;
        }
        let ctype = ContentType::from_str(&item.content_type);
        conn.execute(
            "INSERT OR IGNORE INTO clipboard_items (id, content, content_type, created_at, last_copied_at, is_pinned, is_sensitive, content_hash, char_count, word_count, image_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                item.id,
                item.content,
                ctype.as_str(),
                item.created_at,
                item.last_copied_at,
                if item.is_pinned { 1 } else { 0 },
                if item.is_sensitive { 1 } else { 0 },
                item.content_hash,
                item.char_count,
                item.word_count,
                item.image_path,
            ],
        )
        .map_err(|e| e.to_string())?;
        count += 1;
    }
    if let Ok(items) = fetch_items(&conn, 1000) {
        let _ = app.emit("clipboard://list-changed", &items);
    }
    Ok(count)
}

// ============================== Shortcut / autostart ==============================

fn normalize_shortcut(s: &str) -> String {
    // Tauri global-shortcut expects e.g. "CommandOrControl+Shift+V".
    // Accept "Alt+V", "Ctrl+Shift+V" / "Cmd+Shift+V" and normalize.
    let t = s.trim();
    if t.eq_ignore_ascii_case("alt+v") {
        return "Alt+V".into();
    }
    if t.eq_ignore_ascii_case("ctrl+shift+v") || t.eq_ignore_ascii_case("commandorcontrol+shift+v")
    {
        return "CommandOrControl+Shift+V".into();
    }
    t.replace("Ctrl", "Control")
        .replace("ctrl", "Control")
        .replace("Cmd", "Command")
        .replace("cmd", "Command")
}

fn register_shortcut(app: &AppHandle, shortcut: &str) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let normalized = normalize_shortcut(shortcut);
    let api = app.global_shortcut();
    let _ = api.unregister_all();
    // Register only the configured shortcut (single source of truth).
    if !normalized.trim().is_empty() {
        let _ = api.register(normalized.as_str());
    }
}

fn apply_autostart(app: &AppHandle, enabled: bool) {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        if enabled {
            let _ = app.autolaunch().enable();
        } else {
            let _ = app.autolaunch().disable();
        }
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, enabled);
    }
}

fn toggle_picker(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("picker") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            capture_paste_target(app);
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.center();
        }
    }
}

// ============================== Tray ==============================

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::TrayIconBuilder;

    let open = MenuItem::with_id(app, "open", "Open Open Clip", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "Quick Paste", true, None::<&str>)?;
    let pause = MenuItem::with_id(
        app,
        "pause",
        "Pause / Resume Monitoring",
        true,
        None::<&str>,
    )?;
    let clear = MenuItem::with_id(app, "clear", "Clear History", true, None::<&str>)?;
    let prefs = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quick, &pause, &clear, &prefs, &quit])?;

    let mut builder = TrayIconBuilder::new().menu(&menu).tooltip("Open Clip");
    // Explicit icon keeps exactly one tray icon on all platforms.
    // Decode the bundled PNG with the `image` crate (PNG support is a
    // default feature there) instead of tauri's feature-gated helpers.
    if let Ok(dyn_img) = image::load_from_memory(include_bytes!("../icons/32x32.png")) {
        let rgba = dyn_img.to_rgba8();
        let (w, h) = (rgba.width(), rgba.height());
        builder = builder.icon(tauri::image::Image::new_owned(rgba.into_raw(), w, h));
    }
    let _tray = builder
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quick" => toggle_picker(app),
            "pause" => {
                let paths = resolve_paths(app);
                let mut s = load_settings(&paths);
                s.monitoring_paused = !s.monitoring_paused;
                let _ = save_settings(&paths, &s);
                let _ = app.emit("settings://changed", &s);
            }
            "clear" => {
                let paths = resolve_paths(app);
                if let Ok(conn) = open_conn(&paths) {
                    let _ = conn.execute("DELETE FROM clipboard_items WHERE is_pinned = 0", []);
                    if let Ok(items) = fetch_items(&conn, 1000) {
                        let _ = app.emit("clipboard://list-changed", &items);
                    }
                }
            }
            "settings" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                let _ = app.emit("openclip:show-settings", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::TrayIconEvent;
            if let TrayIconEvent::Click { button, .. } = event {
                if button == tauri::tray::MouseButton::Left {
                    let app = tray.app_handle();
                    if let Some(w) = app.get_webview_window("main") {
                        let visible = w.is_visible().unwrap_or(true);
                        if visible {
                            let _ = w.hide();
                        } else {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

// ============================== Main ==============================

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcuts(["Alt+V"])
                .unwrap_or_else(|_| tauri_plugin_global_shortcut::Builder::new())
                .with_handler(|app, _shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state == ShortcutState::Pressed {
                        toggle_picker(app);
                    }
                })
                .build(),
        )
        .manage(MonitorState {
            last_hash: Mutex::new(String::new()),
            self_copy_until: Mutex::new(0),
            paste_target: Mutex::new(None),
        })
        .setup(|app| {
            let paths = resolve_paths(app.handle());
            let _ = init_db(&paths.db_path);
            let settings = load_settings(&paths);
            app.manage(paths);
            // autostart reflect settings
            apply_autostart(app.handle(), settings.start_on_startup);
            register_shortcut(app.handle(), &settings.quick_paste_shortcut);
            let _ = build_tray(app.handle());
            // Background-first: main window stays hidden in the tray.
            // Always show on first run (onboarding) or when start-minimized is off.
            if !settings.onboarding_done || !settings.start_minimized {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            spawn_monitor(app.handle().clone());
            spawn_janitor(app.handle().clone());
            Ok(())
        })
        .on_window_event(|win, event| {
            if win.label() == "picker" {
                match event {
                    // Picker Esc/close just hides (never destroys the webview)
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = win.hide();
                    }
                    // Win+V-like behavior: click anywhere else dismisses the picker
                    tauri::WindowEvent::Focused(false) => {
                        let _ = win.hide();
                    }
                    _ => {}
                }
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // main window: minimize to tray if enabled (background-first)
                let app = win.app_handle();
                let paths = resolve_paths(app);
                let settings = load_settings(&paths);
                if settings.minimize_to_tray {
                    api.prevent_close();
                    let _ = win.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_items,
            get_settings,
            set_settings,
            set_monitoring_paused,
            copy_to_clipboard,
            copy_item_by_id,
            paste_item_by_id,
            get_image_preview,
            force_save_text,
            toggle_pin,
            delete_item,
            clear_history,
            delete_all_data,
            show_picker,
            hide_picker,
            export_json,
            export_csv,
            import_backup
        ]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running Open Clip");
}
