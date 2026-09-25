//! Arka uç mesajları için basit dil seçimi (arayüz dilini izler)

use std::sync::atomic::{AtomicBool, Ordering};

static EN: AtomicBool = AtomicBool::new(false);

pub fn set(lang: &str) {
    EN.store(lang == "en", Ordering::Relaxed);
}

/// Türkçe ve İngilizce metinden etkin dile uygun olanı döner
pub fn m(tr: &str, en: &str) -> String {
    if EN.load(Ordering::Relaxed) { en.to_string() } else { tr.to_string() }
}
