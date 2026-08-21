"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clapperboard, Loader2 } from "lucide-react";
import { PostproductionAssemblyContainer } from "@/domains/materials/components/PostproductionAssemblyContainer";
import { PRODUCTION_THEME } from "@/domains/materials/components/production-asset-ui";
import { getStandaloneAssemblyProjectAction, type StandaloneAssemblyComponentView } from "./standalone-assembly.actions";
import { getStandaloneAssemblyReadiness } from "./standalone-assembly-readiness";

export function StandaloneAssemblyEditor({
  adminBasePath,
  projectId,
}: {
  adminBasePath: string;
  projectId: string;
}) {
  const [project, setProject] = useState<StandaloneAssemblyComponentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add("courseforge-assembly-focus");
    window.dispatchEvent(new CustomEvent("courseforge:admin-focus-mode", { detail: { enabled: true } }));
    return () => {
      document.documentElement.classList.remove("courseforge-assembly-focus");
      window.dispatchEvent(new CustomEvent("courseforge:admin-focus-mode", { detail: { enabled: false } }));
    };
  }, []);

  useEffect(() => {
    let active = true;
    void getStandaloneAssemblyProjectAction(projectId).then((result) => {
      if (!active) return;
      if (!result.success || !result.data) {
        setError(result.error || "No se pudo cargar el proyecto de ensamble.");
      } else {
        setProject(result.data);
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [projectId]);

  const backHref = `${adminBasePath}/assembly`;

  if (loading) {
    return <div className="flex h-screen items-center justify-center bg-slate-50 text-sm text-slate-600 dark:bg-[#0F1419] dark:text-gray-300"><Loader2 className="mr-2 animate-spin text-cyan-500" size={20} /> Preparando editor…</div>;
  }

  if (error || !project) {
    return <EditorUnavailable backHref={backHref} message={error || "Proyecto no encontrado."} />;
  }

  const readiness = getStandaloneAssemblyReadiness(project.component.assets);
  if (!readiness.canOpenEditor) {
    return <EditorUnavailable backHref={backHref} message="Este proyecto todavía necesita voz, avatar, B-roll con duración o un deck de slides antes de abrir el editor." />;
  }

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-slate-50 dark:bg-[#0F1419]">
      <header className={`${PRODUCTION_THEME.workspaceHeader} justify-between gap-4`}>
        <div className="flex min-w-0 items-center gap-4">
          <Link href={backHref} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"><ArrowLeft size={15} /> Assets</Link>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-cyan-700 dark:text-cyan-300"><Clapperboard size={13} /> Editor de ensamble</p>
            <h1 className="truncate text-base font-bold text-slate-900 dark:text-white">{project.project.title}</h1>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-white/10 dark:text-gray-300">{readiness.assetCount} asset(s)</span>
      </header>
      <main className="min-h-0 flex-1 p-3">
        <PostproductionAssemblyContainer
          artifactId={project.artifactId}
          initialComponentId={project.component.id}
          singleVideoOnly
        />
      </main>
    </div>
  );
}

function EditorUnavailable({ backHref, message }: { backHref: string; message: string }) {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50 p-6 dark:bg-[#0F1419]">
      <div className="max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-white/10 dark:bg-[#151A21]">
        <Clapperboard className="mx-auto text-slate-400" size={34} />
        <h1 className="mt-3 text-lg font-bold text-slate-900 dark:text-white">El editor aún no está disponible</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-gray-400">{message}</p>
        <Link href={backHref} className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#0A2540] px-4 py-2 text-sm font-bold text-white"><ArrowLeft size={15} /> Volver a preparar assets</Link>
      </div>
    </div>
  );
}
