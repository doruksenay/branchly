// Değişiklikler: stage / unstage, satır bazında staging, stash ve commit
import { t } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { api, git, type FileStatus } from "../api";
import { useStore } from "../store";
import { useActions } from "../actions";
import { DiffViewer, type PatchAction } from "../components/DiffViewer";
import { Icon } from "../components/Icon";
import { StatusLetter, useUi } from "../components/ui";
import { basename, dirname, shortDate } from "../lib/format";
import { diffStats, parseDiff } from "../lib/diff";

type Sel = { path: string; staged: boolean } | null;

export function ChangesView() {
  const s = useStore();
  const a = useActions();
  const ui = useUi();
  const repo = s.repo!.root;
  const files = s.status?.files ?? [];
  const unstaged = files.filter((f) => !f.conflict && (f.untracked || f.y !== "."));
  const staged = files.filter((f) => !f.conflict && !f.untracked && f.x !== ".");
  const conflicted = files.filter((f) => f.conflict);
  const [sel, setSel] = useState<Sel>(null);
  const [diff, setDiff] = useState<{ text: string; binary: boolean; too_large: boolean } | null>(null);
  const [msg, setMsg] = useState("");
  const [desc, setDesc] = useState("");
  const [amend, setAmend] = useState(false);
  const [committing, setCommitting] = useState(false);

  // Seçili dosya listeden çıkarsa en yakın dosyayı seç
  useEffect(() => {
    const list = sel?.staged ? staged : unstaged;
    if (sel && list.some((f) => f.path === sel.path)) return;
    if (unstaged[0]) setSel({ path: unstaged[0].path, staged: false });
    else if (staged[0]) setSel({ path: staged[0].path, staged: true });
    else setSel(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.status]);

  const selFile: FileStatus | undefined = sel ? (sel.staged ? staged : unstaged).find((f) => f.path === sel.path) : undefined;

  useEffect(() => {
    if (!sel || !selFile) return setDiff(null);
    let cancel = false;
    api
      .diff(repo, sel.path, sel.staged, !sel.staged && selFile.untracked)
      .then((d) => !cancel && setDiff(d))
      .catch((e) => {
        if (cancel) return;
        setDiff({ text: "", binary: false, too_large: false });
        ui.error(e, t("Fark alınamadı"));
      });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.path, sel?.staged, s.tick]);

  // amend seçilince son mesajı getir
  useEffect(() => {
    if (!amend) return;
    git(repo, ["log", "-1", "--format=%B"])
      .then((r) => {
        const [first, ...rest] = r.stdout.trim().split("\n");
        setMsg(first ?? "");
        setDesc(rest.join("\n").trim());
      })
      .catch(() => {});
  }, [amend, repo]);

  const stage = (paths: string[]) => s.run(t("Stage"), () => git(repo, ["add", "-A", "--", ...paths]));
  const unstage = (paths: string[]) =>
    s.run(t("Unstage"), async () => {
      const r = await api.exec(repo, ["reset", "-q", "HEAD", "--", ...paths]);
      if (!r.ok) await git(repo, ["rm", "--cached", "-q", "-r", "--", ...paths]); // ilk commit öncesi
    });
  const discard = async (list: FileStatus[]) => {
    const n = list.length;
    if (!(await ui.confirm({ title: n === 1 ? t("{x} geri alınsın mı?", { x: basename(list[0].path) }) : t("{n} dosyadaki değişiklikler geri alınsın mı?", { n }), text: t("Bu işlem geri alınamaz. Yeni dosyalar silinir."), ok: t("Geri al"), danger: true }))) return;
    const tracked = list.filter((f) => !f.untracked).map((f) => f.path);
    const untracked = list.filter((f) => f.untracked).map((f) => f.path);
    await s.run(t("Geri al"), () => api.discard(repo, tracked, untracked));
  };

  const onPatch = (patch: string, action: PatchAction) => {
    const label = action === "stage" ? t("Stage") : action === "unstage" ? "Unstage" : t("Geri al");
    const go = () =>
      s.run(label, () =>
        action === "stage"
          ? api.applyPatch(repo, patch, true, false)
          : action === "unstage"
            ? api.applyPatch(repo, patch, true, true)
            : selFile?.untracked
              ? Promise.reject(new Error(t("Yeni dosyada satır geri alma desteklenmiyor; dosyayı tümden geri alın.")))
              : api.applyPatch(repo, patch, false, true),
      );
    if (action === "discard") {
      ui.confirm({ title: t("Seçili değişiklikler geri alınsın mı?"), text: t("Bu işlem geri alınamaz."), ok: t("Geri al"), danger: true }).then((ok) => { if (ok) go(); });
    } else go();
  };

  const commit = async (andPush: boolean) => {
    const message = [msg.trim(), desc.trim()].filter(Boolean).join("\n\n");
    if (!message && !amend) return;
    if (staged.length === 0 && !amend) return ui.toast(t("Commit için önce dosya stage'leyin"), "error");
    setCommitting(true);
    const ok = await s.run(t("Commit"), async () => {
      await git(repo, ["commit", ...(amend ? ["--amend"] : []), ...(message ? ["-F", "-"] : ["--no-edit"])], message || null);
      return true;
    });
    setCommitting(false);
    if (ok) {
      setMsg("");
      setDesc("");
      setAmend(false);
      ui.toast(amend ? t("Commit düzeltildi") : t("Commit oluşturuldu"), "ok");
      if (andPush) await a.push();
    }
  };

  const fileRow = (f: FileStatus, isStaged: boolean) => {
    const active = sel?.path === f.path && sel.staged === isStaged;
    const letter = isStaged ? f.x : f.untracked ? "?" : f.y;
    const partial = !isStaged && !f.untracked && f.x !== "." && f.y !== ".";
    return (
      <div
        key={(isStaged ? "s:" : "u:") + f.path}
        className={"row" + (active ? " sel" : "")}
        style={{ height: 34 }}
        onClick={() => setSel({ path: f.path, staged: isStaged })}
        onDoubleClick={() => (isStaged ? unstage([f.path]) : stage([f.path]))}
        onContextMenu={(e) => {
          e.preventDefault();
          ui.menu(e.clientX, e.clientY, [
            isStaged ? { label: t("Unstage et"), onClick: () => unstage([f.path]) } : { label: t("Stage'le"), onClick: () => stage([f.path]) },
            ...(!isStaged ? [{ label: t("Değişiklikleri geri al…"), danger: true, onClick: () => discard([f]) }] : []),
            { sep: true as const },
            { label: t("Editörde aç"), onClick: () => api.openEditor(repo, f.path, s.settings.editor).catch(ui.error) },
            { label: t("Dosya Gezgini'nde göster"), onClick: () => api.reveal(repo, f.path).catch(ui.error) },
            { label: t("Dosya geçmişi"), onClick: () => { s.setHistoryPath(f.path); s.setView("history"); } },
            ...(f.untracked ? [{ label: t(".gitignore'a ekle"), onClick: () => addIgnore(f.path) }] : []),
            { label: t("Yolu kopyala"), onClick: () => a.copy(f.path) },
          ]);
        }}
      >
        <input
          type="checkbox"
          checked={isStaged}
          aria-label={isStaged ? t("{x} unstage et", { x: f.path }) : t("{x} stage'le", { x: f.path })}
          style={{ margin: 0, width: 15, height: 15, accentColor: "var(--accent)" }}
          onClick={(e) => e.stopPropagation()}
          onChange={() => (isStaged ? unstage([f.path]) : stage([f.path]))}
        />
        <StatusLetter s={letter} />
        <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{basename(f.path)}</span>
        <span className="ellipsis faint" style={{ flex: 1, fontSize: 12 }}>{f.orig_path ? `${f.orig_path} →` : dirname(f.path)}</span>
        {partial && <span className="faint" style={{ fontSize: 11.5 }}>{t("kısmi")}</span>}
      </div>
    );
  };

  const addIgnore = (path: string) =>
    s.run(t(".gitignore"), async () => {
      const cur = await api.readFile(repo, ".gitignore").catch(() => ({ content: "" }));
      const content = (cur.content && !cur.content.endsWith("\n") ? cur.content + "\n" : cur.content) + path + "\n";
      await writeFile(repo, ".gitignore", content);
    });

  const stats = useMemo(() => (diff ? diffStats(parseDiff(diff.text)) : null), [diff]);
  const canCommit = (msg.trim().length > 0 || amend) && (staged.length > 0 || amend) && !committing;

  return (
    <div className="view">
      <section aria-label={t("Değişen dosyalar")} style={{ width: 380, flexShrink: 0, borderRight: "1px solid var(--border-soft)", display: "flex", flexDirection: "column" }}>
        <div className="pane-head">
          <h1>{t("Değişiklikler")}</h1>
          <span className="muted">{t("{n} dosya", { n: files.length })}</span>
          <div className="grow" />
          <button className="btn sm" disabled={unstaged.length === 0} onClick={() => stage(unstaged.map((f) => f.path))}>{t("Tümünü stage'le")}</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 2 }}>
          {conflicted.length > 0 && (
            <button className="row" style={{ border: "1px solid var(--warn-border)", background: "var(--warn-bg)", height: 40, marginBottom: 8, textAlign: "left" }} onClick={() => s.setView("conflicts")}>
              <Icon name="warn" color="var(--warn-icon)" />
              <span style={{ flex: 1, fontWeight: 600 }}>{t("{n} dosyada çakışma var", { n: conflicted.length })}</span>
              <span style={{ color: "var(--accent-text)" }}>{t("Çöz →")}</span>
            </button>
          )}
          {files.length === 0 && (
            <div className="row" style={{ height: 40, color: "var(--text-2)", cursor: "default" }}>
              <Icon name="checkCircle" color="var(--add-fg)" />
              {t("Commit edilecek değişiklik yok")}
            </div>
          )}
          {files.length > 0 && <div className="group-title">
            <span>{t("Stage'lenmemiş ·")} {unstaged.length}</span>
            {unstaged.length > 0 && (
              <button className="btn sm ghost danger" onClick={() => discard(unstaged)}>{t("Tümünü geri al")}</button>
            )}
          </div>}
          {unstaged.map((f) => fileRow(f, false))}
          {files.length > 0 && <div className="group-title" style={{ marginTop: 10 }}>
            <span>{t("Stage'lendi ·")} {staged.length}</span>
            {staged.length > 0 && <button className="btn sm ghost" onClick={() => unstage(staged.map((f) => f.path))}>{t("Tümünü unstage et")}</button>}
          </div>}
          {staged.map((f) => fileRow(f, true))}

          <div className="group-title" style={{ marginTop: 10 }}>
            <span>{t("Stash'ler ·")} {s.stashes.length}</span>
            <button className="btn sm ghost" onClick={a.stash} disabled={files.length === 0}>{t("Stash'le")}</button>
          </div>
          {s.stashes.length === 0 && <div className="faint" style={{ padding: "2px 10px 8px", fontSize: 12 }}>{t("Stash yok")}</div>}
          {s.stashes.map((st) => (
            <div key={st.name} className="row" style={{ minHeight: 44 }}>
              <Icon name="stash" color="var(--text-3)" />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span className="ellipsis" style={{ fontWeight: 500 }}>{st.message.replace(/^On [^:]+: /, "")}</span>
                <span className="faint ellipsis" style={{ fontSize: 11.5 }}>{shortDate(st.time)}</span>
              </div>
              <div className="row-actions">
                <button className="btn sm" title={t("Uygula (stash kalır)")} onClick={() => a.stashApply(st.name, false)}>{t("Uygula")}</button>
                <button className="btn sm" title={t("Uygula ve stash'i sil")} onClick={() => a.stashApply(st.name, true)}>{t("Pop")}</button>
                <button className="iconbtn" aria-label={t("Stash'i sil")} onClick={() => a.stashDrop(st.name)}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ flexShrink: 0, borderTop: "1px solid var(--border-soft)", padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label" style={{ display: "flex", justifyContent: "space-between" }}>
              {t("Commit mesajı")}{" "} <span className="faint" style={{ fontWeight: 400 }}>{msg.length}/72</span>
            </span>
            <input
              className="field"
              value={msg}
              placeholder={t("Kısa özet")}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && e.ctrlKey && canCommit && commit(false)}
            />
          </label>
          <textarea className="field" aria-label={t("Açıklama")} placeholder={t("Açıklama (isteğe bağlı)")} rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={amend} onChange={(e) => setAmend(e.target.checked)} style={{ margin: 0, accentColor: "var(--accent)" }} />
            {t("Son commit'i düzenle (amend)")}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary" style={{ flex: 1, height: 34 }} disabled={!canCommit} onClick={() => commit(false)} title={t("Ctrl+Enter")}>
              {amend ? t("Commit'i düzelt") : t("Commit · {n} dosya", { n: staged.length })}
            </button>
            <button className="btn" style={{ height: 34 }} disabled={!canCommit} onClick={() => commit(true)}>{t("Commit ve Push")}</button>
          </div>
        </div>
      </section>

      <section aria-label={t("Fark görünümü")} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {sel && selFile ? (
          <>
            <div className="pane-head">
              <Icon name="file" color="var(--text-3)" />
              <span className="ellipsis">
                <span className="muted">{dirname(sel.path) ? dirname(sel.path) + "/" : ""}</span>
                <b>{basename(sel.path)}</b>
              </span>
              <span className="pill" style={{ background: "var(--field-2)", color: "var(--text-2)" }}>{sel.staged ? t("Stage'lendi") : t("Çalışma dizini")}</span>
              {stats && (
                <span style={{ fontSize: 12 }}>
                  <span style={{ color: "var(--add-fg)" }}>+{stats.add}</span> <span style={{ color: "var(--del-fg)" }}>−{stats.del}</span>
                </span>
              )}
              <div className="grow" />
              <button className="btn sm" onClick={() => api.openEditor(repo, sel.path, s.settings.editor).catch(ui.error)}>
                <Icon name="external" size={13} /> {t("Editörde aç")}
              </button>
            </div>
            {diff?.binary ? (
              <div className="empty">{t("İkili (binary) dosya — fark gösterilemiyor")}</div>
            ) : diff?.too_large ? (
              <div className="empty">{t("Dosya fark görünümü için çok büyük")}</div>
            ) : diff ? (
              <DiffViewer text={diff.text} path={sel.path} mode={sel.staged ? "staged" : "unstaged"} onPatch={onPatch} />
            ) : (
              <div className="empty"><span className="spinner" /></div>
            )}
          </>
        ) : (
          <div className="empty">
            <Icon name="checkCircle" size={36} color="var(--add-fg)" width={1.2} />
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{t("Çalışma dizini temiz")}</div>
            <div>{t("Commit edilecek değişiklik yok.")}</div>
          </div>
        )}
      </section>
    </div>
  );
}

async function writeFile(repo: string, rel: string, content: string) {
  // .gitignore için: resolve_write dosyayı yazar ve stage eder; burada istenen de budur.
  await api.resolveWrite(repo, rel, content);
}
