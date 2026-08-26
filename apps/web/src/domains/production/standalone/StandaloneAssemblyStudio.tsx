"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Film,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import { ProductionAssetCard } from "@/domains/materials/components/ProductionAssetCard";
import { PRODUCTION_THEME } from "@/domains/materials/components/production-asset-ui";
import {
  generateVideoPromptsAction,
  saveMaterialAssetsAction,
} from "@/domains/materials/actions/production.actions";
import type {
  MaterialAssets,
  StoryboardItem,
} from "@/domains/materials/types/materials.types";
import {
  createStandaloneAssemblyProjectAction,
  getStandaloneAssemblyProjectAction,
  listStandaloneAssemblyProjectsAction,
  syncStandaloneAssemblyProjectAction,
  type StandaloneAssemblyComponentView,
  type StandaloneAssemblyProjectSummary,
} from "./standalone-assembly.actions";
import { getStandaloneAssemblyReadiness } from "./standalone-assembly-readiness";

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusLabel(project: StandaloneAssemblyProjectSummary) {
  if (project.finalVideoUrl || project.status === "COMPLETED") return "Finalizado";
  if (project.status === "RENDERING") return "Renderizando";
  if (project.productionStatus === "COMPLETED") return "Assets listos";
  return "En preparacion";
}

function statusClass(project: StandaloneAssemblyProjectSummary) {
  if (project.finalVideoUrl || project.status === "COMPLETED") {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (project.status === "RENDERING") {
    return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
  }
  return "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300";
}

export function StandaloneAssemblyStudio() {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [projects, setProjects] = useState<StandaloneAssemblyProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] =
    useState<StandaloneAssemblyProjectSummary | null>(null);
  const [componentView, setComponentView] =
    useState<StandaloneAssemblyComponentView | null>(null);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingProject, setLoadingProject] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const pendingAssetsRef = useRef<Record<string, Partial<MaterialAssets>>>({});
  const saveQueuesRef = useRef<Map<string, Promise<void>>>(new Map());

  const selectedProjectId = selectedProject?.id || null;

  const loadProjects = useCallback(
    async (nextQuery = "", preferredProjectId?: string) => {
      setLoadingProjects(true);
      setError(null);
      const result = await listStandaloneAssemblyProjectsAction(nextQuery);
      if (!result.success) {
        setError(result.error || "No se pudieron cargar ensambles.");
        setProjects([]);
        setLoadingProjects(false);
        return;
      }

      const nextProjects = result.projects || [];
      setProjects(nextProjects);
      setSelectedProject((current) => {
        const selectedId = preferredProjectId || current?.id;
        if (selectedId) {
          const match = nextProjects.find((project) => project.id === selectedId);
          if (match) return match;
        }
        return nextProjects[0] || null;
      });
      setLoadingProjects(false);
    },
    [],
  );

  const loadSelectedProject = useCallback(async (projectId: string) => {
    setLoadingProject(true);
    setError(null);
    const result = await getStandaloneAssemblyProjectAction(projectId);
    if (!result.success) {
      setError(result.error || "No se pudo cargar el proyecto.");
      setComponentView(null);
      setLoadingProject(false);
      return;
    }

    setComponentView(result.data || null);
    setLoadingProject(false);
  }, []);

  useEffect(() => {
    void loadProjects("");
  }, [loadProjects]);

  useEffect(() => {
    if (!selectedProjectId) {
      setComponentView(null);
      return;
    }

    void loadSelectedProject(selectedProjectId);
  }, [loadSelectedProject, selectedProjectId]);

  const selectedProjectLabel = useMemo(() => {
    if (!selectedProject) return "Sin video seleccionado";
    return selectedProject.title;
  }, [selectedProject]);
  const adminBasePath = useMemo(() => {
    const adminIndex = pathname.indexOf("/admin");
    return adminIndex >= 0 ? pathname.slice(0, adminIndex + "/admin".length) : "/admin";
  }, [pathname]);
  const sofliaSlidesHref = useMemo(() => {
    const componentId = componentView?.component.id;
    if (!componentId) return undefined;

    const params = new URLSearchParams({
      componentId,
      returnTo: pathname,
    });

    return `${adminBasePath}/slides?${params.toString()}`;
  }, [adminBasePath, componentView?.component.id, pathname]);
  const readiness = useMemo(
    () => getStandaloneAssemblyReadiness(componentView?.component.assets),
    [componentView?.component.assets],
  );
  const editorHref = componentView
    ? `${adminBasePath}/assembly/${componentView.project.id}/edit`
    : null;

  const handleCreateProject = async () => {
    const title = newTitle.trim();
    if (!title) {
      setError("Agrega un titulo para crear el video de ensamble.");
      return;
    }

    setCreatingProject(true);
    setError(null);
    const result = await createStandaloneAssemblyProjectAction({ title });
    if (!result.success || !result.project) {
      setError(result.error || "No se pudo crear el proyecto.");
      setCreatingProject(false);
      return;
    }

    setNewTitle("");
    await loadProjects(query, result.project.id);
    setCreatingProject(false);
  };

  const handleGeneratePrompts = async (
    componentId: string,
    storyboard: StoryboardItem[],
  ) => {
    const result = await generateVideoPromptsAction(componentId, storyboard);
    if (!result.success) {
      throw new Error(result.error || "No se pudieron generar prompts.");
    }

    return result.prompts || "";
  };

  const handleSaveAssets = async (
    componentId: string,
    assets: Partial<MaterialAssets>,
  ): Promise<void> => {
    pendingAssetsRef.current[componentId] = {
      ...pendingAssetsRef.current[componentId],
      ...assets,
    };

    const activeQueue = saveQueuesRef.current.get(componentId);
    if (activeQueue) {
      await activeQueue;
      const followUpQueue = saveQueuesRef.current.get(componentId);
      if (followUpQueue && followUpQueue !== activeQueue) {
        await followUpQueue;
        return;
      }
      if (pendingAssetsRef.current[componentId]) {
        await handleSaveAssets(componentId, {});
      }
      return;
    }

    const projectId = componentView?.project.id;
    const queue = (async () => {
      while (true) {
        let saved = false;
        while (pendingAssetsRef.current[componentId]) {
          const nextAssets = pendingAssetsRef.current[componentId];
          delete pendingAssetsRef.current[componentId];

          const result = await saveMaterialAssetsAction(componentId, nextAssets);
          if (!result.success) {
            pendingAssetsRef.current[componentId] = {
              ...nextAssets,
              ...pendingAssetsRef.current[componentId],
            };
            throw new Error(result.error || "No se pudieron guardar assets.");
          }
          saved = true;
        }

        if (projectId && saved) {
          await syncStandaloneAssemblyProjectAction(projectId);
          await loadSelectedProject(projectId);
          await loadProjects(query, projectId);
        }

        if (!pendingAssetsRef.current[componentId]) break;
      }
    })().finally(() => {
        saveQueuesRef.current.delete(componentId);
        if (pendingAssetsRef.current[componentId]) {
          void handleSaveAssets(componentId, {});
        }
      });

    void queue.catch((saveError) => {
      console.error("Error auto-saving standalone production assets:", saveError);
      setError(saveError instanceof Error ? saveError.message : "No se pudieron guardar assets.");
    });
    saveQueuesRef.current.set(componentId, queue);
    await queue;
  };

  return (
    <div className="engine-assembly-studio space-y-5">
      <div className="engine-assembly-header">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-600 dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-surface-solid)] dark:text-[var(--engine-text-muted)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--engine-accent-strong)]" />
            Ensamble independiente
          </div>
          <h1 className="text-3xl text-gray-900 dark:text-white">
            Estudio de Ensamble
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-gray-600 dark:text-[var(--engine-text-muted)]">
            Crea o selecciona un proyecto, prepara sus assets y después continúa al editor de video.
          </p>
        </div>

        <form
          className="engine-assembly-search"
          onSubmit={(event) => {
            event.preventDefault();
            void loadProjects(query);
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar ensamble"
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm text-gray-900 outline-none transition focus:border-[var(--engine-accent)] focus:ring-2 focus:ring-[var(--engine-accent)]/20 dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-surface-solid)] dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={loadingProjects}
            className="engine-button engine-button--primary"
          >
            {loadingProjects ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar
          </button>
        </form>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="engine-assembly-layout">
        <aside className="engine-project-rail">
          <div className="border-b border-gray-100 p-4 dark:border-white/5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-gray-900 dark:text-white">Videos de ensamble</h2>
                <p className="text-xs text-gray-500 dark:text-[var(--engine-text-muted)]">{projects.length} proyecto(s)</p>
              </div>
              <button
                type="button"
                onClick={() => void loadProjects(query)}
                disabled={loadingProjects}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[var(--engine-muted)]/20 dark:text-gray-200 dark:hover:bg-white/5"
                title="Actualizar"
              >
                <RefreshCw className={`h-4 w-4 ${loadingProjects ? "animate-spin" : ""}`} />
              </button>
            </div>

            <form
              className="mt-4 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void handleCreateProject();
              }}
            >
              <input
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Titulo del video"
                className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[var(--engine-accent)] focus:ring-2 focus:ring-[var(--engine-accent)]/20 dark:border-[var(--engine-muted)]/10 dark:bg-[#0F131A] dark:text-white"
              />
              <button
                type="submit"
                disabled={creatingProject}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--engine-accent-strong)] text-white transition hover:bg-[#008f79] disabled:cursor-not-allowed disabled:opacity-60"
                title="Crear video"
              >
                {creatingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
            </form>
          </div>

          <div className="max-h-[620px] space-y-2 overflow-y-auto p-3">
            {loadingProjects ? (
              <div className="flex items-center justify-center py-12 text-sm text-gray-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cargando ensambles
              </div>
            ) : projects.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-200 p-4 text-center text-sm text-gray-500 dark:border-[var(--engine-muted)]/20">
                Crea un video para iniciar el ensamble independiente.
              </div>
            ) : (
              projects.map((project) => {
                const isSelected = project.id === selectedProjectId;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => setSelectedProject(project)}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      isSelected
                        ? "border-[var(--engine-accent)] bg-[var(--engine-accent)]/5 ring-1 ring-[var(--engine-accent)]/25"
                        : "border-gray-200 hover:bg-gray-50 dark:border-[var(--engine-muted)]/10 dark:hover:bg-white/5"
                    }`}
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span className="line-clamp-2 text-sm font-bold text-gray-900 dark:text-white">
                        {project.title}
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(project)}`}>
                        {statusLabel(project)}
                      </span>
                    </div>
                    {project.description ? (
                      <p className="line-clamp-2 text-xs text-gray-500 dark:text-[var(--engine-text-muted)]">
                        {project.description}
                      </p>
                    ) : null}
                    <div className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">
                      {formatDate(project.updatedAt)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          <div className="engine-assembly-context">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-normal text-gray-500 dark:text-[var(--engine-text-muted)]">
                  Video activo
                </p>
                <h2 className="mt-1 truncate text-lg font-bold text-gray-900 dark:text-white">
                  {selectedProjectLabel}
                </h2>
              </div>
              {componentView?.component.assets?.final_video_url ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Video final disponible
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
                  <Film className="h-3.5 w-3.5" />
                  Pendiente de ensamble
                </div>
              )}
            </div>
          </div>

          {loadingProject ? (
            <div className={`flex flex-col items-center justify-center py-20 ${PRODUCTION_THEME.panel}`}>
              <Loader2 className="mb-4 h-8 w-8 animate-spin text-[var(--engine-info)]" />
              <p className={`font-medium ${PRODUCTION_THEME.secondaryText}`}>Cargando ensamble...</p>
            </div>
          ) : componentView ? (
            <div className="space-y-6">
              <div className="engine-assembly-readiness">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-cyan-700 dark:text-cyan-300"><Upload size={14} /> Preparación de assets</p>
                    <h3 className="mt-1 text-base font-bold text-slate-900 dark:text-white">Carga y clasifica los medios del proyecto</h3>
                    <p className="mt-1 text-xs text-slate-600 dark:text-gray-400">Cuando termines, abre el editor en la siguiente página para trabajar con preview y timeline.</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm dark:bg-white/10 dark:text-gray-300">{readiness.assetCount} asset(s)</span>
                </div>
              </div>

              <ProductionAssetCard
                component={componentView.component}
                hideGeneratedAssetTools
                hideStoryboard
                lessonTitle={componentView.lessonTitle}
                onGeneratePrompts={handleGeneratePrompts}
                onAssetChange={handleSaveAssets}
                slideTemplatesHref={`${adminBasePath}/templates`}
                slideTemplateStudioHref={`${adminBasePath}/slides/templates`}
                sofliaSlidesHref={sofliaSlidesHref}
              />

              <div className="engine-assembly-next">
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">Siguiente paso: edición</p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">{readiness.canOpenEditor ? "El proyecto ya tiene una fuente de duración válida." : "Agrega voz, avatar, B-roll con duración o un deck de slides para continuar."}</p>
                </div>
                {readiness.canOpenEditor && editorHref ? (
                  <Link href={editorHref} className="engine-button engine-button--primary">Abrir editor <ArrowRight size={16} /></Link>
                ) : (
                  <button type="button" disabled className="inline-flex min-h-10 shrink-0 cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-slate-200 px-5 py-2.5 text-sm font-bold text-slate-500 dark:bg-white/10 dark:text-gray-500">Abrir editor <ArrowRight size={16} /></button>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-200 bg-white p-10 text-center dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-surface-solid)]">
              <Film className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
              <p className="text-sm font-medium text-gray-500 dark:text-[var(--engine-text-muted)]">
                Crea o selecciona un video de ensamble para subir assets y renderizar.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
