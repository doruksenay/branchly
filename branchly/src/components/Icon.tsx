// Tek çizgi (stroke) ikon seti
import type { CSSProperties } from "react";

const P: Record<string, string> = {
  branch: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 3-7 2-7 4"/>',
  fetch: '<path d="M13 8a5 5 0 1 1-1.46-3.54M13 3v2.5h-2.5"/>',
  pull: '<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>',
  push: '<path d="M8 13.5v-8M4.5 9 8 5.5 11.5 9M3 2.5h10"/>',
  stash: '<path d="M2 3.5h12v3H2zM3 6.5v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-6M6.5 9h3"/>',
  merge: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="10.5" r="1.5"/><path d="M4.5 5v6M4.5 5c0 3.5 3 5.5 5.5 5.5"/>',
  terminal: '<rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 6.5 7 8.5 5 10.5M8.5 10.5H11"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>',
  changes: '<circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="1.8"/>',
  history: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
  folder: '<path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.5 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/>',
  cloud: '<path d="M4.5 12.5a3 3 0 0 1-.4-5.97A4 4 0 0 1 11.8 7a2.75 2.75 0 0 1 .2 5.5z"/>',
  pr: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 11V6.5A1.5 1.5 0 0 0 10 5H7.5M9 3.5 7.5 5 9 6.5"/>',
  checkCircle: '<circle cx="8" cy="8" r="5.5"/><path d="m5.6 8.1 1.7 1.7 3.2-3.4"/>',
  xCircle: '<circle cx="8" cy="8" r="5.5"/><path d="m6 6 4 4M10 6l-4 4"/>',
  circle: '<circle cx="8" cy="8" r="5"/>',
  chevronDown: '<path d="m4 6 4 4 4-4"/>',
  chevronRight: '<path d="m6 4 4 4-4 4"/>',
  chevronUp: '<path d="m4 10 4-4 4 4"/>',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5"/>',
  external: '<path d="M9.5 2.5h4v4M13.5 2.5 8 8M12 9.5V12a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 3 12V6a1.5 1.5 0 0 1 1.5-1.5H7"/>',
  warn: '<path d="M8 2.5 14 13H2z"/><path d="M8 6.5v3M8 11.3v.2"/>',
  check: '<path d="m3.5 8.5 3 3 6-7"/>',
  arrowUp: '<path d="M8 13V3M4 7l4-4 4 4"/>',
  arrowDown: '<path d="M8 3v10M4 9l4 4 4-4"/>',
  arrowRight: '<path d="M3 8h10M9 4l4 4-4 4"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  minus: '<path d="M3 8h10"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  file: '<path d="M4 1.5h5l3.5 3.5v9.5H4z"/><path d="M9 1.5V5h3.5"/>',
  comment: '<path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"/>',
  split: '<rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M8 3v10"/>',
  settings: '<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>',
  tag: '<path d="M2.5 2.5h5l6 6-5 5-6-6z"/><circle cx="5.5" cy="5.5" r="1"/>',
  undo: '<path d="M5 3 2.5 5.5 5 8M2.5 5.5H10a3.5 3.5 0 0 1 0 7H6"/>',
  trash: '<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 9h5.8l.6-9"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.46-3.54M13 3v2.5h-2.5"/>',
  sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
  moon: '<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z"/>',
  logs: '<path d="M3 4h10M3 8h10M3 12h6"/>',
  monitor: '<rect x="2" y="2.5" width="12" height="8.5" rx="1.5"/><path d="M6 13.5h4M8 11v2.5"/>',
};

export function Icon({
  name,
  size = 16,
  color = "currentColor",
  width = 1.5,
  style,
  fill = "none",
}: {
  name: keyof typeof P | string;
  size?: number;
  color?: string;
  width?: number;
  style?: CSSProperties;
  fill?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={fill}
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: P[name] ?? "" }}
    />
  );
}

export function WinIcon({ kind }: { kind: "min" | "max" | "close" }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      {kind === "min" && <path d="M0 5h10" />}
      {kind === "max" && <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" />}
      {kind === "close" && <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />}
    </svg>
  );
}
