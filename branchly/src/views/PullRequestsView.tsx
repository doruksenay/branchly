// Bitbucket Cloud pull request'leri
import { t } from "../i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errText, git, type RepoRef } from "../api";
import { useStore } from "../store";
import { useActions } from "../actions";
import { Icon } from "../components/Icon";
import { Avatar, Modal, useUi } from "../components/ui";
import { DiffViewer } from "../components/DiffViewer";
import { relative } from "../lib/format";

type Filter = "mine-review" | "mine" | "open" | "merged";

const STATE: Record<string, { label: string; bg: string; fg: string; icon: string }> = {
  OPEN: { label: t("Açık"), bg: "var(--ok-bg)", fg: "var(--ok-fg)", icon: "var(--accent)" },
  MERGED: { label: t("Birleştirildi"), bg: "var(--muted-bg)", fg: "var(--text-2)", icon: "var(--text-3)" },
  DECLINED: { label: t("Reddedildi"), bg: "var(--del-bg)", fg: "var(--del-fg)", icon: "var(--del-fg)" },
  SUPERSEDED: { label: t("Yerini aldı"), bg: "var(--muted-bg)", fg: "var(--text-2)", icon: "var(--text-3)" },
};

function reviewState(pr: any): { label: string; bg: string; fg: string } | null {
  const parts: any[] = pr.participants ?? [];
  if (parts.some((p) => p.state === "changes_requested")) return { label: t("Değişiklik istendi"), bg: "var(--mod-bg)", fg: "var(--mod-fg)" };
  if (parts.some((p) => p.approved)) return { label: t("Onaylandı"), bg: "var(--ok-bg)", fg: "var(--ok-fg)" };
  if (pr.state === "OPEN") return { label: t("İnceleme bekliyor"), bg: "var(--accent-soft)", fg: "var(--accent-text)" };
  return null;
}

export function PullRequestsView({ bbUser, onConnect }: { bbUser: any | null; onConnect: () => void }) {
  const s = useStore();
  const ui = useUi();
  const repo = s.repo!.root;
  const [ref, setRef] = useState<RepoRef | null | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>("open");
  const [prs, setPrs] = useState<any[] | null>(null);
  const [builds, setBuilds] = useState<Record<number, string>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.bbRepo(repo).then(setRef).catch(() => setRef(null));
  }, [repo]);

  const base = ref ? `/repositories/${encodeURIComponent(ref.workspace)}/${encodeURIComponent(ref.slug)}` : "";

  const load = useCallback(async () => {
    if (!ref || !bbUser) return;
    setError(null);
    setPrs(null);
    const uuid = bbUser.uuid as string;
    let q = 'state="OPEN"';
    if (filter === "mine-review") q = `state="OPEN" AND reviewers.uuid="${uuid}"`;
    if (filter === "mine") q = `state="OPEN" AND author.uuid="${uuid}"`;
    if (filter === "merged") q = 'state="MERGED"';
    const state = filter === "merged" ? "&state=MERGED" : "";
    try {
      const r = await api.bb("GET", `${base}/pullrequests?pagelen=30&sort=-updated_on${state}&fields=%2Bvalues.participants&q=${encodeURIComponent(q)}`);
      const list = r?.values ?? [];
      setPrs(list);
      if (list.length && (selected === null || !list.some((p: any) => p.id === selected))) setSelected(list[0].id);
      // Build durumlarını arka planda getir
      for (const pr of list.slice(0, 15)) {
        api
          .bb("GET", `${base}/pullrequests/${pr.id}/statuses?pagelen=10`)
          .then((st) => {
            const v: any[] = st?.values ?? [];
            const agg = v.length === 0 ? "" : v.some((x) => x.state === "FAILED" || x.state === "STOPPED") ? "FAILED" : v.some((x) => x.state === "INPROGRESS") ? "INPROGRESS" : "SUCCESSFUL";
            setBuilds((b) => ({ ...b, [pr.id]: agg }));
          })
          .catch(() => {});
      }
    } catch (e) {
      setError(errText(e));
      setPrs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, bbUser, filter, base]);

  useEffect(() => {
    load();
  }, [load]);

  if (!bbUser)
    return (
      <div className="view">
        <div className="empty">
          <Icon name="pr" size={36} color="var(--accent)" width={1.2} />
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{t("Bitbucket'a bağlanın")}</div>
          <div style={{ maxWidth: 420, lineHeight: 1.5 }}>{t("Pull request'leri görmek, incelemek ve oluşturmak için Bitbucket hesabınızı OAuth ile bağlayın.")}</div>
          <button className="btn primary" onClick={onConnect}>{t("Bitbucket ile giriş yap")}</button>
        </div>
      </div>
    );
  if (ref === undefined) return <div className="view"><div className="empty"><span className="spinner" /></div></div>;
  if (ref === null)
    return (
      <div className="view">
        <div className="empty">
          <Icon name="cloud" size={34} color="var(--text-3)" width={1.2} />
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{t("Bu repository Bitbucket'ta değil")}</div>
          <div>{t("Remote (origin) adresi bitbucket.org'u göstermiyor.")}</div>
        </div>
      </div>
    );

  return (
    <div className="view">
      <section aria-label={t("Pull request listesi")} style={{ width: 420, flexShrink: 0, borderRight: "1px solid var(--border-soft)", display: "flex", flexDirection: "column" }}>
        <div className="pane-head" style={{ borderBottom: "none" }}>
          <h1>{t("Pull request'ler")}</h1>
          <div className="grow" />
          <button className="iconbtn" aria-label={t("Yenile")} title={t("Yenile")} onClick={load}>
            <Icon name="refresh" size={14} />
          </button>
          <button className="btn primary sm" style={{ height: 30 }} onClick={() => setCreating(true)}>
            <Icon name="plus" size={13} width={1.8} /> {t("Yeni PR")}
          </button>
        </div>
        <div style={{ padding: "0 16px 12px", borderBottom: "1px solid var(--border-soft)" }}>
          <div className="seg">
            <button className={filter === "open" ? "on" : ""} onClick={() => setFilter("open")}>{t("Açık")}</button>
            <button className={filter === "mine-review" ? "on" : ""} onClick={() => setFilter("mine-review")}>{t("Bana atanan")}</button>
            <button className={filter === "mine" ? "on" : ""} onClick={() => setFilter("mine")}>{t("Benim")}</button>
            <button className={filter === "merged" ? "on" : ""} onClick={() => setFilter("merged")}>{t("Birleşen")}</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {prs === null && <div className="empty" style={{ paddingTop: 40 }}><span className="spinner" /></div>}
          {error && <div className="empty" style={{ color: "var(--del-fg)" }}>{error}</div>}
          {prs && prs.length === 0 && !error && <div className="empty" style={{ paddingTop: 40 }}>{t("Pull request yok")}</div>}
          {prs?.map((pr) => {
            const rs = reviewState(pr);
            const st = STATE[pr.state] ?? STATE.OPEN;
            const b = builds[pr.id];
            return (
              <button
                key={pr.id}
                onClick={() => setSelected(pr.id)}
                style={{ display: "flex", gap: 12, width: "100%", padding: "14px 18px", border: "none", borderBottom: "1px solid var(--border-soft)", background: selected === pr.id ? "var(--accent-soft)" : "transparent", textAlign: "left" }}
              >
                <Icon name="pr" color={st.icon} style={{ marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                  <div className="ellipsis" style={{ fontSize: 13.5, fontWeight: 600 }}>{pr.title}</div>
                  <div className="ellipsis faint" style={{ fontSize: 12 }}>
                    #{pr.id} · {pr.author?.display_name} · {pr.source?.branch?.name} → {pr.destination?.branch?.name}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                    {rs ? <span className="pill" style={{ background: rs.bg, color: rs.fg }}>{rs.label}</span> : <span className="pill" style={{ background: st.bg, color: st.fg }}>{st.label}</span>}
                    {b && (
                      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: b === "SUCCESSFUL" ? "var(--add-fg)" : b === "FAILED" ? "var(--del-fg)" : "var(--mod-fg)" }}>
                        <span style={{ width: 7, height: 7, borderRadius: 4, background: "currentColor" }} />
                        {b === "SUCCESSFUL" ? t("Build başarılı") : b === "FAILED" ? t("Build başarısız") : t("Build sürüyor")}
                      </span>
                    )}
                    <div className="grow" />
                    <span className="faint" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
                      <Icon name="comment" size={13} />
                      {pr.comment_count ?? 0}
                    </span>
                    <span className="faint" style={{ fontSize: 12 }}>{relative(pr.updated_on)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
      {selected !== null ? (
        <PrDetail key={selected} base={base} id={selected} me={bbUser} onChanged={load} />
      ) : (
        <div className="empty">{t("Bir pull request seçin")}</div>
      )}
      {creating && <CreatePr base={base} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setFilter("open"); setSelected(id); load(); }} />}
    </div>
  );
}

function PrDetail({ base, id, me, onChanged }: { base: string; id: number; me: any; onChanged: () => void }) {
  const s = useStore();
  const a = useActions();
  const ui = useUi();
  const [pr, setPr] = useState<any>(null);
  const [tab, setTab] = useState<"overview" | "files" | "commits">("overview");
  const [comments, setComments] = useState<any[]>([]);
  const [statuses, setStatuses] = useState<any[]>([]);
  const [diffstat, setDiffstat] = useState<any[] | null>(null);
  const [commits, setCommits] = useState<any[] | null>(null);
  const [diffText, setDiffText] = useState<string | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const url = `${base}/pullrequests/${id}`;

  const reload = useCallback(async () => {
    try {
      const [p, c, st] = await Promise.all([api.bb("GET", url), api.bb("GET", `${url}/comments?pagelen=100`), api.bb("GET", `${url}/statuses?pagelen=20`)]);
      setPr(p);
      setComments((c?.values ?? []).filter((x: any) => !x.deleted));
      setStatuses(st?.values ?? []);
    } catch (e) {
      ui.error(e, t("Pull request okunamadı"));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (tab === "files" && diffstat === null) {
      api.bb("GET", `${url}/diffstat?pagelen=200`).then((r) => setDiffstat(r?.values ?? [])).catch((e) => (ui.error(e), setDiffstat([])));
      api.bb("GET", `${url}/diff`).then((r) => setDiffText(typeof r === "string" ? r : "")).catch(() => setDiffText(""));
    }
    if (tab === "commits" && commits === null) api.bb("GET", `${url}/commits?pagelen=50`).then((r) => setCommits(r?.values ?? [])).catch(() => setCommits([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const fileDiffs = useMemo(() => {
    const m = new Map<string, string>();
    if (!diffText) return m;
    const parts = diffText.split(/^(?=diff --git )/m);
    for (const p of parts) {
      const mm = /^diff --git a\/(.+?) b\/(.+)$/m.exec(p);
      if (mm) m.set(mm[2].trim(), p);
    }
    return m;
  }, [diffText]);

  if (!pr) return <div className="empty"><span className="spinner" /></div>;

  const mine = (pr.participants ?? []).find((p: any) => p.user?.uuid === me.uuid);
  const approved = !!mine?.approved;
  const requested = mine?.state === "changes_requested";
  const reviewers = (pr.participants ?? []).filter((p: any) => p.role === "REVIEWER" || p.approved || p.state);
  const st = STATE[pr.state] ?? STATE.OPEN;
  const rs = reviewState(pr);
  const buildOk = statuses.length > 0 && statuses.every((x) => x.state === "SUCCESSFUL");
  const anyApproval = (pr.participants ?? []).some((p: any) => p.approved);
  const isOpen = pr.state === "OPEN";

  const act = (label: string, method: string, path: string, body?: any) =>
    s.run(label, async () => {
      await api.bb(method, path, body ?? null);
      await reload();
      onChanged();
    });

  const checkoutBranch = () =>
    s.run(t("Dalı checkout et"), async () => {
      const name = pr.source.branch.name;
      await git(s.repo!.root, ["fetch", "origin", name]);
      const r = await api.exec(s.repo!.root, ["switch", name]);
      if (!r.ok) await git(s.repo!.root, ["switch", "-c", name, "--track", `origin/${name}`]);
    }, t("{b} dalına geçildi", { b: pr.source.branch.name }));

  const merge = async () => {
    const r = await ui.prompt({ title: t("#{id} birleştirilsin mi?", { id: pr.id }), label: t("Birleştirme commit mesajı"), value: `Merged in ${pr.source.branch.name} (pull request #${pr.id})`, checkbox: t("Kaynak dalı kapat"), ok: t("Birleştir") });
    if (!r) return;
    await act(t("Birleştir"), "POST", `${url}/merge`, { type: "pullrequest", message: r.value, close_source_branch: r.checked });
  };

  const sendComment = async () => {
    if (!reply.trim()) return;
    await act(t("Yorum"), "POST", `${url}/comments`, { content: { raw: reply.trim() }, ...(replyTo ? { parent: { id: replyTo } } : {}) });
    setReply("");
    setReplyTo(null);
  };

  // Yorumları dizilere ayır
  const roots = comments.filter((c) => !c.parent);
  const childrenOf = (cid: number) => comments.filter((c) => c.parent?.id === cid);

  return (
    <section aria-label={t("Pull request ayrıntısı")} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "20px 28px 0", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="pill" style={{ background: st.bg, color: st.fg, height: 22 }}>{st.label}</span>
          {rs && isOpen && <span className="pill" style={{ background: rs.bg, color: rs.fg, height: 22 }}>{rs.label}</span>}
          <div className="grow" />
          <button className="btn" onClick={checkoutBranch}>{t("Dalı checkout et")}</button>
          <button className="btn" onClick={() => api.openUrl(pr.links.html.href)}>
            <Icon name="external" size={13} /> {t("Bitbucket'ta aç")}
          </button>
        </div>
        <h2 className="selectable" style={{ margin: "14px 0 8px", fontSize: 22, fontWeight: 650, lineHeight: 1.25 }}>{pr.title}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-2)", flexWrap: "wrap" }}>
          <Avatar name={pr.author?.display_name ?? "?"} size={22} url={pr.author?.links?.avatar?.href} />
          <b style={{ color: "var(--text)" }}>{pr.author?.display_name}</b>
          <span className="mono" style={{ fontSize: 12, padding: "2px 8px", borderRadius: 6, background: "var(--field-2)", color: "var(--text)" }}>{pr.source?.branch?.name}</span>
          <Icon name="arrowRight" size={14} color="var(--text-3)" />
          <span className="mono" style={{ fontSize: 12, padding: "2px 8px", borderRadius: 6, background: "var(--field-2)", color: "var(--text)" }}>{pr.destination?.branch?.name}</span>
          <span>· {relative(pr.created_on)}</span>
        </div>
        <div role="tablist" style={{ display: "flex", gap: 22, marginTop: 18, borderBottom: "1px solid var(--border-soft)" }}>
          {(
            [
              ["overview", t("Genel bakış"), comments.length],
              ["files", t("Dosyalar"), diffstat?.length ?? ""],
              ["commits", t("Commit'ler"), commits?.length ?? ""],
            ] as const
          ).map(([k, label, n]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              style={{ height: 38, padding: 0, border: "none", borderBottom: `2px solid ${tab === k ? "var(--accent)" : "transparent"}`, background: "transparent", fontWeight: tab === k ? 600 : 400, color: tab === k ? "var(--text)" : "var(--text-2)" }}
            >
              {label} {n !== "" && n !== 0 && <span className="faint">{n}</span>}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 28, padding: "20px 28px", overflow: "auto" }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
            <div className="selectable" style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{pr.description?.trim() || <span className="faint">{t("Açıklama yok")}</span>}</div>
            <div className="label">{t("Etkinlik")}</div>
            {roots.length === 0 && <div className="faint">{t("Henüz yorum yok")}</div>}
            {roots.map((c) => (
              <div key={c.id} style={{ border: "1px solid var(--border-soft)", borderRadius: 12, overflow: "hidden" }}>
                {c.inline && (
                  <div style={{ display: "flex", gap: 8, padding: "9px 14px", background: "var(--hunk-bg)", borderBottom: "1px solid var(--border-soft)", fontSize: 12 }}>
                    <span className="mono">{c.inline.path}</span>
                    <span className="faint">{t("· satır")} {c.inline.to ?? c.inline.from}</span>
                  </div>
                )}
                {[c, ...childrenOf(c.id)].map((x, i) => (
                  <div key={x.id} style={{ display: "flex", gap: 10, padding: i === 0 ? 14 : "0 14px 14px 50px" }}>
                    <Avatar name={x.user?.display_name ?? "?"} size={26} url={x.user?.links?.avatar?.href} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5 }}>
                        <b>{x.user?.display_name}</b> <span className="faint">· {relative(x.created_on)}</span>
                      </div>
                      <div className="selectable" style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{x.content?.raw}</div>
                    </div>
                  </div>
                ))}
                <div style={{ padding: "0 14px 10px 50px" }}>
                  <button className="btn sm ghost" style={{ color: "var(--accent-text)" }} onClick={() => setReplyTo(c.id)}>{t("Yanıtla")}</button>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {replyTo && (
                <div className="faint" style={{ fontSize: 12 }}>
                  {t("Yanıt yazılıyor ·")}{" "} <button className="btn sm ghost" onClick={() => setReplyTo(null)}>{t("vazgeç")}</button>
                </div>
              )}
              <textarea className="field" rows={3} placeholder={replyTo ? t("Yanıt yaz…") : t("Yorum yaz…")} value={reply} onChange={(e) => setReply(e.target.value)} />
              <div>
                <button className="btn" disabled={!reply.trim()} onClick={sendComment}>{t("Gönder")}</button>
              </div>
            </div>
          </div>
          <aside style={{ width: 270, flexShrink: 0, display: "flex", flexDirection: "column", gap: 20 }}>
            {isOpen && (
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" style={{ flex: 1, height: 34 }} onClick={() => act(requested ? t("İsteği kaldır") : t("Değişiklik iste"), requested ? "DELETE" : "POST", `${url}/request-changes`)}>
                  {requested ? t("İsteği kaldır") : t("Değişiklik iste")}
                </button>
                <button className="btn primary" style={{ flex: 1, height: 34 }} onClick={() => act(approved ? t("Onayı geri al") : t("Onayla"), approved ? "DELETE" : "POST", `${url}/approve`)}>
                  <Icon name="check" size={14} width={1.8} /> {approved ? t("Onayı geri al") : t("Onayla")}
                </button>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="label">{t("İnceleyenler")}</div>
              {reviewers.length === 0 && <div className="faint">{t("İnceleyen yok")}</div>}
              {reviewers.map((p: any) => (
                <div key={p.user?.uuid} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Avatar name={p.user?.display_name ?? "?"} size={22} url={p.user?.links?.avatar?.href} />
                  <span className="ellipsis" style={{ flex: 1 }}>{p.user?.display_name}</span>
                  {p.approved ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--add-fg)" }}>
                      <Icon name="check" size={12} width={2} /> {t("Onayladı")}
                    </span>
                  ) : p.state === "changes_requested" ? (
                    <span style={{ fontSize: 12, color: "var(--mod-fg)" }}>{t("Değişiklik istedi")}</span>
                  ) : (
                    <span className="faint" style={{ fontSize: 12 }}>{t("Bekliyor")}</span>
                  )}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="label">{t("Pipelines")}</div>
              {statuses.length === 0 && <div className="faint">{t("Build bilgisi yok")}</div>}
              {statuses.map((b) => (
                <button key={b.key} onClick={() => b.url && api.openUrl(b.url)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, border: "none", textAlign: "left", background: b.state === "SUCCESSFUL" ? "var(--ok-bg)" : b.state === "FAILED" ? "var(--del-bg)" : "var(--warn-bg)" }}>
                  <Icon name={b.state === "SUCCESSFUL" ? "checkCircle" : b.state === "FAILED" ? "xCircle" : "history"} color={b.state === "SUCCESSFUL" ? "var(--add-fg)" : b.state === "FAILED" ? "var(--del-fg)" : "var(--warn-icon)"} />
                  <span className="ellipsis" style={{ flex: 1, fontWeight: 500 }}>{b.name}</span>
                  <span style={{ fontSize: 12 }}>{b.state === "SUCCESSFUL" ? t("Başarılı") : b.state === "FAILED" ? t("Başarısız") : b.state === "INPROGRESS" ? t("Sürüyor") : b.state}</span>
                </button>
              ))}
            </div>
            {isOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="label">{t("Birleştirme")}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name={anyApproval ? "check" : "circle"} size={14} color={anyApproval ? "var(--add-fg)" : "var(--text-3)"} width={anyApproval ? 2 : 1.5} /> {t("En az 1 onay")}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Icon name={buildOk ? "check" : "circle"} size={14} color={buildOk ? "var(--add-fg)" : "var(--text-3)"} width={buildOk ? 2 : 1.5} /> {t("Başarılı build")}
                </div>
                <div className="faint" style={{ fontSize: 12 }}>{t("Repository kuralları Bitbucket tarafında denetlenir.")}</div>
                <button className="btn" style={{ height: 34, marginTop: 4 }} onClick={merge}>{t("Birleştir")}</button>
              </div>
            )}
          </aside>
        </div>
      )}

      {tab === "files" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          <div style={{ width: 300, flexShrink: 0, overflowY: "auto", borderRight: "1px solid var(--border-soft)", padding: 8 }}>
            {diffstat === null && <div className="empty"><span className="spinner" /></div>}
            {diffstat?.map((d, i) => {
              const p = d.new?.path ?? d.old?.path;
              return (
                <div key={i} className={"row" + (file === p ? " sel" : "")} style={{ height: 30 }} onClick={() => setFile(p)}>
                  <span className={"status-letter st-" + (d.status === "added" ? "A" : d.status === "removed" ? "D" : d.status === "renamed" ? "R" : "M")}>
                    {d.status === "added" ? "A" : d.status === "removed" ? "D" : d.status === "renamed" ? "R" : "M"}
                  </span>
                  <span className="ellipsis" style={{ flex: 1 }} title={p}>{p}</span>
                  <span style={{ fontSize: 12, color: "var(--add-fg)" }}>+{d.lines_added}</span>
                  <span style={{ fontSize: 12, color: "var(--del-fg)" }}>−{d.lines_removed}</span>
                </div>
              );
            })}
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            {file ? (
              diffText === null ? (
                <div className="empty"><span className="spinner" /></div>
              ) : (
                <DiffViewer text={fileDiffs.get(file) ?? ""} path={file} mode="readonly" emptyText={t("Bu dosya için fark gösterilemiyor")} />
              )
            ) : (
              <div className="empty">{t("Farkı görmek için bir dosya seçin")}</div>
            )}
          </div>
        </div>
      )}

      {tab === "commits" && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "8px 20px" }}>
          {commits === null && <div className="empty"><span className="spinner" /></div>}
          {commits?.map((c) => (
            <div key={c.hash} className="row" style={{ height: 40 }}>
              <Avatar name={c.author?.user?.display_name ?? c.author?.raw ?? "?"} size={22} />
              <span className="ellipsis" style={{ flex: 1 }}>{(c.message ?? "").split("\n")[0]}</span>
              <span className="faint" style={{ fontSize: 12 }}>{relative(c.date)}</span>
              <button className="btn sm ghost mono" onClick={() => a.copy(c.hash)}>{c.hash.slice(0, 7)}</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CreatePr({ base, onClose, onCreated }: { base: string; onClose: () => void; onCreated: (id: number) => void }) {
  const s = useStore();
  const a = useActions();
  const ui = useUi();
  const branch = s.status?.branch ?? "";
  const [dest, setDest] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [close, setClose] = useState(true);
  const [busy, setBusy] = useState(false);
  const locals = s.branches.filter((b) => b.kind === "local" && b.name !== branch).map((b) => b.name);
  const pushed = !!s.status?.upstream && s.status.ahead === 0;

  useEffect(() => {
    api.bb("GET", base).then((r) => setDest(r?.mainbranch?.name ?? "main")).catch(() => setDest("main"));
    git(s.repo!.root, ["log", "-1", "--format=%s"]).then((r) => setTitle(r.stdout.trim())).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.bb("POST", `${base}/pullrequests`, {
        title,
        description: desc,
        source: { branch: { name: branch } },
        destination: { branch: { name: dest } },
        close_source_branch: close,
      });
      ui.toast(t("#{id} oluşturuldu", { id: r.id }), "ok");
      onCreated(r.id);
    } catch (e) {
      ui.error(e, t("Pull request oluşturulamadı"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} width={560}>
      <h2>{t("Yeni pull request")}</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="mono" style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, background: "var(--field-2)" }}>{branch}</span>
        <Icon name="arrowRight" size={14} color="var(--text-3)" />
        <input className="field mono" style={{ width: 220, fontSize: 12 }} list="pr-dest" value={dest} onChange={(e) => setDest(e.target.value)} aria-label={t("Hedef dal")} />
        <datalist id="pr-dest">
          {locals.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </div>
      {!pushed && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: 10, background: "var(--warn-bg)", border: "1px solid var(--warn-border)" }}>
          <Icon name="warn" color="var(--warn-icon)" />
          <span style={{ flex: 1 }}>{t("Dalınızda push edilmemiş commit'ler var.")}</span>
          <button className="btn sm" onClick={a.push}>{t("Şimdi push et")}</button>
        </div>
      )}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="label">{t("Başlık")}</span>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="label">{t("Açıklama")}</span>
        <textarea className="field" rows={6} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t("Bu değişiklik ne yapıyor? (Markdown desteklenir)")} />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
        {t("Birleştirildikten sonra kaynak dalı kapat")}
      </label>
      <div className="actions">
        <button className="btn" onClick={onClose}>{t("Vazgeç")}</button>
        <button className="btn primary" disabled={busy || !title.trim() || !dest.trim() || !branch} onClick={create}>
          {busy ? t("Oluşturuluyor…") : t("Oluştur")}
        </button>
      </div>
    </Modal>
  );
}
