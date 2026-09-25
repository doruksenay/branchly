import { t, getLang } from "../i18n";
import { useEffect, useState } from "react";
import { api, errText, type CmdLog, type Shell } from "../api";
import { useStore, type ThemePref } from "../store";
import { Icon } from "./Icon";
import { Avatar, Modal, useUi } from "./ui";

export function SettingsDialog({ onClose, bb, onBbChanged }: { onClose: () => void; bb: { configured: boolean; user: any | null }; onBbChanged: () => void }) {
  const s = useStore();
  const ui = useUi();
  const [tab, setTab] = useState<"general" | "bitbucket" | "log">(bb.user || !bb.configured ? "general" : "general");
  const [key, setKey] = useState(s.settings.bitbucketClientId ?? "");
  const [secret, setSecret] = useState("");
  const [logging, setLogging] = useState(false);
  const [shells, setShells] = useState<Shell[]>([]);
  const [log, setLog] = useState<CmdLog[]>([]);
  const [gitv, setGitv] = useState("");

  useEffect(() => {
    api.shells().then(setShells).catch(() => {});
    api.gitVersion().then(setGitv).catch((e) => setGitv(t("Git bulunamadı: ") + errText(e)));
  }, []);
  useEffect(() => {
    if (tab === "log") api.cmdLog().then((l) => setLog(l.reverse()));
  }, [tab]);

  const login = async () => {
    setLogging(true);
    try {
      const u = await api.bbLogin(key, secret);
      ui.toast(t("Bitbucket'a bağlanıldı: {u}", { u: u?.display_name ?? "" }), "ok");
      s.saveSettings({ bitbucketClientId: key.trim() });
      setSecret("");
      onBbChanged();
    } catch (e) {
      ui.error(e, t("Bitbucket girişi başarısız"));
    } finally {
      setLogging(false);
    }
  };

  const themeBtn = (v: ThemePref, label: string, icon: string) => (
    <button className={s.settings.theme === v ? "on" : ""} onClick={() => s.saveSettings({ theme: v })} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <Icon name={icon} size={13} />
      {label}
    </button>
  );

  return (
    <Modal onClose={onClose} width={620}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <h2 style={{ flex: 1 }}>{t("Ayarlar")}</h2>
        <button className="iconbtn" aria-label={t("Kapat")} onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="seg">
        <button className={tab === "general" ? "on" : ""} onClick={() => setTab("general")}>{t("Genel")}</button>
        <button className={tab === "bitbucket" ? "on" : ""} onClick={() => setTab("bitbucket")}>{t("Bitbucket")}</button>
        <button className={tab === "log" ? "on" : ""} onClick={() => setTab("log")}>{t("Git komut günlüğü")}</button>
      </div>

      {tab === "general" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">{t("Tema")}</span>
            <div className="seg">
              {themeBtn("system", t("Sistem"), "monitor")}
              {themeBtn("light", t("Açık"), "sun")}
              {themeBtn("dark", t("Koyu"), "moon")}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">{t("Dil")}</span>
            <div className="seg">
              <button className={getLang() === "tr" ? "on" : ""} onClick={() => s.saveSettings({ lang: "tr" })}>Türkçe</button>
              <button className={getLang() === "en" ? "on" : ""} onClick={() => s.saveSettings({ lang: "en" })}>English</button>
            </div>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">{t("Harici editör komutu")}</span>
            <input className="field mono" value={s.settings.editor} onChange={(e) => s.saveSettings({ editor: e.target.value })} placeholder={t("code")} />
            <span className="faint" style={{ fontSize: 12 }}>{t("Örnekler: code, cursor, notepad++, \"C:\\Program Files\\Sublime Text\\subl.exe\"")}</span>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">{t("Varsayılan terminal")}</span>
            <select className="field" value={s.settings.shell} onChange={(e) => s.saveSettings({ shell: e.target.value })}>
              <option value="">{t("Otomatik")}</option>
              {shells.map((sh) => (
                <option key={sh.id} value={sh.id}>{sh.name}</option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">{t("Sourcetree")}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="muted" style={{ flex: 1 }}>{t("Sourcetree'deki repository listesini ve klasör gruplarını Branchly'ye taşıyın.")}</span>
              <button
                className="btn"
                onClick={() => {
                  onClose();
                  window.dispatchEvent(new Event("branchly:import-sourcetree"));
                }}
              >
                {t("İçe aktar…")}
              </button>
            </div>
          </div>
          <div className="faint" style={{ fontSize: 12 }}>{gitv} {t("· Branchly 0.1.0")}</div>
        </div>
      )}

      {tab === "bitbucket" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {bb.user ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: 10, background: "var(--ok-bg)" }}>
              <Avatar name={bb.user.display_name ?? "?"} size={32} url={bb.user.links?.avatar?.href} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{bb.user.display_name}</div>
                <div className="muted" style={{ fontSize: 12 }}>{t("Bitbucket Cloud'a bağlı")}</div>
              </div>
              <button
                className="btn"
                onClick={async () => {
                  await api.bbLogout();
                  onBbChanged();
                }}
              >
                {t("Çıkış yap")}
              </button>
            </div>
          ) : (
            <div className="muted" style={{ lineHeight: 1.55, fontSize: 12.5 }}>
              {t("Bitbucket'ta bir kez OAuth consumer oluşturun:")}{" "} <b>{t("Workspace settings → OAuth consumers → Add consumer")}</b>.
              <br />
              {t("Callback URL:")}{" "} <span className="mono selectable" style={{ color: "var(--text)" }}>http://127.0.0.1</span> {t("· İzinler: Account (Read), Repositories (Read, Write), Pull requests (Read, Write).")}
              <br />
              {t("\"This is a private consumer\" seçeneğini işaretleyin.")}
            </div>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">{t("OAuth Key")}</span>
            <input className="field mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t("ör. aB3dE5fG7hJ9kL1mN")} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">{t("OAuth Secret")}</span>
            <input className="field mono" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={bb.configured ? t("Kayıtlı (değiştirmek için yazın)") : ""} />
            <span className="faint" style={{ fontSize: 12 }}>{t("Secret ve erişim anahtarları Windows Kimlik Bilgisi Yöneticisi'nde saklanır.")}</span>
          </label>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="btn primary" disabled={logging || !key.trim() || (!secret.trim() && !bb.configured)} onClick={login}>
              {logging ? t("Tarayıcıda onay bekleniyor…") : bb.user ? t("Yeniden giriş yap") : t("Bitbucket ile giriş yap")}
            </button>
          </div>
        </div>
      )}

      {tab === "log" && (
        <div className="mono" style={{ fontSize: 12, maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
          {log.length === 0 && <div className="faint">{t("Henüz komut çalıştırılmadı")}</div>}
          {log.map((l, i) => (
            <div key={i} className="selectable" style={{ display: "flex", gap: 10, padding: "4px 6px", borderRadius: 6, background: i % 2 ? "transparent" : "var(--field-2)" }}>
              <span className="faint">{new Date(l.time * 1000).toLocaleTimeString("tr-TR")}</span>
              <span style={{ flex: 1, color: l.ok ? "var(--text)" : "var(--del-fg)", wordBreak: "break-all" }}>{l.cmd}</span>
              <span className="faint">{l.ms} {t("ms")}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
