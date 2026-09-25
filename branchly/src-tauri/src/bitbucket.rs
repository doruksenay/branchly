//! Bitbucket Cloud entegrasyonu: OAuth 2.0 (loopback yönlendirme) + REST API 2.0
//!
//! Kurulum (bir kez): Bitbucket > Workspace settings > OAuth consumers > Add consumer
//!   Callback URL: http://127.0.0.1
//!   İzinler: Account (Read), Repositories (Read, Write), Pull requests (Read, Write)
//! Anahtar (Key) ve Secret uygulamanın Ayarlar ekranına girilir. Secret ve erişim
//! token'ları Windows Kimlik Bilgisi Yöneticisi'nde (Credential Manager) saklanır.

use crate::settings;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const API: &str = "https://api.bitbucket.org/2.0";
const AUTHORIZE: &str = "https://bitbucket.org/site/oauth2/authorize";
const TOKEN: &str = "https://bitbucket.org/site/oauth2/access_token";
const KR_SERVICE: &str = "Branchly";
const KR_TOKEN: &str = "bitbucket-token";
const KR_SECRET: &str = "bitbucket-client-secret";

#[derive(Serialize, Deserialize, Clone)]
struct TokenSet {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn kr(user: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KR_SERVICE, user).map_err(|e| e.to_string())
}

fn load_token() -> Option<TokenSet> {
    let s = kr(KR_TOKEN).ok()?.get_password().ok()?;
    serde_json::from_str(&s).ok()
}

fn save_token(t: &TokenSet) -> Result<(), String> {
    kr(KR_TOKEN)?.set_password(&serde_json::to_string(t).unwrap()).map_err(|e| format!("{}: {e}", crate::i18n::m("Token kaydedilemedi", "Could not save token")))
}

fn client_id(app: &AppHandle) -> Option<String> {
    settings::load(app).get("bitbucketClientId").and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn client_secret() -> Option<String> {
    kr(KR_SECRET).ok()?.get_password().ok()
}

#[derive(Serialize)]
pub struct BbStatus {
    pub configured: bool,
    pub logged_in: bool,
    pub user: Option<Value>,
}

pub async fn status(app: &AppHandle) -> BbStatus {
    let configured = client_id(app).is_some() && client_secret().is_some();
    if load_token().is_none() {
        return BbStatus { configured, logged_in: false, user: None };
    }
    match api(app, "GET", "/user", None).await {
        Ok(u) => BbStatus { configured, logged_in: true, user: Some(u) },
        Err(_) => BbStatus { configured, logged_in: false, user: None },
    }
}

pub async fn login(app: &AppHandle, id: String, secret: String) -> Result<Value, String> {
    let id = id.trim().to_string();
    let secret = secret.trim().to_string();
    if id.is_empty() {
        return Err(crate::i18n::m("OAuth anahtarı (Key) boş olamaz.", "OAuth key cannot be empty."));
    }
    let mut s = settings::load(app);
    s["bitbucketClientId"] = Value::String(id.clone());
    settings::save(app, &s)?;
    if !secret.is_empty() {
        kr(KR_SECRET)?.set_password(&secret).map_err(|e| format!("{}: {e}", crate::i18n::m("Secret kaydedilemedi", "Could not save secret")))?;
    }
    let secret = client_secret().ok_or_else(|| crate::i18n::m("OAuth secret girilmemiş.", "OAuth secret is missing."))?;

    // Yalnızca 127.0.0.1'e bağlan: Windows Güvenlik Duvarı uyarısı çıkmaz.
    let port: u16 = settings::load(app).get("bitbucketCallbackPort").and_then(|v| v.as_u64()).unwrap_or(0) as u16;
    let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|e| format!("{}: {e}", crate::i18n::m("Yerel port açılamadı", "Could not open local port")))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect = format!("http://127.0.0.1:{port}/");
    let state: String = rand::thread_rng().sample_iter(&rand::distributions::Alphanumeric).take(24).map(char::from).collect();
    let mut url = url::Url::parse(AUTHORIZE).unwrap();
    url.query_pairs_mut()
        .append_pair("client_id", &id)
        .append_pair("response_type", "code")
        .append_pair("state", &state)
        .append_pair("redirect_uri", &redirect);
    tauri_plugin_opener::open_url(url.as_str(), None::<&str>).map_err(|e| format!("{}: {e}", crate::i18n::m("Tarayıcı açılamadı", "Could not open browser")))?;

    let expected = state.clone();
    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &expected))
        .await
        .map_err(|e| e.to_string())??;

    let client = reqwest::Client::new();
    let resp = client
        .post(TOKEN)
        .basic_auth(&id, Some(&secret))
        .form(&[("grant_type", "authorization_code"), ("code", code.as_str()), ("redirect_uri", redirect.as_str())])
        .send()
        .await
        .map_err(|e| format!("{}: {e}", crate::i18n::m("Token isteği başarısız", "Token request failed")))?;
    let token = parse_token(resp, None).await?;
    save_token(&token)?;
    api(app, "GET", "/user", None).await
}

fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        if Instant::now() > deadline {
            return Err(crate::i18n::m("Giriş zaman aşımına uğradı (5 dk).", "Sign-in timed out (5 min)."));
        }
        let (mut stream, _) = match listener.accept() {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        let _ = stream.set_nonblocking(false);
        let mut line = String::new();
        let _ = BufReader::new(&stream).read_line(&mut line);
        // "GET /?code=...&state=... HTTP/1.1"
        let target = line.split_whitespace().nth(1).unwrap_or("/").to_string();
        let parsed = url::Url::parse(&format!("http://127.0.0.1{target}")).ok();
        let params: Vec<(String, String)> = parsed.map(|u| u.query_pairs().into_owned().collect()).unwrap_or_default();
        let get = |k: &str| params.iter().find(|(a, _)| a == k).map(|(_, b)| b.clone());
        let (ok, msg) = match (get("code"), get("state"), get("error")) {
            (_, _, Some(err)) => (Err(format!("{}: {err}", crate::i18n::m("Bitbucket girişi reddetti", "Bitbucket rejected the sign-in"))), crate::i18n::m("Giriş iptal edildi.", "Sign-in cancelled.")),
            (Some(code), Some(st), _) if st == expected_state => (Ok(code), crate::i18n::m("Giriş tamamlandı. Branchly'ye dönebilirsiniz.", "Signed in. You can return to Branchly.")),
            (Some(_), _, _) => (Err(crate::i18n::m("Güvenlik doğrulaması (state) başarısız.", "Security check (state) failed.")), crate::i18n::m("Güvenlik doğrulaması başarısız.", "Security check failed.")),
            _ => continue, // favicon vb. istekler
        };
        let body = format!(
            "<!doctype html><html lang=\"tr\"><meta charset=\"utf-8\"><title>Branchly</title><body style=\"font-family:Segoe UI,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#F5F6F8;color:#1D1D1F\"><div style=\"text-align:center\"><h2 style=\"margin:0 0 8px\">Branchly</h2><p>{msg}</p></div></body></html>"
        );
        let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
        return ok;
    }
}

async fn parse_token(resp: reqwest::Response, old_refresh: Option<String>) -> Result<TokenSet, String> {
    let status = resp.status();
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let desc = v.get("error_description").and_then(|x| x.as_str()).unwrap_or("bilinmeyen hata");
        return Err(format!("{}: {desc}", crate::i18n::m("Token alınamadı", "Could not get token")));
    }
    let access = v.get("access_token").and_then(|x| x.as_str()).ok_or_else(|| crate::i18n::m("Yanıtta access_token yok", "No access_token in response"))?.to_string();
    let refresh = v.get("refresh_token").and_then(|x| x.as_str()).map(|s| s.to_string()).or(old_refresh).unwrap_or_default();
    let exp = v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(3600);
    Ok(TokenSet { access_token: access, refresh_token: refresh, expires_at: now() + exp.saturating_sub(60) })
}

async fn refresh(app: &AppHandle, t: &TokenSet) -> Result<TokenSet, String> {
    let id = client_id(app).ok_or_else(|| crate::i18n::m("Bitbucket yapılandırılmamış", "Bitbucket is not configured"))?;
    let secret = client_secret().ok_or_else(|| crate::i18n::m("Bitbucket yapılandırılmamış", "Bitbucket is not configured"))?;
    let resp = reqwest::Client::new()
        .post(TOKEN)
        .basic_auth(&id, Some(&secret))
        .form(&[("grant_type", "refresh_token"), ("refresh_token", t.refresh_token.as_str())])
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let nt = parse_token(resp, Some(t.refresh_token.clone())).await?;
    save_token(&nt)?;
    Ok(nt)
}

pub fn logout() -> Result<(), String> {
    if let Ok(e) = kr(KR_TOKEN) {
        let _ = e.delete_credential();
    }
    Ok(())
}

/// Genel API çağrısı. `path` "/repositories/..." gibi göreli olmalı ya da
/// sayfalama için API'nin döndürdüğü tam "next" adresi olabilir.
pub async fn api(app: &AppHandle, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
    let url = if path.starts_with(API) {
        path.to_string()
    } else if path.starts_with('/') && !path.contains("://") {
        format!("{API}{path}")
    } else {
        return Err(crate::i18n::m("Geçersiz API yolu", "Invalid API path"));
    };
    let mut token = load_token().ok_or_else(|| crate::i18n::m("Bitbucket'a giriş yapılmamış", "Not signed in to Bitbucket"))?;
    if token.expires_at <= now() {
        token = refresh(app, &token).await?;
    }
    for attempt in 0..2 {
        let client = reqwest::Client::new();
        let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
        let mut req = client.request(m, &url).bearer_auth(&token.access_token).header("Accept", "application/json");
        if let Some(b) = &body {
            req = req.json(b);
        }
        let resp = req.send().await.map_err(|e| format!("{}: {e}", crate::i18n::m("Bitbucket'a ulaşılamadı", "Could not reach Bitbucket")))?;
        let st = resp.status();
        if st.as_u16() == 401 && attempt == 0 {
            token = refresh(app, &token).await?;
            continue;
        }
        let text = resp.text().await.map_err(|e| e.to_string())?;
        if !st.is_success() {
            let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
            let msg = v.pointer("/error/message").and_then(|x| x.as_str()).map(|s| s.to_string()).unwrap_or_else(|| format!("HTTP {}", st.as_u16()));
            return Err(msg);
        }
        if text.trim().is_empty() {
            return Ok(Value::Null);
        }
        return serde_json::from_str(&text).or(Ok(Value::String(text)));
    }
    Err(crate::i18n::m("Yetkilendirme başarısız", "Authorization failed"))
}

#[derive(Serialize)]
pub struct RepoRef {
    pub workspace: String,
    pub slug: String,
}

/// https://kullanici@bitbucket.org/ws/repo.git, git@bitbucket.org:ws/repo.git,
/// ssh://git@bitbucket.org/ws/repo.git
pub fn parse_remote(url: &str) -> Option<RepoRef> {
    let u = url.trim();
    let idx = u.find("bitbucket.org")?;
    let rest = &u[idx + "bitbucket.org".len()..];
    let rest = rest.trim_start_matches(|c| c == ':' || c == '/');
    let rest = rest.trim_end_matches('/').trim_end_matches(".git");
    let mut parts = rest.split('/');
    let ws = parts.next()?.to_string();
    let slug = parts.next()?.to_string();
    if ws.is_empty() || slug.is_empty() {
        return None;
    }
    Some(RepoRef { workspace: ws, slug })
}

#[cfg(test)]
mod tests {
    use super::parse_remote;
    #[test]
    fn remotes() {
        for u in [
            "https://elif@bitbucket.org/acme-yazilim/musteri-portali.git",
            "git@bitbucket.org:acme-yazilim/musteri-portali.git",
            "ssh://git@bitbucket.org/acme-yazilim/musteri-portali",
        ] {
            let r = parse_remote(u).unwrap();
            assert_eq!(r.workspace, "acme-yazilim");
            assert_eq!(r.slug, "musteri-portali");
        }
        assert!(parse_remote("https://github.com/a/b.git").is_none());
    }
}
