// Çakışma çözücü: Mevcut / Gelen panelleri ve düzenlenebilir Sonuç
import { t } from "../i18n";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { api, type ConflictInfo } from "../api";
import { useStore } from "../store";
import { useActions } from "../actions";
import { Icon } from "../components/Icon";
import { Switch, useUi } from "../components/ui";
import { compose, hasMarkers, linesFor, parseConflicts, type Choice, type Segment } from "../lib/conflict";
import { Code, langOf } from "../lib/highlight";
import { basename, dirname } from "../lib/format";

const OP_NAMES: Record<string, string> = {
  merge: "Merge",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
  rebase: "Rebase",
};

export function ConflictView() {
  const s = useStore();
  const a = useActions();
  const ui = useUi();
  const repo = s.repo!.root;
  const conflicted = (s.status?.files ?? []).filter((f) => f.conflict).map((f) => f.path);
  const [resolved, setResolved] = useState<string[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const op = s.op && s.op.kind !== "none" ? s.op : null;

  useEffect(() => {
    if (path && conflicted.includes(path)) return;
    setPath(conflicted[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.status]);

  const onResolved = (p: string) => {
    setResolved((r) => [...new Set([...r, p])]);
    const rest = conflicted.filter((x) => x !== p);
    setPath(rest[0] ?? null);
    if (rest.length === 0) ui.toast(op ? t("Tüm çakışmalar çözüldü. Devam edebilirsiniz.") : t("Tüm çakışmalar çözüldü. Değişiklikleri commit edebilirsiniz."), "ok");
  };

  return (
    <div className="view" style={{ flexDirection: "column" }}>
      {op && (
        <div className="banner" role="status">
          <Icon name="warn" size={18} color="var(--warn-icon)" />
          <div className="ellipsis" style={{ flex: 1 }}>
            <b>{OP_NAMES[op.kind]} {t("devam ediyor")}</b>
            <span className="muted">
              {op.head ? ` · ${op.head.slice(0, 7)}` : ""}
              {op.subject ? ` “${op.subject}”` : ""}
              {op.step && op.total ? " · " + t("adım {a}/{b}", { a: op.step, b: op.total }) : ""}
            </span>
          </div>
          <span className="muted" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
            {conflicted.length === 0 ? t("Tüm çakışmalar çözüldü") : t("{n} dosyada çakışma kaldı", { n: conflicted.length })}
          </span>
          <button className="btn" onClick={a.opAbort}>{t("İptal et")}</button>
          {op.kind !== "merge" && <button className="btn" onClick={a.opSkip}>{t("Atla")}</button>}
          <button className="btn primary" disabled={conflicted.length > 0} onClick={a.opContinue}>
            {op.kind === "merge" ? t("Merge commit'i oluştur") : t("Devam et")}
          </button>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <aside aria-label={t("Çakışan dosyalar")} style={{ width: 260, flexShrink: 0, borderRight: "1px solid var(--border-soft)", padding: "12px 8px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" }}>
          <div className="group-title">{t("Çakışan dosyalar ·")} {conflicted.length}</div>
          {conflicted.map((p) => (
            <button key={p} className={"row" + (p === path ? " sel" : "")} style={{ border: "none", background: p === path ? "var(--accent-soft)" : "transparent", textAlign: "left", padding: "8px 10px", alignItems: "center" }} onClick={() => setPath(p)}>
              <Icon name="warn" color="var(--warn-icon)" />
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span className="ellipsis" style={{ fontWeight: 600 }}>{basename(p)}</span>
                <span className="ellipsis faint" style={{ fontSize: 11.5 }}>{dirname(p) || "/"}</span>
              </span>
            </button>
          ))}
          {resolved.length > 0 && (
            <>
              <div className="group-title" style={{ marginTop: 12 }}>{t("Çözüldü ·")} {resolved.length}</div>
              {resolved.map((p) => (
                <div key={p} className="row" style={{ padding: "6px 10px" }}>
                  <Icon name="checkCircle" color="var(--add-fg)" />
                  <span className="ellipsis">{basename(p)}</span>
                </div>
              ))}
            </>
          )}
          <div style={{ marginTop: "auto", padding: 12, borderRadius: 10, background: "var(--field-2)", fontSize: 12, lineHeight: 1.6, color: "var(--text-2)" }}>
            <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 2 }}>{t("Kısayollar")}</div>
            <div>{t("Alt+↓ / Alt+↑ · sonraki / önceki çakışma")}</div>
            <div>{t("Alt+1 mevcut · Alt+2 gelen")}</div>
            <div>{t("Ctrl+S · kaydet ve çözüldü işaretle")}</div>
          </div>
        </aside>
        {path ? (
          <FileResolver key={path} repo={repo} path={path} onResolved={onResolved} />
        ) : (
          <div className="empty">
            <Icon name="checkCircle" size={36} color="var(--add-fg)" width={1.2} />
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{t("Çözülecek çakışma yok")}</div>
            {op ? <div>{t("“{x}” ile işlemi tamamlayabilirsiniz.", { x: op.kind === "merge" ? t("Merge commit'i oluştur") : t("Devam et") })}</div> : <div>{t("Değişiklikler ekranından commit edebilirsiniz.")}</div>}
            {!op && (
              <button className="btn" onClick={() => s.setView("changes")}>{t("Değişikliklere git")}</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type C = Extract<Segment, { type: "conflict" }>;

function FileResolver({ repo, path, onResolved }: { repo: string; path: string; onResolved: (p: string) => void }) {
  const s = useStore();
  const ui = useUi();
  const [info, setInfo] = useState<ConflictInfo | null>(null);
  const [choices, setChoices] = useState<Record<number, Choice | undefined>>({});
  const [showBase, setShowBase] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const [cur, setCur] = useState(0);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const expand = (si: number) => setExpanded((x) => new Set([...x, si]));
  const lang = langOf(path);
  const panes = useRef<(HTMLDivElement | null)[]>([]);
  const resultRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  useEffect(() => {
    api.conflict(repo, path).then(setInfo).catch((e) => ui.error(e, t("Çakışma okunamadı")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, path]);

  const parsed = useMemo(() => (info?.kind === "text" ? parseConflicts(info.merged) : null), [info]);
  const blocks = useMemo(() => (parsed ? (parsed.segments.filter((x) => x.type === "conflict") as C[]) : []), [parsed]);
  const done = blocks.filter((b) => choices[b.id]).length;
  const allDone = blocks.length > 0 && done === blocks.length;

  const choose = (id: number, c: Choice | undefined) => {
    setChoices((x) => ({ ...x, [id]: c }));
    const next = blocks.find((b) => b.id !== id && !choices[b.id]);
    if (c && next) setTimeout(() => go(blocks.indexOf(next)), 60);
  };
  const go = (i: number) => {
    if (!blocks.length) return;
    const idx = (i + blocks.length) % blocks.length;
    setCur(idx);
    const id = blocks[idx].id;
    document.getElementById(`res-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    document.getElementById(`pane0-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const save = async () => {
    if (!parsed) return;
    const text = manual ?? compose(parsed, choices);
    if (hasMarkers(text)) {
      const ok = await ui.confirm({ title: t("Dosyada hâlâ çakışma işaretleri var"), text: t("<<<<<<< / ======= / >>>>>>> satırları içeren dosya yine de çözüldü olarak işaretlensin mi?"), ok: t("Yine de kaydet"), danger: true });
      if (!ok) return;
    }
    setSaving(true);
    const r = await s.run(t("Çakışmayı kaydet"), () => api.resolveWrite(repo, path, text).then(() => true));
    setSaving(false);
    if (r) onResolved(path);
  };

  const take = async (side: "ours" | "theirs" | "delete") => {
    const r = await s.run(t("Çakışmayı çöz"), () => api.resolveTake(repo, path, side).then(() => true));
    if (r) onResolved(path);
  };

  // Kısayollar
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowDown") (e.preventDefault(), go(cur + 1));
      else if (e.altKey && e.key === "ArrowUp") (e.preventDefault(), go(cur - 1));
      else if (e.altKey && e.key === "1" && blocks[cur]) choose(blocks[cur].id, "ours");
      else if (e.altKey && e.key === "2" && blocks[cur]) choose(blocks[cur].id, "theirs");
      else if (e.ctrlKey && e.key.toLowerCase() === "s") (e.preventDefault(), (allDone || manual !== null) && save());
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const header = (
    <div className="pane-head" style={{ height: 46 }}>
      <span className="ellipsis">
        <span className="muted">{dirname(path) ? dirname(path) + "/" : ""}</span>
        <b>{basename(path)}</b>
      </span>
      {info?.kind === "text" && (
        <span className="pill" style={{ background: allDone ? "var(--ok-bg)" : "var(--warn-bg)", color: allDone ? "var(--ok-fg)" : "var(--warn-fg)" }}>
          {done}/{blocks.length} {t("çözüldü")}
        </span>
      )}
      <div className="grow" />
      {info?.kind === "text" && manual === null && (
        <>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <Switch on={showBase} onChange={setShowBase} label={t("Temel (base) sürümü göster")} />
            {t("Temel")}
          </label>
          <div className="divider-v" />
          <button className="iconbtn" aria-label={t("Önceki çakışma")} title={t("Alt+↑")} onClick={() => go(cur - 1)}>
            <Icon name="arrowUp" size={14} />
          </button>
          <button className="iconbtn" aria-label={t("Sonraki çakışma")} title={t("Alt+↓")} onClick={() => go(cur + 1)}>
            <Icon name="arrowDown" size={14} />
          </button>
          <span className="muted" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
            {Math.min(cur + 1, blocks.length)} / {blocks.length}
          </span>
          <button
            className="btn sm"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              ui.menu(r.left, r.bottom + 4, [
                { label: t("Tüm çakışmalarda mevcudu al"), onClick: () => setChoices(Object.fromEntries(blocks.map((b) => [b.id, "ours" as Choice]))) },
                { label: t("Tüm çakışmalarda geleni al"), onClick: () => setChoices(Object.fromEntries(blocks.map((b) => [b.id, "theirs" as Choice]))) },
                { label: t("Seçimleri sıfırla"), onClick: () => setChoices({}) },
                { sep: true },
                { label: t("Harici editörde aç"), onClick: () => api.openEditor(repo, path, s.settings.editor).catch(ui.error) },
              ]);
            }}
          >
            {t("Tümü")}{" "} <Icon name="chevronDown" size={11} />
          </button>
        </>
      )}
      {info?.kind === "text" && (
        <button className="btn sm" onClick={() => setManual(manual === null ? compose(parsed!, choices) : null)}>
          {manual === null ? t("Elle düzenle") : t("Seçimlere dön")}
        </button>
      )}
      {info?.kind === "text" && (
        <button className="btn primary sm" disabled={saving || (!allDone && manual === null)} onClick={save} title={t("Ctrl+S")}>
          <Icon name="check" size={13} /> {t("Çözüldü işaretle")}
        </button>
      )}
    </div>
  );

  if (!info) return <section style={{ flex: 1 }} className="empty"><span className="spinner" /></section>;

  if (info.kind !== "text") {
    const deleted = info.kind === "deleted";
    return (
      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {header}
        <div className="empty">
          <Icon name="warn" size={32} color="var(--warn-icon)" width={1.3} />
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>
            {deleted ? (info.ours_exists ? t("Gelen tarafta bu dosya silinmiş") : t("Mevcut tarafta bu dosya silinmiş")) : t("İkili (binary) dosyada çakışma")}
          </div>
          <div style={{ maxWidth: 440 }}>
            {deleted ? t("Dosyanın bir tarafta değiştirildiği, diğer tarafta silindiği bir çakışma. Hangi sonucun kalacağını seçin.") : t("İkili dosyalar satır satır birleştirilemez. Hangi sürümün kalacağını seçin.")}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {info.ours_exists && <button className="btn ours" onClick={() => take("ours")}>{t("Mevcut sürümü kullan")}</button>}
            {info.theirs_exists && <button className="btn theirs" onClick={() => take("theirs")}>{t("Gelen sürümü kullan")}</button>}
            {deleted && <button className="btn danger" onClick={() => take("delete")}>{t("Dosyayı sil")}</button>}
          </div>
        </div>
      </section>
    );
  }

  // Satır numaraları: her taraf için ayrı sayaç
  const cols: { key: "ours" | "theirs" | "base"; title: string; sub: string; color: string; bg: string; border: string; text: string }[] = [
    { key: "ours", title: t("Mevcut"), sub: s.status?.branch ? `HEAD · ${s.status.branch}` : "HEAD", color: "var(--ours)", bg: "var(--ours-bg)", border: "var(--ours-border)", text: "var(--ours-text)" },
    ...(showBase ? [{ key: "base" as const, title: t("Temel"), sub: t("ortak ata"), color: "var(--text-3)", bg: "var(--muted-bg)", border: "var(--border)", text: "var(--text-2)" }] : []),
    { key: "theirs", title: t("Gelen"), sub: s.op?.head ? `${s.op.head.slice(0, 7)}${s.op.kind !== "none" ? " · " + s.op.kind : ""}` : t("gelen değişiklik"), color: "var(--theirs)", bg: "var(--theirs-bg)", border: "var(--theirs-border)", text: "var(--theirs-text)" },
  ];

  const onPaneScroll = (i: number) => {
    if (syncing.current) return;
    syncing.current = true;
    const top = panes.current[i]?.scrollTop ?? 0;
    const left = panes.current[i]?.scrollLeft ?? 0;
    panes.current.forEach((p, j) => {
      if (p && j !== i) {
        p.scrollTop = top;
        p.scrollLeft = left;
      }
    });
    requestAnimationFrame(() => (syncing.current = false));
  };

  const LH = 21;
  // Uzun ortak bölümleri daraltarak gösterir (tüm panellerde aynı hizada kalır)
  const commonBlock = (si: number, lines: string[], start: number) => {
    const KEEP = 4;
    if (expanded.has(si) || lines.length <= KEEP * 2 + 3) return <Fragment key={si}>{lines.map((t, i) => line(start + i, t, i))}</Fragment>;
    const hidden = lines.length - KEEP * 2;
    return (
      <Fragment key={si}>
        {lines.slice(0, KEEP).map((t, i) => line(start + i, t, i))}
        <button
          onClick={() => expand(si)}
          style={{ display: "block", width: "100%", height: LH, border: "none", background: "var(--hunk-bg)", color: "var(--text-3)", fontSize: 11.5, textAlign: "left", paddingLeft: 54, fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif" }}
        >
          ⋯ {t("{n} değişmeyen satır", { n: hidden })}
        </button>
        {lines.slice(lines.length - KEEP).map((t, i) => line(start + lines.length - KEEP + i, t, "e" + i))}
      </Fragment>
    );
  };
  const line = (n: number | string, text: string, key: string | number, extra?: React.CSSProperties) => (
    <div key={key} className="ln" style={extra}>
      <span className="no">{n}</span>
      <span className="txt"><Code text={text} lang={lang} /></span>
    </div>
  );

  return (
    <section aria-label={t("Birleştirme düzenleyicisi")} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      {header}
      {manual !== null ? (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "8px 20px", fontSize: 12.5, background: "var(--hunk-bg)", borderBottom: "1px solid var(--border-soft)" }} className="muted">
            {t("Sonucu serbestçe düzenleyin. Çözülmemiş bloklar çakışma işaretleriyle gösterilir.")}
          </div>
          <textarea
            className="mono"
            spellCheck={false}
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            style={{ flex: 1, border: "none", outline: "none", resize: "none", padding: "12px 20px", fontSize: 12.5, lineHeight: "21px", background: "var(--content)", whiteSpace: "pre", tabSize: 4 }}
          />
        </div>
      ) : (
        <>
          <div style={{ height: "46%", minHeight: 180, flexShrink: 0, display: "flex", borderBottom: "1px solid var(--border)" }}>
            {cols.map((c, ci) => {
              let n = 0;
              return (
                <div key={c.key} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", borderRight: ci < cols.length - 1 ? "1px solid var(--border-soft)" : undefined }}>
                  <div style={{ height: 36, flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "0 10px 0 16px", borderBottom: "1px solid var(--border-soft)", fontSize: 12.5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: c.color }} />
                    <b>{c.title}</b>
                    <span className="faint ellipsis">{c.sub}</span>
                    <div className="grow" />
                    {c.key !== "base" && (
                      <button className="btn sm ghost" style={{ color: c.text }} onClick={() => setChoices(Object.fromEntries(blocks.map((b) => [b.id, c.key as Choice])))}>
                        {t("Tümünü al")}
                      </button>
                    )}
                  </div>
                  <div ref={(el) => (panes.current[ci] = el)} onScroll={() => onPaneScroll(ci)} className="code" style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
                    <div style={{ minWidth: "fit-content" }}>
                      {parsed!.segments.map((seg, si) => {
                        if (seg.type === "common") {
                          { const el = commonBlock(si, seg.lines, n + 1); n += seg.lines.length; return el; }
                        }
                        const mine = seg[c.key];
                        const max = Math.max(seg.ours.length, seg.theirs.length, showBase ? seg.base.length : 0);
                        const ch = choices[seg.id];
                        const used = ch && c.key !== "base" && (ch === c.key || ch === "ours-theirs" || ch === "theirs-ours");
                        const unused = ch && c.key !== "base" && !used;
                        const active = blocks[cur]?.id === seg.id;
                        return (
                          <div
                            key={si}
                            id={`pane${ci}-${seg.id}`}
                            style={{
                              background: used ? "var(--ok-bg)" : unused ? "var(--muted-bg)" : c.bg,
                              borderTop: `1px solid ${used ? "transparent" : c.border}`,
                              borderBottom: `1px solid ${used ? "transparent" : c.border}`,
                              boxShadow: active ? `inset 3px 0 0 ${c.color}` : undefined,
                            }}
                          >
                            <div style={{ height: 28, display: "flex", alignItems: "center", gap: 10, padding: "0 10px 0 54px", fontSize: 11.5, userSelect: "none", position: "sticky", left: 0, width: "fit-content" }}>
                              <b style={{ color: used ? "var(--ok-fg)" : c.text, fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif" }}>
                                {t("Çakışma")} {blocks.indexOf(seg) + 1}
                                {used ? t(" · sonuca alındı") : unused ? t(" · kullanılmadı") : ""}
                              </b>
                              {c.key !== "base" && !used && (
                                <button className={"btn sm " + c.key} style={{ height: 22, fontSize: 11.5 }} onClick={() => choose(seg.id, c.key as Choice)}>
                                  {t("Bunu al")}
                                </button>
                              )}
                            </div>
                            <div style={{ opacity: unused ? 0.55 : 1, textDecoration: unused ? "line-through" : undefined }}>
                              {mine.map((t, k) => line(++n, t, k))}
                            </div>
                            {Array.from({ length: max - mine.length }).map((_, k) => (
                              <div key={"pad" + k} style={{ height: LH }} />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ height: 36, flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "0 10px 0 16px", borderBottom: "1px solid var(--border-soft)", fontSize: 12.5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--add-fg)" }} />
              <b>{t("Sonuç")}</b>
              <span className="faint">{path}</span>
              <div className="grow" />
              <button className="btn sm ghost" onClick={() => setChoices({})}>{t("Sıfırla")}</button>
            </div>
            <div ref={resultRef} className="code" style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
              <div style={{ minWidth: "fit-content" }}>
                {(() => {
                  let n = 0;
                  return parsed!.segments.map((seg, si) => {
                    if (seg.type === "common") { const el = commonBlock(si, seg.lines, n + 1); n += seg.lines.length; return el; }
                    const ch = choices[seg.id];
                    const num = blocks.indexOf(seg) + 1;
                    if (ch) {
                      const names: Record<Choice, string> = { ours: t("mevcut alındı"), theirs: t("gelen alındı"), "ours-theirs": t("önce mevcut, sonra gelen"), "theirs-ours": t("önce gelen, sonra mevcut") };
                      return (
                        <div key={si} id={`res-${seg.id}`} style={{ background: "var(--ok-bg)" }}>
                          <div style={{ height: 24, display: "flex", alignItems: "center", gap: 8, padding: "0 10px 0 54px", fontSize: 11.5, color: "var(--ok-fg)", fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif", userSelect: "none" }}>
                            <Icon name="check" size={12} width={1.8} />
                            {t("Çakışma")} {num} · {names[ch]}
                            <button className="btn sm ghost" style={{ height: 20, color: "var(--accent-text)" }} onClick={() => choose(seg.id, undefined)}>{t("Değiştir")}</button>
                          </div>
                          {linesFor(seg, ch).map((t, k) => line(++n, t, k))}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={si}
                        id={`res-${seg.id}`}
                        style={{
                          margin: "6px 20px 6px 54px",
                          padding: "12px 14px",
                          border: `1.5px dashed ${blocks[cur]?.id === seg.id ? "var(--accent)" : "var(--btn-border)"}`,
                          borderRadius: 10,
                          background: "var(--panel)",
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                          fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif",
                          userSelect: "none",
                          width: "min(760px, calc(100vw - 700px))",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Icon name="warn" color="var(--warn-icon)" />
                          <b style={{ fontSize: 13 }}>{t("Çakışma")} {num} {t("çözülmedi")}</b>
                          <span className="muted" style={{ fontSize: 12.5 }}>
                            {t("Mevcut {a} satır · Gelen {b} satır", { a: seg.ours.length, b: seg.theirs.length })}
                          </span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          <button className="btn ours" onClick={() => choose(seg.id, "ours")}>{t("Mevcut'u al")}</button>
                          <button className="btn theirs" onClick={() => choose(seg.id, "theirs")}>{t("Geleni al")}</button>
                          <button className="btn" onClick={() => choose(seg.id, "ours-theirs")}>{t("Önce mevcut, sonra gelen")}</button>
                          <button className="btn" onClick={() => choose(seg.id, "theirs-ours")}>{t("Önce gelen, sonra mevcut")}</button>
                          <button className="btn ghost" style={{ color: "var(--accent-text)" }} onClick={() => setManual(compose(parsed!, choices))}>{t("Elle düzenle")}</button>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

