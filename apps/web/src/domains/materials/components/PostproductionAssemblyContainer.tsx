"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clapperboard, Film, Loader2 } from "lucide-react";
import { useMaterials } from "../hooks/useMaterials";
import { HyperframesCompositionPanel } from "./HyperframesCompositionPanel";
import { PRODUCTION_THEME } from "./production-asset-ui";

interface PostproductionAssemblyContainerProps {
  artifactId: string;
  initialComponentId?: string;
  onNext?: () => void;
  profile?: unknown;
  singleVideoOnly?: boolean;
}

interface VideoComponent {
  assets?: { final_video_url?: string };
  content?: Record<string, unknown>;
  id: string;
  lessonTitle: string;
  type: string;
}

function getComponentTitle(component: VideoComponent) {
  const contentTitle = typeof component.content?.title === "string" ? component.content.title : null;
  return contentTitle || component.lessonTitle || "Video";
}

function hasProductionMedia(component: VideoComponent) {
  const assets = component.assets;
  if (!assets || typeof assets !== "object") return false;
  const values = assets as Record<string, unknown>;
  const slides = values.slides && typeof values.slides === "object"
    ? values.slides as Record<string, unknown>
    : null;
  return Boolean(
    values.voice_audio
    || (Array.isArray(values.voice_clips) && values.voice_clips.length > 0)
    || values.background_music
    || values.avatar_video
    || (Array.isArray(values.avatar_clips) && values.avatar_clips.length > 0)
    || (Array.isArray(values.b_roll_clips) && values.b_roll_clips.length > 0)
    || slides?.animated_deck
    || (Array.isArray(slides?.images) && slides.images.length > 0)
  );
}

/**
 * Dedicated assembly surface for Courseforge's internal video composition flow.
 * Legacy Remotion and desktop-worker controls are intentionally absent here.
 */
export function PostproductionAssemblyContainer({
  artifactId,
  initialComponentId,
  onNext,
  singleVideoOnly = false,
}: PostproductionAssemblyContainerProps) {
  const { materials, getLessonComponents, refresh } = useMaterials(artifactId);
  const [components, setComponents] = useState<VideoComponent[]>([]);
  const [activeComponentId, setActiveComponentId] = useState<string | null>(initialComponentId || null);
  const [isLoading, setIsLoading] = useState(true);

  const loadComponents = useCallback(async () => {
    if (!materials?.lessons) {
      setComponents([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const groups = await Promise.all(materials.lessons.map(async (lesson) => {
        const lessonComponents = await getLessonComponents(lesson.id);
        return lessonComponents
          .filter((component) => component.type.includes("VIDEO"))
          .map((component) => ({
            assets: component.assets,
            content: component.content,
            id: component.id,
            lessonTitle: lesson.lesson_title,
            type: component.type,
          } satisfies VideoComponent));
      }));
      const allComponents = groups.flat();
      const scoped = initialComponentId
        ? allComponents.filter((component) => component.id === initialComponentId)
        : singleVideoOnly
          ? allComponents.slice(0, 1)
          : allComponents;
      const preferredComponent = scoped.find(hasProductionMedia) || scoped[0] || null;
      setComponents(scoped);
      setActiveComponentId((current) => current && scoped.some((component) => component.id === current)
        ? current
        : preferredComponent?.id || null);
    } catch (error) {
      console.error("[VideoAssemblyStudio] No se pudieron cargar los componentes:", error);
      setComponents([]);
    } finally {
      setIsLoading(false);
    }
  }, [getLessonComponents, initialComponentId, materials?.lessons]);

  useEffect(() => { void loadComponents(); }, [loadComponents]);

  const activeComponent = useMemo(
    () => components.find((component) => component.id === activeComponentId) || null,
    [activeComponentId, components],
  );
  const completedCount = components.filter((component) => Boolean(component.assets?.final_video_url)).length;

  const handleVideoCompleted = async () => {
    await refresh();
    await loadComponents();
  };

  if (isLoading) {
    return (
      <div className={`flex min-h-80 items-center justify-center ${PRODUCTION_THEME.panel}`}>
        <Loader2 className="animate-spin text-cyan-400" size={30} />
      </div>
    );
  }

  if (components.length === 0) {
    return (
      <div className={`${PRODUCTION_THEME.panel} flex min-h-80 flex-col items-center justify-center p-8 text-center`}>
        <Film className="mb-3 text-gray-500" size={40} />
        <h2 className={`text-lg font-bold ${PRODUCTION_THEME.primaryText}`}>No hay videos para ensamblar</h2>
        <p className={`mt-2 max-w-md text-sm ${PRODUCTION_THEME.secondaryText}`}>Genera materiales con componentes de video antes de entrar al estudio de ensamblaje.</p>
      </div>
    );
  }

  return (
    <section className="relative flex h-full min-h-0 flex-col">
      <header className="sr-only">
        <div>
          <h2 className="flex items-center gap-3 text-xl font-bold text-slate-900 dark:text-white"><Clapperboard className="text-cyan-600 dark:text-cyan-300" /> Estudio de ensamblaje</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-gray-400">Edita la composición, revisa el preview y envía el video final a renderizado en la nube.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm dark:border-white/10 dark:bg-black/20">
          <CheckCircle2 className="text-green-400" size={17} />
          <span className="font-semibold text-slate-900 dark:text-white">{completedCount}/{components.length}</span><span className="text-slate-500 dark:text-gray-400">videos finalizados</span>
        </div>
      </header>

      <div className="min-h-0 min-w-0 flex-1">
        <aside className="hidden">
          <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gray-500">Videos del curso</p>
          {components.map((component, index) => {
            const active = component.id === activeComponentId;
            const completed = Boolean(component.assets?.final_video_url);
            return (
              <button key={component.id} type="button" onClick={() => setActiveComponentId(component.id)} className={`w-full rounded-xl border p-3 text-left transition-colors ${active ? "border-cyan-400 bg-cyan-50 dark:border-cyan-400/40 dark:bg-cyan-400/10" : "border-transparent hover:bg-slate-100 dark:hover:bg-white/5"}`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${completed ? "bg-green-100 text-green-700 dark:bg-green-400/15 dark:text-green-300" : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-gray-400"}`}>{completed ? <CheckCircle2 size={14} /> : index + 1}</span>
                  <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">{getComponentTitle(component)}</span><span className="mt-1 block text-[11px] text-slate-500 dark:text-gray-500">{component.lessonTitle} · {component.type}</span></span>
                </div>
              </button>
            );
          })}
        </aside>

        <div className="h-full min-w-0">
          {activeComponent && (
            <HyperframesCompositionPanel
              componentId={activeComponent.id}
              componentTitle={getComponentTitle(activeComponent)}
              lessonLibrary={components.map((component) => ({
                completed: Boolean(component.assets?.final_video_url),
                id: component.id,
                subtitle: `${component.lessonTitle} · ${component.type}`,
                title: getComponentTitle(component),
              }))}
              onSelectLesson={setActiveComponentId}
              onContinueToPublication={onNext}
              onVideoCompleted={() => { void handleVideoCompleted(); }}
              selectedLessonId={activeComponentId}
            />
          )}
        </div>
      </div>

    </section>
  );
}
