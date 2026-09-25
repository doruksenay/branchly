// diff3 biçimindeki çakışma işaretlerini (<<<<<<< ||||||| ======= >>>>>>>) parçalara ayırır.

export type Segment =
  | { type: "common"; lines: string[] }
  | { type: "conflict"; id: number; ours: string[]; base: string[]; theirs: string[] };

export type Choice = "ours" | "theirs" | "ours-theirs" | "theirs-ours";

const strip = (l: string) => l.replace(/\r$/, "");

export function parseConflicts(text: string): { segments: Segment[]; eol: "\r\n" | "\n"; trailingNewline: boolean } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = text.endsWith("\n");
  const rows = text.split("\n");
  if (trailingNewline) rows.pop();
  // '\r' her satırda korunur; bu yüzden birleştirmede yalnızca '\n' kullanılır
  const segments: Segment[] = [];
  let common: string[] = [];
  let id = 0;
  let i = 0;
  while (i < rows.length) {
    const r = strip(rows[i]);
    if (r.startsWith("<<<<<<< ") || r === "<<<<<<<") {
      if (common.length) segments.push({ type: "common", lines: common });
      common = [];
      const ours: string[] = [];
      const base: string[] = [];
      const theirs: string[] = [];
      let part: "ours" | "base" | "theirs" = "ours";
      i++;
      while (i < rows.length) {
        const s = strip(rows[i]);
        if (s.startsWith("||||||| ") || s === "|||||||") part = "base";
        else if (s === "=======") part = "theirs";
        else if (s.startsWith(">>>>>>> ") || s === ">>>>>>>") break;
        else (part === "ours" ? ours : part === "base" ? base : theirs).push(rows[i]);
        i++;
      }
      segments.push({ type: "conflict", id: id++, ours, base, theirs });
      i++;
      continue;
    }
    common.push(rows[i]);
    i++;
  }
  if (common.length) segments.push({ type: "common", lines: common });
  return { segments, eol, trailingNewline };
}

export function linesFor(seg: Extract<Segment, { type: "conflict" }>, choice: Choice): string[] {
  switch (choice) {
    case "ours":
      return seg.ours;
    case "theirs":
      return seg.theirs;
    case "ours-theirs":
      return [...seg.ours, ...seg.theirs];
    case "theirs-ours":
      return [...seg.theirs, ...seg.ours];
  }
}

/** Seçimlere göre sonucu üretir; çözülmemiş bloklar işaretlerle kalır. */
export function compose(
  parsed: ReturnType<typeof parseConflicts>,
  choices: Record<number, Choice | undefined>,
): string {
  const out: string[] = [];
  const cr = parsed.eol === "\r\n" ? "\r" : "";
  for (const s of parsed.segments) {
    if (s.type === "common") out.push(...s.lines);
    else {
      const c = choices[s.id];
      if (c) out.push(...linesFor(s, c));
      else {
        out.push("<<<<<<< Mevcut" + cr, ...s.ours, "||||||| Temel" + cr, ...s.base, "=======" + cr, ...s.theirs, ">>>>>>> Gelen" + cr);
      }
    }
  }
  let text = out.join("\n");
  if (parsed.trailingNewline) text += "\n";
  return text;
}

export function hasMarkers(text: string): boolean {
  return /^(<<<<<<< |>>>>>>> |=======\r?$)/m.test(text);
}
