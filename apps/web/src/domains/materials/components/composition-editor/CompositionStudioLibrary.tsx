"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  Download,
  FileQuestion,
  Film,
  Image as ImageIcon,
  Music2,
  Play,
  Plus,
  ScrollText,
  Send,
  Sparkles,
  Subtitles,
  Type,
  Video,
} from "lucide-react";
import { SoundEffectPreviewButton } from "@/components/production/SoundEffectPreviewButton";
import { readCompositionApiResponse } from "@/domains/production/composition-editor/composition-editor-api.client";
import type { CompositionAssetInsertionMode } from "@/domains/production/composition-editor/composition-timeline-edit.service";
import type { CompositionClip } from "@/domains/production/composition-editor/composition-document.types";
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
  libraryOpen: boolean;
  lessons: CompositionStudioLesson[];
  narrative: ReactNode;
  narrativeCount: number;
  captionTranscriptWordCount: number;
  insertionMode: CompositionAssetInsertionMode;
  onAddAsset: (asset: CompositionStudioAsset) => void;
  onReplaceAsset: (asset: CompositionStudioAsset) => void;
  onAddSoundEffect: (soundEffect: SoundEffectCatalogItem) => void;
  onAddCaptionLayer: () => void;
  onGenerateTranscriptCaptions: () => void;
  onInsertionModeChange: (mode: CompositionAssetInsertionMode) => void;
  onAddTextLayer: () => void;
  onClearIntro: () => void;
  onSelectAsset: (hfId: string) => void;
  onSelectLesson: (lessonId: string) => void;
  onSetIntro: (asset: CompositionStudioAsset) => void;
  selectedHfId: string | null;
  replacementTarget: CompositionClip | null;
  replacementTargetUnavailable?: boolean;
  selectedLessonId: string | null;
  timelineAssetHfIds: ReadonlyMap<string, string>;
}

export function CompositionStudioLibrary({ assets, captionTranscriptWordCount, delivery, insertionMode, introAssetId, libraryOpen, lessons, narrative, narrativeCount, onAddAsset, onReplaceAsset, onAddCaptionLayer, onAddSoundEffect, onAddTextLayer, onClearIntro, onGenerateTranscriptCaptions, onInsertionModeChange, onSelectAsset, onSelectLesson, onSetIntro, replacementTarget, replacementTargetUnavailable = false, selectedHfId, selectedLessonId, timelineAssetHfIds }: CompositionStudioLibraryProps) {
  const [activeView, setActiveView] = useState<"assets" | "delivery" | "lessons" | "narrative" | "sfx" | "text">("lessons");
  const [soundEffects, setSoundEffects] = useState<SoundEffectCatalogItem[]>([]);
  const [soundEffectsLoading, setSoundEffectsLoading] = useState(false);
  const [soundEffectsError, setSoundEffectsError] = useState<string | null>(null);
  const [soundEffectQuery, setSoundEffectQuery] = useState("");
  const [assetQuery, setAssetQuery] = useState("");
  const [assetKind, setAssetKind] = useState<"ALL" | "AUDIO" | "IMAGE" | "VIDEO">("ALL");
  const filteredAssets = assets.filter((asset) => {
    const matchesKind = assetKind === "ALL" || asset.mimeType.startsWith(`${assetKind.toLowerCase()}/`);
    const query = assetQuery.trim().toLocaleLowerCase();
    return matchesKind && (!query || `${asset.label} ${asset.sourceLabel} ${asset.sizeLabel}`.toLocaleLowerCase().includes(query));
  });
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
  const selectView = useCallback((nextView: "assets" | "delivery" | "lessons" | "narrative" | "sfx" | "text") => {
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

  return <aside className={`${styles.library} ${!libraryOpen ? styles.libraryHidden : ""} ${activeView === "narrative" ? styles.libraryNarrative : ""}`}>
    <div className={`${styles.panelTabs} ${narrative ? styles.panelTabsWithNarrative : ""}`} role="tablist" aria-label="Biblioteca del ensamble">
      <button type="button" role="tab" aria-selected={activeView === "lessons"} onClick={() => selectView("lessons")} className={`${styles.panelTab} ${activeView === "lessons" ? styles.panelTabActive : ""}`}><Clapperboard size={14} aria-hidden="true" /> Videos <span className={styles.tabCount}>{lessons.length}</span></button>
      <button type="button" role="tab" aria-selected={activeView === "assets"} onClick={() => selectView("assets")} className={`${styles.panelTab} ${activeView === "assets" ? styles.panelTabActive : ""}`}><ImageIcon size={14} aria-hidden="true" /> Medios <span className={styles.tabCount}>{assets.length}</span></button>
      <button type="button" role="tab" aria-selected={activeView === "text"} onClick={() => selectView("text")} className={`${styles.panelTab} ${activeView === "text" ? styles.panelTabActive : ""}`}><Type size={14} aria-hidden="true" /> Texto</button>
      <button type="button" role="tab" aria-selected={activeView === "sfx"} onClick={() => selectView("sfx")} className={`${styles.panelTab} ${activeView === "sfx" ? styles.panelTabActive : ""}`}><Music2 size={14} aria-hidden="true" /> SFX</button>
      {narrative && <button type="button" role="tab" aria-selected={activeView === "narrative"} onClick={() => selectView("narrative")} className={`${styles.panelTab} ${activeView === "narrative" ? styles.panelTabActive : ""}`}><ScrollText size={14} aria-hidden="true" /> Guion <span className={styles.tabCount}>{narrativeCount}</span></button>}
      <button type="button" role="tab" aria-selected={activeView === "delivery"} onClick={() => selectView("delivery")} className={`${styles.panelTab} ${activeView === "delivery" ? styles.panelTabActive : ""}`}><Send size={14} aria-hidden="true" /> Entrega</button>
    </div>

    <div className={`${styles.libraryBody} ${activeView === "delivery" ? styles.libraryBodyDelivery : ""}`}>
      {activeView === "assets" && <label className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 text-[10px] font-bold text-slate-600 dark:border-white/10 dark:text-gray-300"><span>Modo de inserción</span><select value={insertionMode} onChange={(event) => onInsertionModeChange(event.target.value as CompositionAssetInsertionMode)} className={styles.sfxCategory} aria-label="Modo para añadir medios"><option value="APPEND">Añadir</option><option value="INSERT">Insertar y desplazar</option><option value="OVERWRITE">Sobrescribir intervalo</option></select></label>}
      {activeView === "assets" && <div className="flex gap-2 border-b border-slate-200 p-2 dark:border-white/10"><label className={styles.sfxSearch}><span className="sr-only">Buscar medios</span><input value={assetQuery} onChange={(event) => setAssetQuery(event.target.value)} placeholder="Buscar medios…" /></label><select className={styles.sfxCategory} value={assetKind} onChange={(event) => setAssetKind(event.target.value as typeof assetKind)} aria-label="Tipo de medio"><option value="ALL">Todos</option><option value="VIDEO">Video</option><option value="IMAGE">Imagen</option><option value="AUDIO">Audio</option></select></div>}
      {activeView === "assets" && replacementTarget && replacementTargetUnavailable && <p role="status" className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">La fuente de este clip no está disponible. Selecciona un medio compatible y usa «Revincular»; se conservarán sus ediciones.</p>}
      {activeView === "lessons" ? <div className={styles.lessonList} role="tabpanel">{lessons.map((lesson, index) => <button key={lesson.id} type="button" onClick={() => onSelectLesson(lesson.id)} className={`${styles.lessonItem} ${selectedLessonId === lesson.id ? styles.lessonItemActive : ""}`}><span className={`${styles.lessonIndex} ${lesson.completed ? styles.lessonIndexComplete : ""}`}>{lesson.completed ? <CheckCircle2 size={12} aria-label="Completado" /> : index + 1}</span><span className="min-w-0"><span className={styles.itemTitle}>{lesson.title}</span><span className={styles.itemMeta}>{lesson.subtitle}</span></span><ChevronRight className={styles.lessonChevron} size={13} aria-hidden="true" /></button>)}</div>
        : activeView === "assets" ? <div className={styles.assetList} role="tabpanel">{filteredAssets.length === 0 && <p className={styles.libraryEmpty}>No hay medios que coincidan con la búsqueda.</p>}{filteredAssets.map((asset) => {
          const hfId = timelineAssetHfIds.get(asset.id) || asset.deckClip?.hfId || `asset-${asset.id}`;
          const inTimeline = timelineAssetHfIds.has(asset.id);
          const canReplace = Boolean(replacementTarget && replacementTarget.source.type === "PRODUCTION_ASSET" && !replacementTarget.source.placement && replacementTarget.source.productionAssetId !== asset.id && !asset.deckClip && asset.isEditable && asset.valid && asset.mimeType.startsWith(`${replacementTarget.kind.toLowerCase()}/`) && (replacementTarget.kind !== "VIDEO" || (replacementTarget.volume === undefined && replacementTarget.fadeInSeconds === undefined && replacementTarget.fadeOutSeconds === undefined) || asset.hasAudio === true) && (replacementTarget.kind === "IMAGE" || Boolean(asset.durationSeconds && (replacementTarget.sourceOffsetSeconds || 0) + replacementTarget.durationSeconds <= asset.durationSeconds + 0.001)));
          return <div key={asset.id} data-asset-id={asset.id} className={`${styles.assetItem} ${selectedHfId === hfId ? styles.assetItemActive : ""} ${asset.valid ? "" : "border-red-400/40 bg-red-500/10"}`}><button type="button" disabled={!asset.isEditable || !inTimeline} onClick={() => onSelectAsset(hfId)} className={styles.assetMain}><AssetThumbnail asset={asset} /><span className="min-w-0 flex-1"><span className={styles.itemTitle}>{asset.label}</span><span className={styles.assetMetaRow}><span className={styles.itemMeta}>{asset.sourceLabel}</span><span className={styles.itemMeta}>{asset.sizeLabel}</span></span>{asset.audioAnalysis && <span className={`block text-[10px] font-semibold ${asset.audioAnalysis.passed ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{asset.audioAnalysis.integratedLufs === null ? "Silencio" : `${asset.audioAnalysis.integratedLufs.toFixed(1)} LUFS`} · {asset.audioAnalysis.truePeakDbtp === null ? "pico no medible" : `${asset.audioAnalysis.truePeakDbtp.toFixed(1)} dBTP`} · {asset.audioAnalysis.passed ? "nivel conforme" : "revisar nivel"}</span>}</span></button><button type="button" disabled={!asset.isEditable || !asset.valid} onClick={() => onAddAsset(asset)} title={inTimeline ? "Añadir otra instancia a la línea de tiempo" : "Añadir a la línea de tiempo"} className={styles.assetAdd}><Plus size={12} /><span>{inTimeline ? "Añadir otra" : "Añadir a timeline"}</span></button>{replacementTarget && <button type="button" disabled={!canReplace} onClick={() => onReplaceAsset(asset)} title={canReplace ? `${replacementTargetUnavailable ? "Revincular" : "Reemplazar"} ${replacementTarget.label} sin cambiar timing ni layout` : "Selecciona un medio compatible con duración suficiente"} className={styles.assetAdd}><Film size={12} /><span>{replacementTargetUnavailable ? "Revincular" : "Reemplazar"}</span></button>}{asset.mimeType.startsWith("video/") && <button type="button" disabled={!asset.isEditable || !asset.valid || !asset.durationSeconds} onClick={() => introAssetId === asset.id ? onClearIntro() : onSetIntro(asset)} title="Usar este asset de Producción como intro" className={styles.assetAdd}><Film size={12} /><span>{introAssetId === asset.id ? "Quitar intro" : "Usar como intro"}</span></button>}</div>;
        })}</div>
        : activeView === "text" ? <div className="space-y-3 p-3" role="tabpanel"><p className="text-xs leading-5 text-slate-500 dark:text-gray-400">Crea capas editables en el cursor. Texto y fondo mantienen opacidades independientes.</p><button type="button" onClick={onAddTextLayer} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-cyan-400 hover:bg-cyan-50 dark:border-white/10 dark:hover:bg-cyan-400/10"><Type size={19} className="text-cyan-600" /><span><span className={styles.itemTitle}>Capa de texto</span><span className={styles.itemMeta}>Título, etiqueta o llamada visual</span></span></button><button type="button" onClick={onAddCaptionLayer} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-violet-400 hover:bg-violet-50 dark:border-white/10 dark:hover:bg-violet-400/10"><Subtitles size={19} className="text-violet-600" /><span><span className={styles.itemTitle}>Captions transparentes</span><span className={styles.itemMeta}>Sin caja opaca; contraste por stroke y sombra</span></span></button><button type="button" disabled={captionTranscriptWordCount === 0} onClick={onGenerateTranscriptCaptions} className="flex w-full items-center gap-3 rounded-lg border border-slate-200 p-3 text-left hover:border-emerald-400 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-emerald-400/10"><Sparkles size={19} className="text-emerald-600" /><span><span className={styles.itemTitle}>Generar desde la voz</span><span className={styles.itemMeta}>{captionTranscriptWordCount > 0 ? `${captionTranscriptWordCount} palabras sincronizadas disponibles` : "Genera primero una voz con timestamps"}</span></span></button></div>
        : activeView === "sfx" ? <div className={styles.assetList} role="tabpanel"><label className={styles.sfxSearch}><span className="sr-only">Buscar efectos de sonido</span><input value={soundEffectQuery} onChange={(event) => setSoundEffectQuery(event.target.value)} placeholder="Buscar whoosh, click…" /></label><select className={styles.sfxCategory} value={soundEffectCategory} onChange={(event) => setSoundEffectCategory(event.target.value as "" | SoundEffectCatalogItem["category"])} aria-label="Categoría de efectos"><option value="">Todas las categorías</option><option value="TRANSITION">Transición</option><option value="EMPHASIS">Énfasis</option><option value="UI">UI</option><option value="IMPACT">Impacto</option><option value="AMBIENCE">Ambiente</option><option value="OTHER">Otros</option></select>{soundEffectsLoading ? <p className={styles.libraryEmpty}>Cargando efectos…</p> : soundEffectsError ? <p className={styles.libraryEmpty}>{soundEffectsError}</p> : soundEffects.length === 0 ? <p className={styles.libraryEmpty}>No hay efectos disponibles todavía.</p> : soundEffects.map((soundEffect) => <div key={soundEffect.id} className={styles.assetItem}><span className={styles.assetMain}><span className="relative flex h-9 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-violet-100 text-violet-700 dark:border-white/10 dark:bg-violet-500/10 dark:text-violet-200"><Music2 size={18} /></span><span className="min-w-0 flex-1"><span className={styles.itemTitle}>{soundEffect.name}</span><span className={styles.assetMetaRow}><span className={styles.itemMeta}>{soundEffect.category.toLowerCase()}</span><span className={styles.itemMeta}>{(soundEffect.durationMilliseconds / 1000).toFixed(2)} s</span></span></span></span><span className="flex flex-none items-center gap-1"><SoundEffectPreviewButton soundEffectId={soundEffect.id} /><a href={`/api/production/sound-effects/${soundEffect.id}/download`} title={`Descargar ${soundEffect.name}`} className={styles.assetAdd}><Download size={12} /><span>Descargar</span></a><button type="button" onClick={() => onAddSoundEffect(soundEffect)} title={`Añadir ${soundEffect.name} al cursor`} className={styles.assetAdd}><Plus size={12} /><span>Añadir al cursor</span></button></span></div>)}</div>
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
