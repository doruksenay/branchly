//! Dosya gezgini, dosya önizleme, harici editör ve depo izleme.

use crate::git;
use notify::{RecursiveMode, Watcher};
use serde::Serialize;
use std::path::Path;
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Serialize)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub ignored: bool,
}

pub fn list_dir(repo: &str, rel: &str) -> Result<Vec<DirEntry>, String> {
    let dir = if rel.is_empty() { Path::new(repo).to_path_buf() } else { git::safe_join(repo, rel)? };
    let rd = std::fs::read_dir(&dir).map_err(|e| format!("{}: {e}", crate::i18n::m("Klasör okunamadı", "Could not read folder")))?;
    let mut entries: Vec<DirEntry> = vec![];
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        if name == ".git" {
            continue;
        }
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let path = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
        entries.push(DirEntry { name, path, is_dir, ignored: false });
    }
    // .gitignore ile yok sayılanları işaretle
    if !entries.is_empty() {
        let input: String = entries
            .iter()
            .map(|e| if e.is_dir { format!("{}/", e.path) } else { e.path.clone() })
            .collect::<Vec<_>>()
            .join("\0");
        let args: Vec<String> = vec!["check-ignore".into(), "-z".into(), "--stdin".into()];
        if let Ok(r) = git::run_raw(repo, &args, Some(input.as_bytes())) {
            let out = String::from_utf8_lossy(&r.stdout).to_string();
            for p in out.split('\0').filter(|s| !s.is_empty()) {
                let p = p.trim_end_matches('/');
                if let Some(e) = entries.iter_mut().find(|e| e.path == p) {
                    e.ignored = true;
                }
            }
        }
    }
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(entries)
}

#[derive(Serialize)]
pub struct FileContent {
    pub content: String,
    pub binary: bool,
    pub too_large: bool,
    pub size: u64,
}

pub fn read_file(repo: &str, rel: &str) -> Result<FileContent, String> {
    let full = git::safe_join(repo, rel)?;
    let meta = std::fs::metadata(&full).map_err(|e| e.to_string())?;
    let size = meta.len();
    if size > 2 * 1024 * 1024 {
        return Ok(FileContent { content: String::new(), binary: false, too_large: true, size });
    }
    let data = std::fs::read(&full).map_err(|e| e.to_string())?;
    if data.iter().take(8000).any(|b| *b == 0) {
        return Ok(FileContent { content: String::new(), binary: true, too_large: false, size });
    }
    Ok(FileContent { content: String::from_utf8_lossy(&data).to_string(), binary: false, too_large: false, size })
}

pub fn open_in_editor(repo: &str, rel: &str, editor: &str) -> Result<(), String> {
    let full = if rel.is_empty() { Path::new(repo).to_path_buf() } else { git::safe_join(repo, rel)? };
    let editor = if editor.trim().is_empty() { "code" } else { editor.trim() };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // "code" gibi .cmd betikleri doğrudan çalıştırılamadığı için cmd üzerinden başlat.
        std::process::Command::new("cmd")
            .args(["/C", editor])
            .arg(&full)
            .current_dir(repo)
            .creation_flags(0x0800_0000)
            .spawn()
            .map_err(|e| format!("{}: {e}", crate::i18n::m("Editör açılamadı", "Could not open editor")))?;
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new(editor)
            .arg(&full)
            .current_dir(repo)
            .spawn()
            .map_err(|e| format!("{}: {e}", crate::i18n::m("Editör açılamadı", "Could not open editor")))?;
    }
    Ok(())
}

pub fn reveal(repo: &str, rel: &str) -> Result<(), String> {
    let full = if rel.is_empty() { Path::new(repo).to_path_buf() } else { git::safe_join(repo, rel)? };
    tauri_plugin_opener::reveal_item_in_dir(&full).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// İzleyici: terminalden veya dış araçlardan yapılan değişikliklerde arayüzü yeniler
// ---------------------------------------------------------------------------

pub struct WatchState {
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

pub fn watch(app: AppHandle, state: &WatchState, repo: String) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| e.to_string())?;
    watcher.watch(Path::new(&repo), RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    // Önceki izleyiciyi bırak (kanalı kapanınca iş parçacığı da sonlanır).
    *state.watcher.lock().unwrap() = Some(watcher);

    std::thread::spawn(move || {
        loop {
            let ev = match rx.recv() {
                Ok(ev) => ev,
                Err(_) => break,
            };
            let mut relevant = is_relevant(&ev);
            // Kısa süre içinde gelen olayları topla
            loop {
                match rx.recv_timeout(Duration::from_millis(350)) {
                    Ok(ev) => relevant |= is_relevant(&ev),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            if relevant {
                let _ = app.emit("repo-changed", repo.clone());
            }
        }
    });
    Ok(())
}

fn is_relevant(ev: &notify::Result<notify::Event>) -> bool {
    let Ok(ev) = ev else { return false };
    if matches!(ev.kind, notify::EventKind::Access(_)) {
        return false;
    }
    ev.paths.iter().any(|p| {
        let s = p.to_string_lossy().replace('\\', "/");
        if let Some(idx) = s.find("/.git/") {
            let inner = &s[idx + 6..];
            // Nesne veritabanı ve kilit dosyaları gürültüdür
            !(inner.starts_with("objects/") || inner.ends_with(".lock") || inner.starts_with("logs/"))
        } else {
            !s.contains("/node_modules/")
        }
    })
}
