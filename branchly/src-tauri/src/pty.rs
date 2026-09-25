//! Gömülü terminal: portable-pty (Windows'ta ConPTY) + xterm.js

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

struct Session {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Mutex<HashMap<u32, Session>>,
    next: AtomicU32,
}

#[derive(Serialize, Clone)]
pub struct Shell {
    pub id: String,
    pub name: String,
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Serialize, Clone)]
struct DataEvent {
    id: u32,
    data: String,
}

pub fn list_shells() -> Vec<Shell> {
    let mut list = vec![];
    #[cfg(windows)]
    {
        use std::path::PathBuf;
        let env = |k: &str| std::env::var(k).ok();
        let mut git_bash: Vec<PathBuf> = vec![];
        for base in [env("ProgramW6432"), env("ProgramFiles"), env("ProgramFiles(x86)")].into_iter().flatten() {
            git_bash.push(PathBuf::from(base).join("Git").join("bin").join("bash.exe"));
        }
        if let Some(l) = env("LOCALAPPDATA") {
            git_bash.push(PathBuf::from(l).join("Programs").join("Git").join("bin").join("bash.exe"));
        }
        if let Some(p) = git_bash.into_iter().find(|p| p.exists()) {
            list.push(Shell { id: "gitbash".into(), name: "Git Bash".into(), program: p.to_string_lossy().into(), args: vec!["--login".into(), "-i".into()] });
        }
        let mut pwsh: Vec<PathBuf> = vec![];
        for base in [env("ProgramW6432"), env("ProgramFiles")].into_iter().flatten() {
            pwsh.push(PathBuf::from(base).join("PowerShell").join("7").join("pwsh.exe"));
        }
        if let Some(p) = pwsh.into_iter().find(|p| p.exists()) {
            list.push(Shell { id: "pwsh".into(), name: "PowerShell 7".into(), program: p.to_string_lossy().into(), args: vec!["-NoLogo".into()] });
        }
        let root = env("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        list.push(Shell {
            id: "powershell".into(),
            name: "Windows PowerShell".into(),
            program: format!("{root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"),
            args: vec!["-NoLogo".into()],
        });
        list.push(Shell { id: "cmd".into(), name: crate::i18n::m("Komut İstemi", "Command Prompt"), program: format!("{root}\\System32\\cmd.exe"), args: vec![] });
        let wsl = format!("{root}\\System32\\wsl.exe");
        if std::path::Path::new(&wsl).exists() {
            list.push(Shell { id: "wsl".into(), name: "WSL".into(), program: wsl, args: vec![] });
        }
    }
    #[cfg(not(windows))]
    {
        let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
        let name = std::path::Path::new(&sh).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or("shell".into());
        list.push(Shell { id: "default".into(), name, program: sh.clone(), args: vec!["-l".into()] });
        for extra in ["/bin/bash", "/bin/zsh"] {
            if extra != sh && std::path::Path::new(extra).exists() {
                let n = extra.rsplit('/').next().unwrap().to_string();
                list.push(Shell { id: n.clone(), name: n, program: extra.into(), args: vec!["-l".into()] });
            }
        }
    }
    list
}

pub fn spawn(app: AppHandle, state: &PtyState, program: String, args: Vec<String>, cwd: String, cols: u16, rows: u16) -> Result<u32, String> {
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;
    let mut cmd = CommandBuilder::new(&program);
    cmd.args(&args);
    if !cwd.is_empty() {
        cmd.cwd(&cwd);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // Git Bash'in giriş sırasında ev dizinine gitmesini engelle
    cmd.env("CHERE_INVOKING", "1");
    // Türkçe karakterlerin terminalde doğru görünmesi için UTF-8 varsayılanı
    if std::env::var("LANG").map(|v| !v.to_uppercase().contains("UTF")).unwrap_or(true) {
        cmd.env("LANG", "C.UTF-8");
    }
    cmd.env("LESSCHARSET", "utf-8");
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("{}: {e}", crate::i18n::m("Kabuk başlatılamadı", "Could not start shell")))?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = state.next.fetch_add(1, Ordering::SeqCst) + 1;
    state.sessions.lock().unwrap().insert(id, Session { master: pair.master, writer, child });

    std::thread::spawn(move || {
        let mut buf = [0u8; 16384];
        let mut carry: Vec<u8> = vec![];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    // Yarım kalmış UTF-8 dizilerini bir sonraki okumaya taşı
                    let valid = match std::str::from_utf8(&carry) {
                        Ok(_) => carry.len(),
                        Err(e) => {
                            if e.error_len().is_some() {
                                carry.len()
                            } else {
                                e.valid_up_to()
                            }
                        }
                    };
                    let chunk: Vec<u8> = carry.drain(..valid).collect();
                    if !chunk.is_empty() {
                        let data = String::from_utf8_lossy(&chunk).to_string();
                        let _ = app.emit("pty-data", DataEvent { id, data });
                    }
                }
            }
        }
        let _ = app.emit("pty-exit", id);
    });
    Ok(id)
}

pub fn write(state: &PtyState, id: u32, data: &str) -> Result<(), String> {
    let mut s = state.sessions.lock().unwrap();
    let sess = s.get_mut(&id).ok_or_else(|| crate::i18n::m("Terminal oturumu bulunamadı", "Terminal session not found"))?;
    sess.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    sess.writer.flush().map_err(|e| e.to_string())
}

pub fn resize(state: &PtyState, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let s = state.sessions.lock().unwrap();
    let sess = s.get(&id).ok_or_else(|| crate::i18n::m("Terminal oturumu bulunamadı", "Terminal session not found"))?;
    sess.master
        .resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

pub fn kill(state: &PtyState, id: u32) -> Result<(), String> {
    if let Some(mut sess) = state.sessions.lock().unwrap().remove(&id) {
        let _ = sess.child.kill();
    }
    Ok(())
}
