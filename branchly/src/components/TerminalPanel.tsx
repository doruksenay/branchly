// Gömülü terminal paneli (xterm.js). Tema uygulamayla birlikte açık/koyu değişir.
import { t } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { listen } from "@tauri-apps/api/event";
import { api, type Shell } from "../api";
import { useStore } from "../store";
import { Icon } from "./Icon";
import { useUi } from "./ui";

const LIGHT: ITheme = {
  background: "#f7f8fa",
  foreground: "#1d1d1f",
  cursor: "#1d1d1f",
  cursorAccent: "#f7f8fa",
  selectionBackground: "rgba(10,100,232,0.22)",
  black: "#1d1d1f",
  red: "#c62828",
  green: "#1a7f37",
  yellow: "#9a6700",
  blue: "#0a64e8",
  magenta: "#8250df",
  cyan: "#0e7c86",
  white: "#6b6b70",
  brightBlack: "#6b6b70",
  brightRed: "#d73a49",
  brightGreen: "#22863a",
  brightYellow: "#b08800",
  brightBlue: "#2f7cf6",
  brightMagenta: "#9a5ce6",
  brightCyan: "#1b8f99",
  brightWhite: "#3a3a3c",
};
const DARK: ITheme = {
  background: "#1e1e21",
  foreground: "#e5e5ea",
  cursor: "#e5e5ea",
  cursorAccent: "#1e1e21",
  selectionBackground: "rgba(59,140,255,0.35)",
  black: "#1c1c1e",
  red: "#ff7b72",
  green: "#7ee787",
  yellow: "#f2cc60",
  blue: "#79c0ff",
  magenta: "#d2a8ff",
  cyan: "#56d4dd",
  white: "#aeaeb2",
  brightBlack: "#6e6e73",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#a5d6ff",
  brightMagenta: "#e2c5ff",
  brightCyan: "#76e3ea",
  brightWhite: "#f2f2f7",
};

type Session = { key: number; ptyId: number | null; title: string; term: Terminal; fit: FitAddon; exited: boolean; shell: Shell; opened: boolean };
let keySeq = 0;
const byPty = new Map<number, Session>();

// Tek bir global dinleyici; veriyi ilgili terminale yönlendirir
let listening = false;
function ensureListener() {
  if (listening) return;
  listening = true;
  listen<{ id: number; data: string }>("pty-data", (e) => byPty.get(e.payload.id)?.term.write(e.payload.data));
  listen<number>("pty-exit", (e) => {
    const s = byPty.get(e.payload);
    if (s) {
      s.exited = true;
      s.term.write(t("\r\n\u001b[2m[İşlem sonlandı — kapatmak için sekmeyi kapatın]\u001b[0m\r\n"));
    }
  });
}

export function TerminalPanel({ visible }: { visible: boolean }) {
  const s = useStore();
  const ui = useUi();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [shells, setShells] = useState<Shell[]>([]);
  const hosts = useRef(new Map<number, HTMLDivElement>());
  const panelRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(s.settings.terminalHeight || 300);
  const theme = s.theme === "dark" ? DARK : LIGHT;

  useEffect(() => {
    ensureListener();
    api.shells().then(setShells).catch(() => {});
  }, []);

  const open = async (shell?: Shell) => {
    const sh = shell ?? shells.find((x) => x.id === s.settings.shell) ?? shells[0];
    if (!sh) return;
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "JetBrains Mono", Consolas, "SF Mono", monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const sess: Session = { key: ++keySeq, ptyId: null, title: (s.repo?.name ? s.repo.name + " · " : "") + sh.name, term, fit, exited: false, shell: sh, opened: false };
    setSessions((x) => [...x, sess]);
    setActive(sess.key);
  };

  // Terminal, kapsayıcı DOM öğesi oluştuğunda başlatılır
  const attach = async (sess: Session, host: HTMLDivElement) => {
    if (sess.opened) return;
    sess.opened = true;
    const { term, fit, shell: sh } = sess;
    term.open(host);
    await new Promise((r) => requestAnimationFrame(r));
    try {
      fit.fit();
    } catch {}
    try {
      const id = await api.ptySpawn(sh.program, sh.args, s.repo?.root ?? "", Math.max(term.cols, 20), Math.max(term.rows, 5));
      sess.ptyId = id;
      byPty.set(id, sess);
      term.onData((d) => api.ptyWrite(id, d).catch(() => {}));
      term.onResize(({ cols, rows }) => api.ptyResize(id, cols, rows).catch(() => {}));
      // Ctrl+C seçim varsa kopyala, Ctrl+V yapıştır
      term.attachCustomKeyEventHandler((ev) => {
        if (ev.type !== "keydown") return true;
        if (ev.ctrlKey && ev.key === "c" && term.hasSelection()) {
          navigator.clipboard.writeText(term.getSelection());
          return false;
        }
        if (ev.ctrlKey && ev.key === "v") {
          navigator.clipboard.readText().then((t) => api.ptyWrite(id, t));
          return false;
        }
        return true;
      });
      term.focus();
    } catch (e) {
      term.write(`\x1b[31m${t("Kabuk başlatılamadı")}: ${String(e)}\x1b[0m\r\n`);
    }
  };

  const close = (key: number) => {
    const sess = sessions.find((x) => x.key === key);
    if (!sess) return;
    if (sess.ptyId !== null) {
      api.ptyKill(sess.ptyId).catch(() => {});
      byPty.delete(sess.ptyId);
    }
    sess.term.dispose();
    const rest = sessions.filter((x) => x.key !== key);
    setSessions(rest);
    if (active === key) setActive(rest[rest.length - 1]?.key ?? null);
    if (rest.length === 0) s.setTerminalOpen(false);
  };

  // Görünür olup hiç terminal yoksa bir tane başlat
  useEffect(() => {
    if (visible && shells.length && sessions.length === 0) open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shells, visible]);

  // Tema değişince tüm terminalleri güncelle
  useEffect(() => {
    sessions.forEach((x) => (x.term.options.theme = theme));
  }, [theme, sessions]);

  // Boyut değişince sığdır
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      sessions.forEach((x) => {
        if (x.key === active) {
          try {
            x.fit.fit();
          } catch {}
        }
      });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [sessions, active]);

  useEffect(() => {
    const sess = sessions.find((x) => x.key === active);
    if (sess)
      requestAnimationFrame(() => {
        try {
          sess.fit.fit();
        } catch {}
        sess.term.focus();
      });
  }, [active, sessions, visible]);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = height;
    const move = (ev: MouseEvent) => setHeight(Math.max(140, Math.min(window.innerHeight - 220, h0 - (ev.clientY - y0))));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setHeight((h) => {
        s.saveSettings({ terminalHeight: h });
        return h;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <section ref={panelRef} className="term-panel" aria-label={t("Terminal")} style={{ height, display: visible ? "flex" : "none" }}>
      <div className="term-resize" onMouseDown={startResize} />
      <div className="term-tabs">
        {sessions.map((x) => (
          <button key={x.key} className={"term-tab" + (x.key === active ? " on" : "")} onClick={() => setActive(x.key)}>
            <Icon name="terminal" size={14} />
            {x.title}
            <span
              className="x"
              role="button"
              aria-label={t("Terminali kapat")}
              onClick={(e) => {
                e.stopPropagation();
                close(x.key);
              }}
            >
              <Icon name="close" size={10} />
            </span>
          </button>
        ))}
        <button className="iconbtn" aria-label={t("Yeni terminal")} title={t("Yeni terminal")} onClick={() => open()}>
          <Icon name="plus" size={14} />
        </button>
        <button
          className="iconbtn"
          style={{ width: 22 }}
          aria-label={t("Kabuk seç")}
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            ui.menu(r.left, r.bottom + 4, [
              ...shells.map((sh) => ({ label: sh.name, hint: sh.id === s.settings.shell ? t("varsayılan") : undefined, onClick: () => open(sh) })),
              { sep: true as const },
              ...shells.map((sh) => ({ label: t("Varsayılan: {x}", { x: sh.name }), onClick: () => s.saveSettings({ shell: sh.id }) })),
            ]);
          }}
        >
          <Icon name="chevronDown" size={11} width={2} />
        </button>
        <div className="grow" />
        <span className="faint" style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, marginRight: 6 }}>
          <Icon name="refresh" size={12} color="var(--add-fg)" />
          {t("Terminaldeki git işlemleri arayüze otomatik yansır")}
        </span>
        <button className="iconbtn" aria-label={t("Terminali gizle")} title={t("Gizle (Ctrl+`)")} onClick={() => s.setTerminalOpen(false)}>
          <Icon name="chevronDown" size={14} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative", background: theme.background }}>
        {sessions.map((x) => (
          <div
            key={x.key}
            className="term-host"
            ref={(el) => {
              if (el) {
                hosts.current.set(x.key, el);
                attach(x, el);
              }
            }}
            style={{ position: "absolute", inset: 0, display: x.key === active ? "block" : "none" }}
          />
        ))}
      </div>
    </section>
  );
}
