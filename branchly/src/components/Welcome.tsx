import { t } from "../i18n";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../api";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { Modal, useUi } from "./ui";
import logoLight from "../assets/logo-light.png";
import logoDark from "../assets/logo-dark.png";

export async function chooseRepo(openRepo: (p: string) => Promise<void>) {
  const dir = await open({ directory: true, multiple: false, title: t("Git repository'si seçin") });
  if (typeof dir === "string") await openRepo(dir);
}

export function Welcome() {
  const s = useStore();
  const ui = useUi();
  const [cloning, setCloning] = useState(false);

  return (
    <div className="empty" style={{ gap: 18 }}>
      <img src={s.theme === "dark" ? logoDark : logoLight} alt={t("Branchly")} style={{ height: 64 }} />
      <div className="muted" style={{ fontSize: 14 }}>{t("Hafif, modern Git istemcisi")}</div>
      <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
        <button className="btn primary" style={{ height: 36, padding: "0 16px" }} onClick={() => chooseRepo(s.openRepo)}>
          <Icon name="folder" /> {t("Repository aç")}
        </button>
        <button className="btn" style={{ height: 36, padding: "0 16px" }} onClick={() => setCloning(true)}>
          <Icon name="pull" /> {t("Klonla")}
        </button>
      </div>
      <button className="btn ghost sm" style={{ color: "var(--accent-text)" }} onClick={() => window.dispatchEvent(new Event("branchly:import-sourcetree"))}>
        {t("Sourcetree'den içe aktar…")}
      </button>
      {s.settings.recent.length > 0 && (
        <div style={{ width: 520, marginTop: 14, textAlign: "left", maxHeight: "46vh", overflowY: "auto" }}>
          {[...new Set(s.settings.recent.map((r) => r.folder ?? ""))]
            .sort((x, y) => (x === "" ? -1 : y === "" ? 1 : x.localeCompare(y, "tr")))
            .map((folder) => (
              <div key={folder || "_"} style={{ marginBottom: 10 }}>
                <div className="label" style={{ padding: "0 10px 6px" }}>{folder || t("Repository'lerim")}</div>
                {s.settings.recent
                  .filter((r) => (r.folder ?? "") === folder)
                  .map((r) => (
                    <div key={r.root} className="row" style={{ height: 44, cursor: "pointer" }} onClick={() => s.openRepo(r.root)}>
                      <Icon name="folder" color="var(--accent)" />
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                        <span style={{ fontWeight: 600, color: "var(--text)" }}>{r.name}</span>
                        <span className="ellipsis faint" style={{ fontSize: 12 }}>{r.root}</span>
                      </div>
                      <div className="row-actions">
                      <button
                        className="iconbtn"
                        aria-label={t("Listeden kaldır")}
                        onClick={(e) => {
                          e.stopPropagation();
                          s.saveSettings({ recent: s.settings.recent.filter((x) => x.root !== r.root) });
                        }}
                      >
                        <Icon name="close" size={12} />
                      </button>
                      </div>
                    </div>
                  ))}
              </div>
            ))}
        </div>
      )}
      {cloning && (
        <CloneDialog
          onClose={() => setCloning(false)}
          onDone={(p) => {
            setCloning(false);
            s.openRepo(p);
          }}
          onError={(e) => ui.error(e, t("Klonlama başarısız"))}
        />
      )}
    </div>
  );
}

export function CloneDialog({ onClose, onDone, onError }: { onClose: () => void; onDone: (path: string) => void; onError: (e: unknown) => void }) {
  const [url, setUrl] = useState("");
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState(false);
  const name = url.trim().replace(/\/+$/, "").split(/[/:]/).pop()?.replace(/\.git$/, "") ?? "";
  const sep = dir.includes("\\") ? "\\" : "/";
  const target = dir && name ? dir.replace(/[\\/]+$/, "") + sep + name : "";

  const clone = async () => {
    setBusy(true);
    try {
      const r = await api.exec(dir, ["clone", "--progress", url.trim(), name]);
      if (!r.ok) throw new Error(r.stderr);
      onDone(target);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={560}>
      <h2>{t("Repository klonla")}</h2>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="label">{t("Repository adresi")}</span>
        <input className="field mono" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://bitbucket.org/ekip/proje.git" />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="label">{t("Hedef klasör")}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field mono" value={dir} onChange={(e) => setDir(e.target.value)} placeholder="C:\\Projeler" />
          <button
            className="btn"
            style={{ height: 32 }}
            onClick={async () => {
              const d = await open({ directory: true, title: t("Hedef klasör") });
              if (typeof d === "string") setDir(d);
            }}
          >
            {t("Seç…")}
          </button>
        </div>
        {target && <span className="faint" style={{ fontSize: 12 }}>{target}</span>}
      </label>
      <div className="actions">
        <button className="btn" onClick={onClose}>{t("Vazgeç")}</button>
        <button className="btn primary" disabled={!url.trim() || !dir || busy} onClick={clone}>
          {busy ? t("Klonlanıyor…") : t("Klonla")}
        </button>
      </div>
    </Modal>
  );
}
