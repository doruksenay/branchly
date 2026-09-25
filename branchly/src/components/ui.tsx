// Ortak arayüz yardımcıları: bildirimler, bağlam menüsü, soru/onay/seçim diyalogları
import { t } from "../i18n";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { avatarColors, initials } from "../lib/format";

export type MenuItem =
  | { label: string; onClick: () => void; hint?: string; danger?: boolean; disabled?: boolean }
  | { sep: true }
  | { header: string };

type Toast = { id: number; text: string; detail?: string; kind: "info" | "error" | "ok" };

type PromptOpts = { title: string; label?: string; value?: string; placeholder?: string; ok?: string; checkbox?: string };
type ConfirmOpts = { title: string; text?: string; ok?: string; danger?: boolean };
type PickOpts = { title: string; items: { value: string; label: string; hint?: string }[]; placeholder?: string };

type Ctx = {
  toast: (text: string, kind?: Toast["kind"], detail?: string) => void;
  error: (e: unknown, title?: string) => void;
  menu: (x: number, y: number, items: MenuItem[]) => void;
  prompt: (o: PromptOpts) => Promise<{ value: string; checked: boolean } | null>;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  pick: (o: PickOpts) => Promise<string | null>;
};

const UiCtx = createContext<Ctx>(null as unknown as Ctx);
export const useUi = () => useContext(UiCtx);

let toastSeq = 0;

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [dialog, setDialog] = useState<ReactNode>(null);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info", detail?: string) => {
    const id = ++toastSeq;
    setToasts((t) => [...t, { id, text, kind, detail }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 9000 : 3500);
  }, []);

  const error = useCallback(
    (e: unknown, title = t("İşlem başarısız")) => {
      const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
      toast(title, "error", msg);
    },
    [toast],
  );

  const prompt = useCallback(
    (o: PromptOpts) =>
      new Promise<{ value: string; checked: boolean } | null>((resolve) => {
        const close = (v: { value: string; checked: boolean } | null) => {
          setDialog(null);
          resolve(v);
        };
        setDialog(<PromptDialog o={o} close={close} />);
      }),
    [],
  );

  const confirm = useCallback(
    (o: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        const close = (v: boolean) => {
          setDialog(null);
          resolve(v);
        };
        setDialog(
          <Modal onClose={() => close(false)}>
            <h2>{o.title}</h2>
            {o.text && <div className="muted" style={{ lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{o.text}</div>}
            <div className="actions">
              <button className="btn" onClick={() => close(false)}>{t("Vazgeç")}</button>
              <button className={"btn primary"} style={o.danger ? { background: "var(--del-fg)", borderColor: "var(--del-fg)" } : undefined} autoFocus onClick={() => close(true)}>
                {o.ok ?? "Tamam"}
              </button>
            </div>
          </Modal>,
        );
      }),
    [],
  );

  const pick = useCallback(
    (o: PickOpts) =>
      new Promise<string | null>((resolve) => {
        const close = (v: string | null) => {
          setDialog(null);
          resolve(v);
        };
        setDialog(<PickDialog o={o} close={close} />);
      }),
    [],
  );

  const ctx = useMemo<Ctx>(
    () => ({ toast, error, menu: (x, y, items) => setMenu({ x, y, items }), prompt, confirm, pick }),
    [toast, error, prompt, confirm, pick],
  );

  return (
    <UiCtx.Provider value={ctx}>
      {children}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {dialog}
      <div className="toasts">
        {toasts.map((tt) => (
          <div key={tt.id} className={"toast " + tt.kind}>
            <Icon
              name={tt.kind === "error" ? "warn" : tt.kind === "ok" ? "checkCircle" : "checkCircle"}
              color={tt.kind === "error" ? "var(--del-fg)" : "var(--add-fg)"}
              style={{ marginTop: 2 }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{tt.text}</div>
              {tt.detail && <pre className="mono">{tt.detail}</pre>}
            </div>
            <button className="iconbtn" style={{ width: 20, height: 20, marginLeft: "auto" }} aria-label={t("Kapat")} onClick={() => setToasts((x) => x.filter((y) => y.id !== tt.id))}>
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
      </div>
    </UiCtx.Provider>
  );
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {items.map((it, i) =>
        "sep" in it ? (
          <div key={i} className="sep" />
        ) : "header" in it ? (
          <div key={i} className="menu-header">{it.header}</div>
        ) : (
          <button
            key={i}
            role="menuitem"
            className={it.danger ? "danger" : ""}
            disabled={it.disabled}
            onClick={() => {
              onClose();
              it.onClick();
            }}
          >
            <span>{it.label}</span>
            {it.hint && <span className="hint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}

export function Modal({ children, onClose, width }: { children: ReactNode; onClose: () => void; width?: number }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" style={width ? { width } : undefined}>
        {children}
      </div>
    </div>
  );
}

function PromptDialog({ o, close }: { o: PromptOpts; close: (v: { value: string; checked: boolean } | null) => void }) {
  const [v, setV] = useState(o.value ?? "");
  const [checked, setChecked] = useState(true);
  return (
    <Modal onClose={() => close(null)}>
      <h2>{o.title}</h2>
      <form
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim()) close({ value: v.trim(), checked });
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {o.label && <span className="label">{o.label}</span>}
          <input className="field" autoFocus value={v} placeholder={o.placeholder} onChange={(e) => setV(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
        {o.checkbox && (
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
            {o.checkbox}
          </label>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={() => close(null)}>{t("Vazgeç")}</button>
          <button type="submit" className="btn primary" disabled={!v.trim()}>{o.ok ?? "Tamam"}</button>
        </div>
      </form>
    </Modal>
  );
}

function PickDialog({ o, close }: { o: PickOpts; close: (v: string | null) => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const items = o.items.filter((i) => i.label.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr")));
  return (
    <Modal onClose={() => close(null)} width={520}>
      <h2>{o.title}</h2>
      <input
        className="field"
        autoFocus
        placeholder={o.placeholder ?? "Ara…"}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSel((s) => Math.min(items.length - 1, s + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
          } else if (e.key === "Enter" && items[sel]) close(items[sel].value);
        }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 340, overflowY: "auto" }}>
        {items.length === 0 && <div className="muted" style={{ padding: 10 }}>{t("Sonuç yok")}</div>}
        {items.map((it, i) => (
          <button
            key={it.value}
            className={"row" + (i === sel ? " sel" : "")}
            style={{ border: "none", background: i === sel ? "var(--accent-soft)" : "transparent", textAlign: "left", height: 32 }}
            onMouseEnter={() => setSel(i)}
            onClick={() => close(it.value)}
          >
            <span className="ellipsis" style={{ flex: 1 }}>{it.label}</span>
            {it.hint && <span className="faint" style={{ fontSize: 12 }}>{it.hint}</span>}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function Avatar({ name, size = 20, url }: { name: string; size?: number; url?: string | null }) {
  const [bg, fg] = avatarColors(name);
  if (url) return <img src={url} alt="" width={size} height={size} style={{ borderRadius: "50%", flexShrink: 0 }} />;
  return (
    <span className="avatar" style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.max(8, size * 0.42) }}>
      {initials(name)}
    </span>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={"switch" + (on ? " on" : "")} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export function StatusLetter({ s }: { s: string }) {
  const letter = s === "?" ? "U" : s;
  return <span className={"status-letter st-" + (s === "?" ? "U" : /[MADRCU]/.test(s) ? s : "M")}>{letter}</span>;
}
