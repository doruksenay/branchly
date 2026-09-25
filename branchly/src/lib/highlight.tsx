// Hafif sözdizimi renklendirme (dil bağımsız, satır bazlı)
export type Tok = { t: string; c: string };

const KW = new Set(
  (
    "import from export default function const let var return if else for while do switch case break continue new class extends " +
    "implements interface type enum public private protected static readonly async await try catch finally throw typeof instanceof in of " +
    "void null undefined true false this super yield def lambda pass None True False elif and or not is with as fn pub mod use struct impl " +
    "trait match mut ref where loop crate self Self namespace using package func go defer chan select map range string int bool " +
    "val when object fun override internal sealed data companion"
  ).split(" "),
);

const RE =
  /(\/\/.*$|#(?![a-fA-F0-9]{3,8}\b).*$|\/\*.*?\*\/|<!--.*?-->)|("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?)|(<\/?[A-Za-z][\w.-]*|\/?>)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_$][\w$]*)\b/g;

export function highlight(line: string, lang: string): Tok[] {
  if (lang === "plain" || line.length > 2000) return [{ t: line, c: "" }];
  const out: Tok[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  RE.lastIndex = 0;
  const hashComments = lang === "py" || lang === "sh" || lang === "yaml" || lang === "rb" || lang === "toml";
  while ((m = RE.exec(line))) {
    if (m.index > last) out.push({ t: line.slice(last, m.index), c: "" });
    let c = "";
    if (m[1]) {
      if (m[1].startsWith("#") && !hashComments) {
        // '#' yorum olmayan dillerde (ör. CSS renkleri, C önişlemci) düz metin
        out.push({ t: "#", c: "" });
        last = m.index + 1;
        RE.lastIndex = last;
        continue;
      }
      c = "tk-com";
    } else if (m[2]) c = "tk-str";
    else if (m[3]) c = "tk-tag";
    else if (m[4]) c = "tk-num";
    else if (m[5]) c = KW.has(m[5]) ? "tk-kw" : /^[A-Z]/.test(m[5]) ? "tk-type" : "";
    out.push({ t: m[0], c });
    last = RE.lastIndex;
    if (m[0].length === 0) RE.lastIndex++;
  }
  if (last < line.length) out.push({ t: line.slice(last), c: "" });
  return out;
}

export function langOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["py"].includes(ext)) return "py";
  if (["sh", "bash", "zsh", "ps1"].includes(ext)) return "sh";
  if (["yml", "yaml"].includes(ext)) return "yaml";
  if (["toml", "ini", "cfg", "conf"].includes(ext)) return "toml";
  if (["rb"].includes(ext)) return "rb";
  if (["txt", "log", "md", "csv"].includes(ext)) return "plain";
  return "c";
}

export function Code({ text, lang }: { text: string; lang: string }) {
  const toks = highlight(text.replace(/\r$/, ""), lang);
  return toks.map((k, i) => (k.c ? <span key={i} className={k.c}>{k.t}</span> : k.t));
}
