import { t } from "../i18n";
import { useState } from "react";
import { useStore, conflictCount, type View } from "../store";
import { useActions } from "../actions";
import { Icon } from "./Icon";
import { Avatar, useUi } from "./ui";

export function Sidebar({ bbUser, onSettings }: { bbUser: any | null; onSettings: () => void }) {
  const s = useStore();
  const a = useActions();
  const ui = useUi();
  const [remotesOpen, setRemotesOpen] = useState<Record<string, boolean>>({});
  const [tagsOpen, setTagsOpen] = useState(false);
  const files = s.status?.files ?? [];
  const conflicts = conflictCount(s.status);
  const locals = s.branches.filter((b) => b.kind === "local");
  const remotes = s.branches.filter((b) => b.kind === "remote");
  const tags = s.branches.filter((b) => b.kind === "tag");
  const remoteNames = [...new Set(remotes.map((r) => r.name.split("/")[0]))];

  const nav = (v: View, icon: string, label: string, count?: number | string, warn?: boolean) => (
    <button className={"sb-item" + (s.view === v ? " active" : "")} onClick={() => s.setView(v)} aria-current={s.view === v ? "page" : undefined}>
      <Icon name={icon} color="var(--accent)" />
      <span style={{ flex: 1 }}>{label}</span>
      {count !== undefined && count !== 0 &&
        (warn ? (
          <span className="pill" style={{ background: "var(--mod-bg)", color: "var(--mod-fg)", height: 18 }}>{count}</span>
        ) : (
          <span className="count">{count}</span>
        ))}
    </button>
  );

  const localMenu = (e: React.MouseEvent, name: string, head: boolean) => {
    e.preventDefault();
    const cur = s.status?.branch;
    ui.menu(e.clientX, e.clientY, [
      { label: t("Bu dala geç"), disabled: head, onClick: () => a.checkout(name) },
      { label: t("{b} dalına merge et", { b: cur ?? "HEAD" }), disabled: head, onClick: () => a.merge(name) },
      { label: t("{b} dalını bunun üzerine rebase et", { b: cur ?? "HEAD" }), disabled: head, onClick: () => a.rebase(name) },
      { sep: true },
      { label: t("Buradan yeni dal…"), onClick: () => a.newBranch(name) },
      { label: t("Yeniden adlandır…"), onClick: () => a.renameBranch(name) },
      { label: t("Geçmişini göster"), onClick: () => s.setView("history") },
      { sep: true },
      { label: t("Dalı sil"), danger: true, disabled: head, onClick: () => a.deleteBranch(name) },
    ]);
  };

  return (
    <nav className="sidebar" aria-label={t("Kenar çubuğu")}>
      <div className="sb-section">
        <div className="sb-title">{t("Çalışma alanı")}</div>
        {conflicts > 0 || (s.op && s.op.kind !== "none") ? nav("conflicts", "warn", t("Çakışmalar"), conflicts || "!", true) : null}
        {nav("changes", "changes", t("Değişiklikler"), files.length)}
        {nav("history", "history", t("Geçmiş"))}
        {nav("files", "folder", t("Dosyalar"))}
        <button className="sb-item" onClick={() => s.setView("changes")}>
          <Icon name="stash" color="var(--accent)" />
          <span style={{ flex: 1 }}>{t("Stash'ler")}</span>
          {s.stashes.length > 0 && <span className="count">{s.stashes.length}</span>}
        </button>
      </div>

      <div className="sb-section">
        <div className="sb-title">
          {t("Dallar")}
          <button className="iconbtn" style={{ width: 20, height: 20 }} aria-label={t("Yeni dal")} onClick={() => a.newBranch()}>
            <Icon name="plus" size={12} />
          </button>
        </div>
        {locals.map((b) => (
          <button
            key={b.full}
            className="sb-item"
            title={b.upstream ? `${b.name} → ${b.upstream}` : b.name}
            onDoubleClick={() => !b.head && a.checkout(b.name)}
            onContextMenu={(e) => localMenu(e, b.name, b.head)}
          >
            <Icon name="branch" color={b.head ? "var(--accent)" : "var(--text-3)"} />
            <span className="ellipsis" style={{ flex: 1, fontWeight: b.head ? 600 : 400 }}>{b.name}</span>
            {(b.ahead > 0 || b.behind > 0) && <span className="count" style={{ fontSize: 11.5 }}>↑{b.ahead} ↓{b.behind}</span>}
          </button>
        ))}
      </div>

      {remoteNames.length > 0 && (
        <div className="sb-section">
          <div className="sb-title">{t("Remote'lar")}</div>
          {remoteNames.map((rn) => (
            <div key={rn}>
              <button className="sb-item" onClick={() => setRemotesOpen((o) => ({ ...o, [rn]: !o[rn] }))}>
                <Icon name="cloud" color="var(--text-3)" />
                <span style={{ flex: 1 }}>{rn}</span>
                <Icon name={remotesOpen[rn] ? "chevronDown" : "chevronRight"} size={12} color="var(--text-3)" width={1.8} />
              </button>
              {remotesOpen[rn] &&
                remotes
                  .filter((r) => r.name.startsWith(rn + "/"))
                  .map((r) => (
                    <button
                      key={r.full}
                      className="sb-item"
                      style={{ paddingLeft: 30, height: 28 }}
                      onDoubleClick={() => a.checkout(r.name, true)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        ui.menu(e.clientX, e.clientY, [
                          { label: t("Yerel dal olarak checkout et"), onClick: () => a.checkout(r.name, true) },
                          { label: t("{b} dalına merge et", { b: s.status?.branch ?? "HEAD" }), onClick: () => a.merge(r.name) },
                          { label: t("Buradan yeni dal…"), onClick: () => a.newBranch(r.name) },
                        ]);
                      }}
                    >
                      <span className="ellipsis" style={{ flex: 1 }}>{r.name.slice(rn.length + 1)}</span>
                    </button>
                  ))}
            </div>
          ))}
        </div>
      )}

      {tags.length > 0 && (
        <div className="sb-section">
          <button className="sb-item" onClick={() => setTagsOpen((v) => !v)}>
            <Icon name="tag" color="var(--text-3)" />
            <span style={{ flex: 1 }}>{t("Etiketler")}</span>
            <span className="count">{tags.length}</span>
            <Icon name={tagsOpen ? "chevronDown" : "chevronRight"} size={12} color="var(--text-3)" width={1.8} />
          </button>
          {tagsOpen &&
            tags.slice(0, 50).map((t) => (
              <div key={t.full} className="sb-item" style={{ paddingLeft: 30, height: 26, cursor: "default" }}>
                <span className="ellipsis">{t.name}</span>
              </div>
            ))}
        </div>
      )}

      <div className="sb-section">
        <div className="sb-title">{t("Bitbucket")}</div>
        {nav("prs", "pr", t("Pull request'ler"))}
      </div>

      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10, padding: 8 }}>
        {bbUser ? (
          <>
            <Avatar name={bbUser.display_name ?? "?"} size={28} url={bbUser.links?.avatar?.href} />
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
              <span className="ellipsis" style={{ fontSize: 12.5, fontWeight: 600 }}>{bbUser.display_name}</span>
              <span className="ellipsis muted" style={{ fontSize: 11.5 }}>{t("Bitbucket · bağlı")}</span>
            </div>
          </>
        ) : (
          <span className="muted" style={{ flex: 1, fontSize: 12 }}>{t("Bitbucket bağlı değil")}</span>
        )}
        <button className="iconbtn" aria-label={t("Ayarlar")} title={t("Ayarlar")} onClick={onSettings}>
          <Icon name="settings" />
        </button>
      </div>
    </nav>
  );
}
