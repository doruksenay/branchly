// Rust arka ucuna yapılan tüm çağrılar
import { invoke } from "@tauri-apps/api/core";

export type FileStatus = {
  path: string;
  orig_path: string | null;
  x: string;
  y: string;
  conflict: boolean;
  untracked: boolean;
};
export type StatusInfo = {
  branch: string | null;
  oid: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: FileStatus[];
};
export type Commit = {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  subject: string;
  refs: string[];
};
export type ChangedFile = { path: string; old_path: string | null; status: string; added: number; deleted: number };
export type CommitDetail = {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  body: string;
  files: ChangedFile[];
};
export type Branch = {
  kind: "local" | "remote" | "tag";
  name: string;
  full: string;
  short_oid: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  head: boolean;
  time: number;
};
export type Stash = { name: string; message: string; time: number };
export type OpState = {
  kind: "none" | "merge" | "cherry-pick" | "revert" | "rebase";
  head: string | null;
  subject: string | null;
  step: number | null;
  total: number | null;
};
export type RunResult = { ok: boolean; code: number; stdout: string; stderr: string };
export type DiffResult = { text: string; binary: boolean; too_large: boolean };
export type ConflictInfo = {
  kind: "text" | "binary" | "deleted";
  merged: string;
  ours_exists: boolean;
  theirs_exists: boolean;
  conflicts: number;
};
export type DirEntry = { name: string; path: string; is_dir: boolean; ignored: boolean };
export type FileContent = { content: string; binary: boolean; too_large: boolean; size: number };
export type Shell = { id: string; name: string; program: string; args: string[] };
export type CmdLog = { time: number; cmd: string; ok: boolean; ms: number };
export type BbStatus = { configured: boolean; logged_in: boolean; user: any | null };
export type RepoRef = { workspace: string; slug: string };
export type StRepo = { name: string; path: string; folder: string | null; exists: boolean; is_git: boolean; open_tab: boolean };

export const api = {
  repoOpen: (path: string) => invoke<{ root: string; name: string }>("repo_open", { path }),
  status: (repo: string) => invoke<StatusInfo>("git_status", { repo }),
  log: (repo: string, limit: number, skip = 0, all = true, path: string | null = null) =>
    invoke<Commit[]>("git_log", { repo, limit, skip, all, path }),
  commitDetail: (repo: string, hash: string) => invoke<CommitDetail>("git_commit_detail", { repo, hash }),
  branches: (repo: string) => invoke<Branch[]>("git_branches", { repo }),
  stashes: (repo: string) => invoke<Stash[]>("git_stashes", { repo }),
  opState: (repo: string) => invoke<OpState>("git_op_state", { repo }),
  diff: (repo: string, path: string, staged: boolean, untracked: boolean) =>
    invoke<DiffResult>("git_diff", { repo, path, staged, untracked }),
  commitFileDiff: (repo: string, hash: string, path: string, parents: number) =>
    invoke<DiffResult>("git_commit_file_diff", { repo, hash, path, parents }),
  applyPatch: (repo: string, patch: string, cached: boolean, reverse: boolean) =>
    invoke<void>("git_apply_patch", { repo, patch, cached, reverse }),
  discard: (repo: string, paths: string[], untracked: string[]) => invoke<void>("git_discard", { repo, paths, untracked }),
  exec: (repo: string, args: string[], stdin: string | null = null) => invoke<RunResult>("git_exec", { repo, args, stdin }),
  conflict: (repo: string, path: string) => invoke<ConflictInfo>("git_conflict", { repo, path }),
  resolveWrite: (repo: string, path: string, content: string) => invoke<void>("git_resolve_write", { repo, path, content }),
  resolveTake: (repo: string, path: string, side: "ours" | "theirs" | "delete") =>
    invoke<void>("git_resolve_take", { repo, path, side }),
  cmdLog: () => invoke<CmdLog[]>("git_cmd_log"),
  gitVersion: () => invoke<string>("git_version"),

  listDir: (repo: string, rel: string) => invoke<DirEntry[]>("fs_list_dir", { repo, rel }),
  readFile: (repo: string, rel: string) => invoke<FileContent>("fs_read_file", { repo, rel }),
  openEditor: (repo: string, rel: string, editor: string) => invoke<void>("fs_open_editor", { repo, rel, editor }),
  reveal: (repo: string, rel: string) => invoke<void>("fs_reveal", { repo, rel }),
  watch: (repo: string) => invoke<void>("watch_repo", { repo }),

  shells: () => invoke<Shell[]>("pty_list_shells"),
  ptySpawn: (program: string, args: string[], cwd: string, cols: number, rows: number) =>
    invoke<number>("pty_spawn", { program, args, cwd, cols, rows }),
  ptyWrite: (id: number, data: string) => invoke<void>("pty_write", { id, data }),
  ptyResize: (id: number, cols: number, rows: number) => invoke<void>("pty_resize", { id, cols, rows }),
  ptyKill: (id: number) => invoke<void>("pty_kill", { id }),

  settingsGet: () => invoke<Record<string, any>>("settings_get"),
  settingsSet: (value: Record<string, any>) => invoke<void>("settings_set", { value }),

  bbStatus: () => invoke<BbStatus>("bb_status"),
  bbLogin: (clientId: string, clientSecret: string) => invoke<any>("bb_login", { clientId, clientSecret }),
  bbLogout: () => invoke<void>("bb_logout"),
  bb: (method: string, path: string, body: any = null) => invoke<any>("bb_api", { method, path, body }),
  bbRepo: (repo: string) => invoke<RepoRef | null>("bb_repo_info", { repo }),
  openUrl: (url: string) => invoke<void>("open_url", { url }),
  sourcetreeRepos: () => invoke<StRepo[]>("sourcetree_repos"),
};

/** git_exec sonucu başarısızsa hata fırlatır */
export async function git(repo: string, args: string[], stdin: string | null = null): Promise<RunResult> {
  const r = await api.exec(repo, args, stdin);
  if (!r.ok) throw new Error((r.stderr || r.stdout || "git error").trim());
  return r;
}

export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return JSON.stringify(e);
}
