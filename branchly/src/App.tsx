import { t } from "./i18n";
import { useCallback, useEffect, useState } from "react";
import { api, type BbStatus } from "./api";
import { StoreProvider, useStore } from "./store";
import { UiProvider } from "./components/ui";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { TerminalPanel } from "./components/TerminalPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { CommandPalette } from "./components/CommandPalette";
import { Welcome, chooseRepo, CloneDialog } from "./components/Welcome";
import { RepoTabs } from "./components/RepoTabs";
import { ImportDialog } from "./components/ImportDialog";
import { useUi } from "./components/ui";
import type { StRepo } from "./api";
import { ChangesView } from "./views/ChangesView";
import { HistoryView } from "./views/HistoryView";
import { FilesView } from "./views/FilesView";
import { ConflictView } from "./views/ConflictView";
import { PullRequestsView } from "./views/PullRequestsView";
import { useActions } from "./actions";
import { Icon } from "./components/Icon";

function Shell() {
  const s = useStore();
  const a = useActions();
  const [bb, setBb] = useState<BbStatus>({ configured: false, logged_in: false, user: null });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [termMounted, setTermMounted] = useState(false);
  const [importList, setImportList] = useState<StRepo[] | null>(null);
  const [cloning, setCloning] = useState(false);
  const ui = useUi();

  // İlk açılışta Sourcetree depolarını taşımayı öner
  const startImport = useCallback(
    async (manual: boolean) => {
      const list = await api.sourcetreeRepos().catch(() => [] as StRepo[]);
      if (list.length) setImportList(list);
      else if (manual) ui.toast(t("Sourcetree repository listesi bulunamadı"), "error", t("{p} okunamadı.", { p: "%LOCALAPPDATA%\\Atlassian\\SourceTree\\bookmarks.xml" }));
      else s.saveSettings({ sourcetreeAsked: true });
    },
    [ui, s],
  );
  useEffect(() => {
    if (!s.settings.sourcetreeAsked) startImport(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const f = () => startImport(true);
    const r = (e: Event) => api.reveal((e as CustomEvent).detail, "").catch(ui.error);
    window.addEventListener("branchly:import-sourcetree", f);
    window.addEventListener("branchly:reveal", r);
    return () => {
      window.removeEventListener("branchly:import-sourcetree", f);
      window.removeEventListener("branchly:reveal", r);
    };
  }, [startImport, ui]);

  const loadBb = useCallback(() => {
    api.bbStatus().then(setBb).catch(() => {});
  }, []);
  useEffect(loadBb, [loadBb]);
  useEffect(() => {
    if (s.terminalOpen) setTermMounted(true);
  }, [s.terminalOpen]);

  const openRepoDialog = useCallback(() => chooseRepo(s.openRepo), [s.openRepo]);
  useEffect(() => {
    const f = () => openRepoDialog();
    window.addEventListener("branchly:open-repo", f);
    return () => window.removeEventListener("branchly:open-repo", f);
  }, [openRepoDialog]);

  // Klavye kısayolları
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.ctrlKey && (e.key === "`" || e.code === "Backquote") && s.repo) {
        e.preventDefault();
        s.setTerminalOpen((v) => !v);
      } else if (e.ctrlKey && !e.shiftKey && ["1", "2", "3", "4"].includes(e.key) && s.repo) {
        e.preventDefault();
        s.setView((["changes", "history", "files", "prs"] as const)[+e.key - 1]);
      } else if (e.ctrlKey && e.shiftKey && k === "s" && s.repo) {
        e.preventDefault();
        a.stash();
      } else if (e.ctrlKey && e.shiftKey && k === "n" && s.repo) {
        e.preventDefault();
        a.newBranch();
      } else if (e.ctrlKey && k === "o") {
        e.preventDefault();
        openRepoDialog();
      } else if (e.key === "F5") {
        e.preventDefault();
        s.refresh();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [s, a, openRepoDialog]);

  // WebView'in varsayılan sağ tık menüsünü kapat (metin alanları hariç)
  useEffect(() => {
    const f = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest("input, textarea, .selectable")) e.preventDefault();
    };
    window.addEventListener("contextmenu", f);
    return () => window.removeEventListener("contextmenu", f);
  }, []);

  let view = null;
  if (s.repo) {
    switch (s.view) {
      case "changes":
        view = <ChangesView />;
        break;
      case "history":
        view = <HistoryView />;
        break;
      case "files":
        view = <FilesView />;
        break;
      case "conflicts":
        view = <ConflictView />;
        break;
      case "prs":
        view = <PullRequestsView bbUser={bb.user} onConnect={() => setSettingsOpen(true)} />;
        break;
    }
  }

  return (
    <div className="app">
      <TitleBar onPalette={() => setPaletteOpen(true)} />
      {s.settings.tabs.length > 0 && <RepoTabs onOpenRepo={openRepoDialog} onClone={() => setCloning(true)} onImport={() => startImport(true)} />}
      <div className="body">
        {s.repo && <Sidebar bbUser={bb.user} onSettings={() => setSettingsOpen(true)} />}
        <main className="content" style={!s.repo ? { borderLeft: "none", borderTopLeftRadius: 0 } : undefined}>
          {s.repo ? (
            <>
              {view}
              {termMounted && <TerminalPanel visible={s.terminalOpen} />}
            </>
          ) : (
            <>
              <Welcome />
              <button className="iconbtn" style={{ position: "absolute", right: 16, bottom: 16 }} aria-label={t("Ayarlar")} onClick={() => setSettingsOpen(true)}>
                <Icon name="settings" />
              </button>
            </>
          )}
        </main>
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} bb={{ configured: bb.configured, user: bb.user }} onBbChanged={loadBb} />}
      {importList && (
        <ImportDialog
          repos={importList}
          onClose={(n) => {
            setImportList(null);
            if (n) ui.toast(t("{n} repository Sourcetree'den taşındı", { n }), "ok");
          }}
        />
      )}
      {cloning && (
        <CloneDialog
          onClose={() => setCloning(false)}
          onDone={(p) => {
            setCloning(false);
            s.openRepo(p);
          }}
          onError={(e) => ui.error(e, t("Klonlama başarısız"))}
        />
      )}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onSettings={() => setSettingsOpen(true)} onOpenRepo={openRepoDialog} />}
    </div>
  );
}

export default function App() {
  return (
    <UiProvider>
      <StoreProvider>
        <Shell />
      </StoreProvider>
    </UiProvider>
  );
}
