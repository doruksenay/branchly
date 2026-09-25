// Dosya gezgini: git durumlu ağaç + önizleme
import { t } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { api, type DirEntry, type FileContent } from "../api";
import { useStore } from "../store";
import { useActions } from "../actions";
import { Icon } from "../components/Icon";
import { StatusLetter, Switch, useUi } from "../components/ui";
import { Code, langOf } from "../lib/highlight";
import { basename } from "../lib/format";

export function FilesView() {
  const s = useStore();
  const a = useActions();
  const ui = useUi();
  const repo = s.repo!.root;
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set([""]));
  const [changedOnly, setChangedOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [filter, setFilter] = useState("");

  const statusMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of s.status?.files ?? []) m.set(f.path, f.conflict ? "X" : f.untracked ? "?" : f.y !== "." ? f.y : f.x);
    return m;
  }, [s.status]);
  const changedDirs = useMemo(() => {
    const d = new Set<string>();
    for (const p of statusMap.keys()) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) d.add(parts.slice(0, i).join("/"));
    }
    return d;
  }, [statusMap]);

  const load = async (rel: string) => {
    try {
      const list = await api.listDir(repo, rel);
      setChildren((c) => ({ ...c, [rel]: list }));
    } catch (e) {
      ui.error(e, t("Klasör okunamadı"));
    }
  };

  // Açık klasörleri depo değiştikçe yenile
  useEffect(() => {
    open.forEach((rel) => load(rel));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, s.tick]);

  useEffect(() => {
    if (!selected) return setContent(null);
    api.readFile(repo, selected).then(setContent).catch(() => setContent(null));
  }, [selected, repo, s.tick]);

  const toggle = (rel: string) => {
    const n = new Set(open);
    if (n.has(rel)) n.delete(rel);
    else {
      n.add(rel);
      if (!children[rel]) load(rel);
    }
    setOpen(n);
  };

  type Row = { path: string; name: string; depth: number; dir: boolean; ignored: boolean };
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (changedOnly) {
      const paths = [...statusMap.keys()].sort();
      const seen = new Set<string>();
      for (const p of paths) {
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) {
          const dir = parts.slice(0, i).join("/");
          if (!seen.has(dir)) {
            seen.add(dir);
            out.push({ path: dir, name: parts[i - 1], depth: i - 1, dir: true, ignored: false });
          }
        }
        out.push({ path: p, name: parts[parts.length - 1], depth: parts.length - 1, dir: false, ignored: false });
      }
      return out;
    }
    const walk = (rel: string, depth: number) => {
      for (const e of children[rel] ?? []) {
        out.push({ path: e.path, name: e.name, depth, dir: e.is_dir, ignored: e.ignored });
        if (e.is_dir && open.has(e.path)) walk(e.path, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }, [children, open, changedOnly, statusMap]);

  const visible = filter.trim() ? rows.filter((r) => r.name.toLocaleLowerCase("tr").includes(filter.toLocaleLowerCase("tr"))) : rows;
  const lang = selected ? langOf(selected) : "plain";
  const lines = useMemo(() => (content && !content.binary && !content.too_large ? content.content.split("\n") : []), [content]);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const menu = (e: React.MouseEvent, r: Row) => {
    e.preventDefault();
    ui.menu(e.clientX, e.clientY, [
      { label: t("Editörde aç"), onClick: () => api.openEditor(repo, r.path, s.settings.editor).catch(ui.error) },
      { label: t("Dosya Gezgini'nde göster"), onClick: () => api.reveal(repo, r.path).catch(ui.error) },
      ...(!r.dir ? [{ label: t("Dosya geçmişi"), onClick: () => { s.setHistoryPath(r.path); s.setView("history"); } }] : []),
      { sep: true as const },
      { label: t("Yolu kopyala"), onClick: () => a.copy(r.path) },
    ]);
  };

  return (
    <div className="view">
      <aside aria-label={t("Dosya ağacı")} style={{ width: 300, flexShrink: 0, borderRight: "1px solid var(--border-soft)", display: "flex", flexDirection: "column" }}>
        <div className="pane-head" style={{ borderBottom: "none" }}>
          <h1>{t("Dosyalar")}</h1>
          <div className="grow" />
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            {t("Yalnızca değişenler")}
            <Switch on={changedOnly} onChange={setChangedOnly} label={t("Yalnızca değişen dosyaları göster")} />
          </label>
        </div>
        <div style={{ padding: "0 12px 8px" }}>
          <div className="search" style={{ height: 30, background: "var(--field-2)" }}>
            <Icon name="search" size={13} />
            <input placeholder={t("Dosya ara")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Dosya ara")} />
          </div>
        </div>
        <div role="tree" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 8px 8px" }}>
          {visible.map((r) => {
            const st = statusMap.get(r.path);
            const dirChanged = r.dir && changedDirs.has(r.path);
            const isOpen = changedOnly || open.has(r.path);
            return (
              <div
                key={r.path}
                role="treeitem"
                aria-expanded={r.dir ? isOpen : undefined}
                className={"row" + (selected === r.path ? " sel" : "")}
                style={{ minHeight: 26, height: 26, gap: 6, paddingLeft: 8 + r.depth * 16, color: r.ignored ? "var(--text-3)" : undefined }}
                onClick={() => (r.dir ? !changedOnly && toggle(r.path) : setSelected(r.path))}
                onDoubleClick={() => !r.dir && api.openEditor(repo, r.path, s.settings.editor).catch(ui.error)}
                onContextMenu={(e) => menu(e, r)}
              >
                <span style={{ width: 12, display: "inline-flex" }}>{r.dir && <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={10} width={2} color="var(--text-3)" />}</span>
                {r.dir ? <Icon name="folder" color="#4a86d8" fill="rgba(74,134,216,0.22)" width={1.2} /> : <Icon name="file" color="var(--text-3)" width={1.3} />}
                <span className="ellipsis" style={{ flex: 1, textDecoration: st === "D" ? "line-through" : undefined, fontWeight: selected === r.path ? 600 : 400 }}>{r.name}</span>
                {st && <span style={{ fontSize: 11.5, fontWeight: 700, color: st === "D" || st === "X" ? "var(--del-fg)" : st === "?" || st === "A" ? "var(--add-fg)" : "var(--mod-fg)" }}>{st === "?" ? "U" : st === "X" ? "!" : st}</span>}
                {dirChanged && !st && <span style={{ width: 6, height: 6, borderRadius: 3, background: "var(--mod-fg)" }} />}
              </div>
            );
          })}
        </div>
      </aside>
      <section aria-label={t("Dosya önizleme")} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {selected ? (
          <>
            <div className="pane-head">
              <span className="ellipsis">
                <span className="muted">{selected.split("/").slice(0, -1).join(" / ")}{selected.includes("/") ? " / " : ""}</span>
                <b>{basename(selected)}</b>
              </span>
              {statusMap.get(selected) && <StatusLetter s={statusMap.get(selected)!} />}
              <div className="grow" />
              <button className="btn ghost" onClick={() => { s.setHistoryPath(selected); s.setView("history"); }}>{t("Geçmiş")}</button>
              <button className="btn" onClick={() => api.openEditor(repo, selected, s.settings.editor).catch(ui.error)}>
                <Icon name="external" size={14} /> {t("Editörde aç")}
              </button>
              <button className="iconbtn" style={{ border: "1px solid var(--btn-border)", width: 30, height: 30 }} title={t("Dosya Gezgini'nde göster")} aria-label={t("Dosya Gezgini'nde göster")} onClick={() => api.reveal(repo, selected).catch(ui.error)}>
                <Icon name="folder" size={14} />
              </button>
            </div>
            {!content ? (
              <div className="empty">{t("Dosya okunamadı")}</div>
            ) : content.binary ? (
              <div className="empty">{t("İkili (binary) dosya ·")} {(content.size / 1024).toFixed(1)} {t("KB")}</div>
            ) : content.too_large ? (
              <div className="empty">{t("Dosya önizleme için çok büyük")}</div>
            ) : (
              <div className="code" style={{ flex: 1, overflow: "auto", padding: "10px 0" }}>
                <div style={{ minWidth: "fit-content" }}>
                  {lines.map((l, i) => (
                    <div key={i} className="ln">
                      <span className="no">{i + 1}</span>
                      <span className="txt"><Code text={l} lang={lang} /></span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="empty">
            <Icon name="folder" size={34} color="var(--text-3)" width={1.2} />
            {t("Önizlemek için bir dosya seçin")}
          </div>
        )}
      </section>
    </div>
  );
}
