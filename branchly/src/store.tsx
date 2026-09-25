// Uygulama durumu: açık depo, git durumu, dallar, ayarlar, tema
import { t } from "./i18n";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { api, errText, type Branch, type OpState, type Stash, type StatusInfo } from "./api";
import { useUi } from "./components/ui";
import { detectLang, setLang, type Lang } from "./i18n";

export type View = "changes" | "history" | "files" | "prs" | "conflicts";
export type ThemePref = "system" | "light" | "dark";

export type RepoEntry = { root: string; name: string; folder?: string | null };

export type Settings = {
  theme: ThemePref;
  editor: string;
  shell: string;
  /** Depo kütüphanesi (Sourcetree'den aktarılanlar dahil) */
  recent: RepoEntry[];
  /** Açık depo sekmeleri (kök yolları) */
  tabs: string[];
  sourcetreeAsked?: boolean;
  lang?: Lang;
  lastRepo?: string;
  terminalHeight: number;
  bitbucketClientId?: string;
  [k: string]: any;
};

const DEFAULTS: Settings = { theme: "system", editor: "code", shell: "", recent: [], tabs: [], terminalHeight: 300 };

type Store = {
  settings: Settings;
  saveSettings: (patch: Partial<Settings>) => void;
  theme: "light" | "dark";
  repo: { root: string; name: string } | null;
  openRepo: (path: string) => Promise<void>;
  closeRepo: () => void;
  /** Sekmeyi kapatır; açık depo buysa sıradaki sekmeye geçer */
  closeTab: (root: string) => void;
  /** Kütüphaneye depo ekler (içe aktarma) */
  addToLibrary: (list: RepoEntry[], openTabs: string[]) => void;
  status: StatusInfo | null;
  branches: Branch[];
  stashes: Stash[];
  op: OpState | null;
  refresh: () => Promise<void>;
  /** Değişiklik sayacı: geçmiş gibi ağır görünümler yenilenmek için izler */
  tick: number;
  view: View;
  setView: (v: View) => void;
  busy: string | null;
  /** Bir işlemi meşgul göstergesi, hata bildirimi ve sonrasında yenileme ile çalıştırır */
  run: <T>(label: string, fn: () => Promise<T>, okMsg?: string) => Promise<T | undefined>;
  terminalOpen: boolean;
  setTerminalOpen: (v: boolean | ((x: boolean) => boolean)) => void;
  historyPath: string | null;
  setHistoryPath: (p: string | null) => void;
};

const StoreCtx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(StoreCtx);

function systemDark() {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const ui = useUi();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const [sysDark, setSysDark] = useState(systemDark());
  const [repo, setRepo] = useState<{ root: string; name: string } | null>(null);
  const [status, setStatus] = useState<StatusInfo | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [stashes, setStashes] = useState<Stash[]>([]);
  const [op, setOp] = useState<OpState | null>(null);
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<View>("changes");
  const [busy, setBusy] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [historyPath, setHistoryPath] = useState<string | null>(null);
  const repoRef = useRef<string | null>(null);
  const refreshing = useRef<Promise<void> | null>(null);
  const pending = useRef(false);

  // Ayarlar
  useEffect(() => {
    api
      .settingsGet()
      .then((s) => setSettings({ ...DEFAULTS, ...s }))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  const saveSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const n = { ...s, ...patch };
      api.settingsSet(n).catch(() => {});
      return n;
    });
  }, []);

  // Tema
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const f = () => setSysDark(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  // Dil: ayarda yoksa Windows dilinden
  const lang: Lang = settings.lang ?? detectLang();
  setLang(lang);
  useEffect(() => {
    invoke("set_lang", { lang }).catch(() => {});
  }, [lang]);
  const theme: "light" | "dark" = settings.theme === "system" ? (sysDark ? "dark" : "light") : settings.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const refresh = useCallback(async () => {
    const r = repoRef.current;
    if (!r) return;
    if (refreshing.current) {
      pending.current = true;
      return refreshing.current;
    }
    const p = (async () => {
      try {
        const [st, br, sh, o] = await Promise.all([api.status(r), api.branches(r), api.stashes(r), api.opState(r)]);
        if (repoRef.current !== r) return;
        setStatus(st);
        setBranches(br);
        setStashes(sh);
        setOp(o);
        setTick((t) => t + 1);
      } catch (e) {
        console.error(e);
      }
    })();
    refreshing.current = p;
    await p;
    refreshing.current = null;
    if (pending.current) {
      pending.current = false;
      await refresh();
    }
  }, []);

  const openRepo = useCallback(
    async (path: string) => {
      try {
        const info = await api.repoOpen(path);
        const same = repoRef.current === info.root;
        repoRef.current = info.root;
        setRepo(info);
        if (!same) {
          setStatus(null);
          setHistoryPath(null);
          setView((v) => (v === "conflicts" ? "changes" : v));
        }
        await api.watch(info.root).catch(() => {});
        await refresh();
        setSettings((s) => {
          const prev = s.recent.find((x) => x.root === info.root);
          const entry: RepoEntry = { ...info, folder: prev?.folder ?? null };
          const recent = [entry, ...s.recent.filter((x) => x.root !== info.root)].slice(0, 80);
          const tabs = s.tabs.includes(info.root) ? s.tabs : [...s.tabs, info.root];
          const n = { ...s, recent, tabs, lastRepo: info.root };
          api.settingsSet(n).catch(() => {});
          return n;
        });
      } catch (e) {
        ui.error(e, t("Repository açılamadı"));
        // Açılamayan depoyu sekmelerden çıkar
        setSettings((s) => {
          const n = { ...s, tabs: s.tabs.filter((t) => t !== path) };
          api.settingsSet(n).catch(() => {});
          return n;
        });
      }
    },
    [refresh, ui],
  );

  const closeRepo = useCallback(() => {
    repoRef.current = null;
    setRepo(null);
    setStatus(null);
    setBranches([]);
    setStashes([]);
    setOp(null);
    saveSettings({ lastRepo: undefined });
  }, [saveSettings]);

  const closeTab = useCallback(
    (root: string) => {
      const idx = settings.tabs.indexOf(root);
      const tabs = settings.tabs.filter((t) => t !== root);
      saveSettings({ tabs });
      if (repoRef.current === root) {
        const next = tabs[Math.min(idx, tabs.length - 1)];
        if (next) openRepo(next);
        else closeRepo();
      }
    },
    [settings.tabs, saveSettings, openRepo, closeRepo],
  );

  const addToLibrary = useCallback((list: RepoEntry[], openTabs: string[]) => {
    setSettings((s) => {
      const known = new Set(s.recent.map((r) => r.root.toLowerCase()));
      const recent = [...s.recent, ...list.filter((r) => !known.has(r.root.toLowerCase()))];
      const tabs = [...s.tabs, ...openTabs.filter((t) => !s.tabs.includes(t))];
      const n = { ...s, recent, tabs, sourcetreeAsked: true };
      api.settingsSet(n).catch(() => {});
      return n;
    });
  }, []);

  // Son depoyu otomatik aç
  useEffect(() => {
    if (loaded && settings.lastRepo && !repoRef.current) openRepo(settings.lastRepo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Dosya sistemi / terminal değişikliklerinde yenile
  useEffect(() => {
    const un = listen<string>("repo-changed", (e) => {
      if (e.payload === repoRef.current) refresh();
    });
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => {
      un.then((f) => f());
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);

  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>, okMsg?: string) => {
      setBusy(label);
      try {
        const r = await fn();
        if (okMsg) ui.toast(okMsg, "ok");
        return r;
      } catch (e) {
        ui.toast(label + t(" başarısız"), "error", errText(e));
        return undefined;
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh, ui],
  );

  const value = useMemo<Store>(
    () => ({
      settings,
      saveSettings,
      theme,
      repo,
      openRepo,
      closeRepo,
      closeTab,
      addToLibrary,
      status,
      branches,
      stashes,
      op,
      refresh,
      tick,
      view,
      setView,
      busy,
      run,
      terminalOpen,
      setTerminalOpen,
      historyPath,
      setHistoryPath,
    }),
    [settings, saveSettings, theme, repo, openRepo, closeRepo, closeTab, addToLibrary, status, branches, stashes, op, refresh, tick, view, busy, run, terminalOpen, historyPath],
  );

  if (!loaded) return null;
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function conflictCount(st: StatusInfo | null) {
  return st?.files.filter((f) => f.conflict).length ?? 0;
}
