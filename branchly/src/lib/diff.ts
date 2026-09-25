// Birleşik (unified) diff ayrıştırma ve satır bazında kısmi yama üretimi.
// Satır içerikleri '\r' dahil olduğu gibi korunur; böylece CRLF dosyalar bozulmaz.

export type DiffLine = {
  kind: "ctx" | "add" | "del" | "meta";
  text: string; // işaret karakteri olmadan
  oldNo: number | null;
  newNo: number | null;
  idx: number; // hunk içindeki sıra
  noNewline?: boolean; // ardından "\ No newline at end of file" geliyor
};

export type Hunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  section: string;
  lines: DiffLine[];
};

export type FileDiff = {
  headerLines: string[]; // "diff --git", "---", "+++" vb.
  hunks: Hunk[];
};

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

export function parseDiff(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  if (!text) return files;
  const rows = text.split("\n");
  if (rows[rows.length - 1] === "") rows.pop();
  let file: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of rows) {
    if (raw.startsWith("diff --git ")) {
      file = { headerLines: [raw], hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) {
      file = { headerLines: [], hunks: [] };
      files.push(file);
    }
    const m = HUNK_RE.exec(raw.replace(/\r$/, ""));
    if (m) {
      hunk = {
        header: raw.replace(/\r$/, ""),
        oldStart: +m[1],
        oldCount: m[2] === undefined ? 1 : +m[2],
        newStart: +m[3],
        newCount: m[4] === undefined ? 1 : +m[4],
        section: m[5].trim(),
        lines: [],
      };
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) {
      file.headerLines.push(raw);
      continue;
    }
    const c = raw[0];
    const body = raw.slice(1);
    if (c === "+") {
      hunk.lines.push({ kind: "add", text: body, oldNo: null, newNo: newNo++, idx: hunk.lines.length });
    } else if (c === "-") {
      hunk.lines.push({ kind: "del", text: body, oldNo: oldNo++, newNo: null, idx: hunk.lines.length });
    } else if (c === "\\") {
      const prev = hunk.lines[hunk.lines.length - 1];
      if (prev) prev.noNewline = true;
    } else {
      hunk.lines.push({ kind: "ctx", text: body, oldNo: oldNo++, newNo: newNo++, idx: hunk.lines.length });
    }
  }
  return files;
}

/**
 * Seçilen satırlardan uygulanabilir bir yama üretir.
 *
 * mode "forward": çalışma dizini diff'inden indekse uygulanacak (stage) ya da
 *   git apply -R ile geri alınacak (discard) yama. Seçilmemiş '-' satırları
 *   bağlam olur, seçilmemiş '+' satırları atılır.
 * mode "reverse": indeks diff'inden `git apply --cached -R` ile unstage için.
 *   Ters yönde uygulandığından kural aynıdır ama taraflar yer değiştirir:
 *   seçilmemiş '+' satırları bağlam olur, seçilmemiş '-' satırları atılır.
 */
export function buildPatch(
  file: FileDiff,
  selection: Map<number, Set<number>>, // hunkIndex -> satır idx'leri
  mode: "forward" | "reverse",
): string | null {
  const out: string[] = [];
  const header = file.headerLines.filter(
    (l) => l.startsWith("diff --git") || l.startsWith("---") || l.startsWith("+++") || l.startsWith("new file mode") || l.startsWith("deleted file mode"),
  );
  // "new file mode" varken kısmi seçim yapılırsa yine de yeni dosya olarak eklenir
  out.push(...header);
  let any = false;
  file.hunks.forEach((h, hi) => {
    const sel = selection.get(hi);
    if (!sel || sel.size === 0) return;
    const body: string[] = [];
    let oldCount = 0;
    let newCount = 0;
    let changed = false;
    for (const l of h.lines) {
      const chosen = sel.has(l.idx);
      let line: string | null = null;
      if (l.kind === "ctx") {
        line = " " + l.text;
        oldCount++;
        newCount++;
      } else if (l.kind === "add") {
        if (chosen) {
          line = "+" + l.text;
          newCount++;
          changed = true;
        } else if (mode === "reverse") {
          line = " " + l.text;
          oldCount++;
          newCount++;
        }
      } else if (l.kind === "del") {
        if (chosen) {
          line = "-" + l.text;
          oldCount++;
          changed = true;
        } else if (mode === "forward") {
          line = " " + l.text;
          oldCount++;
          newCount++;
        }
      }
      if (line !== null) {
        body.push(line);
        if (l.noNewline) body.push("\\ No newline at end of file");
      }
    }
    if (!changed) return;
    any = true;
    out.push(`@@ -${h.oldStart},${oldCount} +${h.newStart},${newCount} @@`);
    out.push(...body);
  });
  if (!any) return null;
  return out.join("\n") + "\n";
}

export function allChangeLines(h: Hunk): Set<number> {
  return new Set(h.lines.filter((l) => l.kind !== "ctx").map((l) => l.idx));
}

export function diffStats(files: FileDiff[]) {
  let add = 0;
  let del = 0;
  for (const f of files) for (const h of f.hunks) for (const l of h.lines) {
    if (l.kind === "add") add++;
    else if (l.kind === "del") del++;
  }
  return { add, del };
}
