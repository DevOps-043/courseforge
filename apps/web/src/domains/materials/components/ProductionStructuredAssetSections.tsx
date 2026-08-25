import { useEffect, useMemo, useRef, useState } from "react";
import {
  Volume2,
  Music,
  Mic,
  FileVideo,
  Video,
  Upload,
  Wand2,
  Sparkles,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Search,
  X,
  Play,
  Pause,
  Download,
  HardDrive,
  AlertTriangle,
  Eye,
  ListChecks,
  LayoutTemplate,
  PanelsTopLeft,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import type {
  VoiceAudio,
  VoiceClip,
  AvatarClip,
  AvatarGenerationMode,
  BackgroundMusic,
  BRollClip,
  AvatarVideo,
  SlidesAsset,
} from "../validators/assets.validators";
import { CloudStorageConnectButton } from "@/app/admin/artifacts/new/components/CloudStorageConnectButton";
import { getCloudStorageConnectionsAction } from "@/domains/production/actions/cloud-storage.actions";
import { repairCommonUtf8Mojibake } from "@/domains/production/text/mojibake.service";
import type {
  CloudStorageConnection,
  CloudStorageFile,
  CloudStorageProvider,
} from "@/domains/production/cloud-storage/types";
import type { SlideTemplateLibraryItem } from "@/domains/production/slides/slide-template-library.actions";
import { EngineSelect } from "@/components/ui/EngineSelect";

function formatSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

type AnimatedDeckAsset = NonNullable<SlidesAsset["animated_deck"]>;
type AnimatedDeckSlideAsset = AnimatedDeckAsset["slides"][number];

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildAnimatedDeckSlideSrcDoc(deck: AnimatedDeckAsset, slide: AnimatedDeckSlideAsset) {
  const width = deck.width || 1920;
  const height = deck.height || 1080;
  const classList = (slide.classes || "slide")
    .split(/\s+/)
    .filter(Boolean);
  if (!classList.includes("active")) {
    classList.push("active");
  }
  const classes = escapeHtmlAttribute(classList.join(" "));
  const html = repairCommonUtf8Mojibake(slide.html || "");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=${width}, initial-scale=1" />
  <style>
    html, body {
      margin: 0;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      background: #ffffff;
    }
    .deck-scope {
      position: relative;
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
    }
    ${deck.css || ""}
  </style>
</head>
<body>
  <div class="deck-scope" style="--deck-t: 0;">
    <section class="${classes}">${html}</section>
  </div>
</body>
</html>`;
}

function AnimatedDeckSlideFrame({
  deck,
  slide,
}: {
  deck: AnimatedDeckAsset;
  slide: AnimatedDeckSlideAsset;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.2);
  const width = deck.width || 1920;
  const height = deck.height || 1080;
  const srcDoc = useMemo(
    () => buildAnimatedDeckSlideSrcDoc(deck, slide),
    [deck, slide],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateScale = () => {
      const nextScale = container.clientWidth / width;
      setScale(Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 0.2);
    };
    updateScale();

    const resizeObserver = new ResizeObserver(updateScale);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [width]);

  return (
    <div
      ref={containerRef}
      className="relative aspect-video overflow-hidden rounded-lg border border-gray-200 bg-[#05070b] dark:border-[var(--engine-muted)]/20"
    >
      <iframe
        title={`Preview ${slide.label || slide.index}`}
        srcDoc={srcDoc}
        sandbox=""
        scrolling="no"
        className="absolute left-0 top-0 border-0"
        style={{
          width,
          height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}

function AnimatedDeckPreview({
  deck,
  sourceUrl,
}: {
  deck: AnimatedDeckAsset;
  sourceUrl?: string;
}) {
  const deckSlides = useMemo(
    () => [...(deck.slides || [])].sort((left, right) => left.index - right.index),
    [deck.slides],
  );
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedSlide = deckSlides[Math.min(selectedIndex, Math.max(0, deckSlides.length - 1))];

  useEffect(() => {
    if (selectedIndex > deckSlides.length - 1) {
      setSelectedIndex(Math.max(0, deckSlides.length - 1));
    }
  }, [deckSlides.length, selectedIndex]);

  if (!selectedSlide) {
    return null;
  }

  return (
    <div className="mt-3 rounded-xl border border-purple-100 bg-white p-3 shadow-sm dark:border-purple-500/10 dark:bg-[var(--engine-canvas)]/60">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Eye size={14} className="text-purple-500" />
          <span className="text-xs font-bold text-gray-800 dark:text-gray-100">Vista de slides resultantes</span>
          <span className="rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700 dark:bg-purple-500/10 dark:text-purple-300">
            {deckSlides.length} slide(s)
          </span>
        </div>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[10px] font-bold text-gray-600 transition-colors hover:bg-gray-50 dark:border-[var(--engine-muted)]/20 dark:text-gray-300 dark:hover:bg-white/5"
          >
            <ExternalLink size={10} />
            HTML original
          </a>
        ) : null}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
        <div className="min-w-0 space-y-2">
          <AnimatedDeckSlideFrame deck={deck} slide={selectedSlide} />
          <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500 dark:text-gray-400">
            <span className="truncate font-semibold">
              Slide {selectedSlide.index}: {selectedSlide.label || "Sin titulo"}
            </span>
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 font-bold dark:bg-white/5">
              {selectedSlide.animationCount} animacion(es)
            </span>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-gray-100 bg-gray-50 p-2 dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-surface-solid)]/80">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <ListChecks size={12} />
            Pasos
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {deckSlides.map((slide, index) => (
              <button
                key={`${slide.index}-${slide.label}`}
                type="button"
                onClick={() => setSelectedIndex(index)}
                className={`flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-[10px] transition-colors ${
                  selectedSlide.index === slide.index
                    ? "border-purple-300 bg-purple-50 text-purple-800 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-200"
                    : "border-transparent text-gray-600 hover:bg-white dark:text-gray-300 dark:hover:bg-white/5"
                }`}
              >
                <span className="min-w-0 truncate font-bold">
                  {String(index + 1).padStart(2, "0")} - {slide.label || `Slide ${slide.index}`}
                </span>
                <span className="shrink-0 rounded bg-white/70 px-1 py-0.5 font-semibold dark:bg-black/20">
                  {slide.animationCount}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function buildHtmlPreviewHref(slides: SlidesAsset | null) {
  if (!slides?.html_content_path) {
    return slides?.html_public_url;
  }

  return `/api/production/slides/html-preview?path=${encodeURIComponent(slides.html_content_path)}`;
}

// ---------------------------------------------------------
// 1. VOICE AUDIO SECTION
// ---------------------------------------------------------
interface VoiceAudioSectionProps {
  voiceAudio: VoiceAudio | null;
  voiceClips: VoiceClip[];
  isUploading: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  
  // Drive props
  isSearchingDrive: boolean;
  isImportingDrive: boolean;
  driveSearchResults: any[];
  searchDrive: (query: string) => Promise<void>;
  importDriveAsset: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides", accessToken?: string, provider?: CloudStorageProvider) => Promise<boolean>;
  clearDriveSearchResults: () => void;
}

export function VoiceAudioSection({
  voiceAudio,
  voiceClips,
  isUploading,
  fileRef,
  onUpload,
  onClear,
  isSearchingDrive,
  isImportingDrive,
  driveSearchResults,
  searchDrive,
  importDriveAsset,
  clearDriveSearchResults,
}: VoiceAudioSectionProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="p-3 rounded-xl border border-gray-200 dark:border-[var(--engine-muted)]/10 bg-gray-50/50 dark:bg-[var(--engine-canvas)]/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mic size={14} className="text-[var(--engine-info)]" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Audio de Voz (Locución)</span>
          {(voiceAudio || voiceClips.length > 0) && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 size={10} /> {voiceClips.length > 0 ? `${voiceClips.length} clips` : "Subido"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {voiceAudio ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-550 dark:text-gray-400 truncate max-w-[150px] font-medium" title={voiceAudio.storage_path.split("/").pop()}>
                {voiceAudio.storage_path.split("/").pop()}
                {voiceAudio.duration && ` (${voiceAudio.duration}s)`}
              </span>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={isUploading}
                className="px-2 py-1 rounded bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-[var(--engine-muted)]/20 text-[10px] font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                {isUploading ? <Loader2 size={10} className="animate-spin" /> : "Re-subir"}
              </button>
              <button
                onClick={() => setIsModalOpen(true)}
                className="px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 text-[10px] font-bold hover:bg-blue-100 transition-colors"
              >
                Drive
              </button>
              <button
                onClick={onClear}
                className="p-1 text-red-500 hover:text-red-705 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors cursor-pointer"
                title="Eliminar audio de voz"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={isUploading}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white dark:bg-[var(--engine-surface-solid)] dark:border-[var(--engine-muted)]/20 text-[10px] font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-all cursor-pointer"
              >
                {isUploading ? (
                  <Loader2 className="animate-spin text-[var(--engine-info)]" size={10} />
                ) : (
                  <Upload size={10} />
                )}
                <span>Subir MP3</span>
              </button>
              <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50/50 hover:bg-blue-100/70 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 text-[10px] font-bold transition-all cursor-pointer"
              >
                <HardDrive size={10} />
                <span>Drive</span>
              </button>
            </div>
          )}
        </div>
      </div>
      {voiceClips.length > 0 ? (
        <div className="mt-3 space-y-2 border-t border-gray-200 pt-3 dark:border-white/10">
          {[...voiceClips].sort((left, right) => left.order - right.order).map((clip) => (
            <div key={clip.id} className="flex flex-col gap-1 rounded-lg bg-white p-2 dark:bg-white/5">
              <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-gray-500 dark:text-gray-300">
                <span>Escena {clip.order}</span>
                <span>{clip.status}{clip.duration ? ` · ${clip.duration.toFixed(1)}s` : ""}</span>
              </div>
              {clip.status === "COMPLETED" ? (
                <audio src={clip.public_url} controls preload="metadata" className="h-8 w-full" />
              ) : (
                <span className="text-[10px] text-amber-600 dark:text-amber-300">
                  Esta voz debe regenerarse junto con su clip de avatar.
                </span>
              )}
            </div>
          ))}
        </div>
      ) : null}

      <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">
        Formatos admitidos: MP3 o WAV · máximo 50 MiB por archivo.
      </p>

      <input
        type="file"
        ref={fileRef}
        onChange={onUpload}
        className="hidden"
        accept=".mp3,.wav,audio/mpeg,audio/mp3,audio/wav"
      />

      <GoogleDriveImportModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        type="voice"
        isSearching={isSearchingDrive}
        isImporting={isImportingDrive}
        results={driveSearchResults}
        onSearch={searchDrive}
        onImport={importDriveAsset}
        onClearResults={clearDriveSearchResults}
      />
    </div>
  );
}

// ---------------------------------------------------------
// 2. BACKGROUND MUSIC SECTION
// ---------------------------------------------------------
interface BackgroundMusicSectionProps {
  backgroundMusic: BackgroundMusic | null;
  isUploading: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  
  // Artlist props
  isSearchingArtlist: boolean;
  isImportingArtlist: boolean;
  artlistSearchResults: any[];
  searchArtlist: (query: string, type: "music" | "video") => Promise<void>;
  importArtlistAsset: (id: string, type: "music" | "video") => Promise<boolean>;
  clearArtlistSearchResults: () => void;

  // Drive props
  isSearchingDrive: boolean;
  isImportingDrive: boolean;
  driveSearchResults: any[];
  searchDrive: (query: string) => Promise<void>;
  importDriveAsset: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides", accessToken?: string, provider?: CloudStorageProvider) => Promise<boolean>;
  clearDriveSearchResults: () => void;
}

export function BackgroundMusicSection({
  backgroundMusic,
  isUploading,
  fileRef,
  onUpload,
  onClear,
  isSearchingDrive,
  isImportingDrive,
  driveSearchResults,
  searchDrive,
  importDriveAsset,
  clearDriveSearchResults,
}: BackgroundMusicSectionProps) {
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);

  return (
    <div className="p-3 rounded-xl border border-gray-200 dark:border-[var(--engine-muted)]/10 bg-gray-50/50 dark:bg-[var(--engine-canvas)]/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Music size={14} className="text-indigo-500" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Música de Fondo (Background)</span>
          {backgroundMusic && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 size={10} /> Subido
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {backgroundMusic ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-gray-550 dark:text-gray-400 truncate max-w-[150px] font-medium" title={backgroundMusic.storage_path.split("/").pop()}>
                {backgroundMusic.storage_path.split("/").pop()}
              </span>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={isUploading}
                className="px-2 py-1 rounded bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-[var(--engine-muted)]/20 text-[10px] font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                {isUploading ? <Loader2 size={10} className="animate-spin" /> : "Local"}
              </button>
              {/* <button
                onClick={() => setIsModalOpen(true)}
                className="px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 text-[10px] font-bold hover:bg-indigo-100 transition-colors"
              >
                Artlist
              </button> */}
              <button
                onClick={() => setIsDriveModalOpen(true)}
                className="px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 text-[10px] font-bold hover:bg-blue-100 transition-colors"
              >
                Drive
              </button>
              <button
                onClick={onClear}
                className="p-1 text-red-500 hover:text-red-705 hover:bg-red-50 dark:hover:bg-red-500/10 rounded transition-colors cursor-pointer"
                title="Eliminar música"
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={isUploading}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-305 bg-white dark:bg-[var(--engine-surface-solid)] dark:border-[var(--engine-muted)]/20 text-[10px] font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-all cursor-pointer"
              >
                {isUploading ? (
                  <Loader2 className="animate-spin text-indigo-500" size={10} />
                ) : (
                  <Upload size={10} />
                )}
                <span>Subir MP3</span>
              </button>
              {/* <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100/70 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 text-[10px] font-bold transition-all cursor-pointer"
              >
                <Music size={10} />
                <span>Artlist</span>
              </button> */}
              <button
                onClick={() => setIsDriveModalOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50/50 hover:bg-blue-100/70 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 text-[10px] font-bold transition-all cursor-pointer"
              >
                <HardDrive size={10} />
                <span>Drive</span>
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">
        Formatos admitidos: MP3 o WAV · máximo 50 MiB por archivo.
      </p>

      {backgroundMusic && (
        <div className="mt-2 flex items-center gap-1.5 border-t border-gray-100 pt-2 text-[10px] text-gray-500 dark:border-[var(--engine-muted)]/10 dark:text-gray-400">
          <Volume2 size={11} className="shrink-0 text-indigo-500" />
          <span>El volumen y la reducción durante voz se ajustan en el Estudio de edición.</span>
        </div>
      )}

      <input
        type="file"
        ref={fileRef}
        onChange={onUpload}
        className="hidden"
        accept=".mp3,.wav,audio/mpeg,audio/mp3,audio/wav"
      />

      {/* <ArtlistSearchModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        type="music"
        suggestions={musicSuggestions}
        isSearching={isSearchingArtlist}
        isImporting={isImportingArtlist}
        results={artlistSearchResults}
        onSearch={searchArtlist}
        onImport={importArtlistAsset}
        onClearResults={clearArtlistSearchResults}
      /> */}

      <GoogleDriveImportModal
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        type="music"
        isSearching={isSearchingDrive}
        isImporting={isImportingDrive}
        results={driveSearchResults}
        onSearch={searchDrive}
        onImport={importDriveAsset}
        onClearResults={clearDriveSearchResults}
      />
    </div>
  );
}

// ---------------------------------------------------------
// 3. SOFLIA HTML SLIDES SECTION
// ---------------------------------------------------------
interface SofliaHtmlSlidesSectionProps {
  slides: SlidesAsset | null;
  isGeneratingSofliaSlides: boolean;
  isUploading: boolean;
  isPreparingAnimatedDeck: boolean;
  isLoadingSlideTemplates?: boolean;
  selectedSlideTemplateRunId?: string | null;
  showSofliaGeneration?: boolean;
  slideTemplates?: SlideTemplateLibraryItem[];
  slideTemplatesHref?: string;
  slideTemplateStudioHref?: string;
  sofliaSlidesHref?: string;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onGenerateSofliaSlides: (slideTemplateRunId?: string | null) => void;
  onSelectSlideTemplate?: (slideTemplateRunId: string | null) => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPrepareAnimatedDeck: (htmlContentPath: string) => Promise<boolean>;
  onClear: () => void;
  
  // Drive props
  isSearchingDrive: boolean;
  isImportingDrive: boolean;
  driveSearchResults: any[];
  searchDrive: (query: string) => Promise<void>;
  importDriveAsset: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides", accessToken?: string, provider?: CloudStorageProvider) => Promise<boolean>;
  clearDriveSearchResults: () => void;
}

export function SofliaHtmlSlidesSection({
  slides,
  isGeneratingSofliaSlides,
  isUploading,
  isPreparingAnimatedDeck,
  isLoadingSlideTemplates = false,
  selectedSlideTemplateRunId,
  showSofliaGeneration = true,
  slideTemplates = [],
  slideTemplatesHref,
  slideTemplateStudioHref,
  sofliaSlidesHref,
  fileRef,
  onGenerateSofliaSlides,
  onSelectSlideTemplate,
  onUpload,
  onPrepareAnimatedDeck,
  onClear,
  isSearchingDrive,
  isImportingDrive,
  driveSearchResults,
  searchDrive,
  importDriveAsset,
  clearDriveSearchResults,
}: SofliaHtmlSlidesSectionProps) {
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const animatedDeck = slides?.animated_deck;
  const qaStatus = typeof slides?.qa_report?.status === "string"
    ? slides.qa_report.status
    : null;
  const qaFindingCount = Array.isArray(slides?.qa_report?.findings)
    ? slides.qa_report.findings.length
    : 0;
  const renderableSlideCount = slides?.images?.length || 0;
  const hasSourceReference = Boolean(slides?.html_public_url || slides?.html_content_path);
  const canPrepareAnimatedDeck = Boolean(slides?.html_content_path);
  const selectedSlideTemplate = slideTemplates.find(
    (template) => template.id === selectedSlideTemplateRunId,
  );
  const slideImages = useMemo(
    () => [...(slides?.images || [])].sort((left, right) => left.slide_index - right.slide_index),
    [slides?.images],
  );
  const handlePrepareAnimatedDeck = async () => {
    if (!slides?.html_content_path) {
      toast.error("No hay HTML fuente para preparar como deck animado.");
      return;
    }

    try {
      await onPrepareAnimatedDeck(slides.html_content_path);
      toast.success("Deck animado preparado para Remotion");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo preparar el deck animado");
    }
  };

  return (
    <div className="p-3 rounded-xl border border-gray-200 dark:border-[var(--engine-muted)]/10 bg-gray-50/50 dark:bg-[var(--engine-canvas)]/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wand2 size={14} className="text-purple-500" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Slides SofLIA - Engine</span>
          {animatedDeck?.status === "READY_FOR_RENDER" || animatedDeck?.status === "READY_FOR_PREVIEW" ? (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 size={10} /> Deck HTML listo
            </span>
          ) : animatedDeck?.status === "FAILED" ? (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 px-1.5 py-0.5 rounded-full">
              <AlertTriangle size={10} /> Deck fallido
            </span>
          ) : renderableSlideCount > 0 ? (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 size={10} /> {renderableSlideCount} imagen(es)
            </span>
          ) : hasSourceReference ? (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded-full">
              Fuente cargada
            </span>
          ) : null}
          {qaStatus && (
            <span className={`flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
              qaStatus === "FAIL"
                ? "text-red-600 bg-red-50 dark:bg-red-500/10 dark:text-red-300"
                : qaStatus === "WARN"
                  ? "text-amber-600 bg-amber-50 dark:bg-amber-500/10 dark:text-amber-300"
                  : "text-green-600 bg-green-50 dark:bg-green-500/10 dark:text-green-300"
            }`}>
              QA {qaStatus}{qaFindingCount > 0 ? ` · ${qaFindingCount}` : ""}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {showSofliaGeneration && (
            <button
              onClick={() => onGenerateSofliaSlides(selectedSlideTemplateRunId || null)}
              disabled={isGeneratingSofliaSlides}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isGeneratingSofliaSlides ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
              <span>{isGeneratingSofliaSlides ? "Generando..." : "Generar HTML"}</span>
            </button>
          )}

          {sofliaSlidesHref ? (
            <a
              href={sofliaSlidesHref}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-500/20 dark:bg-purple-500/10 dark:text-purple-300 transition-colors"
            >
              <PanelsTopLeft size={10} />
              <span>Abrir Slides</span>
            </a>
          ) : null}

          {slideTemplatesHref && (
            <a
              href={slideTemplatesHref}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-lg border border-gray-300 bg-white dark:bg-[var(--engine-surface-solid)] hover:bg-gray-50 dark:hover:bg-white/5 text-gray-650 dark:text-gray-300 transition-colors"
            >
              <LayoutTemplate size={10} />
              <span>Plantillas</span>
            </a>
          )}

          {slideTemplateStudioHref && (
            <a
              href={slideTemplateStudioHref}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-lg border border-teal-200 bg-teal-50/70 hover:bg-teal-100 text-teal-700 dark:border-teal-500/20 dark:bg-teal-500/10 dark:text-teal-300 transition-colors"
            >
              <Wand2 size={10} />
              <span>Nueva template</span>
            </a>
          )}
          
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-lg border border-gray-300 bg-white dark:bg-[var(--engine-surface-solid)] hover:bg-gray-50 dark:hover:bg-white/5 text-gray-650 dark:text-gray-300 transition-colors"
          >
            {isUploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
            <span>Subir slides</span>
          </button>

          {canPrepareAnimatedDeck && (
            <button
              onClick={handlePrepareAnimatedDeck}
              disabled={isPreparingAnimatedDeck}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300 transition-colors"
            >
              {isPreparingAnimatedDeck ? <Loader2 size={10} className="animate-spin" /> : <Play size={10} />}
              <span>{isPreparingAnimatedDeck ? "Preparando..." : "Preparar deck"}</span>
            </button>
          )}

          <button
            onClick={() => setIsDriveModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-lg border border-blue-200 bg-blue-50/50 hover:bg-blue-100/70 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 transition-colors"
          >
            <HardDrive size={10} />
            <span>Drive</span>
          </button>
        </div>
      </div>

      <div className="mt-2 grid gap-1.5 rounded-lg border border-gray-100 bg-white/75 p-2 dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-surface-solid)]/50">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            <LayoutTemplate size={11} />
            Plantilla HTML
          </span>
          {slides?.selected_slide_template_title ? (
            <span className="max-w-[180px] truncate rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-700 dark:bg-purple-500/10 dark:text-purple-300">
              {slides.selected_slide_template_title}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EngineSelect
            value={selectedSlideTemplateRunId || ""}
            onValueChange={(value) => onSelectSlideTemplate?.(value || null)}
            disabled={isGeneratingSofliaSlides || isLoadingSlideTemplates}
            className="min-w-0 flex-1"
            options={[
              {
                value: "",
                label: isLoadingSlideTemplates ? "Cargando plantillas..." : "Automática según la lección",
              },
              ...slideTemplates.map((template) => ({ value: template.id, label: template.title })),
            ]}
          />
          {selectedSlideTemplate ? (
            <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-600 dark:bg-white/5 dark:text-gray-300">
              {selectedSlideTemplate.layouts.length} layout(s)
            </span>
          ) : null}
        </div>
      </div>

      {(slides?.open_design_project_id || hasSourceReference || renderableSlideCount > 0 || animatedDeck) && (
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-[var(--engine-muted)]/10 text-[10px]">
          {slides?.open_design_project_id && (
            <span className="font-mono text-gray-450 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded">
              ID: {slides.open_design_project_id}
            </span>
          )}
          {renderableSlideCount > 0 && (
            <span className="font-semibold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded">
              {renderableSlideCount} imagen(es) heredadas
            </span>
          )}
          {animatedDeck && (
            <span className={`font-semibold px-1.5 py-0.5 rounded ${
              animatedDeck.status === "FAILED"
                ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
            }`}>
              {animatedDeck.slide_count} slide(s) HTML · {animatedDeck.animated_slide_count} animada(s) · {animatedDeck.static_slide_count} estatica(s)
            </span>
          )}
          {animatedDeck?.fonts?.length ? (
            <span className="font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/10 px-1.5 py-0.5 rounded">
              Fonts: {animatedDeck.fonts.map((font) => font.family).join(", ")}
            </span>
          ) : null}
          <button
            onClick={onClear}
            className="inline-flex items-center gap-0.5 text-red-500 hover:text-red-700 ml-auto font-bold cursor-pointer"
            title="Eliminar slides"
          >
            <X size={10} /> Eliminar
          </button>
        </div>
      )}

      {animatedDeck?.status === "FAILED" && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] leading-relaxed text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">
          {animatedDeck.error_message || "El deck no paso las validaciones de seguridad."}
        </div>
      )}

      {animatedDeck && animatedDeck.status !== "FAILED" && (
        <AnimatedDeckPreview
          deck={animatedDeck}
          sourceUrl={buildHtmlPreviewHref(slides)}
        />
      )}

      {slideImages.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {slideImages.map((slide) => (
            <a
              key={`${slide.storage_path}-${slide.slide_index}`}
              href={slide.public_url}
              target="_blank"
              rel="noreferrer"
              className="group overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm transition-colors hover:border-purple-300 dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)]"
              title={`Slide ${slide.slide_index}`}
            >
              <div className="aspect-video overflow-hidden bg-black">
                <img
                  src={slide.public_url}
                  alt={`Slide ${slide.slide_index}`}
                  className="h-full w-full object-contain"
                  loading="lazy"
                />
              </div>
              <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold text-gray-600 dark:text-gray-300">
                <span>Slide {String(slide.slide_index).padStart(2, "0")}</span>
                <ExternalLink size={10} className="opacity-0 transition-opacity group-hover:opacity-100" />
              </div>
            </a>
          ))}
        </div>
      )}

      <input
        type="file"
        ref={fileRef}
        onChange={onUpload}
        className="hidden"
        accept=".zip,.html,.htm,.pdf,.ppt,.pptx,image/png,image/jpeg,image/webp,image/svg+xml"
        multiple
      />

      <GoogleDriveImportModal
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        type="slides"
        isSearching={isSearchingDrive}
        isImporting={isImportingDrive}
        results={driveSearchResults}
        onSearch={searchDrive}
        onImport={importDriveAsset}
        onClearResults={clearDriveSearchResults}
      />
    </div>
  );
}

// ---------------------------------------------------------
// 4. B-ROLL CLIPS SECTION
// ---------------------------------------------------------
interface BRollClipsSectionProps {
  clips: BRollClip[];
  isUploading: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDelete: (id: string) => void;
  
  // Artlist props
  isSearchingArtlist: boolean;
  isImportingArtlist: boolean;
  artlistSearchResults: any[];
  searchArtlist: (query: string, type: "music" | "video") => Promise<void>;
  importArtlistAsset: (id: string, type: "music" | "video") => Promise<boolean>;
  clearArtlistSearchResults: () => void;
  bRollPrompts: string;

  // Drive props
  isSearchingDrive: boolean;
  isImportingDrive: boolean;
  driveSearchResults: any[];
  searchDrive: (query: string) => Promise<void>;
  importDriveAsset: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides", accessToken?: string, provider?: CloudStorageProvider) => Promise<boolean>;
  clearDriveSearchResults: () => void;
}

export function BRollClipsSection({
  clips,
  isUploading,
  fileRef,
  onUpload,
  onDelete,
  isSearchingDrive,
  isImportingDrive,
  driveSearchResults,
  searchDrive,
  importDriveAsset,
  clearDriveSearchResults,
}: BRollClipsSectionProps) {
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);

  return (
    <div className="p-3 rounded-xl border border-gray-200 dark:border-[var(--engine-muted)]/10 bg-gray-50/50 dark:bg-[var(--engine-canvas)]/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileVideo size={14} className="text-[var(--engine-accent)]" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Clips de B-Roll (Video)</span>
          <span className="text-[10px] font-semibold text-gray-500 bg-gray-200/50 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
            {clips.length} clip(s)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white dark:bg-[var(--engine-surface-solid)] px-2.5 py-1.5 text-[10px] font-bold text-gray-650 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-all cursor-pointer"
          >
            {isUploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
            <span>MP4</span>
          </button>
          
          {/* <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1 rounded-lg border border-[var(--engine-accent)]/30 bg-[var(--engine-accent)]/5 px-2.5 py-1.5 text-[10px] font-bold text-[var(--engine-accent)] hover:bg-[var(--engine-accent)]/10 transition-all cursor-pointer"
          >
            <Search size={10} />
            <span>Artlist</span>
          </button> */}
 
          <button
            onClick={() => setIsDriveModalOpen(true)}
            className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50/50 px-2.5 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100/70 transition-all cursor-pointer"
          >
            <HardDrive size={10} />
            <span>Drive</span>
          </button>
        </div>
      </div>

      <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">
        MP4 o WebM · carga directa hasta 500 MiB · render remoto hasta 2 GiB · máximo 1920 px en el lado mayor.
      </p>
 
      {clips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100 dark:border-[var(--engine-muted)]/10">
          {clips.map((clip) => (
            <div
              key={clip.id}
              className="inline-flex items-center gap-1 bg-white dark:bg-[var(--engine-surface-solid)] px-2 py-0.5 pl-2.5 pr-1.5 rounded-full border border-gray-200 dark:border-[var(--engine-muted)]/25 text-[10px] shadow-sm"
            >
              <a
                href={clip.public_url}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-gray-800 dark:text-gray-200 hover:text-[var(--engine-accent)] hover:underline"
              >
                #{clip.order} ({clip.duration ? `${clip.duration}s` : 'MP4'})
              </a>
              <button
                onClick={() => onDelete(clip.id)}
                className="text-gray-400 hover:text-red-500 transition-colors p-0.5 rounded-full hover:bg-gray-100 dark:hover:bg-white/5"
                title="Eliminar clip"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}
 
      <input
        type="file"
        ref={fileRef}
        onChange={onUpload}
        className="hidden"
        accept=".mp4,.webm,video/mp4,video/webm"
      />
 
      {/* <ArtlistSearchModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        type="video"
        suggestions={videoSuggestions}
        isSearching={isSearchingArtlist}
        isImporting={isImportingArtlist}
        results={artlistSearchResults}
        onSearch={searchArtlist}
        onImport={importArtlistAsset}
        onClearResults={clearArtlistSearchResults}
      /> */}
 
      <GoogleDriveImportModal
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        type="broll"
        isSearching={isSearchingDrive}
        isImporting={isImportingDrive}
        results={driveSearchResults}
        onSearch={searchDrive}
        onImport={importDriveAsset}
        onClearResults={clearDriveSearchResults}
      />
    </div>
  );
}

// ---------------------------------------------------------
// 5. AVATAR IA SECTION
// ---------------------------------------------------------
interface AvatarVideoSectionProps {
  aspectRatio: "16:9" | "9:16";
  avatarClips: AvatarClip[];
  avatarGenerationMode: AvatarGenerationMode;
  avatarVideo: AvatarVideo | null;
  avatarPresets: { id: string; is_default?: boolean; name?: string | null }[];
  captionEnabled: boolean;
  componentId: string;
  engine: "avatar_iv" | "avatar_v";
  isUploading: boolean;
  isSyncing: boolean;
  isLoadingPresets: boolean;
  jobId: string | null;
  jobStatus: string | null;
  providerJobId: string | null;
  resolution: "720p" | "1080p" | "4k";
  selectedAvatarPresetId: string;
  selectedVoicePresetId: string;
  syncProgress: number;
  syncError: string | null;
  voicePresets: { id: string; is_default?: boolean; name?: string | null }[];
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAspectRatioChange: (value: "16:9" | "9:16") => void;
  onAvatarPresetChange: (value: string) => void;
  onCaptionEnabledChange: (value: boolean) => void;
  onClear: () => void;
  onDeleteClip: (clipId: string) => void;
  onEngineChange: (value: "avatar_iv" | "avatar_v") => void;
  onHeygenStatusCheck: () => void;
  onRefreshPresets: () => Promise<void>;
  onResolutionChange: (value: "720p" | "1080p" | "4k") => void;
  onVoicePresetChange: (value: string) => void;
  
  // Drive props
  isSearchingDrive: boolean;
  isImportingDrive: boolean;
  driveSearchResults: any[];
  searchDrive: (query: string) => Promise<void>;
  importDriveAsset: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides", accessToken?: string, provider?: CloudStorageProvider) => Promise<boolean>;
  clearDriveSearchResults: () => void;
}

export function AvatarVideoSection({
  aspectRatio,
  avatarClips,
  avatarGenerationMode,
  avatarVideo,
  avatarPresets,
  captionEnabled,
  componentId,
  engine,
  isUploading,
  isSyncing,
  isLoadingPresets,
  jobId,
  jobStatus,
  providerJobId,
  resolution,
  selectedAvatarPresetId,
  selectedVoicePresetId,
  syncProgress,
  syncError,
  voicePresets,
  fileRef,
  onUpload,
  onClear,
  onDeleteClip,
  onAspectRatioChange,
  onAvatarPresetChange,
  onCaptionEnabledChange,
  onEngineChange,
  onHeygenStatusCheck,
  onRefreshPresets,
  onResolutionChange,
  onVoicePresetChange,
  isSearchingDrive,
  isImportingDrive,
  driveSearchResults,
  searchDrive,
  importDriveAsset,
  clearDriveSearchResults,
}: AvatarVideoSectionProps) {
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const completedAvatarClips = avatarClips.filter(
    (clip) => clip.status === "COMPLETED" && clip.public_url,
  );
  const avatarClipDuration = completedAvatarClips.reduce(
    (sum, clip) => sum + (typeof clip.duration === "number" ? clip.duration : 0),
    0,
  );
  const hasAvatarClips = completedAvatarClips.length > 0;
  const openHeygenModule = () => {
    const currentPath = window.location.pathname;
    const adminIndex = currentPath.indexOf("/admin");
    const tenantPrefix = adminIndex > 0 ? currentPath.slice(0, adminIndex) : "";
    const query = new URLSearchParams({
      componentId,
      returnTo: `${window.location.pathname}${window.location.search}${window.location.hash}`,
      source: "course",
    });

    window.location.assign(`${tenantPrefix}/admin/heygen?${query.toString()}`);
  };

  return (
    <div className="p-3 rounded-xl border border-gray-200 dark:border-[var(--engine-muted)]/10 bg-gray-50/50 dark:bg-[var(--engine-canvas)]/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Video size={14} className="text-rose-500" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Avatares</span>
          {(avatarVideo || hasAvatarClips) && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 size={10} /> Listo
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isUploading || isSyncing}
            className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white dark:bg-[var(--engine-surface-solid)] px-2.5 py-1.5 text-[10px] font-bold text-gray-650 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-all cursor-pointer disabled:opacity-50"
          >
            {isUploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
            <span>Video completo</span>
          </button>
          
          <button
            onClick={() => setIsDriveModalOpen(true)}
            disabled={isUploading || isSyncing}
            className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50/50 px-2.5 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100/70 transition-all cursor-pointer disabled:opacity-50"
          >
            <HardDrive size={10} />
            <span>Drive</span>
          </button>
        </div>
      </div>

      <p className="mt-2 text-[10px] text-gray-500 dark:text-gray-400">
        MP4 o WebM · carga directa hasta 500 MiB · render remoto hasta 2 GiB · máximo 1920×1080 o 1080×1920.
      </p>

      <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold text-gray-500 dark:text-gray-400">
        <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-white/5">
          {avatarGenerationMode === "scene_clips" ? "Modo: Por escenas" : "Modo: Video completo"}
        </span>
        {avatarGenerationMode === "scene_clips" ? (
          <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-white/5">
            {completedAvatarClips.length}/{avatarClips.length} clips · {formatSeconds(avatarClipDuration)}
          </span>
        ) : avatarVideo?.duration ? (
          <span className="rounded-full bg-gray-100 px-2 py-1 dark:bg-white/5">
            {formatSeconds(avatarVideo.duration)}
          </span>
        ) : null}
      </div>

      {!avatarVideo && (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3 dark:border-[var(--engine-muted)]/10">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <EngineSelect
              value={selectedAvatarPresetId}
              onValueChange={onAvatarPresetChange}
              disabled={isSyncing || isLoadingPresets}
              options={[
                { value: "", label: "Avatar predeterminado" },
                ...avatarPresets.map((preset) => ({
                  value: preset.id,
                  label: `${preset.name || preset.id}${preset.is_default ? " · Predeterminado" : ""}`,
                })),
              ]}
            />

            <EngineSelect
              value={selectedVoicePresetId}
              onValueChange={onVoicePresetChange}
              disabled={isSyncing || isLoadingPresets}
              options={[
                { value: "", label: "Voz predeterminada" },
                ...voicePresets.map((preset) => ({
                  value: preset.id,
                  label: `${preset.name || preset.id}${preset.is_default ? " · Predeterminada" : ""}`,
                })),
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <EngineSelect
              value={engine}
              onValueChange={(value) => onEngineChange(value as "avatar_iv" | "avatar_v")}
              disabled={isSyncing}
              options={[
                { value: "avatar_iv", label: "Avatar IV" },
                { value: "avatar_v", label: "Avatar V" },
              ]}
            />

            <EngineSelect
              value={resolution}
              onValueChange={(value) => onResolutionChange(value as "720p" | "1080p" | "4k")}
              disabled={isSyncing}
              options={[
                { value: "720p", label: "720p" },
                { value: "1080p", label: "1080p" },
                { value: "4k", label: "4K" },
              ]}
            />

            <EngineSelect
              value={aspectRatio}
              onValueChange={(value) => onAspectRatioChange(value as "16:9" | "9:16")}
              disabled={isSyncing}
              options={[
                { value: "16:9", label: "16:9 · Horizontal" },
                { value: "9:16", label: "9:16 · Vertical" },
              ]}
            />

            <label className="flex items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[11px] font-bold text-gray-650 dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)] dark:text-gray-300">
              <input
                type="checkbox"
                checked={captionEnabled}
                onChange={(event) => onCaptionEnabledChange(event.target.checked)}
                disabled={isSyncing}
                className="accent-rose-500"
              />
              SRT
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={openHeygenModule}
              disabled={isSyncing || isUploading || isLoadingPresets}
              className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-rose-500 disabled:opacity-50"
            >
              <ExternalLink size={11} />
              Abrir modulo de avatares
            </button>
            <button
              type="button"
              onClick={onRefreshPresets}
              disabled={isSyncing || isLoadingPresets}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[10px] font-bold text-gray-650 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-surface-solid)] dark:text-gray-300 dark:hover:bg-white/5"
            >
              {isLoadingPresets ? "Cargando..." : "Presets"}
            </button>
            {jobId && (
              <button
                type="button"
                onClick={onHeygenStatusCheck}
                disabled={isSyncing}
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-[10px] font-bold text-rose-700 transition-colors hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
              >
                Consultar
              </button>
            )}
          </div>
        </div>
      )}

      {isSyncing && (
        <div className="space-y-1 mt-2 pt-2 border-t border-gray-100 dark:border-[var(--engine-muted)]/10">
          <div className="flex justify-between text-[9px] font-semibold text-rose-500">
            <span className="flex items-center gap-1 animate-pulse">
              <Loader2 size={8} className="animate-spin" />
              Generando avatar...
            </span>
            <span>{syncProgress}%</span>
          </div>
          <div className="relative h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-rose-500 transition-all duration-300"
              style={{ width: `${syncProgress}%` }}
            />
          </div>
        </div>
      )}

      {syncError && (
        <p className="text-[10px] text-red-500 font-medium mt-1.5 pl-1">
          Error: {syncError}
        </p>
      )}

      {(jobId || providerJobId || jobStatus) && !avatarVideo && (
        <div className="mt-2 flex flex-wrap gap-2 border-t border-gray-100 pt-2 text-[10px] text-gray-500 dark:border-[var(--engine-muted)]/10 dark:text-gray-400">
          {jobStatus && <span>Status: {jobStatus}</span>}
          {providerJobId && <span>Proveedor: {providerJobId}</span>}
          {jobId && <span>Job: {jobId.slice(0, 8)}...</span>}
        </div>
      )}

      {hasAvatarClips ? (
        <div className="mt-3 border-t border-gray-100 pt-3 dark:border-[var(--engine-muted)]/10">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Clips generados
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-white/5 dark:text-gray-400">
              {completedAvatarClips.length} clip(s)
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {completedAvatarClips.map((clip) => (
              <div
                key={clip.id}
                className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-surface-solid)]"
              >
                <video
                  src={clip.public_url}
                  controls
                  preload="metadata"
                  className="aspect-video w-full bg-black object-cover"
                />
                <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[10px]">
                  <span className="min-w-0 truncate font-bold text-gray-700 dark:text-gray-200">
                    Escena {clip.order}
                    {clip.duration ? ` - ${formatSeconds(clip.duration)}` : ""}
                  </span>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href={clip.public_url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-bold text-rose-500 hover:text-rose-400"
                    >
                      Abrir
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm("¿Retirar este video de avatar para volver a generarlo? La escena y el historial se conservarán.")) {
                          onDeleteClip(clip.id);
                        }
                      }}
                      className="inline-flex items-center gap-1 font-bold text-red-500 hover:text-red-700"
                      title="Retirar video y conservar la escena"
                    >
                      <Trash2 size={11} /> Borrar
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {avatarVideo && (
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-105 dark:border-[var(--engine-muted)]/10 text-[10px]">
          <span className="font-semibold text-gray-500 truncate max-w-[150px]" title={avatarVideo.storage_path.split("/").pop()}>
            {avatarVideo.storage_path.split("/").pop()}
          </span>
          {avatarVideo.provider && (
            <span className="text-gray-400">({avatarVideo.provider})</span>
          )}
          <a
            href={avatarVideo.public_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-rose-500 hover:text-rose-400 font-bold"
          >
            <ExternalLink size={10} /> Ver avatar
          </a>
          <button
            onClick={onClear}
            className="inline-flex items-center gap-0.5 text-red-500 hover:text-red-700 ml-auto font-bold cursor-pointer"
            title="Eliminar avatar"
          >
            <X size={10} /> Eliminar
          </button>
        </div>
      )}

      <input
        type="file"
        ref={fileRef}
        onChange={onUpload}
        className="hidden"
        accept=".mp4,.webm,video/mp4,video/webm"
      />

      <GoogleDriveImportModal
        isOpen={isDriveModalOpen}
        onClose={() => setIsDriveModalOpen(false)}
        type="avatar"
        isSearching={isSearchingDrive}
        isImporting={isImportingDrive}
        results={driveSearchResults}
        onSearch={searchDrive}
        onImport={importDriveAsset}
        onClearResults={clearDriveSearchResults}
      />
    </div>
  );
}

// ---------------------------------------------------------
// ARTLIST CATALOG SEARCH & IMPORT MODAL
// ---------------------------------------------------------
interface ArtlistSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: "music" | "video";
  suggestions: string[];
  isSearching: boolean;
  isImporting: boolean;
  results: any[];
  onSearch: (query: string, type: "music" | "video") => Promise<void>;
  onImport: (id: string, type: "music" | "video") => Promise<boolean>;
  onClearResults: () => void;
}

export function ArtlistSearchModal({
  isOpen,
  onClose,
  type,
  suggestions,
  isSearching,
  isImporting,
  results,
  onSearch,
  onImport,
  onClearResults,
}: ArtlistSearchModalProps) {
  const [query, setQuery] = useState("");
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [hoveredVideoId, setHoveredVideoId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSearchSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    onSearch(query, type);
  };

  const handleSuggestionClick = (tag: string) => {
    setQuery(tag);
    onSearch(tag, type);
  };

  const handlePlayToggle = (trackId: string, url: string) => {
    if (!audioRef.current) return;
    if (playingTrackId === trackId) {
      audioRef.current.pause();
      setPlayingTrackId(null);
    } else {
      audioRef.current.src = url;
      audioRef.current.volume = 0.3;
      audioRef.current.play()
        .then(() => setPlayingTrackId(trackId))
        .catch((err) => {
          console.error("Audio playback error:", err);
          setPlayingTrackId(null);
        });
    }
  };

  const handleImportClick = async (assetId: string) => {
    const success = await onImport(assetId, type);
    if (success) {
      onClose();
    }
  };

  const handleClose = () => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    setPlayingTrackId(null);
    onClearResults();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <audio
        ref={audioRef}
        onEnded={() => setPlayingTrackId(null)}
        className="hidden"
      />

      <div className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-surface-solid)] flex flex-col shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-[var(--engine-muted)]/10 px-6 py-4">
          <div className="flex items-center gap-2">
            {type === "music" ? (
              <Music className="text-indigo-500 animate-pulse" size={20} />
            ) : (
              <FileVideo className="text-[var(--engine-accent)] animate-pulse" size={20} />
            )}
            <div>
              <h3 className="text-sm font-bold text-gray-950 dark:text-white">
                Buscar en Artlist {type === "music" ? "Música" : "B-Roll"}
              </h3>
              <p className="text-[11px] text-gray-505 dark:text-gray-400">
                Catálogo simulado rápido libre de regalías
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-gray-450 hover:text-gray-650 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
          
          {/* Search bar */}
          <form onSubmit={handleSearchSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-450" />
              <input
                type="text"
                placeholder={type === "music" ? "Buscar por género, mood o instrumento..." : "Buscar por tags de video o keywords..."}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-gray-305 bg-white text-gray-900 placeholder-gray-400 focus:border-[var(--engine-info)] focus:outline-none dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)] dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="px-4 py-2 text-xs font-bold text-white bg-[var(--engine-info)] hover:bg-[#1A4ED4] rounded-lg transition-colors flex items-center gap-1"
            >
              {isSearching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
              Buscar
            </button>
          </form>

          {/* Suggestions Chips */}
          {suggestions.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                <Sparkles size={10} className="text-yellow-500" /> Sugerencias de la IA
              </p>
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((tag, idx) => (
                  <button
                    key={`${tag}-${idx}`}
                    onClick={() => handleSuggestionClick(tag)}
                    className="px-2 py-1 text-[11px] font-medium rounded-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/20 dark:text-indigo-300 transition-colors border border-indigo-100/50 dark:border-indigo-500/10"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search Results */}
          <div className="space-y-2 pt-2">
            {isSearching ? (
              <div className="flex flex-col items-center justify-center py-12 text-gray-505 dark:text-gray-400 space-y-3">
                <Loader2 className="animate-spin text-[var(--engine-info)]" size={32} />
                <p className="text-xs">Consultando catálogo de Artlist...</p>
              </div>
            ) : results.length === 0 ? (
              <div className="text-center py-12 text-xs text-gray-500 dark:text-gray-405 border border-dashed border-gray-200 dark:border-[var(--engine-muted)]/15 rounded-xl">
                Haz una búsqueda o haz clic en las sugerencias para cargar el catálogo.
              </div>
            ) : type === "music" ? (
              // Music List
              <div className="space-y-2">
                {results.map((track) => (
                  <div
                    key={track.id}
                    className="flex items-center justify-between p-3 rounded-xl border border-gray-100 dark:border-[var(--engine-muted)]/10 bg-gray-50/50 dark:bg-[var(--engine-canvas)]/30 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handlePlayToggle(track.id, track.public_url)}
                        className="p-2 rounded-full bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-[var(--engine-muted)]/20 text-gray-650 dark:text-gray-300 hover:text-[var(--engine-info)] dark:hover:text-[#38BDF8] hover:border-[var(--engine-info)]/30 transition-all flex items-center justify-center shadow-sm"
                      >
                        {playingTrackId === track.id ? (
                          <Pause size={14} className="fill-current text-[var(--engine-info)]" />
                        ) : (
                          <Play size={14} className="fill-current" />
                        )}
                      </button>
                      <div>
                        <p className="font-semibold text-gray-905 dark:text-white">{track.title}</p>
                        <p className="text-[10px] text-gray-550">{track.artist} - {track.genre} - {track.mood}</p>
                      </div>
                    </div>
                    
                    <button
                      onClick={() => handleImportClick(track.id)}
                      disabled={isImporting}
                      className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-gray-200 dark:border-[var(--engine-muted)]/20 hover:bg-white dark:hover:bg-white/5 text-gray-750 dark:text-gray-300 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isImporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                      Importar
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              // Video Grid
              <div className="grid grid-cols-2 gap-4">
                {results.map((video) => (
                  <div
                    key={video.id}
                    className="group flex flex-col rounded-xl border border-gray-105 dark:border-[var(--engine-muted)]/10 bg-gray-50/50 dark:bg-[var(--engine-canvas)]/30 overflow-hidden"
                  >
                    <div
                      className="relative aspect-video bg-black cursor-pointer overflow-hidden flex items-center justify-center"
                      onMouseEnter={() => setHoveredVideoId(video.id)}
                      onMouseLeave={() => setHoveredVideoId(null)}
                    >
                      {hoveredVideoId === video.id ? (
                        <video
                          src={video.public_url}
                          autoPlay
                          muted
                          loop
                          playsInline
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-gray-900 text-gray-500 relative">
                          <FileVideo size={36} className="text-gray-600 group-hover:scale-105 transition-transform" />
                          <span className="absolute bottom-2 right-2 text-[10px] bg-black/70 px-1.5 py-0.5 rounded text-white font-mono">
                            {video.duration_seconds}s
                          </span>
                          <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity text-white text-[10px] font-bold">
                            Hover para vista previa
                          </span>
                        </div>
                      )}
                    </div>
                    
                    <div className="p-3 flex-1 flex flex-col justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-gray-900 dark:text-white line-clamp-1">{video.title}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {video.tags.slice(0, 3).map((tag: string) => (
                            <span
                              key={tag}
                              className="text-[9px] bg-gray-200/50 dark:bg-white/5 text-gray-500 dark:text-gray-400 px-1.5 py-0.5 rounded"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={() => handleImportClick(video.id)}
                        disabled={isImporting}
                        className="w-full py-1.5 text-[11px] font-bold rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                      >
                        {isImporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                        Importar Clip
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 dark:bg-[var(--engine-surface-solid)] px-6 py-3 border-t border-gray-100 dark:border-[var(--engine-muted)]/10 flex justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-xs font-bold rounded-lg border border-gray-300 dark:border-[var(--engine-muted)]/20 text-gray-750 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// GOOGLE DRIVE FILE EXPLORER & IMPORT MODAL
// ---------------------------------------------------------
interface GoogleDriveImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: "voice" | "music" | "broll" | "avatar" | "slides";
  isSearching: boolean;
  isImporting: boolean;
  results: CloudStorageFile[];
  onSearch: (query: string, provider?: CloudStorageProvider) => Promise<void>;
  onImport: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides", accessToken?: string, provider?: CloudStorageProvider) => Promise<boolean>;
  onClearResults: () => void;
}

export function GoogleDriveImportModal({
  isOpen,
  onClose,
  type,
  isSearching,
  isImporting,
  results,
  onSearch,
  onImport,
  onClearResults,
}: GoogleDriveImportModalProps) {
  const [linkUrl, setLinkUrl] = useState("");
  const [query, setQuery] = useState("");
  const [connections, setConnections] = useState<CloudStorageConnection[]>([]);
  const [isLoadingConnections, setIsLoadingConnections] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [localIsImporting, setLocalIsImporting] = useState(false);
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<CloudStorageProvider | null>(null);

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const developerKey = process.env.NEXT_PUBLIC_GOOGLE_DEVELOPER_KEY;
  const configuredPickerAppId = process.env.NEXT_PUBLIC_GOOGLE_APP_ID;
  const isDeveloperKeyLikelyApiKey = Boolean(developerKey?.startsWith("AIza"));
  const isConfigured = Boolean(clientId && developerKey && isDeveloperKeyLikelyApiKey);
  const driveReadonlyScope = "https://www.googleapis.com/auth/drive.readonly";
  const driveTokenCacheKey = "soflia-engine.googleDrive.readonlyToken";

  const connectedProviders = useMemo(
    () => connections.filter((connection) => connection.connected),
    [connections],
  );
  const selectedProviderLabel =
    selectedProvider === "google_drive"
      ? "Google Drive"
      : selectedProvider === "onedrive"
        ? "OneDrive"
        : "Cloud";

  const loadConnections = async () => {
    setIsLoadingConnections(true);
    try {
      const response = await getCloudStorageConnectionsAction();
      const nextConnections = response.connections;
      setConnections(nextConnections);

      const firstConnected = nextConnections.find((connection) => connection.connected)?.provider || null;
      setSelectedProvider((currentProvider) => {
        if (
          currentProvider &&
          nextConnections.some((connection) => connection.provider === currentProvider && connection.connected)
        ) {
          return currentProvider;
        }

        return firstConnected;
      });
    } finally {
      setIsLoadingConnections(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    loadConnections();
  }, [isOpen]);

  const handleProviderSelect = (provider: CloudStorageProvider) => {
    setSelectedProvider(provider);
    setQuery("");
    setLinkUrl("");
    onClearResults();
  };

  const getPickerAppId = (clientIdStr: string): string => {
    if (configuredPickerAppId) return configuredPickerAppId;

    const projectNumber = clientIdStr.split("-")[0];
    return /^\d+$/.test(projectNumber) ? projectNumber : clientIdStr;
  };

  const getPickerSize = () => {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    return {
      width: Math.min(920, Math.max(720, viewportWidth - 96)),
      height: Math.min(560, Math.max(420, viewportHeight - 180)),
    };
  };

  const getAllowedDriveMimeTypes = () => {
    switch (type) {
      case "voice":
      case "music":
        return [
          "audio/aac",
          "audio/flac",
          "audio/m4a",
          "audio/mp4",
          "audio/mpeg",
          "audio/ogg",
          "audio/wav",
          "audio/webm",
          "audio/x-m4a",
          "audio/x-wav",
        ];
      case "broll":
      case "avatar":
        return [
          "video/avi",
          "video/mp4",
          "video/mpeg",
          "video/quicktime",
          "video/webm",
          "video/x-m4v",
          "video/x-matroska",
          "video/x-msvideo",
        ];
      case "slides":
        return [
          "application/zip",
          "text/html",
          "application/vnd.google-apps.presentation",
          "application/vnd.ms-powerpoint",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ];
    }
  };

  const getCachedAccessToken = (): string | null => {
    try {
      const cachedToken = window.sessionStorage.getItem(driveTokenCacheKey);
      if (!cachedToken) return null;

      const parsed = JSON.parse(cachedToken) as { accessToken?: string; expiresAt?: number; scope?: string };
      const expiresWithBuffer = (parsed.expiresAt ?? 0) - 60000;

      if (parsed.accessToken && parsed.scope === driveReadonlyScope && Date.now() < expiresWithBuffer) {
        return parsed.accessToken;
      }

      window.sessionStorage.removeItem(driveTokenCacheKey);
      return null;
    } catch {
      window.sessionStorage.removeItem(driveTokenCacheKey);
      return null;
    }
  };

  const cacheAccessToken = (accessToken: string, expiresInSeconds?: number) => {
    const expiresAt = Date.now() + Math.max(expiresInSeconds ?? 3600, 300) * 1000;
    window.sessionStorage.setItem(
      driveTokenCacheKey,
      JSON.stringify({
        accessToken,
        expiresAt,
        scope: driveReadonlyScope,
      })
    );
  };

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkUrl.trim() || !selectedProvider) return;
    const success = await onImport(linkUrl.trim(), type, undefined, selectedProvider);
    if (success) {
      setLinkUrl("");
      onClose();
    }
  };

  const handleSearchSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProvider) return;
    await onSearch(query.trim(), selectedProvider);
  };

  const handleImportCloudFile = async (fileId: string) => {
    if (!selectedProvider) return;
    const success = await onImport(fileId, type, undefined, selectedProvider);
    if (success) {
      onClearResults();
      onClose();
    }
  };

  const loadGoogleScripts = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      if ((window as any).gapi && (window as any).google) {
        resolve();
        return;
      }

      const loadGis = () => {
        if ((window as any).google) {
          resolve();
          return;
        }
        const gisScript = document.createElement("script");
        gisScript.src = "https://accounts.google.com/gsi/client";
        gisScript.async = true;
        gisScript.defer = true;
        gisScript.onload = () => resolve();
        gisScript.onerror = () => reject(new Error("Failed to load Google GIS SDK"));
        document.body.appendChild(gisScript);
      };

      if ((window as any).gapi) {
        loadGis();
      } else {
        const gapiScript = document.createElement("script");
        gapiScript.src = "https://apis.google.com/js/api.js";
        gapiScript.async = true;
        gapiScript.defer = true;
        gapiScript.onload = () => loadGis();
        gapiScript.onerror = () => reject(new Error("Failed to load Google GAPI SDK"));
        document.body.appendChild(gapiScript);
      }
    });
  };

  const initGapi = (): Promise<void> => {
    return new Promise((resolve) => {
      (window as any).gapi.load("client:picker", () => {
        resolve();
      });
    });
  };

  const requestAccessToken = (clientIdStr: string, prompt: "" | "consent" = "consent"): Promise<string> => {
    return new Promise((resolve, reject) => {
      let didComplete = false;
      const timeoutId = window.setTimeout(() => {
        if (didComplete) return;
        didComplete = true;
        reject(new Error("Google no completó la autorización. Revisa la ventana emergente o vuelve a intentarlo."));
      }, 120000);

      const finishWithError = (message: string) => {
        if (didComplete) return;
        didComplete = true;
        window.clearTimeout(timeoutId);
        reject(new Error(message));
      };

      const finishWithToken = (accessToken: string) => {
        if (didComplete) return;
        didComplete = true;
        window.clearTimeout(timeoutId);
        resolve(accessToken);
      };

      try {
        const tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
          client_id: clientIdStr,
          scope: driveReadonlyScope,
          callback: (response: any) => {
            if (response.error) {
              finishWithError(response.error_description || response.error);
              return;
            }
            if (response.access_token) {
              cacheAccessToken(response.access_token, response.expires_in);
              finishWithToken(response.access_token);
            } else {
              finishWithError("No se obtuvo token de acceso de Google.");
            }
          },
          error_callback: (error: any) => {
            const errorType = error?.type || error?.message || "popup_failed_to_open";
            finishWithError(`No se pudo abrir o completar el login de Google (${errorType}).`);
          },
        });
        tokenClient.requestAccessToken({ prompt });
      } catch (err) {
        window.clearTimeout(timeoutId);
        reject(err);
      }
    });
  };

  const getAccessTokenForPicker = async (clientIdStr: string): Promise<string> => {
    const cachedAccessToken = getCachedAccessToken();
    if (cachedAccessToken) return cachedAccessToken;

    try {
      return await requestAccessToken(clientIdStr, "");
    } catch {
      return requestAccessToken(clientIdStr, "consent");
    }
  };

  const handleOpenPicker = async () => {
    if (!clientId || !developerKey) return;
    setIsConnecting(true);

    try {
      // 1. Load scripts
      await loadGoogleScripts();

      // 2. Initialize GAPI client Picker
      await initGapi();

      // 3. Request Access Token from Google
      const accessToken = await getAccessTokenForPicker(clientId);
      setIsConnecting(false);

      // 4. Build and display the Google Picker
      const view = new (window as any).google.picker.DocsView((window as any).google.picker.ViewId.DOCS);
      
      const allowedMimes = getAllowedDriveMimeTypes();
      view.setMimeTypes(allowedMimes.join(","));

      const pickerSize = getPickerSize();
      setIsPickerVisible(true);
      const picker = new (window as any).google.picker.PickerBuilder()
        .enableFeature((window as any).google.picker.Feature.NAV_HIDDEN)
        .setDeveloperKey(developerKey)
        .setAppId(getPickerAppId(clientId))
        .setOrigin(window.location.origin)
        .setSize(pickerSize.width, pickerSize.height)
        .setOAuthToken(accessToken)
        .addView(view)
        .setCallback(async (data: any) => {
          const action = data[(window as any).google.picker.Response.ACTION];
          if (action === (window as any).google.picker.Action.CANCEL) {
            setIsConnecting(false);
            setLocalIsImporting(false);
            setIsPickerVisible(false);
            return;
          }

          if (action === (window as any).google.picker.Action.PICKED) {
            const doc = data[(window as any).google.picker.Response.DOCUMENTS][0];
            const fileId = doc[(window as any).google.picker.Document.ID];
            
            console.log("[GoogleDrivePicker] Picked file ID:", fileId);
            setLocalIsImporting(true);
            setIsPickerVisible(false);
            
            try {
              const success = await onImport(fileId, type, accessToken, "google_drive");
              if (success) {
                onClose();
              }
            } catch (err) {
              console.error("[GoogleDrivePicker] Import failed:", err);
            } finally {
              setLocalIsImporting(false);
            }
          }
        })
        .build();

      picker.setVisible(true);

    } catch (err: any) {
      setIsConnecting(false);
      setLocalIsImporting(false);
      setIsPickerVisible(false);
      console.error("[GoogleDrivePicker] Connection failed:", err);
      toast.error(err.message || "Error al conectar con Google Drive. Verifica que tu navegador permita ventanas emergentes.");
    }
  };

  const handleClose = () => {
    setLinkUrl("");
    setQuery("");
    setIsConnecting(false);
    setLocalIsImporting(false);
    setIsPickerVisible(false);
    onClearResults();
    onClose();
  };

  if (!isOpen) return null;
  if (isPickerVisible) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-surface-solid)] flex flex-col shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-[var(--engine-muted)]/10 px-6 py-4">
          <div className="flex items-center gap-2">
            <HardDrive className="text-blue-500 animate-pulse" size={20} />
            <div>
              <h3 className="text-sm font-bold text-gray-950 dark:text-white">
                Importar recurso desde cloud
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Usa la cuenta vinculada para copiar assets hacia SofLIA - Engine
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-gray-450 hover:text-gray-650 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          <CloudStorageImportBody
            connectedProviders={connectedProviders}
            isConfigured={isConfigured}
            isConnecting={isConnecting}
            isImporting={isImporting}
            isLoadingConnections={isLoadingConnections}
            isPickerDeveloperKeyInvalid={Boolean(developerKey && !isDeveloperKeyLikelyApiKey)}
            isSearching={isSearching}
            linkUrl={linkUrl}
            localIsImporting={localIsImporting}
            onConnectRefresh={loadConnections}
            onImportFile={handleImportCloudFile}
            onLinkSubmit={handleLinkSubmit}
            onOpenPicker={handleOpenPicker}
            onProviderSelect={handleProviderSelect}
            onQueryChange={setQuery}
            onSearchSubmit={handleSearchSubmit}
            query={query}
            results={results}
            selectedProvider={selectedProvider}
            selectedProviderLabel={selectedProviderLabel}
            setLinkUrl={setLinkUrl}
          />
        </div>

        {/* Footer */}
        <div className="bg-gray-50 dark:bg-[var(--engine-surface-solid)] px-6 py-3 border-t border-gray-100 dark:border-[var(--engine-muted)]/10 flex justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-xs font-bold rounded-lg border border-gray-305 dark:border-[var(--engine-muted)]/20 text-gray-750 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

interface CloudStorageImportBodyProps {
  connectedProviders: CloudStorageConnection[];
  isConfigured: boolean;
  isConnecting: boolean;
  isImporting: boolean;
  isLoadingConnections: boolean;
  isPickerDeveloperKeyInvalid: boolean;
  isSearching: boolean;
  linkUrl: string;
  localIsImporting: boolean;
  onConnectRefresh: () => void;
  onImportFile: (fileId: string) => Promise<void>;
  onLinkSubmit: (event: React.FormEvent) => void;
  onOpenPicker: () => void;
  onProviderSelect: (provider: CloudStorageProvider) => void;
  onQueryChange: (value: string) => void;
  onSearchSubmit: (event: React.FormEvent) => void;
  query: string;
  results: CloudStorageFile[];
  selectedProvider: CloudStorageProvider | null;
  selectedProviderLabel: string;
  setLinkUrl: (value: string) => void;
}

function CloudStorageImportBody({
  connectedProviders,
  isConfigured,
  isConnecting,
  isImporting,
  isLoadingConnections,
  isPickerDeveloperKeyInvalid,
  isSearching,
  linkUrl,
  localIsImporting,
  onConnectRefresh,
  onImportFile,
  onLinkSubmit,
  onOpenPicker,
  onProviderSelect,
  onQueryChange,
  onSearchSubmit,
  query,
  results,
  selectedProvider,
  selectedProviderLabel,
  setLinkUrl,
}: CloudStorageImportBodyProps) {
  if (isLoadingConnections) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-400">
        <Loader2 className="mb-3 animate-spin text-[var(--engine-info)]" size={28} />
        <p className="text-xs">Revisando cuentas vinculadas...</p>
      </div>
    );
  }

  if (connectedProviders.length === 0) {
    return (
      <div className="space-y-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-5 text-center dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)]/30">
        <HardDrive size={32} className="mx-auto text-gray-400" />
        <div>
          <p className="text-sm font-bold text-gray-900 dark:text-white">No hay cuentas cloud vinculadas</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Vincula Google Drive u OneDrive para importar assets directamente a SofLIA - Engine.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <CloudStorageConnectButton provider="google_drive" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
            Vincular Google Drive
          </CloudStorageConnectButton>
          <CloudStorageConnectButton provider="onedrive" className="rounded-lg border border-[var(--engine-accent)]/30 bg-[var(--engine-accent)]/10 px-3 py-2 text-xs font-bold text-[#008F7A] hover:bg-[var(--engine-accent)]/15 dark:text-[var(--engine-accent)]">
            Vincular OneDrive
          </CloudStorageConnectButton>
          <button
            type="button"
            onClick={onConnectRefresh}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-white dark:border-[var(--engine-muted)]/20 dark:text-gray-300 dark:hover:bg-white/5"
          >
            Actualizar
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400">
          Cuenta vinculada
        </label>
        <div className="flex flex-wrap gap-2">
          {connectedProviders.map((connection) => {
            const label = connection.provider === "google_drive" ? "Google Drive" : "OneDrive";
            return (
              <button
                key={connection.provider}
                type="button"
                onClick={() => onProviderSelect(connection.provider)}
                className={`rounded-lg border px-3 py-2 text-left text-xs font-bold transition-colors ${
                  selectedProvider === connection.provider
                    ? "border-[var(--engine-info)] bg-blue-50 text-[var(--engine-info)] dark:bg-blue-500/10"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-[var(--engine-muted)]/20 dark:text-gray-300 dark:hover:bg-white/5"
                }`}
              >
                <span className="block">{label}</span>
                {connection.email && (
                  <span className="block max-w-[180px] truncate text-[10px] font-medium text-gray-500 dark:text-gray-400">
                    {connection.email}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400">
          Buscar archivo en {selectedProviderLabel}
        </label>
        <form onSubmit={onSearchSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-450" />
            <input
              type="text"
              placeholder="Buscar por nombre o dejar vacio para ver recientes"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              disabled={!selectedProvider || isSearching}
              className="w-full rounded-lg border border-gray-305 bg-white py-2 pl-9 pr-4 text-xs text-gray-900 placeholder-gray-400 focus:border-[var(--engine-info)] focus:outline-none dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)] dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={!selectedProvider || isSearching}
            className="flex items-center gap-1 rounded-lg bg-[var(--engine-info)] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#1A4ED4] disabled:opacity-50"
          >
            {isSearching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            Buscar
          </button>
        </form>
      </div>

      <div className="space-y-2">
        {isSearching ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-10 text-gray-500 dark:border-[var(--engine-muted)]/15 dark:text-gray-400">
            <Loader2 className="mb-3 animate-spin text-[var(--engine-info)]" size={28} />
            <p className="text-xs">Consultando {selectedProviderLabel}...</p>
          </div>
        ) : results.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-xs text-gray-500 dark:border-[var(--engine-muted)]/15 dark:text-gray-400">
            Busca archivos para importar desde {selectedProviderLabel}.
          </div>
        ) : (
          <div className="space-y-2">
            {results.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/50 p-3 text-xs dark:border-[var(--engine-muted)]/10 dark:bg-[var(--engine-canvas)]/30"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-900 dark:text-white">{file.name}</p>
                  <p className="truncate text-[10px] text-gray-500 dark:text-gray-400">
                    {file.mimeType || "archivo"}{file.size ? ` - ${Math.round(file.size / 1024)} KB` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onImportFile(file.id)}
                  disabled={isImporting || localIsImporting}
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-bold text-gray-700 transition-colors hover:bg-white disabled:opacity-50 dark:border-[var(--engine-muted)]/20 dark:text-gray-300 dark:hover:bg-white/5"
                >
                  {(isImporting || localIsImporting) ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                  Importar
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="block text-[11px] font-bold uppercase tracking-wider text-gray-400">
          Importar por ID o enlace
        </label>
        <form onSubmit={onLinkSubmit} className="flex gap-2">
          <input
            type="text"
            placeholder={selectedProvider === "onedrive" ? "ID del item de OneDrive" : "ID o enlace de Google Drive"}
            value={linkUrl}
            onChange={(event) => setLinkUrl(event.target.value)}
            disabled={!selectedProvider || isImporting || localIsImporting}
            className="flex-1 rounded-lg border border-gray-305 bg-white p-2 text-xs text-gray-900 placeholder-gray-400 focus:border-[var(--engine-info)] focus:outline-none dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)] dark:text-white"
          />
          <button
            type="submit"
            disabled={!selectedProvider || isImporting || localIsImporting || !linkUrl.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-blue-550 disabled:opacity-50"
          >
            {(isImporting || localIsImporting) ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Importar
          </button>
        </form>
        {selectedProvider === "onedrive" && (
          <p className="text-[10px] leading-relaxed text-gray-500 dark:text-gray-400">
            OneDrive importa por itemId; los enlaces compartidos quedan para una mejora posterior.
          </p>
        )}
      </div>

      {selectedProvider === "google_drive" && (
        <div className="space-y-3">
          {!isConfigured ? (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-500/5 p-4 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              <p className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-400">
                <AlertTriangle size={14} />
                Google Picker no esta completamente configurado
              </p>
              <p className="leading-relaxed">
                La busqueda por cuenta vinculada sigue disponible. Para abrir Picker configura NEXT_PUBLIC_GOOGLE_CLIENT_ID, NEXT_PUBLIC_GOOGLE_DEVELOPER_KEY y NEXT_PUBLIC_GOOGLE_APP_ID.
              </p>
              {isPickerDeveloperKeyInvalid && (
                <p className="pt-1 text-[10px] font-semibold text-red-600 dark:text-red-300 leading-normal">
                  NEXT_PUBLIC_GOOGLE_DEVELOPER_KEY debe ser una API Key de navegador de Google Cloud.
                </p>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-4 dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-canvas)]/10">
              <div>
                <p className="text-xs font-semibold text-gray-900 dark:text-white">Abrir Google Picker</p>
                <p className="mt-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                  Usa el selector nativo de Google como alternativa a la busqueda.
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenPicker}
                disabled={isImporting || localIsImporting || isConnecting}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow-md shadow-blue-500/10 transition-all hover:bg-blue-550 disabled:opacity-50"
              >
                {(isConnecting || localIsImporting) ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <ExternalLink size={12} />
                )}
                <span>{isConnecting ? "Conectando..." : localIsImporting ? "Importando..." : "Abrir Picker"}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
