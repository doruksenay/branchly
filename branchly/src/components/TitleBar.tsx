import { t } from "../i18n";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "../store";
import { useActions } from "../actions";
import { Icon, WinIcon } from "./Icon";
import { useUi } from "./ui";
import markLight from "../assets/mark.png";
import markDark from "../assets/mark-dark.png";

export function TitleBar({ onPalette }: { onPalette: () => void }) {
  const s = useStore();
  const a = useActions();
  const ui = useUi();
  const win = getCurrentWindow();
  const st = s.status;
  const opLabel = s.op && s.op.kind !== "none" ? s.op.kind.toUpperCase() : null;

  const branchMenu = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const locals = s.branches.filter((b) => b.kind === "local");
    ui.menu(r.left, r.bottom + 4, [
      ...locals.slice(0, 12).map((b) => ({
        label: (b.head ? "✓ " : "   ") + b.name,
        hint: b.ahead || b.behind ? `↑${b.ahead} ↓${b.behind}` : undefined,
        onClick: () => !b.head && a.checkout(b.name),
      })),
      { sep: true as const },
      { label: t("Tüm dallar…"), onClick: pickBranch },
      { label: t("Yeni dal…"), onClick: () => a.newBranch() },
    ]);
  };

  const pickBranch = async () => {
    const items = s.branches
      .filter((b) => b.kind !== "tag")
      .map((b) => ({ value: b.kind + ":" + b.name, label: b.name, hint: b.kind === "remote" ? "uzak" : b.head ? "mevcut" : "" }));
    const v = await ui.pick({ title: t("Dala geç"), items, placeholder: t("Dal ara…") });
    if (!v) return;
    const [kind, ...rest] = v.split(":");
    a.checkout(rest.join(":"), kind === "remote");
  };

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <img src={s.theme === "dark" ? markDark : markLight} alt={t("Branchly")} />
        {s.repo ? (
          <button
            className="tb"
            style={{ fontWeight: 600, height: 30, padding: "0 8px" }}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              ui.menu(r.left, r.bottom + 4, [
                ...s.settings.recent
                  .filter((x) => x.root !== s.repo?.root)
                  .slice(0, 8)
                  .map((x) => ({ label: x.name, hint: x.root.length > 34 ? "…" + x.root.slice(-32) : x.root, onClick: () => s.openRepo(x.root) })),
                { sep: true as const },
                { label: t("Repository aç…"), onClick: () => window.dispatchEvent(new Event("branchly:open-repo")) },
                { label: t("Repository'yi kapat"), onClick: s.closeRepo },
              ]);
            }}
          >
            <span className="ellipsis" style={{ maxWidth: 150 }}>{s.repo.name}</span>
            <Icon name="chevronDown" size={12} color="var(--text-3)" width={1.8} />
          </button>
        ) : (
          <span style={{ fontWeight: 650, fontSize: 14 }} data-tauri-drag-region>{t("Branchly")}</span>
        )}
      </div>

      {s.repo && (
        <>
          <button className="btn" style={{ gap: 7 }} onClick={branchMenu} title={t("Dal değiştir")}>
            <Icon name="branch" color="var(--accent)" />
            <span className="ellipsis" style={{ maxWidth: 220 }}>{st?.branch ?? (st?.oid ? t("ayrık: {x}", { x: st.oid.slice(0, 7) }) : "…")}</span>
            {opLabel && <span className="pill" style={{ background: "var(--mod-bg)", color: "var(--mod-fg)", height: 18, borderRadius: 5, fontSize: 10.5 }}>{opLabel}</span>}
            {st && (st.ahead > 0 || st.behind > 0) && <span className="muted" style={{ fontSize: 12 }}>↑{st.ahead} ↓{st.behind}</span>}
            <Icon name="chevronDown" size={12} color="var(--text-3)" width={1.8} />
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: 4 }}>
            <button className="tb" onClick={a.fetch} disabled={!!s.busy}>
              <Icon name="fetch" />
              {t("Fetch")}
            </button>
            <button className="tb" onClick={a.pull} disabled={!!s.busy}>
              <Icon name="pull" />
              {t("Pull")}
              {!!st?.behind && <span className="badge">{st.behind}</span>}
            </button>
            <button className="tb" onClick={a.push} disabled={!!s.busy}>
              <Icon name="push" />
              {t("Push")}
              {!!st?.ahead && <span className="badge">{st.ahead}</span>}
            </button>
            <div className="divider-v" />
            <button className="tb icon" title={t("Stash (Ctrl+Shift+S)")} aria-label={t("Stash")} onClick={a.stash}>
              <Icon name="stash" />
            </button>
            <button className="tb icon" title={t("Yeni dal (Ctrl+Shift+N)")} aria-label={t("Yeni dal")} onClick={() => a.newBranch()}>
              <Icon name="branch" />
            </button>
            <button className="tb icon" title={t("Merge")} aria-label={t("Merge")} onClick={() => a.merge()}>
              <Icon name="merge" />
            </button>
            <div className="divider-v" />
            <button
              className={"tb icon" + (s.terminalOpen ? " active" : "")}
              title={t("Terminal (Ctrl+`)")}
              aria-label={t("Terminal")}
              aria-pressed={s.terminalOpen}
              onClick={() => s.setTerminalOpen((v) => !v)}
            >
              <Icon name="terminal" />
            </button>
            {s.busy && (
              <span style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 10, color: "var(--text-2)" }}>
                <span className="spinner" />
                {s.busy}…
              </span>
            )}
          </div>
        </>
      )}
      <div className="grow" data-tauri-drag-region style={{ alignSelf: "stretch" }} />
      <button className="search" style={{ width: 280, border: "none", cursor: "pointer" }} onClick={onPalette}>
        <Icon name="search" size={14} />
        <span style={{ flex: 1, textAlign: "left" }}>{t("Ara veya komut çalıştır")}</span>
        <kbd>{t("Ctrl K")}</kbd>
      </button>
      <div className="winctl">
        <button aria-label={t("Simge durumuna küçült")} onClick={() => win.minimize()}>
          <WinIcon kind="min" />
        </button>
        <button aria-label={t("Ekranı kapla")} onClick={() => win.toggleMaximize()}>
          <WinIcon kind="max" />
        </button>
        <button aria-label={t("Kapat")} className="close" onClick={() => win.close()}>
          <WinIcon kind="close" />
        </button>
      </div>
    </header>
  );
}
