import { useEffect, useMemo, useRef, useState } from "react";
import {
  Volume2,
  VolumeX,
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
} from "lucide-react";
import { toast } from "sonner";
import type {
  VoiceAudio,
  BackgroundMusic,
  BRollClip,
  AvatarVideo,
  SlidesAsset,
} from "../validators/assets.validators";
import { CloudStorageConnectButton } from "@/app/admin/artifacts/new/components/CloudStorageConnectButton";
import { getCloudStorageConnectionsAction } from "@/domains/production/actions/cloud-storage.actions";
import type {
  CloudStorageConnection,
  CloudStorageFile,
  CloudStorageProvider,
} from "@/domains/production/cloud-storage/types";


// ---------------------------------------------------------
// 1. VOICE AUDIO SECTION
// ---------------------------------------------------------
interface VoiceAudioSectionProps {
  voiceAudio: VoiceAudio | null;
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
    <div className="p-3 rounded-xl border border-gray-200 dark:border-[#6C757D]/10 bg-gray-50/50 dark:bg-[#0F1419]/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mic size={14} className="text-[#1F5AF6]" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Audio de Voz (Locución)</span>
          {voiceAudio && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 size={10} /> Subido
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
                className="px-2 py-1 rounded bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/20 text-[10px] font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
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
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-300 bg-white dark:bg-[#151A21] dark:border-[#6C757D]/20 text-[10px] font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-all cursor-pointer"
              >
                {isUploading ? (
                  <Loader2 className="animate-spin text-[#1F5AF6]" size={10} />
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

      <input
        type="file"
        ref={fileRef}
        onChange={onUpload}
        className="hidden"
        accept="audio/mpeg,audio/mp3,audio/wav"
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
  onVolumeChange: (vol: number) => void;
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
  onVolumeChange,
  onClear,
  isSearchingDrive,
  isImportingDrive,
  driveSearchResults,
  searchDrive,
  importDriveAsset,
  clearDriveSearchResults,
}: BackgroundMusicSectionProps) {
  const [vol, setVol] = useState(backgroundMusic?.volume_multiplier ?? 0.15);
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);

  const handleVolSlide = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVol(v);
    onVolumeChange(v);
  };

  return (
    <div className="p-3 rounded-xl border border-gray-200 dark:border-[#6C757D]/10 bg-gray-50/50 dark:bg-[#0F1419]/30">
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
                className="px-2 py-1 rounded bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/20 text-[10px] font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-50"
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
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-gray-305 bg-white dark:bg-[#151A21] dark:border-[#6C757D]/20 text-[10px] font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-all cursor-pointer"
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

      {backgroundMusic && (
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-[#6C757D]/10 text-[10px] text-gray-500">
          <span className="flex items-center gap-1 font-semibold min-w-[70px]">
            {vol > 0 ? <Volume2 size={11} className="text-indigo-500" /> : <VolumeX size={11} />}
            Vol: {Math.round(vol * 100)}%
          </span>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            value={vol}
            onChange={handleVolSlide}
            className="flex-1 accent-indigo-500 h-1 bg-gray-200 dark:bg-gray-700 rounded-lg cursor-pointer"
          />
        </div>
      )}

      <input
        type="file"
        ref={fileRef}
        onChange={onUpload}
        className="hidden"
        accept="audio/mpeg,audio/mp3"
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
// 3. OPEN DESIGN SLIDES SECTION
// ---------------------------------------------------------
interface OpenDesignSlidesSectionProps {
  slides: SlidesAsset | null;
  isExporting: boolean;
  isUploading: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onExport: () => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
  
  // Drive props
  isSearchingDrive: boolean;
  isImportingDrive: boolean;
  driveSearchResults: any[];
  searchDrive: (query: string) => Promise<void>;
  importDriveAsset: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides", accessToken?: string, provider?: CloudStorageProvider) => Promise<boolean>;
  clearDriveSearchResults: () => void;
}export function OpenDesignSlidesSection({
  slides,
  isExporting,
  isUploading,
  fileRef,
  onExport,
  onUpload,
  onClear,
  isSearchingDrive,
  isImportingDrive,
  driveSearchResults,
  searchDrive,
  importDriveAsset,
  clearDriveSearchResults,
}: OpenDesignSlidesSectionProps) {
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const renderableSlideCount = slides?.images?.length || 0;
  const hasSourceReference = Boolean(slides?.html_public_url);

  return (
    <div className="p-3 rounded-xl border border-gray-200 dark:border-[#6C757D]/10 bg-gray-50/50 dark:bg-[#0F1419]/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wand2 size={14} className="text-purple-500" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Diapositivas (Open Design)</span>
          {renderableSlideCount > 0 ? (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 size={10} /> {renderableSlideCount} renderizable(s)
            </span>
          ) : hasSourceReference ? (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-1.5 py-0.5 rounded-full">
              Fuente cargada
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={onExport}
            disabled={isExporting}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-sm transition-all"
          >
            {isExporting ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
            <span>{isExporting ? "Creando..." : "Exportar"}</span>
          </button>
          
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-lg border border-gray-300 bg-white dark:bg-[#151A21] hover:bg-gray-50 dark:hover:bg-white/5 text-gray-650 dark:text-gray-300 transition-colors"
          >
            {isUploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
            <span>Subir slides</span>
          </button>

          <button
            onClick={() => setIsDriveModalOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold rounded-lg border border-blue-200 bg-blue-50/50 hover:bg-blue-100/70 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 transition-colors"
          >
            <HardDrive size={10} />
            <span>Drive</span>
          </button>
        </div>
      </div>

      {(slides?.open_design_project_id || slides?.html_public_url || renderableSlideCount > 0) && (
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-[#6C757D]/10 text-[10px]">
          {slides?.open_design_project_id && (
            <span className="font-mono text-gray-450 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded">
              ID: {slides.open_design_project_id}
            </span>
          )}
          {renderableSlideCount > 0 && (
            <span className="font-semibold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded">
              {renderableSlideCount} imagen(es) listas para Remotion
            </span>
          )}
          {slides?.html_content_path?.endsWith(".html") && (
            <a
              href={`/api/admin/slides/html-preview?path=${encodeURIComponent(
                slides.html_content_path.replace(/^production-assets\//, "")
              )}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-purple-600 hover:text-purple-550 dark:text-purple-400 dark:hover:text-purple-300 font-bold"
            >
              <ExternalLink size={10} /> Ver Slides HTML
            </a>
          )}
          <button
            onClick={onClear}
            className="inline-flex items-center gap-0.5 text-red-500 hover:text-red-700 ml-auto font-bold cursor-pointer"
            title="Eliminar slides"
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
    <div className="p-3 rounded-xl border border-gray-200 dark:border-[#6C757D]/10 bg-gray-50/50 dark:bg-[#0F1419]/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileVideo size={14} className="text-[#00D4B3]" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Clips de B-Roll (Video)</span>
          <span className="text-[10px] font-semibold text-gray-500 bg-gray-200/50 dark:bg-white/5 px-1.5 py-0.5 rounded-full">
            {clips.length} clip(s)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white dark:bg-[#151A21] px-2.5 py-1.5 text-[10px] font-bold text-gray-650 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-all cursor-pointer"
          >
            {isUploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
            <span>MP4</span>
          </button>
          
          {/* <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1 rounded-lg border border-[#00D4B3]/30 bg-[#00D4B3]/5 px-2.5 py-1.5 text-[10px] font-bold text-[#00D4B3] hover:bg-[#00D4B3]/10 transition-all cursor-pointer"
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
 
      {clips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-gray-100 dark:border-[#6C757D]/10">
          {clips.map((clip) => (
            <div
              key={clip.id}
              className="inline-flex items-center gap-1 bg-white dark:bg-[#151A21] px-2 py-0.5 pl-2.5 pr-1.5 rounded-full border border-gray-200 dark:border-[#6C757D]/25 text-[10px] shadow-sm"
            >
              <a
                href={clip.public_url}
                target="_blank"
                rel="noreferrer"
                className="font-bold text-gray-800 dark:text-gray-200 hover:text-[#00D4B3] hover:underline"
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
        accept="video/mp4,video/quicktime,video/webm"
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
  avatarVideo: AvatarVideo | null;
  isUploading: boolean;
  isSyncing: boolean;
  syncProgress: number;
  syncError: string | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onHeygenSync: (videoId: string) => void;
  onClear: () => void;
  
  // Drive props
  isSearchingDrive: boolean;
  isImportingDrive: boolean;
  driveSearchResults: any[];
  searchDrive: (query: string) => Promise<void>;
  importDriveAsset: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides", accessToken?: string, provider?: CloudStorageProvider) => Promise<boolean>;
  clearDriveSearchResults: () => void;
}export function AvatarVideoSection({
  avatarVideo,
  isUploading,
  isSyncing,
  fileRef,
  onUpload,
  onClear,
  isSearchingDrive,
  isImportingDrive,
  driveSearchResults,
  searchDrive,
  importDriveAsset,
  clearDriveSearchResults,
}: AvatarVideoSectionProps) {
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);

  return (
    <div className="p-3 rounded-xl border border-gray-200 dark:border-[#6C757D]/10 bg-gray-50/50 dark:bg-[#0F1419]/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Video size={14} className="text-rose-500" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Avatar IA (Talking Head)</span>
          {avatarVideo && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 size={10} /> Listo
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={isUploading || isSyncing}
            className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white dark:bg-[#151A21] px-2.5 py-1.5 text-[10px] font-bold text-gray-650 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-all cursor-pointer disabled:opacity-50"
          >
            {isUploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
            <span>MP4</span>
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

      {/* {!avatarVideo && !isSyncing && (
        <div className="flex gap-1.5 mt-2 pt-2 border-t border-gray-100 dark:border-[#6C757D]/10">
          <input
            type="text"
            placeholder="ID de Video Heygen..."
            value={heygenId}
            onChange={(e) => setHeygenId(e.target.value)}
            disabled={isSyncing || isUploading}
            className="flex-1 px-2.5 py-1 text-[11px] rounded-lg border border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:outline-none dark:border-[#6C757D]/20 dark:bg-[#0F1419] dark:text-white"
          />
          <button
            onClick={handleSyncSubmit}
            disabled={isSyncing || isUploading || !heygenId}
            className="px-3 py-1.5 text-[10px] font-bold rounded-lg bg-rose-605 hover:bg-rose-500 text-white transition-colors disabled:opacity-50"
          >
            Importar Heygen
          </button>
        </div>
      )}

      {isSyncing && (
        <div className="space-y-1 mt-2 pt-2 border-t border-gray-100 dark:border-[#6C757D]/10">
          <div className="flex justify-between text-[9px] font-semibold text-rose-500">
            <span className="flex items-center gap-1 animate-pulse">
              <Loader2 size={8} className="animate-spin" />
              Sincronizando Heygen...
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
      )} */}

      {avatarVideo && (
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-105 dark:border-[#6C757D]/10 text-[10px]">
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
            <ExternalLink size={10} /> Ver Avatar
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
        accept="video/mp4"
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

      <div className="relative w-full max-w-3xl max-h-[85vh] overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-[#6C757D]/20 dark:bg-[#151A21] flex flex-col shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-[#6C757D]/10 px-6 py-4">
          <div className="flex items-center gap-2">
            {type === "music" ? (
              <Music className="text-indigo-500 animate-pulse" size={20} />
            ) : (
              <FileVideo className="text-[#00D4B3] animate-pulse" size={20} />
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
                className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-gray-305 bg-white text-gray-900 placeholder-gray-400 focus:border-[#1F5AF6] focus:outline-none dark:border-[#6C757D]/20 dark:bg-[#0F1419] dark:text-white"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching}
              className="px-4 py-2 text-xs font-bold text-white bg-[#1F5AF6] hover:bg-[#1A4ED4] rounded-lg transition-colors flex items-center gap-1"
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
                <Loader2 className="animate-spin text-[#1F5AF6]" size={32} />
                <p className="text-xs">Consultando catálogo de Artlist...</p>
              </div>
            ) : results.length === 0 ? (
              <div className="text-center py-12 text-xs text-gray-500 dark:text-gray-405 border border-dashed border-gray-200 dark:border-[#6C757D]/15 rounded-xl">
                Haz una búsqueda o haz clic en las sugerencias para cargar el catálogo.
              </div>
            ) : type === "music" ? (
              // Music List
              <div className="space-y-2">
                {results.map((track) => (
                  <div
                    key={track.id}
                    className="flex items-center justify-between p-3 rounded-xl border border-gray-100 dark:border-[#6C757D]/10 bg-gray-50/50 dark:bg-[#0F1419]/30 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handlePlayToggle(track.id, track.public_url)}
                        className="p-2 rounded-full bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/20 text-gray-650 dark:text-gray-300 hover:text-[#1F5AF6] dark:hover:text-[#38BDF8] hover:border-[#1F5AF6]/30 transition-all flex items-center justify-center shadow-sm"
                      >
                        {playingTrackId === track.id ? (
                          <Pause size={14} className="fill-current text-[#1F5AF6]" />
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
                      className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-gray-200 dark:border-[#6C757D]/20 hover:bg-white dark:hover:bg-white/5 text-gray-750 dark:text-gray-300 transition-colors flex items-center gap-1.5 disabled:opacity-50"
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
                    className="group flex flex-col rounded-xl border border-gray-105 dark:border-[#6C757D]/10 bg-gray-50/50 dark:bg-[#0F1419]/30 overflow-hidden"
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
        <div className="bg-gray-50 dark:bg-[#151A21] px-6 py-3 border-t border-gray-100 dark:border-[#6C757D]/10 flex justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-xs font-bold rounded-lg border border-gray-300 dark:border-[#6C757D]/20 text-gray-750 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
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
  const driveTokenCacheKey = "courseforge.googleDrive.readonlyToken";

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
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-[#6C757D]/20 dark:bg-[#151A21] flex flex-col shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-[#6C757D]/10 px-6 py-4">
          <div className="flex items-center gap-2">
            <HardDrive className="text-blue-500 animate-pulse" size={20} />
            <div>
              <h3 className="text-sm font-bold text-gray-950 dark:text-white">
                Importar recurso desde cloud
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Usa la cuenta vinculada para copiar assets hacia CourseGen
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
        <div className="bg-gray-50 dark:bg-[#151A21] px-6 py-3 border-t border-gray-100 dark:border-[#6C757D]/10 flex justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-xs font-bold rounded-lg border border-gray-305 dark:border-[#6C757D]/20 text-gray-750 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
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
        <Loader2 className="mb-3 animate-spin text-[#1F5AF6]" size={28} />
        <p className="text-xs">Revisando cuentas vinculadas...</p>
      </div>
    );
  }

  if (connectedProviders.length === 0) {
    return (
      <div className="space-y-4 rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-5 text-center dark:border-[#6C757D]/20 dark:bg-[#0F1419]/30">
        <HardDrive size={32} className="mx-auto text-gray-400" />
        <div>
          <p className="text-sm font-bold text-gray-900 dark:text-white">No hay cuentas cloud vinculadas</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Vincula Google Drive u OneDrive para importar assets directamente a CourseGen.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <CloudStorageConnectButton provider="google_drive" className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
            Vincular Google Drive
          </CloudStorageConnectButton>
          <CloudStorageConnectButton provider="onedrive" className="rounded-lg border border-[#00D4B3]/30 bg-[#00D4B3]/10 px-3 py-2 text-xs font-bold text-[#008F7A] hover:bg-[#00D4B3]/15 dark:text-[#00D4B3]">
            Vincular OneDrive
          </CloudStorageConnectButton>
          <button
            type="button"
            onClick={onConnectRefresh}
            className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-600 hover:bg-white dark:border-[#6C757D]/20 dark:text-gray-300 dark:hover:bg-white/5"
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
                    ? "border-[#1F5AF6] bg-blue-50 text-[#1F5AF6] dark:bg-blue-500/10"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-[#6C757D]/20 dark:text-gray-300 dark:hover:bg-white/5"
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
              className="w-full rounded-lg border border-gray-305 bg-white py-2 pl-9 pr-4 text-xs text-gray-900 placeholder-gray-400 focus:border-[#1F5AF6] focus:outline-none dark:border-[#6C757D]/20 dark:bg-[#0F1419] dark:text-white"
            />
          </div>
          <button
            type="submit"
            disabled={!selectedProvider || isSearching}
            className="flex items-center gap-1 rounded-lg bg-[#1F5AF6] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#1A4ED4] disabled:opacity-50"
          >
            {isSearching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
            Buscar
          </button>
        </form>
      </div>

      <div className="space-y-2">
        {isSearching ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 py-10 text-gray-500 dark:border-[#6C757D]/15 dark:text-gray-400">
            <Loader2 className="mb-3 animate-spin text-[#1F5AF6]" size={28} />
            <p className="text-xs">Consultando {selectedProviderLabel}...</p>
          </div>
        ) : results.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 py-8 text-center text-xs text-gray-500 dark:border-[#6C757D]/15 dark:text-gray-400">
            Busca archivos para importar desde {selectedProviderLabel}.
          </div>
        ) : (
          <div className="space-y-2">
            {results.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/50 p-3 text-xs dark:border-[#6C757D]/10 dark:bg-[#0F1419]/30"
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
                  className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-bold text-gray-700 transition-colors hover:bg-white disabled:opacity-50 dark:border-[#6C757D]/20 dark:text-gray-300 dark:hover:bg-white/5"
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
            className="flex-1 rounded-lg border border-gray-305 bg-white p-2 text-xs text-gray-900 placeholder-gray-400 focus:border-[#1F5AF6] focus:outline-none dark:border-[#6C757D]/20 dark:bg-[#0F1419] dark:text-white"
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
            <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-4 dark:border-[#6C757D]/20 dark:bg-[#0F1419]/10">
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
