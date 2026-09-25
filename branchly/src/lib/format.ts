import { getLang } from "../i18n";
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS_LONG_TR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

const en = () => getLang() === "en";
const mon = (i: number) => (en() ? MONTHS_EN : MONTHS_TR)[i];
const monLong = (i: number) => (en() ? MONTHS_LONG_EN : MONTHS_LONG_TR)[i];

const pad = (n: number) => String(n).padStart(2, "0");

export function shortDate(unix: number): string {
  const d = new Date(unix * 1000);
  const now = new Date();
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay) return `${en() ? "Today" : "Bugün"} ${hm}`;
  if (d.toDateString() === y.toDateString()) return `${en() ? "Yesterday" : "Dün"} ${hm}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getDate()} ${mon(d.getMonth())} ${hm}`;
  return `${d.getDate()} ${mon(d.getMonth())} ${d.getFullYear()}`;
}

export function longDate(unix: number): string {
  const d = new Date(unix * 1000);
  return en()
    ? `${monLong(d.getMonth())} ${d.getDate()}, ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
    : `${d.getDate()} ${monLong(d.getMonth())} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function relative(iso: string): string {
  const t = new Date(iso).getTime();
  const s = Math.max(0, (Date.now() - t) / 1000);
  const E = en();
  if (s < 60) return E ? "just now" : "az önce";
  if (s < 3600) return E ? `${Math.floor(s / 60)} min ago` : `${Math.floor(s / 60)} dk önce`;
  if (s < 86400) return E ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 3600)} sa önce`;
  if (s < 86400 * 2) return E ? "yesterday" : "dün";
  if (s < 86400 * 30) return E ? `${Math.floor(s / 86400)} days ago` : `${Math.floor(s / 86400)} gün önce`;
  return new Date(iso).toLocaleDateString(E ? "en-US" : "tr-TR");
}

export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "?") + (p.length > 1 ? p[p.length - 1][0] : "")).toLocaleUpperCase("tr-TR");
}

const AVATAR = [
  ["#F2D7C9", "#7A3E1D"],
  ["#D5E3F7", "#1E4E8C"],
  ["#DCEFD9", "#2F6A2B"],
  ["#EADCF7", "#5B2E8C"],
  ["#F7E6C9", "#7A5A1D"],
  ["#D2EEF0", "#1D6670"],
];
export function avatarColors(key: string): [string, string] {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const c = AVATAR[h % AVATAR.length];
  return [c[0], c[1]];
}

export function basename(p: string) {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}
export function dirname(p: string) {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}
