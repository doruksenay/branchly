// Diff görüntüleyici: hunk ve satır bazında stage / unstage / geri alma
import { t } from "../i18n";
import { useEffect, useMemo, useState } from "react";
import { allChangeLines, buildPatch, parseDiff, type FileDiff } from "../lib/diff";
import { Code, langOf } from "../lib/highlight";
import { Icon } from "./Icon";

export type DiffMode = "unstaged" | "staged" | "readonly";
export type PatchAction = "stage" | "unstage" | "discard";

export function DiffViewer({
  text,
  path,
  mode,
  onPatch,
  emptyText = t("Değişiklik yok"),
}: {
  text: string;
  path: string;
  mode: DiffMode;
  onPatch?: (patch: string, action: PatchAction) => void;
  emptyText?: string;
}) {
  const files = useMemo(() => parseDiff(text), [text]);
  const file: FileDiff | undefined = files[0];
  const [sel, setSel] = useState<Map<number, Set<number>>>(new Map());
  const [anchor, setAnchor] = useState<{ h: number; i: number } | null>(null);
  const lang = langOf(path);
  useEffect(() => {
    setSel(new Map());
    setAnchor(null);
  }, [text]);

  if (!file || file.hunks.length === 0) {
    const note = file?.headerLines.find((l) => l.startsWith("rename") || l.startsWith("old mode") || l.startsWith("Binary"));
    return <div className="empty">{note ? note : emptyText}</div>;
  }

  const count = [...sel.values()].reduce((a, s) => a + s.size, 0);
  const selectable = mode !== "readonly";

  const toggle = (h: number, i: number, shift: boolean) => {
    const next = new Map(sel);
    const set = new Set(next.get(h) ?? []);
    if (shift && anchor && anchor.h === h) {
      const [a, b] = [Math.min(anchor.i, i), Math.max(anchor.i, i)];
      const on = !set.has(i);
      for (const l of file.hunks[h].lines) if (l.idx >= a && l.idx <= b && l.kind !== "ctx") on ? set.add(l.idx) : set.delete(l.idx);
    } else {
      set.has(i) ? set.delete(i) : set.add(i);
      setAnchor({ h, i });
    }
    next.set(h, set);
    setSel(next);
  };

  const run = (action: PatchAction, selection: Map<number, Set<number>>) => {
    // stage ve discard, çalışma dizini diff'inden ileri yönlü yama kullanır;
    // unstage, indeks diff'ini ters uygular.
    const patch = buildPatch(file, selection, action === "unstage" ? "reverse" : "forward");
    if (patch && onPatch) onPatch(patch, action);
    setSel(new Map());
  };
  const hunkSel = (hi: number) => new Map([[hi, allChangeLines(file.hunks[hi])]]);

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
      <div className="mono" style={{ fontSize: 12.5, minWidth: "fit-content", paddingBottom: 80 }}>
        {file.hunks.map((h, hi) => (
          <div key={hi}>
            <div className="hunk-head">
              <span className="ellipsis" style={{ flex: 1 }}>
                {h.header}
              </span>
              {mode === "unstaged" && (
                <>
                  <button className="btn sm" onClick={() => run("stage", hunkSel(hi))}>{t("Hunk'ı stage'le")}</button>
                  <button className="btn sm ghost danger" onClick={() => run("discard", hunkSel(hi))}>{t("Geri al")}</button>
                </>
              )}
              {mode === "staged" && <button className="btn sm" onClick={() => run("unstage", hunkSel(hi))}>{t("Hunk'ı unstage et")}</button>}
            </div>
            {h.lines.map((l) => {
              const isSel = sel.get(hi)?.has(l.idx) ?? false;
              return (
                <div
                  key={l.idx}
                  className={"dl " + l.kind + (isSel ? " sel" : "")}
                  onMouseDown={(e) => {
                    if (!selectable || l.kind === "ctx" || e.button !== 0) return;
                    if ((e.target as HTMLElement).closest(".t") && !e.shiftKey && !(e.target as HTMLElement).closest(".gut")) return;
                    e.preventDefault();
                    toggle(hi, l.idx, e.shiftKey);
                  }}
                >
                  <span className="gut" title={selectable && l.kind !== "ctx" ? t("Satırı seç (Shift ile aralık)") : undefined} style={{ cursor: selectable && l.kind !== "ctx" ? "pointer" : "default" }}>
                    {selectable && l.kind !== "ctx" && <span className="box" />}
                  </span>
                  <span className="n">{l.oldNo ?? ""}</span>
                  <span className="n">{l.newNo ?? ""}</span>
                  <span className="sg">{l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}</span>
                  <span className="t selectable">
                    <Code text={l.text} lang={lang} />
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {count > 0 && (
        <div
          style={{
            position: "sticky",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            width: "fit-content",
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "6px 6px 6px 16px",
            borderRadius: 12,
            background: "#1d1d1f",
            color: "#fff",
            boxShadow: "var(--shadow)",
            whiteSpace: "nowrap",
            marginTop: -60,
          }}
        >
          <span style={{ marginRight: 10 }}>{t("{n} satır seçili", { n: count })}</span>
          {mode === "unstaged" && (
            <>
              <button className="btn primary" style={{ height: 30 }} onClick={() => run("stage", sel)}>{t("Seçilenleri stage'le")}</button>
              <button className="btn ghost" style={{ height: 30, color: "#fff" }} onClick={() => run("discard", sel)}>{t("Seçilenleri geri al")}</button>
            </>
          )}
          {mode === "staged" && <button className="btn primary" style={{ height: 30 }} onClick={() => run("unstage", sel)}>{t("Seçilenleri unstage et")}</button>}
          <button className="iconbtn" style={{ color: "#fff" }} aria-label={t("Seçimi temizle")} onClick={() => setSel(new Map())}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
