// Ctrl+K komut paleti: işlemler, dallar, görünümler
import { t } from "../i18n";
import { useMemo, useState } from "react";
import { useStore } from "../store";
import { useActions } from "../actions";
import { Modal } from "./ui";
import { Icon } from "./Icon";

type Cmd = { id: string; label: string; hint?: string; icon: string; run: () => void };

export function CommandPalette({ onClose, onSettings, onOpenRepo }: { onClose: () => void; onSettings: () => void; onOpenRepo: () => void }) {
  const s = useStore();
  const a = useActions();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  const cmds = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [
      { id: "open", label: t("Repository aç…"), icon: "folder", run: onOpenRepo },
      { id: "settings", label: t("Ayarlar"), icon: "settings", run: onSettings },
      { id: "theme", label: s.theme === "dark" ? t("Açık temaya geç") : t("Koyu temaya geç"), icon: s.theme === "dark" ? "sun" : "moon", run: () => s.saveSettings({ theme: s.theme === "dark" ? "light" : "dark" }) },
    ];
    if (s.repo) {
      list.push(
        { id: "v-changes", label: t("Değişiklikler"), hint: t("Ctrl+1"), icon: "changes", run: () => s.setView("changes") },
        { id: "v-history", label: t("Geçmiş"), hint: t("Ctrl+2"), icon: "history", run: () => s.setView("history") },
        { id: "v-files", label: t("Dosyalar"), hint: t("Ctrl+3"), icon: "folder", run: () => s.setView("files") },
        { id: "v-prs", label: t("Pull request'ler"), hint: t("Ctrl+4"), icon: "pr", run: () => s.setView("prs") },
        { id: "fetch", label: t("Fetch"), icon: "fetch", run: a.fetch },
        { id: "pull", label: t("Pull"), icon: "pull", run: a.pull },
        { id: "push", label: t("Push"), icon: "push", run: a.push },
        { id: "stash", label: t("Stash'le…"), hint: t("Ctrl+Shift+S"), icon: "stash", run: a.stash },
        { id: "branch", label: t("Yeni dal…"), hint: t("Ctrl+Shift+N"), icon: "branch", run: () => a.newBranch() },
        { id: "merge", label: t("Merge…"), icon: "merge", run: () => a.merge() },
        { id: "term", label: t("Terminali aç/kapat"), hint: t("Ctrl+`"), icon: "terminal", run: () => s.setTerminalOpen((v) => !v) },
      );
      for (const b of s.branches.filter((x) => x.kind === "local" && !x.head))
        list.push({ id: "co-" + b.name, label: t("Dala geç: {b}", { b: b.name }), icon: "branch", run: () => a.checkout(b.name) });
      for (const b of s.branches.filter((x) => x.kind === "remote"))
        list.push({ id: "cor-" + b.name, label: t("Uzak dalı checkout et: {b}", { b: b.name }), icon: "cloud", run: () => a.checkout(b.name, true) });
    }
    return list;
  }, [s, a, onSettings, onOpenRepo]);

  const items = cmds.filter((c) => c.label.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr"))).slice(0, 60);
  const exec = (c: Cmd | undefined) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <Modal onClose={onClose} width={560}>
      <div className="search" style={{ height: 40, background: "var(--field-2)" }}>
        <Icon name="search" />
        <input
          autoFocus
          placeholder={t("Komut veya dal adı yazın…")}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setSel((x) => Math.min(items.length - 1, x + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setSel((x) => Math.max(0, x - 1)));
            else if (e.key === "Enter") exec(items[sel]);
          }}
          style={{ fontSize: 14 }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 380, overflowY: "auto" }}>
        {items.map((c, i) => (
          <button
            key={c.id}
            className="row"
            style={{ border: "none", height: 34, background: i === sel ? "var(--accent-soft)" : "transparent", textAlign: "left" }}
            onMouseEnter={() => setSel(i)}
            onClick={() => exec(c)}
          >
            <Icon name={c.icon} color="var(--text-2)" />
            <span className="ellipsis" style={{ flex: 1 }}>{c.label}</span>
            {c.hint && <kbd>{c.hint}</kbd>}
          </button>
        ))}
        {items.length === 0 && <div className="faint" style={{ padding: 10 }}>{t("Sonuç yok")}</div>}
      </div>
    </Modal>
  );
}
