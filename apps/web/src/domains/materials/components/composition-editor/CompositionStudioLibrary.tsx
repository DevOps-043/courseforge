"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  FileQuestion,
  Film,
  Image as ImageIcon,
  Music2,
  Play,
  Plus,
  ScrollText,
  Send,
  Video,
} from "lucide-react";
import { SoundEffectPreviewButton } from "@/components/production/SoundEffectPreviewButton";
import { readCompositionApiResponse } from "@/domains/production/composition-editor/composition-editor-api.client";
import type { CompositionStudioAsset, CompositionStudioLesson } from "./composition-studio.types";
import styles from "./CompositionStudio.module.css";

export type SoundEffectCatalogItem = {
  category: "AMBIENCE" | "EMPHASIS" | "IMPACT" | "OTHER" | "TRANSITION" | "UI";
  description: string;
  durationMilliseconds: number;
  id: string;
  name: string;
  tags: string[];
};

interface CompositionStudioLibraryProps {
  assets: CompositionStudioAsset[];
  delivery: ReactNode;
  introAssetId: string | null;
  lessons: CompositionStudioLesson[];
  narrative: ReactNode;
  narrativeCount: number;
  onAddAsset: (asset: CompositionStudioAsset) => void;
  onAddSoundEffect: (soundEffect: SoundEffectCatalogItem) => void;
  onClearIntro: () => void;
  onSelectAsset: (hfId: string) => void;
  onSelectLesson: (lessonId: string) => void;
  onSetIntro: (asset: CompositionStudioAsset) => void;
  selectedHfId: string | null;
  selectedLessonId: string | null;
  timelineAssetIds: Set<string>;
}

export function CompositionStudioLibrary({ assets, delivery, introAssetId, lessons, narrative, narrativeCount, onAddAsset, onAddSoundEffect, onClearIntro, onSelectAsset, onSelectLesson, onSetIntro, selectedHfId, selectedLessonId, timelineAssetIds }: CompositionStudioLibraryProps) {
  const [activeView, setActiveView] = useState<"assets" | "delivery" | "lessons" | "narrative" | "sfx">("lessons");
  const [soundEffects, setSoundEffects] = useState<SoundEffectCatalogItem[]>([]);
  const [soundEffectsLoading, setSoundEffectsLoading] = useState(false);
  const [soundEffectsError, setSoundEffectsError] = useState<string | null>(null);
  const [soundEffectQuery, setSoundEffectQuery] = useState("");
  const [soundEffectCategory, setSoundEffectCategory] = useState<"" | SoundEffectCatalogItem["category"]>("TRANSITION");
  useEffect(() => {
    if (!narrative && activeView === "narrative") setActiveView("lessons");
  }, [activeView, narrative]);
  const loadSoundEffects = useCallback(async () => {
    setSoundEffectsLoading(true);
    setSoundEffectsError(null);
    try {
      const query = new URLSearchParams({ limit: "25" });
      if (soundEffectQuery.trim()) query.set("query", soundEffectQuery.trim());
      if (soundEffectCategory) query.set("category", soundEffectCategory);
      const response = await fetch(`/api/production/sound-effects?${query.toString()}`, { cache: "no-store" });
      const result = await readCompositionApiResponse<{ data?: SoundEffectCatalogItem[]; error?: string }>(response, "No se pudo cargar la biblioteca de efectos.");
      if (!response.ok) throw new Error(result.error || "No se pudo cargar la biblioteca de efectos.");
      setSoundEffects(result.data || []);
    } catch (error) {
      setSoundEffectsError(error instanceof Error ? error.message : "No se pudo cargar la biblioteca de efectos.");
    } finally {
      setSoundEffectsLoading(false);
    }
  }, [soundEffectCategory, soundEffectQuery]);
  useEffect(() => {
    if (activeView !== "sfx") return;
    const timeout = window.setTimeout(() => void loadSoundEffects(), 180);
    return () => window.clearTimeout(timeout);
  }, [activeView, loadSoundEffects]);
  const selectView = useCallback((nextView: "assets" | "delivery" | "lessons" | "narrative" | "sfx") => {
    if (nextView === activeView) return;
    const updateView = () => flushSync(() => setActiveView(nextView));
    const transitionDocument = document as Document & {
      startViewTransition?: (updateCallback: () => void) => unknown;
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !transitionDocument.startViewTransition) {
      updateView();
      return;
    }
    try {
      transitionDocument.startViewTransition(updateView);
    } catch {
      updateView();
    }
  }, [activeView]);

  return <aside className={`${styles.library} ${activeView === "narrative" ? styles.libraryNarrative : ""}`}>
    <div className={`${styles.panelTabs} ${narrative ? styles.panelTabsWithNarrative : ""}`} role="tablist" aria-label="Biblioteca del ensamble">
      <button type="button" role="tab" aria-selected={activeView === "lessons"} onClick={() => selectView("lessons")} className={`${styles.panelTab} ${activeView === "lessons" ? styles.panelTabActive : ""}`}><Clapperboard size={14} aria-hidden="true" /> Videos <span className={styles.tabCount}>{lessons.length}</span></button>
      <button type="button" role="tab" aria-selected={activeView === "assets"} onClick={() => selectView("assets")} className={`${styles.panelTab} ${activeView === "assets" ? styles.panelTabActive : ""}`}><ImageIcon size={14} aria-hidden="true" /> Medios <span className={styles.tabCount}>{assets.length}</span></button>
      <button type="button" role="tab" aria-selected={activeView === "sfx"} onClick={() => selectView("sfx")} className={`${styles.panelTab} ${activeView === "sfx" ? styles.panelTabActive : ""}`}><Music2 size={14} aria-hidden="true" /> SFX</button>
      {narrative && <button type="button" role="tab" aria-selected={activeView === "narrative"} onClick={() => selectView("narrative")} className={`${styles.panelTab} ${activeView === "narrative" ? styles.panelTabActive : ""}`}><ScrollText size={14} aria-hidden="true" /> Guion <span className={styles.tabCount}>{narrativeCount}</span></button>}
      <button type="button" role="tab" aria-selected={activeView === "delivery"} onClick={() => selectView("delivery")} className={`${styles.panelTab} ${activeView === "delivery" ? styles.panelTabActive : ""}`}><Send size={14} aria-hidden="true" /> Entrega</button>
    </div>

    <div className={`${styles.libraryBody} ${activeView === "delivery" ? styles.libraryBodyDelivery : ""}`}>
      {activeView === "lessons" ? <div className={styles.lessonList} role="tabpanel">{lessons.map((lesson, index) => <button key={lesson.id} type="button" onClick={() => onSelectLesson(lesson.id)} className={`${styles.lessonItem} ${selectedLessonId === lesson.id ? styles.lessonItemActive : ""}`}><span className={`${styles.lessonIndex} ${lesson.completed ? styles.lessonIndexComplete : ""}`}>{lesson.completed ? <CheckCircle2 size={12} aria-label="Completado" /> : index + 1}</span><span className="min-w-0"><span className={styles.itemTitle}>{lesson.title}</span><span className={styles.itemMeta}>{lesson.subtitle}</span></span><ChevronRight className={styles.lessonChevron} size={13} aria-hidden="true" /></button>)}</div>
        : activeView === "assets" ? <div className={styles.assetList} role="tabpanel">{assets.map((asset) => {
          const hfId = `asset-${asset.id}`;
          const inTimeline = timelineAssetIds.has(asset.id);
          return <div key={asset.id} className={`${styles.assetItem} ${selectedHfId === hfId ? styles.assetItemActive : ""} ${asset.valid ? "" : "border-red-400/40 bg-red-500/10"}`}><button type="button" disabled={!asset.isEditable || !inTimeline} onClick={() => onSelectAsset(hfId)} className={styles.assetMain}><AssetThumbnail asset={asset} /><span className="min-w-0 flex-1"><span className={styles.itemTitle}>{asset.label}</span><span className={styles.assetMetaRow}><span className={styles.itemMeta}>{asset.sourceLabel}</span><span className={styles.itemMeta}>{asset.sizeLabel}</span></span></span></button><button type="button" disabled={!asset.isEditable || !asset.valid || inTimeline} onClick={() => onAddAsset(asset)} title={inTimeline ? "Este asset ya está en la línea de tiempo" : "Añadir a la línea de tiempo"} className={`${styles.assetAdd} ${inTimeline ? styles.assetAddComplete : ""}`}>{inTimeline ? <CheckCircle2 size={12} /> : <Plus size={12} />}<span>{inTimeline ? "En timeline" : "Añadir a timeline"}</span></button>{asset.mimeType.startsWith("video/") && <button type="button" disabled={!asset.isEditable || !asset.valid || !asset.durationSeconds} onClick={() => introAssetId === asset.id ? onClearIntro() : onSetIntro(asset)} title="Usar este asset de Producción como intro" className={styles.assetAdd}><Film size={12} /><span>{introAssetId === asset.id ? "Quitar intro" : "Usar como intro"}</span></button>}</div>;
        })}</div>
        : activeView === "sfx" ? <div className={styles.assetList} role="tabpanel"><label className={styles.sfxSearch}><span className="sr-only">Buscar efectos de sonido</span><input value={soundEffectQuery} onChange={(event) => setSoundEffectQuery(event.target.value)} placeholder="Buscar whoosh, click…" /></label><select className={styles.sfxCategory} value={soundEffectCategory} onChange={(event) => setSoundEffectCategory(event.target.value as "" | SoundEffectCatalogItem["category"])} aria-label="Categoría de efectos"><option value="">Todas las categorías</option><option value="TRANSITION">Transición</option><option value="EMPHASIS">Énfasis</option><option value="UI">UI</option><option value="IMPACT">Impacto</option><option value="AMBIENCE">Ambiente</option><option value="OTHER">Otros</option></select>{soundEffectsLoading ? <p className={styles.libraryEmpty}>Cargando efectos…</p> : soundEffectsError ? <p className={styles.libraryEmpty}>{soundEffectsError}</p> : soundEffects.length === 0 ? <p className={styles.libraryEmpty}>No hay efectos disponibles todavía.</p> : soundEffects.map((soundEffect) => <div key={soundEffect.id} className={styles.assetItem}><span className={styles.assetMain}><span className="relative flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-violet-100 text-violet-700 dark:border-white/10 dark:bg-violet-500/10 dark:text-violet-200"><Music2 size={18} /></span><span className="min-w-0 flex-1"><span className={styles.itemTitle}>{soundEffect.name}</span><span className={styles.assetMetaRow}><span className={styles.itemMeta}>{soundEffect.category.toLowerCase()}</span><span className={styles.itemMeta}>{(soundEffect.durationMilliseconds / 1000).toFixed(2)} s</span></span></span></span><span className="flex flex-none items-center gap-1"><SoundEffectPreviewButton soundEffectId={soundEffect.id} /><button type="button" onClick={() => onAddSoundEffect(soundEffect)} title={`Añadir ${soundEffect.name} al cursor`} className={styles.assetAdd}><Plus size={12} /><span>Añadir al cursor</span></button></span></div>)}</div>
        : activeView === "narrative" ? <div className={styles.narrativeMenu} role="tabpanel">{narrative}</div>
          : <div className={styles.deliveryMenu} role="tabpanel">{delivery}</div>}
    </div>
  </aside>;
}

function AssetThumbnail({ asset }: { asset: CompositionStudioAsset }) {
  const [failed, setFailed] = useState(false);
  const commonClass = "relative flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-white/5";
  if (asset.mimeType.startsWith("audio/")) return <span className={commonClass + " text-violet-600 dark:text-violet-300"}><Music2 size={18} /></span>;
  if (asset.mimeType.startsWith("image/") && asset.previewUrl && !failed) return <span className={commonClass}><img src={asset.previewUrl} alt="" onError={() => setFailed(true)} className="h-full w-full bg-slate-950 object-contain" /></span>;
  if (asset.mimeType.startsWith("video/") && asset.previewUrl && !failed) return <span className={commonClass}><video muted preload="metadata" onError={() => setFailed(true)} className="h-full w-full bg-slate-950 object-contain"><source src={asset.previewUrl} type={asset.mimeType} /></video><Play className="pointer-events-none absolute text-white drop-shadow" size={15} /></span>;
  const Icon = asset.mimeType.startsWith("image/") ? ImageIcon : asset.mimeType.startsWith("video/") ? Video : FileQuestion;
  return <span className={commonClass + " text-slate-400 dark:text-gray-500"}><Icon size={18} /></span>;
}
