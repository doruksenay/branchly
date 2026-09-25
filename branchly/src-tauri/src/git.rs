//! Git işlemleri. Okuma/yazma için sistemdeki `git` çalıştırılabilir dosyası kullanılır;
//! böylece hook'lar, SSH ayarları ve Git Credential Manager olduğu gibi çalışır.

use serde::Serialize;
use std::collections::VecDeque;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ---------------------------------------------------------------------------
// Komut günlüğü ("Git komutlarını göster")
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
pub struct CmdLogEntry {
    pub time: u64,
    pub cmd: String,
    pub ok: bool,
    pub ms: u64,
}

static CMD_LOG: Mutex<VecDeque<CmdLogEntry>> = Mutex::new(VecDeque::new());

fn log_cmd(args: &[String], ok: bool, ms: u64) {
    // Uygulamanın her yenilemede çalıştırdığı okuma komutlarını günlüğe yazma.
    let first = args.first().map(|s| s.as_str()).unwrap_or("");
    let read_only = matches!(
        first,
        "status" | "log" | "for-each-ref" | "rev-parse" | "diff" | "show" | "ls-files" | "cat-file" | "merge-file"
            | "check-ignore" | "diff-tree" | "remote" | "config" | "version"
    ) || (first == "stash" && args.get(1).map(|s| s == "list").unwrap_or(false));
    if read_only {
        return;
    }
    let cmd = format!("git {}", args.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" "));
    let time = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let mut log = CMD_LOG.lock().unwrap();
    log.push_back(CmdLogEntry { time, cmd, ok, ms });
    while log.len() > 200 {
        log.pop_front();
    }
}

fn quote(a: &str) -> String {
    if a.is_empty() || a.contains(' ') || a.contains('"') {
        format!("\"{}\"", a.replace('"', "\\\""))
    } else {
        a.to_string()
    }
}

pub fn cmd_log() -> Vec<CmdLogEntry> {
    CMD_LOG.lock().unwrap().iter().cloned().collect()
}

// ---------------------------------------------------------------------------
// Çalıştırma
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
pub struct RunResult {
    pub ok: bool,
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

pub struct RawOut {
    pub code: i32,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

pub fn git_command(repo: &str) -> Command {
    let mut cmd = Command::new("git");
    if !repo.is_empty() {
        cmd.current_dir(repo);
    }
    cmd.env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_EDITOR", "true")
        .env("GIT_SEQUENCE_EDITOR", "true")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .env("LC_ALL", "C")
        .env("LANG", "C");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

pub fn run_raw(repo: &str, args: &[String], stdin: Option<&[u8]>) -> Result<RawOut, String> {
    let mut full: Vec<String> = vec![
        "-c".into(),
        "core.quotepath=false".into(),
        "-c".into(),
        "color.ui=false".into(),
    ];
    full.extend(args.iter().cloned());
    let started = Instant::now();
    let mut cmd = git_command(repo);
    cmd.args(&full)
        .stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            crate::i18n::m("Git bulunamadı. Lütfen Git for Windows'u kurun (https://git-scm.com).", "Git not found. Please install Git for Windows (https://git-scm.com).")
        } else {
            format!("{}: {e}", crate::i18n::m("git çalıştırılamadı", "Could not run git"))
        }
    })?;
    if let Some(data) = stdin {
        if let Some(mut s) = child.stdin.take() {
            let data = data.to_vec();
            // Büyük girdilerde kilitlenmeyi önlemek için ayrı iş parçacığında yaz.
            std::thread::spawn(move || {
                let _ = s.write_all(&data);
            });
        }
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let code = out.status.code().unwrap_or(-1);
    log_cmd(args, code == 0, started.elapsed().as_millis() as u64);
    Ok(RawOut { code, stdout: out.stdout, stderr: String::from_utf8_lossy(&out.stderr).to_string() })
}

pub fn run(repo: &str, args: &[&str]) -> Result<RunResult, String> {
    let a: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let r = run_raw(repo, &a, None)?;
    Ok(RunResult {
        ok: r.code == 0,
        code: r.code,
        stdout: String::from_utf8_lossy(&r.stdout).to_string(),
        stderr: r.stderr,
    })
}

/// Başarılıysa stdout'u, değilse stderr'i hata olarak döner.
pub fn ok(repo: &str, args: &[&str]) -> Result<String, String> {
    let r = run(repo, args)?;
    if r.ok {
        Ok(r.stdout)
    } else {
        Err(if r.stderr.trim().is_empty() { r.stdout } else { r.stderr })
    }
}

pub fn ok_bytes(repo: &str, args: &[&str]) -> Result<Vec<u8>, String> {
    let a: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let r = run_raw(repo, &a, None)?;
    if r.code == 0 {
        Ok(r.stdout)
    } else {
        Err(r.stderr)
    }
}

// ---------------------------------------------------------------------------
// Depo
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct RepoInfo {
    pub root: String,
    pub name: String,
}

pub fn open_repo(path: &str) -> Result<RepoInfo, String> {
    let out = ok(path, &["rev-parse", "--show-toplevel"]).map_err(|_| crate::i18n::m("Bu klasör bir Git repository'si değil.", "This folder is not a Git repository."))?;
    let root = out.trim().to_string();
    let root = if cfg!(windows) { root.replace('/', "\\") } else { root };
    let name = Path::new(&root).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| root.clone());
    Ok(RepoInfo { root, name })
}

pub fn git_dir(repo: &str) -> Result<PathBuf, String> {
    let out = ok(repo, &["rev-parse", "--absolute-git-dir"])?;
    Ok(PathBuf::from(out.trim()))
}

// ---------------------------------------------------------------------------
// Durum
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone)]
pub struct FileStatus {
    pub path: String,
    pub orig_path: Option<String>,
    /// İndeks (stage) durumu: M A D R C U ya da '.'
    pub x: String,
    /// Çalışma dizini durumu
    pub y: String,
    pub conflict: bool,
    pub untracked: bool,
}

#[derive(Serialize, Debug, Default)]
pub struct StatusInfo {
    pub branch: Option<String>,
    pub oid: Option<String>,
    pub upstream: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub files: Vec<FileStatus>,
}

pub fn status(repo: &str) -> Result<StatusInfo, String> {
    let raw = ok_bytes(repo, &["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"])?;
    Ok(parse_status(&String::from_utf8_lossy(&raw)))
}

pub fn parse_status(s: &str) -> StatusInfo {
    let mut info = StatusInfo::default();
    let mut tokens = s.split('\0').peekable();
    while let Some(tok) = tokens.next() {
        if tok.is_empty() {
            continue;
        }
        if let Some(h) = tok.strip_prefix("# ") {
            if let Some(v) = h.strip_prefix("branch.head ") {
                info.branch = if v == "(detached)" { None } else { Some(v.to_string()) };
            } else if let Some(v) = h.strip_prefix("branch.oid ") {
                info.oid = if v == "(initial)" { None } else { Some(v.to_string()) };
            } else if let Some(v) = h.strip_prefix("branch.upstream ") {
                info.upstream = Some(v.to_string());
            } else if let Some(v) = h.strip_prefix("branch.ab ") {
                for part in v.split(' ') {
                    if let Some(n) = part.strip_prefix('+') {
                        info.ahead = n.parse().unwrap_or(0);
                    } else if let Some(n) = part.strip_prefix('-') {
                        info.behind = n.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }
        let kind = tok.chars().next().unwrap_or(' ');
        match kind {
            '1' => {
                let p: Vec<&str> = tok.splitn(9, ' ').collect();
                if p.len() == 9 {
                    let xy: Vec<char> = p[1].chars().collect();
                    info.files.push(FileStatus {
                        path: p[8].to_string(),
                        orig_path: None,
                        x: xy[0].to_string(),
                        y: xy[1].to_string(),
                        conflict: false,
                        untracked: false,
                    });
                }
            }
            '2' => {
                let p: Vec<&str> = tok.splitn(10, ' ').collect();
                let orig = tokens.next().map(|s| s.to_string());
                if p.len() == 10 {
                    let xy: Vec<char> = p[1].chars().collect();
                    info.files.push(FileStatus {
                        path: p[9].to_string(),
                        orig_path: orig,
                        x: xy[0].to_string(),
                        y: xy[1].to_string(),
                        conflict: false,
                        untracked: false,
                    });
                }
            }
            'u' => {
                let p: Vec<&str> = tok.splitn(11, ' ').collect();
                if p.len() == 11 {
                    let xy: Vec<char> = p[1].chars().collect();
                    info.files.push(FileStatus {
                        path: p[10].to_string(),
                        orig_path: None,
                        x: xy[0].to_string(),
                        y: xy[1].to_string(),
                        conflict: true,
                        untracked: false,
                    });
                }
            }
            '?' => info.files.push(FileStatus {
                path: tok[2..].to_string(),
                orig_path: None,
                x: "?".into(),
                y: "?".into(),
                conflict: false,
                untracked: true,
            }),
            _ => {}
        }
    }
    info
}

// ---------------------------------------------------------------------------
// Geçmiş
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug)]
pub struct Commit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub subject: String,
    pub refs: Vec<String>,
}

pub fn log(repo: &str, limit: u32, skip: u32, all: bool, path: Option<String>) -> Result<Vec<Commit>, String> {
    let mut args: Vec<String> = vec![
        "log".into(),
        "--date-order".into(),
        format!("-n{limit}"),
        format!("--skip={skip}"),
        "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D%x1e".into(),
    ];
    if all {
        args.push("--branches".into());
        args.push("--remotes".into());
        args.push("--tags".into());
    }
    args.push("HEAD".into());
    if let Some(p) = path {
        args.push("--".into());
        args.push(p);
    }
    let r = run_raw(repo, &args, None)?;
    if r.code != 0 {
        // Henüz commit olmayan depo
        if r.stderr.contains("does not have any commits") || r.stderr.contains("unknown revision") || r.stderr.contains("bad default revision") {
            return Ok(vec![]);
        }
        return Err(r.stderr);
    }
    Ok(parse_log(&String::from_utf8_lossy(&r.stdout)))
}

pub fn parse_log(s: &str) -> Vec<Commit> {
    s.split('\x1e')
        .filter_map(|rec| {
            let rec = rec.trim_start_matches('\n');
            if rec.is_empty() {
                return None;
            }
            let f: Vec<&str> = rec.split('\x1f').collect();
            if f.len() < 7 {
                return None;
            }
            Some(Commit {
                hash: f[0].to_string(),
                parents: f[1].split(' ').filter(|p| !p.is_empty()).map(|p| p.to_string()).collect(),
                author: f[2].to_string(),
                email: f[3].to_string(),
                time: f[4].parse().unwrap_or(0),
                subject: f[5].to_string(),
                refs: f[6].split(", ").filter(|r| !r.is_empty()).map(|r| r.trim().to_string()).collect(),
            })
        })
        .collect()
}

#[derive(Serialize, Debug)]
pub struct ChangedFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub added: i64,
    pub deleted: i64,
}

#[derive(Serialize, Debug)]
pub struct CommitDetail {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub body: String,
    pub files: Vec<ChangedFile>,
}

pub fn commit_detail(repo: &str, hash: &str) -> Result<CommitDetail, String> {
    let head = ok(repo, &["show", "-s", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%B", hash])?;
    let f: Vec<&str> = head.splitn(6, '\x1f').collect();
    if f.len() < 6 {
        return Err(crate::i18n::m("Commit okunamadı", "Could not read commit"));
    }
    let parents: Vec<String> = f[1].split(' ').filter(|p| !p.is_empty()).map(|s| s.to_string()).collect();
    let (ns, st) = if parents.is_empty() {
        (
            ok_bytes(repo, &["diff-tree", "--no-commit-id", "-r", "--root", "-M", "--numstat", "-z", hash])?,
            ok_bytes(repo, &["diff-tree", "--no-commit-id", "-r", "--root", "-M", "--name-status", "-z", hash])?,
        )
    } else {
        let base = format!("{hash}^1");
        (
            ok_bytes(repo, &["diff", "-M", "--numstat", "-z", &base, hash])?,
            ok_bytes(repo, &["diff", "-M", "--name-status", "-z", &base, hash])?,
        )
    };
    let files = merge_numstat(&String::from_utf8_lossy(&ns), &String::from_utf8_lossy(&st));
    Ok(CommitDetail {
        hash: f[0].to_string(),
        parents,
        author: f[2].to_string(),
        email: f[3].to_string(),
        time: f[4].parse().unwrap_or(0),
        body: f[5].trim_end().to_string(),
        files,
    })
}

fn merge_numstat(numstat: &str, namestatus: &str) -> Vec<ChangedFile> {
    // name-status -z: "M\0path\0" veya "R100\0old\0new\0"
    let mut statuses: Vec<(String, String, Option<String>)> = vec![];
    let mut it = namestatus.split('\0').filter(|s| !s.is_empty());
    while let Some(code) = it.next() {
        let letter = code.chars().next().unwrap_or('M').to_string();
        if letter == "R" || letter == "C" {
            let old = it.next().unwrap_or("").to_string();
            let new = it.next().unwrap_or("").to_string();
            statuses.push((letter, new, Some(old)));
        } else {
            let p = it.next().unwrap_or("").to_string();
            statuses.push((letter, p, None));
        }
    }
    // numstat -z: "a\td\tpath\0" veya yeniden adlandırmada "a\td\t\0old\0new\0"
    let mut counts: Vec<(i64, i64)> = vec![];
    let mut it = numstat.split('\0');
    while let Some(rec) = it.next() {
        if rec.is_empty() {
            continue;
        }
        let parts: Vec<&str> = rec.splitn(3, '\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let a = parts[0].parse().unwrap_or(-1);
        let d = parts[1].parse().unwrap_or(-1);
        if parts[2].is_empty() {
            it.next();
            it.next();
        }
        counts.push((a, d));
    }
    statuses
        .into_iter()
        .enumerate()
        .map(|(i, (status, path, old))| {
            let (a, d) = counts.get(i).cloned().unwrap_or((0, 0));
            ChangedFile { path, old_path: old, status, added: a, deleted: d }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Dallar, stash, işlem durumu
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug)]
pub struct Branch {
    pub kind: String,
    pub name: String,
    pub full: String,
    pub short_oid: String,
    pub upstream: Option<String>,
    pub ahead: i64,
    pub behind: i64,
    pub head: bool,
    pub time: i64,
}

pub fn branches(repo: &str) -> Result<Vec<Branch>, String> {
    let out = ok(
        repo,
        &[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname)%1f%(refname:short)%1f%(objectname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(HEAD)%1f%(committerdate:unix)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    let mut list = vec![];
    for line in out.lines() {
        let f: Vec<&str> = line.split('\x1f').collect();
        if f.len() < 7 {
            continue;
        }
        let full = f[0];
        let kind = if full.starts_with("refs/heads/") {
            "local"
        } else if full.starts_with("refs/remotes/") {
            if full.ends_with("/HEAD") {
                continue;
            }
            "remote"
        } else {
            "tag"
        };
        let (mut ahead, mut behind) = (0, 0);
        let track = f[4].trim_matches(|c| c == '[' || c == ']');
        for part in track.split(", ") {
            if let Some(n) = part.strip_prefix("ahead ") {
                ahead = n.parse().unwrap_or(0);
            } else if let Some(n) = part.strip_prefix("behind ") {
                behind = n.parse().unwrap_or(0);
            }
        }
        list.push(Branch {
            kind: kind.into(),
            name: f[1].to_string(),
            full: full.to_string(),
            short_oid: f[2].to_string(),
            upstream: if f[3].is_empty() { None } else { Some(f[3].to_string()) },
            ahead,
            behind,
            head: f[5] == "*",
            time: f[6].parse().unwrap_or(0),
        });
    }
    Ok(list)
}

#[derive(Serialize, Debug)]
pub struct Stash {
    pub name: String,
    pub message: String,
    pub time: i64,
}

pub fn stashes(repo: &str) -> Result<Vec<Stash>, String> {
    let r = run(repo, &["stash", "list", "--format=%gd%x1f%s%x1f%ct"])?;
    if !r.ok {
        return Ok(vec![]);
    }
    Ok(r
        .stdout
        .lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\x1f').collect();
            if f.len() < 3 {
                return None;
            }
            Some(Stash { name: f[0].into(), message: f[1].into(), time: f[2].parse().unwrap_or(0) })
        })
        .collect())
}

#[derive(Serialize, Debug)]
pub struct OpState {
    /// none | merge | cherry-pick | revert | rebase
    pub kind: String,
    pub head: Option<String>,
    pub subject: Option<String>,
    pub step: Option<u32>,
    pub total: Option<u32>,
}

pub fn op_state(repo: &str) -> Result<OpState, String> {
    let gd = git_dir(repo)?;
    let read = |p: &Path| std::fs::read_to_string(p).ok().map(|s| s.trim().to_string());
    let subject_of = |rev: &str| ok(repo, &["show", "-s", "--format=%s", rev]).ok().map(|s| s.trim().to_string());
    if let Some(h) = read(&gd.join("CHERRY_PICK_HEAD")) {
        return Ok(OpState { kind: "cherry-pick".into(), subject: subject_of(&h), head: Some(h), step: None, total: None });
    }
    if let Some(h) = read(&gd.join("REVERT_HEAD")) {
        return Ok(OpState { kind: "revert".into(), subject: subject_of(&h), head: Some(h), step: None, total: None });
    }
    if let Some(h) = read(&gd.join("MERGE_HEAD")) {
        let msg = read(&gd.join("MERGE_MSG")).and_then(|m| m.lines().next().map(|s| s.to_string()));
        return Ok(OpState { kind: "merge".into(), subject: msg, head: Some(h), step: None, total: None });
    }
    for dir in ["rebase-merge", "rebase-apply"] {
        let d = gd.join(dir);
        if d.is_dir() {
            let step = read(&d.join("msgnum")).or_else(|| read(&d.join("next"))).and_then(|s| s.parse().ok());
            let total = read(&d.join("end")).or_else(|| read(&d.join("last"))).and_then(|s| s.parse().ok());
            let head = read(&d.join("stopped-sha")).or_else(|| read(&gd.join("REBASE_HEAD")));
            let subject = head.as_deref().and_then(subject_of);
            return Ok(OpState { kind: "rebase".into(), head, subject, step, total });
        }
    }
    Ok(OpState { kind: "none".into(), head: None, subject: None, step: None, total: None })
}

// ---------------------------------------------------------------------------
// Diff ve kısmi staging
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct DiffResult {
    pub text: String,
    pub binary: bool,
    pub too_large: bool,
}

const MAX_DIFF: usize = 3 * 1024 * 1024;

pub fn diff_file(repo: &str, path: &str, staged: bool, untracked: bool) -> Result<DiffResult, String> {
    if untracked {
        return untracked_diff(repo, path);
    }
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-U3"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(path);
    let bytes = ok_bytes(repo, &args)?;
    finish_diff(bytes)
}

pub fn commit_file_diff(repo: &str, hash: &str, path: &str, parent_count: usize) -> Result<DiffResult, String> {
    let bytes = if parent_count == 0 {
        ok_bytes(repo, &["show", "--format=", "--no-color", "--no-ext-diff", "-M", hash, "--", path])?
    } else {
        let base = format!("{hash}^1");
        ok_bytes(repo, &["diff", "--no-color", "--no-ext-diff", "-M", &base, hash, "--", path])?
    };
    finish_diff(bytes)
}

fn finish_diff(bytes: Vec<u8>) -> Result<DiffResult, String> {
    let text = String::from_utf8_lossy(&bytes).to_string();
    let binary = text.lines().any(|l| l.starts_with("Binary files ") || l == "GIT binary patch");
    Ok(DiffResult { too_large: bytes.len() > MAX_DIFF, text: if bytes.len() > MAX_DIFF { String::new() } else { text }, binary })
}

fn untracked_diff(repo: &str, path: &str) -> Result<DiffResult, String> {
    let full = Path::new(repo).join(path);
    let data = std::fs::read(&full).map_err(|e| format!("{}: {e}", crate::i18n::m("Dosya okunamadı", "Could not read file")))?;
    if data.len() > MAX_DIFF {
        return Ok(DiffResult { text: String::new(), binary: false, too_large: true });
    }
    if data.iter().take(8000).any(|b| *b == 0) {
        return Ok(DiffResult { text: String::new(), binary: true, too_large: false });
    }
    let text = String::from_utf8_lossy(&data);
    let mut lines: Vec<&str> = text.split('\n').collect();
    let no_newline = !text.is_empty() && !text.ends_with('\n');
    if !no_newline {
        lines.pop();
    }
    let mut out = format!("diff --git a/{path} b/{path}\nnew file mode 100644\n--- /dev/null\n+++ b/{path}\n");
    if !lines.is_empty() {
        out.push_str(&format!("@@ -0,0 +1,{} @@\n", lines.len()));
        for l in &lines {
            out.push('+');
            out.push_str(l);
            out.push('\n');
        }
        if no_newline {
            out.push_str("\\ No newline at end of file\n");
        }
    }
    Ok(DiffResult { text: out, binary: false, too_large: false })
}

pub fn apply_patch(repo: &str, patch: &str, cached: bool, reverse: bool) -> Result<(), String> {
    let mut args: Vec<String> = vec!["apply".into(), "--recount".into(), "--whitespace=nowarn".into()];
    if cached {
        args.push("--cached".into());
    }
    if reverse {
        args.push("-R".into());
    }
    args.push("-".into());
    let r = run_raw(repo, &args, Some(patch.as_bytes()))?;
    if r.code == 0 {
        Ok(())
    } else {
        Err(r.stderr)
    }
}

/// Çalışma dizinindeki değişiklikleri geri alır; takip edilmeyen dosyaları siler.
pub fn discard(repo: &str, paths: &[String], untracked: &[String]) -> Result<(), String> {
    if !paths.is_empty() {
        let mut args: Vec<String> = vec!["checkout".into(), "--".into()];
        args.extend(paths.iter().cloned());
        let r = run_raw(repo, &args, None)?;
        if r.code != 0 {
            return Err(r.stderr);
        }
    }
    for p in untracked {
        let full = safe_join(repo, p)?;
        if full.is_dir() {
            std::fs::remove_dir_all(&full).map_err(|e| e.to_string())?;
        } else {
            std::fs::remove_file(&full).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn safe_join(repo: &str, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() || rel_path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err(crate::i18n::m("Geçersiz yol", "Invalid path"));
    }
    Ok(Path::new(repo).join(rel_path))
}

// ---------------------------------------------------------------------------
// Çakışmalar
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct ConflictInfo {
    /// text | binary | deleted
    pub kind: String,
    /// diff3 biçiminde çakışma işaretli birleşik içerik
    pub merged: String,
    pub ours_exists: bool,
    pub theirs_exists: bool,
    pub conflicts: i32,
}

pub fn conflict(repo: &str, path: &str) -> Result<ConflictInfo, String> {
    let out = ok_bytes(repo, &["ls-files", "-u", "-z", "--", path])?;
    let s = String::from_utf8_lossy(&out);
    let mut stages: [Option<String>; 4] = [None, None, None, None];
    for rec in s.split('\0').filter(|r| !r.is_empty()) {
        // "<mode> <sha> <stage>\t<path>"
        let (meta, _p) = rec.split_once('\t').unwrap_or((rec, ""));
        let m: Vec<&str> = meta.split(' ').collect();
        if m.len() == 3 {
            if let Ok(n) = m[2].parse::<usize>() {
                if n < 4 {
                    stages[n] = Some(m[1].to_string());
                }
            }
        }
    }
    let ours_exists = stages[2].is_some();
    let theirs_exists = stages[3].is_some();
    if !ours_exists || !theirs_exists {
        return Ok(ConflictInfo { kind: "deleted".into(), merged: String::new(), ours_exists, theirs_exists, conflicts: 1 });
    }
    let blob = |sha: &Option<String>| -> Result<Vec<u8>, String> {
        match sha {
            Some(s) => ok_bytes(repo, &["cat-file", "blob", s]),
            None => Ok(vec![]),
        }
    };
    let base = blob(&stages[1])?;
    let ours = blob(&stages[2])?;
    let theirs = blob(&stages[3])?;
    let is_bin = |d: &[u8]| d.iter().take(8000).any(|b| *b == 0);
    if is_bin(&base) || is_bin(&ours) || is_bin(&theirs) {
        return Ok(ConflictInfo { kind: "binary".into(), merged: String::new(), ours_exists, theirs_exists, conflicts: 1 });
    }
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let (po, pb, pt) = (dir.path().join("ours"), dir.path().join("base"), dir.path().join("theirs"));
    std::fs::write(&po, &ours).map_err(|e| e.to_string())?;
    std::fs::write(&pb, &base).map_err(|e| e.to_string())?;
    std::fs::write(&pt, &theirs).map_err(|e| e.to_string())?;
    let args: Vec<String> = vec![
        "merge-file".into(),
        "-p".into(),
        "--diff3".into(),
        "-L".into(),
        "Mevcut".into(),
        "-L".into(),
        "Temel".into(),
        "-L".into(),
        "Gelen".into(),
        po.to_string_lossy().to_string(),
        pb.to_string_lossy().to_string(),
        pt.to_string_lossy().to_string(),
    ];
    let r = run_raw(repo, &args, None)?;
    if r.code < 0 || r.code > 127 {
        return Err(r.stderr);
    }
    Ok(ConflictInfo {
        kind: "text".into(),
        merged: String::from_utf8_lossy(&r.stdout).to_string(),
        ours_exists,
        theirs_exists,
        conflicts: r.code,
    })
}

pub fn resolve_write(repo: &str, path: &str, content: &str) -> Result<(), String> {
    let full = safe_join(repo, path)?;
    std::fs::write(&full, content.as_bytes()).map_err(|e| format!("{}: {e}", crate::i18n::m("Dosya yazılamadı", "Could not write file")))?;
    ok(repo, &["add", "--", path])?;
    Ok(())
}

pub fn resolve_take(repo: &str, path: &str, side: &str) -> Result<(), String> {
    let info = conflict(repo, path)?;
    let exists = match side {
        "ours" => info.ours_exists,
        "theirs" => info.theirs_exists,
        _ => false,
    };
    if side == "delete" || !exists {
        ok(repo, &["rm", "-q", "--", path])?;
        return Ok(());
    }
    let flag = if side == "ours" { "--ours" } else { "--theirs" };
    ok(repo, &["checkout", flag, "--", path])?;
    ok(repo, &["add", "--", path])?;
    Ok(())
}

pub fn remote_url(repo: &str) -> Option<String> {
    let remotes = ok(repo, &["remote"]).ok()?;
    let name = if remotes.lines().any(|l| l == "origin") { "origin".to_string() } else { remotes.lines().next()?.to_string() };
    ok(repo, &["remote", "get-url", &name]).ok().map(|s| s.trim().to_string())
}

// ---------------------------------------------------------------------------
// Testler
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn sh(dir: &str, args: &[&str]) {
        let r = run(dir, args).unwrap();
        assert!(r.ok, "git {:?} failed: {}", args, r.stderr);
    }

    fn init() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().to_str().unwrap();
        sh(p, &["init", "-q", "-b", "main"]);
        sh(p, &["config", "user.name", "Test"]);
        sh(p, &["config", "user.email", "t@example.com"]);
        d
    }

    #[test]
    fn status_log_branches() {
        let d = init();
        let p = d.path().to_str().unwrap();
        std::fs::write(d.path().join("a.txt"), "bir\niki\n").unwrap();
        let st = status(p).unwrap();
        assert_eq!(st.files.len(), 1);
        assert!(st.files[0].untracked);
        sh(p, &["add", "."]);
        sh(p, &["commit", "-qm", "ilk"]);
        std::fs::write(d.path().join("a.txt"), "bir\nİKİ\n").unwrap();
        let st = status(p).unwrap();
        assert_eq!(st.branch.as_deref(), Some("main"));
        assert_eq!(st.files[0].y, "M");
        let lg = log(p, 10, 0, true, None).unwrap();
        assert_eq!(lg.len(), 1);
        assert_eq!(lg[0].subject, "ilk");
        let br = branches(p).unwrap();
        assert!(br.iter().any(|b| b.name == "main" && b.head));
        let det = commit_detail(p, &lg[0].hash).unwrap();
        assert_eq!(det.files.len(), 1);
        assert_eq!(det.files[0].added, 2);
    }

    #[test]
    fn partial_stage_patch() {
        let d = init();
        let p = d.path().to_str().unwrap();
        std::fs::write(d.path().join("f.txt"), "a\nb\nc\n").unwrap();
        sh(p, &["add", "."]);
        sh(p, &["commit", "-qm", "ilk"]);
        std::fs::write(d.path().join("f.txt"), "a\nB1\nB2\nc\n").unwrap();
        // Sadece "+B1" satırını ve "-b" silmesini stage'le; "+B2" dışarıda kalsın.
        let patch = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,3 @@\n a\n-b\n+B1\n c\n";
        apply_patch(p, patch, true, false).unwrap();
        let staged = ok(p, &["show", ":f.txt"]).unwrap();
        assert_eq!(staged, "a\nB1\nc\n");
    }

    #[test]
    fn cherry_pick_conflict_flow() {
        let d = init();
        let p = d.path().to_str().unwrap();
        std::fs::write(d.path().join("c.txt"), "x\nortak\ny\n").unwrap();
        sh(p, &["add", "."]);
        sh(p, &["commit", "-qm", "taban"]);
        sh(p, &["checkout", "-qb", "diger"]);
        std::fs::write(d.path().join("c.txt"), "x\ngelen\ny\n").unwrap();
        sh(p, &["commit", "-qam", "gelen"]);
        let their = ok(p, &["rev-parse", "HEAD"]).unwrap();
        sh(p, &["checkout", "-q", "main"]);
        std::fs::write(d.path().join("c.txt"), "x\nmevcut\ny\n").unwrap();
        sh(p, &["commit", "-qam", "mevcut"]);
        let r = run(p, &["cherry-pick", their.trim()]).unwrap();
        assert!(!r.ok);
        let op = op_state(p).unwrap();
        assert_eq!(op.kind, "cherry-pick");
        let st = status(p).unwrap();
        assert!(st.files.iter().any(|f| f.conflict));
        let c = conflict(p, "c.txt").unwrap();
        assert_eq!(c.kind, "text");
        assert!(c.merged.contains("<<<<<<< Mevcut"));
        assert!(c.merged.contains("||||||| Temel"));
        assert!(c.merged.contains(">>>>>>> Gelen"));
        resolve_write(p, "c.txt", "x\nmevcut\ngelen\ny\n").unwrap();
        let st = status(p).unwrap();
        assert!(!st.files.iter().any(|f| f.conflict));
        let r = run(p, &["cherry-pick", "--continue"]).unwrap();
        assert!(r.ok, "{}", r.stderr);
        assert_eq!(op_state(p).unwrap().kind, "none");
    }

    #[test]
    fn crlf_preserved_in_conflict() {
        let d = init();
        let p = d.path().to_str().unwrap();
        sh(p, &["config", "core.autocrlf", "false"]);
        std::fs::write(d.path().join("w.txt"), "a\r\nb\r\n").unwrap();
        sh(p, &["add", "."]);
        sh(p, &["commit", "-qm", "t"]);
        sh(p, &["checkout", "-qb", "k"]);
        std::fs::write(d.path().join("w.txt"), "a\r\nK\r\n").unwrap();
        sh(p, &["commit", "-qam", "k"]);
        sh(p, &["checkout", "-q", "main"]);
        std::fs::write(d.path().join("w.txt"), "a\r\nM\r\n").unwrap();
        sh(p, &["commit", "-qam", "m"]);
        let _ = run(p, &["merge", "k"]).unwrap();
        let c = conflict(p, "w.txt").unwrap();
        assert!(c.merged.contains("M\r\n"));
        assert!(c.merged.contains("K\r\n"));
    }
}
