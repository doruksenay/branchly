mod bitbucket;
mod files;
mod git;
mod i18n;
mod pty;
mod settings;
mod sourcetree;

use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, State};

/// Uzun sürebilecek işleri arayüz iş parçacığını kilitlemeden çalıştırır.
async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

// ------------------------------ Git ---------------------------------------

#[tauri::command]
async fn repo_open(path: String) -> Result<git::RepoInfo, String> {
    blocking(move || git::open_repo(&path)).await
}

#[tauri::command]
async fn git_status(repo: String) -> Result<git::StatusInfo, String> {
    blocking(move || git::status(&repo)).await
}

#[tauri::command]
async fn git_log(repo: String, limit: u32, skip: u32, all: bool, path: Option<String>) -> Result<Vec<git::Commit>, String> {
    blocking(move || git::log(&repo, limit, skip, all, path)).await
}

#[tauri::command]
async fn git_commit_detail(repo: String, hash: String) -> Result<git::CommitDetail, String> {
    blocking(move || git::commit_detail(&repo, &hash)).await
}

#[tauri::command]
async fn git_branches(repo: String) -> Result<Vec<git::Branch>, String> {
    blocking(move || git::branches(&repo)).await
}

#[tauri::command]
async fn git_stashes(repo: String) -> Result<Vec<git::Stash>, String> {
    blocking(move || git::stashes(&repo)).await
}

#[tauri::command]
async fn git_op_state(repo: String) -> Result<git::OpState, String> {
    blocking(move || git::op_state(&repo)).await
}

#[tauri::command]
async fn git_diff(repo: String, path: String, staged: bool, untracked: bool) -> Result<git::DiffResult, String> {
    blocking(move || git::diff_file(&repo, &path, staged, untracked)).await
}

#[tauri::command]
async fn git_commit_file_diff(repo: String, hash: String, path: String, parents: usize) -> Result<git::DiffResult, String> {
    blocking(move || git::commit_file_diff(&repo, &hash, &path, parents)).await
}

#[tauri::command]
async fn git_apply_patch(repo: String, patch: String, cached: bool, reverse: bool) -> Result<(), String> {
    blocking(move || git::apply_patch(&repo, &patch, cached, reverse)).await
}

#[tauri::command]
async fn git_discard(repo: String, paths: Vec<String>, untracked: Vec<String>) -> Result<(), String> {
    blocking(move || git::discard(&repo, &paths, &untracked)).await
}

/// Genel git çağrısı: checkout, branch, merge, fetch, pull, push, stash, cherry-pick,
/// revert, reset, commit gibi işlemler arayüzden argümanlarla çağrılır.
#[tauri::command]
async fn git_exec(repo: String, args: Vec<String>, stdin: Option<String>) -> Result<git::RunResult, String> {
    blocking(move || {
        let r = git::run_raw(&repo, &args, stdin.as_deref().map(|s| s.as_bytes()))?;
        Ok(git::RunResult { ok: r.code == 0, code: r.code, stdout: String::from_utf8_lossy(&r.stdout).to_string(), stderr: r.stderr })
    })
    .await
}

#[tauri::command]
async fn git_conflict(repo: String, path: String) -> Result<git::ConflictInfo, String> {
    blocking(move || git::conflict(&repo, &path)).await
}

#[tauri::command]
async fn git_resolve_write(repo: String, path: String, content: String) -> Result<(), String> {
    blocking(move || git::resolve_write(&repo, &path, &content)).await
}

#[tauri::command]
async fn git_resolve_take(repo: String, path: String, side: String) -> Result<(), String> {
    blocking(move || git::resolve_take(&repo, &path, &side)).await
}

#[tauri::command]
fn git_cmd_log() -> Vec<git::CmdLogEntry> {
    git::cmd_log()
}

#[tauri::command]
async fn git_version() -> Result<String, String> {
    blocking(|| git::ok("", &["--version"]).map(|s| s.trim().to_string())).await
}

// ------------------------------ Dosyalar ----------------------------------

#[tauri::command]
async fn fs_list_dir(repo: String, rel: String) -> Result<Vec<files::DirEntry>, String> {
    blocking(move || files::list_dir(&repo, &rel)).await
}

#[tauri::command]
async fn fs_read_file(repo: String, rel: String) -> Result<files::FileContent, String> {
    blocking(move || files::read_file(&repo, &rel)).await
}

#[tauri::command]
fn fs_open_editor(repo: String, rel: String, editor: String) -> Result<(), String> {
    files::open_in_editor(&repo, &rel, &editor)
}

#[tauri::command]
fn fs_reveal(repo: String, rel: String) -> Result<(), String> {
    files::reveal(&repo, &rel)
}

#[tauri::command]
fn watch_repo(app: AppHandle, state: State<files::WatchState>, repo: String) -> Result<(), String> {
    files::watch(app, &state, repo)
}

// ------------------------------ Terminal ----------------------------------

#[tauri::command]
fn pty_list_shells() -> Vec<pty::Shell> {
    pty::list_shells()
}

#[tauri::command]
fn pty_spawn(app: AppHandle, state: State<pty::PtyState>, program: String, args: Vec<String>, cwd: String, cols: u16, rows: u16) -> Result<u32, String> {
    pty::spawn(app, &state, program, args, cwd, cols, rows)
}

#[tauri::command]
fn pty_write(state: State<pty::PtyState>, id: u32, data: String) -> Result<(), String> {
    pty::write(&state, id, &data)
}

#[tauri::command]
fn pty_resize(state: State<pty::PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    pty::resize(&state, id, cols, rows)
}

#[tauri::command]
fn pty_kill(state: State<pty::PtyState>, id: u32) -> Result<(), String> {
    pty::kill(&state, id)
}

// ------------------------------ Ayarlar -----------------------------------

#[tauri::command]
fn settings_get(app: AppHandle) -> Value {
    settings::load(&app)
}

#[tauri::command]
fn settings_set(app: AppHandle, value: Value) -> Result<(), String> {
    settings::save(&app, &value)
}

// ------------------------------ Bitbucket ---------------------------------

#[tauri::command]
async fn bb_status(app: AppHandle) -> bitbucket::BbStatus {
    bitbucket::status(&app).await
}

#[tauri::command]
async fn bb_login(app: AppHandle, client_id: String, client_secret: String) -> Result<Value, String> {
    bitbucket::login(&app, client_id, client_secret).await
}

#[tauri::command]
fn bb_logout() -> Result<(), String> {
    bitbucket::logout()
}

#[tauri::command]
async fn bb_api(app: AppHandle, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    bitbucket::api(&app, &method, &path, body).await
}

#[tauri::command]
async fn bb_repo_info(repo: String) -> Result<Option<bitbucket::RepoRef>, String> {
    blocking(move || Ok(git::remote_url(&repo).and_then(|u| bitbucket::parse_remote(&u)))).await
}

#[tauri::command]
async fn sourcetree_repos() -> Result<Vec<sourcetree::StRepo>, String> {
    blocking(|| Ok(sourcetree::find_repos())).await
}

#[tauri::command]
fn set_lang(lang: String) {
    i18n::set(&lang);
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(crate::i18n::m("Geçersiz adres", "Invalid URL"));
    }
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pty::PtyState::default())
        .manage(files::WatchState { watcher: Mutex::new(None) })
        .invoke_handler(tauri::generate_handler![
            repo_open,
            git_status,
            git_log,
            git_commit_detail,
            git_branches,
            git_stashes,
            git_op_state,
            git_diff,
            git_commit_file_diff,
            git_apply_patch,
            git_discard,
            git_exec,
            git_conflict,
            git_resolve_write,
            git_resolve_take,
            git_cmd_log,
            git_version,
            fs_list_dir,
            fs_read_file,
            fs_open_editor,
            fs_reveal,
            watch_repo,
            pty_list_shells,
            pty_spawn,
            pty_write,
            pty_resize,
            pty_kill,
            settings_get,
            settings_set,
            bb_status,
            bb_login,
            bb_logout,
            bb_api,
            bb_repo_info,
            open_url,
            sourcetree_repos,
            set_lang,
        ])
        .run(tauri::generate_context!())
        .expect("Branchly başlatılamadı");
}
