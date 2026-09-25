// Açık repository'ler için sekme çubuğu (Sourcetree'deki gibi birden fazla depo)
import { t } from "../i18n";
import { useEffect } from "react";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { useUi, type MenuItem } from "./ui";

export function RepoTabs({ onOpenRepo, onClone, onImport }: { onOpenRepo: () => void; onClone: () => void; onImport: () => void }) {
  const s = useStore();
  const ui = useUi();
  const tabs = s.settings.tabs;
  const byRoot = new Map(s.settings.recent.map((r) => [r.root, r]));
  const current = s.repo?.root;

  // Ctrl+Tab / Ctrl+Shift+Tab ile sekmeler arasında dolaş, Ctrl+W ile kapat
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!tabs.length) return;
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        const i = Math.max(0, tabs.indexOf(current ?? ""));
        const next = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
        if (next && next !== current) s.openRepo(next);
      } else if (e.ctrlKey && e.key.toLowerCase() === "w" && current) {
        e.preventDefault();
        s.closeTab(current);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [tabs, current, s]);

  const addMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const closed = s.settings.recent.filter((x) => !tabs.includes(x.root));
    const folders = [...new Set(closed.map((x) => x.folder ?? ""))];
    const items: MenuItem[] = [];
    for (const f of folders) {
      const list = closed.filter((x) => (x.folder ?? "") === f);
      items.push({ header: f || t("Repository'lerim") });
      for (const x of list.slice(0, 15)) items.push({ label: x.name, hint: shortPath(x.root), onClick: () => s.openRepo(x.root) });
    }
    if (items.length) items.push({ sep: true });
    items.push(
      { label: t("Klasörden repository aç…"), hint: t("Ctrl+O"), onClick: onOpenRepo },
      { label: t("Repository klonla…"), onClick: onClone },
      { label: t("Sourcetree'den içe aktar…"), onClick: onImport },
    );
    ui.menu(r.left, r.bottom + 4, items);
  };

  return (
    <div role="tablist" aria-label={t("Açık repository'ler")} style={{ height: 38, flexShrink: 0, display: "flex", alignItems: "center", gap: 4, padding: "0 12px 4px", overflowX: "auto" }} data-tauri-drag-region>
      {tabs.map((root) => {
        const e = byRoot.get(root);
        const name = e?.name ?? root.split(/[\\/]/).pop();
        const active = root === current;
        return (
          <div
            key={root}
            role="tab"
            aria-selected={active}
            title={root}
            onMouseDown={(ev) => {
              if (ev.button === 1) {
                ev.preventDefault();
                s.closeTab(root);
              }
            }}
            onClick={() => !active && s.openRepo(root)}
            onContextMenu={(ev) => {
              ev.preventDefault();
              ui.menu(ev.clientX, ev.clientY, [
                { label: t("Sekmeyi kapat"), hint: t("Ctrl+W"), onClick: () => s.closeTab(root) },
                { label: t("Diğer sekmeleri kapat"), onClick: () => { s.saveSettings({ tabs: [root] }); if (!active) s.openRepo(root); } },
                { sep: true },
                { label: t("Dosya Gezgini'nde göster"), onClick: () => window.dispatchEvent(new CustomEvent("branchly:reveal", { detail: root })) },
              ]);
            }}
            className="repo-tab"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              height: 30,
              padding: "0 6px 0 11px",
              borderRadius: 8,
              flexShrink: 0,
              maxWidth: 240,
              cursor: "default",
              background: active ? "var(--content)" : "transparent",
              boxShadow: active ? "0 0 0 1px var(--border), 0 1px 2px rgba(0,0,0,0.06)" : undefined,
              fontWeight: active ? 600 : 400,
              color: active ? "var(--text)" : "var(--text-2)",
            }}
          >
            <Icon name="folder" size={14} color={active ? "var(--accent)" : "var(--text-3)"} />
            <span className="ellipsis">{name}</span>
            <button
              className="iconbtn tab-x"
              aria-label={t("{x} sekmesini kapat", { x: name ?? "" })}
              style={{ width: 20, height: 20, opacity: active ? 0.8 : 0 }}
              onClick={(ev) => {
                ev.stopPropagation();
                s.closeTab(root);
              }}
            >
              <Icon name="close" size={10} width={1.8} />
            </button>
          </div>
        );
      })}
      <button className="iconbtn" aria-label={t("Repository aç veya ekle")} onClick={addMenu}>
        <Icon name="plus" size={14} />
      </button>
    </div>
  );
}

function shortPath(p: string) {
  return p.length > 40 ? "…" + p.slice(-38) : p;
}
