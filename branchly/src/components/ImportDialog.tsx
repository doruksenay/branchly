// Sourcetree'den depo taşıma
import { t } from "../i18n";
import { useMemo, useState } from "react";
import type { StRepo } from "../api";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { Modal } from "./ui";

export function ImportDialog({ repos, onClose }: { repos: StRepo[]; onClose: (imported: number) => void }) {
  const s = useStore();
  const usable = (r: StRepo) => r.exists && r.is_git;
  const known = new Set(s.settings.recent.map((r) => r.root.toLowerCase()));
  const [sel, setSel] = useState<Set<string>>(new Set(repos.filter((r) => usable(r) && !known.has(r.path.toLowerCase())).map((r) => r.path)));
  const [openTabs, setOpenTabs] = useState(true);

  const groups = useMemo(() => {
    const m = new Map<string, StRepo[]>();
    for (const r of repos) {
      const k = r.folder ?? "";
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()].sort((a, b) => (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0], "tr")));
  }, [repos]);

  const toggle = (p: string) => {
    const n = new Set(sel);
    n.has(p) ? n.delete(p) : n.add(p);
    setSel(n);
  };
  const toggleGroup = (list: StRepo[]) => {
    const ok = list.filter(usable).map((r) => r.path);
    const all = ok.every((p) => sel.has(p));
    const n = new Set(sel);
    ok.forEach((p) => (all ? n.delete(p) : n.add(p)));
    setSel(n);
  };

  const doImport = () => {
    const chosen = repos.filter((r) => sel.has(r.path));
    // Sourcetree'de açık olan sekmeleri koru; hiç yoksa ilk 6 depoyu sekme olarak aç
    let tabs = chosen.filter((r) => r.open_tab).map((r) => r.path);
    if (!tabs.length) tabs = chosen.slice(0, 6).map((r) => r.path);
    s.addToLibrary(
      chosen.map((r) => ({ root: r.path, name: r.name, folder: r.folder })),
      openTabs ? tabs : [],
    );
    if (openTabs && tabs[0]) s.openRepo(tabs[0]);
    onClose(chosen.length);
  };

  const later = () => {
    s.saveSettings({ sourcetreeAsked: true });
    onClose(0);
  };

  return (
    <Modal onClose={later} width={600}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon name="folder" size={20} color="var(--accent)" />
        </div>
        <div>
          <h2>{t("Sourcetree'deki repository'leriniz taşınsın mı?")}</h2>
          <div className="muted" style={{ marginTop: 2 }}>
            {t("{n} repository bulundu. Seçtikleriniz klasör gruplarıyla birlikte Branchly'ye eklenir; Sourcetree'ye dokunulmaz.", { n: repos.length })}
          </div>
        </div>
      </div>

      <div style={{ border: "1px solid var(--border-soft)", borderRadius: 10, maxHeight: 340, overflowY: "auto", padding: 6 }}>
        {groups.map(([folder, list]) => {
          const ok = list.filter(usable);
          const all = ok.length > 0 && ok.every((r) => sel.has(r.path));
          return (
            <div key={folder || "_"}>
              {folder && (
                <label className="row" style={{ height: 30, fontWeight: 600, fontSize: 12, color: "var(--text-2)" }}>
                  <input type="checkbox" checked={all} disabled={ok.length === 0} onChange={() => toggleGroup(list)} style={{ accentColor: "var(--accent)" }} />
                  <Icon name="folder" size={14} color="var(--text-3)" />
                  {folder}
                  <span className="faint" style={{ fontWeight: 400 }}>· {list.length}</span>
                </label>
              )}
              {list.map((r) => {
                const can = usable(r);
                const already = known.has(r.path.toLowerCase());
                return (
                  <label key={r.path} className="row" style={{ minHeight: 40, paddingLeft: folder ? 34 : 10, opacity: can ? 1 : 0.55, cursor: can ? "pointer" : "default" }}>
                    <input type="checkbox" checked={sel.has(r.path)} disabled={!can} onChange={() => toggle(r.path)} style={{ accentColor: "var(--accent)" }} />
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                      <span style={{ fontWeight: 500 }}>
                        {r.name}
                        {r.open_tab && <span className="pill" style={{ marginLeft: 8, height: 17, background: "var(--accent-soft)", color: "var(--accent-text)", fontSize: 10.5 }}>{t("açık sekme")}</span>}
                      </span>
                      <span className="ellipsis faint mono" style={{ fontSize: 11.5 }}>{r.path}</span>
                    </div>
                    {!r.exists ? (
                      <span style={{ fontSize: 12, color: "var(--del-fg)" }}>{t("Klasör bulunamadı")}</span>
                    ) : !r.is_git ? (
                      <span className="faint" style={{ fontSize: 12 }}>{t("Git repository'si değil")}</span>
                    ) : already ? (
                      <span className="faint" style={{ fontSize: 12 }}>{t("Zaten ekli")}</span>
                    ) : null}
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={openTabs} onChange={(e) => setOpenTabs(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
        {t("Sourcetree'de açık olan repository'leri sekme olarak aç")}
      </label>

      <div className="actions">
        <button className="btn" onClick={later}>{t("Şimdi değil")}</button>
        <button className="btn primary" disabled={sel.size === 0} onClick={doImport}>
          {t("{n} repository'yi taşı", { n: sel.size })}
        </button>
      </div>
      <div className="faint" style={{ fontSize: 12, marginTop: -6 }}>{t("Bu işlemi daha sonra Ayarlar → Genel bölümünden de yapabilirsiniz.")}</div>
    </Modal>
  );
}
