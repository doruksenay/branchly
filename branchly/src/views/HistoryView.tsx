// Geçmiş: commit grafiği, ayrıntı paneli, cherry-pick / revert / reset menüsü
import { t } from "../i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Commit, type CommitDetail } from "../api";
import { useStore } from "../store";
import { useActions } from "../actions";
import { layoutGraph, LANE_COLORS, type GraphRow } from "../lib/graph";
import { Avatar, StatusLetter, useUi } from "../components/ui";
import { Icon } from "../components/Icon";
import { DiffViewer } from "../components/DiffViewer";
import { longDate, shortDate } from "../lib/format";

const ROW = 36;
const LANE = 14;
const PAGE = 500;

export function HistoryView() {
  const s = useStore();
  const a = useActions();
  const ui = useUi();
  const repo = s.repo!.root;
  const [all, setAll] = useState(true);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [fileDiff, setFileDiff] = useState<{ path: string; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(800);
  const listRef = useRef<HTMLDivElement>(null);
  const headHash = s.status?.oid ?? null;

  // HEAD veya dallar değişince yeniden yükle
  const refsKey = s.branches.map((b) => b.full + b.short_oid).join("|") + (headHash ?? "");
  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api
      .log(repo, PAGE, 0, all, s.historyPath)
      .then((c) => {
        if (cancel) return;
        setCommits(c);
        setMore(c.length === PAGE);
      })
      .catch((e) => ui.error(e, t("Geçmiş okunamadı")))
      .finally(() => !cancel && setLoading(false));
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, all, refsKey, s.historyPath]);

  const loadMore = async () => {
    const c = await api.log(repo, PAGE, commits.length, all, s.historyPath).catch((e) => (ui.error(e), []));
    setCommits((x) => [...x, ...c]);
    setMore(c.length === PAGE);
  };

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!selected) return setDetail(null);
    setFileDiff(null);
    api.commitDetail(repo, selected).then(setDetail).catch((e) => ui.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, repo]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commits;
    const q = query.toLocaleLowerCase("tr");
    return commits.filter((c) => c.subject.toLocaleLowerCase("tr").includes(q) || c.author.toLocaleLowerCase("tr").includes(q) || c.hash.startsWith(q));
  }, [commits, query]);
  const graph = useMemo(() => layoutGraph(filtered), [filtered]);
  const graphW = Math.min(graph.maxLanes, 12) * LANE + 12;

  const localNames = new Set(s.branches.filter((b) => b.kind === "local").map((b) => b.name));
  const current = s.status?.branch;

  const start = Math.max(0, Math.floor(scrollTop / ROW) - 10);
  const end = Math.min(filtered.length, Math.ceil((scrollTop + height) / ROW) + 10);

  const openMenu = (e: React.MouseEvent, c: Commit) => {
    e.preventDefault();
    setSelected(c.hash);
    const short = c.hash.slice(0, 7);
    ui.menu(e.clientX, e.clientY, [
      { label: t("{b} dalına cherry-pick et", { b: current ?? "HEAD" }), hint: short, onClick: () => a.cherryPick(c.hash), disabled: c.parents.length > 1 },
      { label: t("Commit'i geri al (revert)"), onClick: () => a.revert(c.hash), disabled: c.parents.length > 1 },
      { sep: true },
      { label: t("Buradan dal oluştur…"), onClick: () => a.newBranch(c.hash) },
      { label: t("Etiket ekle…"), onClick: () => a.tag(c.hash) },
      { label: t("Bu commit'e geç (checkout)"), onClick: () => a.checkoutCommit(c.hash) },
      { sep: true },
      { label: t("{b} dalını buraya sıfırla", { b: current ?? "HEAD" }) + " — soft", onClick: () => a.reset(c.hash, "soft") },
      { label: t("{b} dalını buraya sıfırla", { b: current ?? "HEAD" }) + " — mixed", onClick: () => a.reset(c.hash, "mixed") },
      { label: t("{b} dalını buraya sıfırla", { b: current ?? "HEAD" }) + " — hard", danger: true, onClick: () => a.reset(c.hash, "hard") },
      { sep: true },
      { label: t("SHA'yı kopyala"), onClick: () => a.copy(c.hash) },
      { label: t("Mesajı kopyala"), onClick: () => a.copy(c.subject) },
    ]);
  };

  const chip = (r: string, i: number) => {
    let label = r;
    let cls = { bg: "var(--field-2)", fg: "var(--text)", bd: "var(--btn-border)" };
    if (r.startsWith("HEAD -> ")) {
      label = r.slice(8);
      cls = { bg: "var(--accent)", fg: "var(--on-accent)", bd: "var(--accent)" };
    } else if (r === "HEAD") {
      cls = { bg: "var(--accent)", fg: "var(--on-accent)", bd: "var(--accent)" };
    } else if (r.startsWith("tag: ")) {
      label = r.slice(5);
      cls = { bg: "var(--muted-bg)", fg: "var(--text-2)", bd: "var(--border)" };
    } else if (localNames.has(r)) {
      cls = { bg: "var(--theirs-bg)", fg: "var(--theirs-text)", bd: "var(--theirs-border)" };
    } else if (r.endsWith("/HEAD")) return null;
    else cls = { bg: "transparent", fg: "var(--text-2)", bd: "var(--btn-border)" };
    return (
      <span key={i} className="chip" style={{ background: cls.bg, color: cls.fg, borderColor: cls.bd }}>
        {r.startsWith("tag: ") && <Icon name="tag" size={11} style={{ marginRight: 3 }} />}
        {label}
      </span>
    );
  };

  return (
    <div className="view">
      <section aria-label={t("Commit geçmişi")} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <div className="pane-head">
          <h1>{t("Geçmiş")}</h1>
          {s.historyPath ? (
            <span className="pill" style={{ background: "var(--accent-soft)", color: "var(--accent-text)", gap: 6 }}>
              {s.historyPath}
              <button className="iconbtn" style={{ width: 16, height: 16 }} aria-label={t("Dosya filtresini kaldır")} onClick={() => s.setHistoryPath(null)}>
                <Icon name="close" size={10} />
              </button>
            </span>
          ) : (
            <span className="muted">{t("{n} commit", { n: commits.length + (more ? "+" : "") })}</span>
          )}
          <div className="grow" />
          <div className="search" style={{ width: 220, height: 30, background: "var(--field-2)" }}>
            <Icon name="search" size={13} />
            <input placeholder={t("Mesaj, yazar veya SHA")} value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t("Geçmişte ara")} />
          </div>
          <div className="seg">
            <button className={all ? "on" : ""} onClick={() => setAll(true)}>{t("Tüm dallar")}</button>
            <button className={!all ? "on" : ""} onClick={() => setAll(false)}>{t("Mevcut dal")}</button>
          </div>
        </div>
        <div style={{ height: 30, flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "0 20px", fontSize: 11.5, color: "var(--text-3)", borderBottom: "1px solid var(--border-soft)" }}>
          <span style={{ width: graphW, flexShrink: 0 }}>{t("Grafik")}</span>
          <span style={{ flex: 1 }}>{t("Açıklama")}</span>
          <span style={{ width: 140, flexShrink: 0 }}>{t("Yazar")}</span>
          <span style={{ width: 100, flexShrink: 0 }}>{t("Tarih")}</span>
          <span style={{ width: 64, flexShrink: 0 }}>{t("Commit")}</span>
        </div>
        <div ref={listRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", position: "relative" }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          {loading && commits.length === 0 && <div className="empty"><span className="spinner" /></div>}
          {!loading && commits.length === 0 && <div className="empty">{t("Henüz commit yok")}</div>}
          <div style={{ height: filtered.length * ROW + (more ? 56 : 0), position: "relative" }}>
            {filtered.slice(start, end).map((c, k) => {
              const i = start + k;
              const g = graph.rows[i];
              const sel = c.hash === selected;
              const isHead = c.hash === headHash;
              return (
                <div
                  key={c.hash}
                  onClick={() => setSelected(c.hash)}
                  onContextMenu={(e) => openMenu(e, c)}
                  style={{
                    position: "absolute",
                    top: i * ROW,
                    left: 0,
                    right: 0,
                    height: ROW,
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "0 20px",
                    background: sel ? "var(--accent-soft)" : undefined,
                    cursor: "default",
                  }}
                >
                  <GraphCell row={g} width={graphW} head={isHead} selected={sel} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                    {c.refs.map(chip)}
                    <span className="ellipsis" style={{ fontWeight: isHead ? 600 : 400 }}>{c.subject}</span>
                  </span>
                  <span style={{ width: 140, flexShrink: 0, display: "flex", alignItems: "center", gap: 7, color: "var(--text-2)" }}>
                    <Avatar name={c.author} size={20} />
                    <span className="ellipsis">{c.author}</span>
                  </span>
                  <span style={{ width: 100, flexShrink: 0, color: "var(--text-2)", fontSize: 12.5 }}>{shortDate(c.time)}</span>
                  <span className="mono" style={{ width: 64, flexShrink: 0, fontSize: 12, color: "var(--text-2)" }}>{c.hash.slice(0, 7)}</span>
                </div>
              );
            })}
            {more && (
              <div style={{ position: "absolute", top: filtered.length * ROW + 12, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
                <button className="btn sm" onClick={loadMore}>{t("Daha fazla yükle")}</button>
              </div>
            )}
          </div>
        </div>
      </section>

      <aside aria-label={t("Commit ayrıntıları")} style={{ width: 420, flexShrink: 0, borderLeft: "1px solid var(--border-soft)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {!detail ? (
          <div className="empty">{t("Ayrıntıları görmek için bir commit seçin")}</div>
        ) : (
          <>
            <div style={{ padding: "20px 24px 14px", display: "flex", flexDirection: "column", gap: 14, overflowY: "auto", maxHeight: fileDiff ? "46%" : undefined, flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="faint" style={{ fontSize: 12 }}>{t("Commit")}</span>
                <span className="mono selectable" style={{ fontSize: 12, padding: "2px 8px", borderRadius: 6, background: "var(--field-2)" }}>{detail.hash.slice(0, 10)}</span>
                <button className="iconbtn" aria-label={t("SHA'yı kopyala")} onClick={() => a.copy(detail.hash)}>
                  <Icon name="copy" size={14} />
                </button>
              </div>
              <div className="selectable">
                <h2 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 650, lineHeight: 1.3 }}>{detail.body.split("\n")[0]}</h2>
                {detail.body.includes("\n") && (
                  <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.55, color: "var(--text-2)" }}>{detail.body.split("\n").slice(1).join("\n").trim()}</p>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "88px minmax(0,1fr)", rowGap: 8, alignItems: "center" }}>
                <span className="faint">{t("Yazar")}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <Avatar name={detail.author} />
                  <span className="ellipsis selectable" title={detail.email}>{detail.author}</span>
                </span>
                <span className="faint">{t("Tarih")}</span>
                <span>{longDate(detail.time)}</span>
                <span className="faint">{t("Üst commit")}</span>
                <span className="mono" style={{ fontSize: 12, display: "flex", gap: 8 }}>
                  {detail.parents.map((p) => (
                    <button key={p} className="btn sm ghost mono" style={{ padding: "0 4px", height: 22 }} onClick={() => setSelected(p)}>
                      {p.slice(0, 7)}
                    </button>
                  ))}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => a.cherryPick(detail.hash)} disabled={detail.parents.length > 1}>{t("Cherry-pick")}</button>
                <button className="btn" onClick={() => a.revert(detail.hash)} disabled={detail.parents.length > 1}>{t("Revert")}</button>
                <button className="btn" onClick={() => a.newBranch(detail.hash)}>{t("Dal oluştur")}</button>
              </div>
              <div>
                <div className="label" style={{ paddingBottom: 6 }}>{t("Değişen dosyalar ·")} {detail.files.length}</div>
                {detail.files.map((f) => (
                  <div
                    key={f.path}
                    className={"row" + (fileDiff?.path === f.path ? " sel" : "")}
                    style={{ height: 30, padding: "0 6px" }}
                    onClick={async () => {
                      const d = await api.commitFileDiff(repo, detail.hash, f.path, detail.parents.length).catch((e) => (ui.error(e), null));
                      if (d) setFileDiff({ path: f.path, text: d.binary ? "" : d.text });
                    }}
                  >
                    <StatusLetter s={f.status} />
                    <span className="ellipsis" style={{ flex: 1 }} title={f.old_path ? `${f.old_path} → ${f.path}` : f.path}>{f.path}</span>
                    {f.added >= 0 && <span style={{ fontSize: 12, color: "var(--add-fg)" }}>+{f.added}</span>}
                    {f.deleted >= 0 && <span style={{ fontSize: 12, color: "var(--del-fg)" }}>−{f.deleted}</span>}
                  </div>
                ))}
              </div>
            </div>
            {fileDiff && (
              <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", borderTop: "1px solid var(--border-soft)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 16px", background: "var(--hunk-bg)" }}>
                  <span className="mono ellipsis" style={{ flex: 1, fontSize: 12 }}>{fileDiff.path}</span>
                  <button className="iconbtn" aria-label={t("Farkı kapat")} onClick={() => setFileDiff(null)}>
                    <Icon name="close" size={13} />
                  </button>
                </div>
                <DiffViewer text={fileDiff.text} path={fileDiff.path} mode="readonly" emptyText={t("İkili dosya veya içerik farkı yok")} />
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function GraphCell({ row, width, head, selected }: { row: GraphRow | undefined; width: number; head: boolean; selected: boolean }) {
  if (!row) return <span style={{ width, flexShrink: 0 }} />;
  const x = (l: number) => 8 + l * LANE;
  const mid = ROW / 2;
  const col = (c: number) => LANE_COLORS[c % LANE_COLORS.length];
  const paths = row.edges.map((e, i) => {
    const x1 = x(e.fromLane);
    const x2 = x(e.toLane);
    let d = "";
    if (e.half === "full") d = `M${x1} 0V${ROW}`;
    else if (e.half === "top") d = x1 === x2 ? `M${x1} 0V${mid}` : `M${x1} 0C${x1} ${mid * 0.8} ${x2} ${mid * 0.4} ${x2} ${mid}`;
    else d = x1 === x2 ? `M${x1} ${mid}V${ROW}` : `M${x1} ${mid}C${x1} ${mid + mid * 0.6} ${x2} ${mid + mid * 0.2} ${x2} ${ROW}`;
    return <path key={i} d={d} stroke={col(e.color)} strokeWidth={2} fill="none" />;
  });
  const cx = x(row.lane);
  const c = col(row.color);
  const ring = selected ? "var(--accent-soft)" : "var(--content)";
  return (
    <svg width={width} height={ROW} style={{ flexShrink: 0, overflow: "visible" }} aria-hidden="true">
      {paths}
      {head ? (
        <>
          <circle cx={cx} cy={mid} r={6.5} fill={ring} stroke={c} strokeWidth={2} />
          <circle cx={cx} cy={mid} r={3} fill={c} />
        </>
      ) : row.isMerge ? (
        <circle cx={cx} cy={mid} r={4.5} fill={ring} stroke={c} strokeWidth={2} />
      ) : (
        <circle cx={cx} cy={mid} r={4.5} fill={c} stroke={ring} strokeWidth={2} />
      )}
    </svg>
  );
}
