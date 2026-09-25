// Araç çubuğu, menüler ve komut paletinden çağrılan git işlemleri
import { t } from "./i18n";
import { useMemo } from "react";
import { api, git } from "./api";
import { useStore } from "./store";
import { useUi } from "./components/ui";

export function useActions() {
  const s = useStore();
  const ui = useUi();

  return useMemo(() => {
    const repo = () => s.repo?.root ?? "";
    const current = () => s.status?.branch ?? null;

    /** Çakışma çıkabilecek komutlar: çakışmada hata yerine çakışma ekranını açar */
    async function conflictAware(label: string, args: string[]) {
      await s.run(label, async () => {
        const r = await api.exec(repo(), args);
        if (r.ok) return;
        const st = await api.status(repo());
        if (st.files.some((f) => f.conflict)) {
          ui.toast(t("{label}: çakışma var, çözmeniz gerekiyor", { label }), "info");
          s.setView("conflicts");
          return;
        }
        throw new Error((r.stderr || r.stdout).trim());
      });
    }

    return {
      fetch: () => s.run(t("Fetch"), () => git(repo(), ["fetch", "--all", "--prune"]), t("Remote'lar güncellendi")),
      pull: () => conflictAware(t("Pull"), ["pull", "--no-rebase"]),
      push: async () => {
        const b = current();
        if (!b) return ui.toast(t("Ayrık HEAD durumunda push yapılamaz"), "error");
        const hasUp = !!s.status?.upstream;
        await s.run(t("Push"), async () => {
          if (hasUp) await git(repo(), ["push"]);
          else {
            const remotes = (await git(repo(), ["remote"])).stdout.split("\n").filter(Boolean);
            const remote = remotes.includes("origin") ? "origin" : remotes[0];
            if (!remote) throw new Error(t("Bu repository'de remote tanımlı değil."));
            await git(repo(), ["push", "-u", remote, b]);
          }
        }, t("Push tamamlandı"));
      },
      stash: async () => {
        const r = await ui.prompt({ title: t("Değişiklikleri stash'le"), label: t("Açıklama"), value: "WIP", checkbox: t("Takip edilmeyen dosyaları da dahil et"), ok: t("Stash'le") });
        if (!r) return;
        await s.run(t("Stash"), () => git(repo(), ["stash", "push", ...(r.checked ? ["-u"] : []), "-m", r.value]), t("Stash oluşturuldu"));
      },
      stashApply: (name: string, pop: boolean) => conflictAware(pop ? t("Stash pop") : t("Stash uygula"), ["stash", pop ? "pop" : "apply", name]),
      stashDrop: async (name: string) => {
        if (!(await ui.confirm({ title: t("Stash silinsin mi?"), text: t("{name} kalıcı olarak silinecek.", { name }), ok: t("Sil"), danger: true }))) return;
        await s.run(t("Stash sil"), () => git(repo(), ["stash", "drop", name]));
      },
      newBranch: async (start?: string) => {
        const r = await ui.prompt({ title: t("Yeni dal"), label: start ? t("Başlangıç: {x}", { x: start.slice(0, 10) }) : t("Dal adı"), placeholder: t("feature/yeni-ozellik"), checkbox: t("Oluşturduktan sonra geç"), ok: t("Oluştur") });
        if (!r) return;
        const name = r.value.replace(/\s+/g, "-");
        await s.run(t("Dal oluştur"), () =>
          git(repo(), r.checked ? ["switch", "-c", name, ...(start ? [start] : [])] : ["branch", name, ...(start ? [start] : [])]),
          t("{name} oluşturuldu", { name }),
        );
      },
      checkout: async (name: string, remote = false) => {
        if (remote) {
          const local = name.replace(/^[^/]+\//, "");
          const exists = s.branches.some((b) => b.kind === "local" && b.name === local);
          await s.run(t("Dala geç"), () => git(repo(), exists ? ["switch", local] : ["switch", "-c", local, "--track", name]));
        } else await s.run(t("Dala geç"), () => git(repo(), ["switch", name]));
      },
      checkoutCommit: async (hash: string) => {
        if (!(await ui.confirm({ title: t("Commit'e geçilsin mi?"), text: t("Ayrık HEAD (detached HEAD) durumuna geçeceksiniz."), ok: t("Geç") }))) return;
        await s.run(t("Checkout"), () => git(repo(), ["checkout", "--detach", hash]));
      },
      merge: async (name?: string) => {
        let target = name;
        if (!target) {
          const items = s.branches
            .filter((b) => b.kind !== "tag" && !b.head)
            .map((b) => ({ value: b.name, label: b.name, hint: b.kind === "remote" ? "uzak" : "" }));
          target = (await ui.pick({ title: t("{b} dalına birleştir", { b: current() ?? "HEAD" }), items })) ?? undefined;
        }
        if (!target) return;
        await conflictAware(t("Merge"), ["merge", "--no-edit", target]);
      },
      rebase: async (name: string) => {
        if (!(await ui.confirm({ title: t("Rebase yapılsın mı?"), text: t("{b} dalı {name} üzerine yeniden yazılacak.", { b: current() ?? "HEAD", name }), ok: t("Rebase") }))) return;
        await conflictAware(t("Rebase"), ["rebase", name]);
      },
      deleteBranch: async (name: string) => {
        if (!(await ui.confirm({ title: t("Dal silinsin mi?"), text: name, ok: t("Sil"), danger: true }))) return;
        await s.run(t("Dal sil"), async () => {
          const r = await api.exec(repo(), ["branch", "-d", name]);
          if (r.ok) return;
          if (/not fully merged/.test(r.stderr)) {
            if (await ui.confirm({ title: t("Dal birleştirilmemiş"), text: t("Bu daldaki bazı commit'ler hiçbir yerde yok. Yine de silinsin mi?"), ok: t("Zorla sil"), danger: true }))
              await git(repo(), ["branch", "-D", name]);
            return;
          }
          throw new Error(r.stderr);
        });
      },
      renameBranch: async (name: string) => {
        const r = await ui.prompt({ title: t("Dalı yeniden adlandır"), value: name, ok: t("Kaydet") });
        if (r) await s.run(t("Yeniden adlandır"), () => git(repo(), ["branch", "-m", name, r.value]));
      },
      cherryPick: (hash: string) => conflictAware(t("Cherry-pick"), ["cherry-pick", hash]),
      revert: (hash: string) => conflictAware(t("Revert"), ["revert", "--no-edit", hash]),
      reset: async (hash: string, mode: "soft" | "mixed" | "hard") => {
        const txt = {
          soft: t("Değişiklikler stage'de kalır."),
          mixed: t("Değişiklikler çalışma dizininde kalır, stage boşaltılır."),
          hard: t("Commit edilmemiş TÜM değişiklikler kaybolur!"),
        }[mode];
        if (!(await ui.confirm({ title: `${current() ?? "HEAD"} → ${hash.slice(0, 7)} (${mode})`, text: txt, ok: t("Sıfırla"), danger: mode === "hard" }))) return;
        await s.run(t("Reset"), () => git(repo(), ["reset", `--${mode}`, hash]));
      },
      tag: async (hash: string) => {
        const r = await ui.prompt({ title: t("Etiket ekle"), label: `Commit ${hash.slice(0, 7)}`, placeholder: t("v1.0.0"), ok: t("Ekle") });
        if (r) await s.run(t("Etiket"), () => git(repo(), ["tag", r.value, hash]));
      },
      opContinue: async () => {
        const k = s.op?.kind;
        if (!k || k === "none") return;
        const args = k === "merge" ? ["commit", "--no-edit"] : [k, "--continue"];
        await conflictAware(t("Devam et"), args);
      },
      opAbort: async () => {
        const k = s.op?.kind;
        if (!k || k === "none") return;
        if (!(await ui.confirm({ title: t("İşlem iptal edilsin mi?"), text: t("Çakışma çözümleri ve işlem geri alınır."), ok: t("İptal et"), danger: true }))) return;
        await s.run(t("İptal"), () => git(repo(), [k, "--abort"]));
      },
      opSkip: async () => {
        const k = s.op?.kind;
        if (!k || k === "none" || k === "merge") return;
        await conflictAware(t("Atla"), [k, "--skip"]);
      },
      copy: (text: string) => navigator.clipboard.writeText(text).then(() => ui.toast(t("Kopyalandı"), "ok")),
    };
  }, [s, ui]);
}
