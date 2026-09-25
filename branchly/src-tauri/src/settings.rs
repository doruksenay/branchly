//! Basit JSON ayar dosyası (%APPDATA%\app.branchly.desktop\settings.json)

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

fn path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

pub fn load(app: &AppHandle) -> Value {
    let v = path(app).and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str::<Value>(&s).ok());
    match v {
        Some(v) if v.is_object() => v,
        _ => json!({}),
    }
}

pub fn save(app: &AppHandle, v: &Value) -> Result<(), String> {
    let p = path(app).ok_or_else(|| crate::i18n::m("Ayar klasörü bulunamadı", "Settings folder not found"))?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, serde_json::to_string_pretty(v).unwrap()).map_err(|e| e.to_string())
}
