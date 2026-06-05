import { useState, useRef, useEffect } from "react";
import {
  Volume2,
  VolumeX,
  Music,
  Mic,
  FileVideo,
  Video,
  Upload,
  Trash2,
  Wand2,
  Sparkles,
  Link,
  CheckCircle2,
  Loader2,
  Copy,
  ExternalLink,
  Search,
  X,
  Play,
  Pause,
  Download,
  HardDrive,
} from "lucide-react";
import type {
  VoiceAudio,
  BackgroundMusic,
  BRollClip,
  AvatarVideo,
  SlidesAsset,
} from "../validators/assets.validators";
import type { DriveFile } from "@/domains/production/providers/google-drive.service";
import { PRODUCTION_THEME } from "./production-asset-ui";


// ---------------------------------------------------------
// 1. VOICE AUDIO SECTION
// ---------------------------------------------------------
interface VoiceAudioSectionProps {
  voiceAudio: VoiceAudio | null;
  isUploading: boolean;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  
  // Drive props
  isSearchingDrive: boolean;
  isImportingDrive: boolean;
  driveSearchResults: any[];
  searchDrive: (query: string) => Promise<void>;
  importDriveAsset: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides") => Promise<boolean>;
  clearDriveSearchResults: () => void;
}

export function VoiceAudioSection({
  voiceAudio,
  isUploading,
  fileRef,
  onUpload,
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
  importDriveAsset: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides") => Promise<boolean>;
  clearDriveSearchResults: () => void;
}

export function BackgroundMusicSection({
  backgroundMusic,
  isUploading,
  fileRef,
  onUpload,
  onVolumeChange,
  isSearchingArtlist,
  isImportingArtlist,
  artlistSearchResults,
  searchArtlist,
  importArtlistAsset,
  clearArtlistSearchResults,
  isSearchingDrive,
  isImportingDrive,
  driveSearchResults,
  searchDrive,
  importDriveAsset,
  clearDriveSearchResults,
}: BackgroundMusicSectionProps) {
  const [vol, setVol] = useState(backgroundMusic?.volume_multiplier ?? 0.15);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);

  const handleVolSlide = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    setVol(v);
    onVolumeChange(v);
  };

  const musicSuggestions = ["Acoustic", "Synthwave", "Cinematic", "Lo-Fi", "Corporate"];

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
              <button
                onClick={() => setIsModalOpen(true)}
                className="px-2 py-1 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 text-[10px] font-bold hover:bg-indigo-100 transition-colors"
              >
                Artlist
              </button>
              <button
                onClick={() => setIsDriveModalOpen(true)}
                className="px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 text-[10px] font-bold hover:bg-blue-100 transition-colors"
              >
                Drive
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
              <button
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100/70 text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300 text-[10px] font-bold transition-all cursor-pointer"
              >
                <Music size={10} />
                <span>Artlist</span>
              </button>
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

      <ArtlistSearchModal
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
      />

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
  
  // Drive props
  isSearchingDrive: boolean;
  isImportingDrive: boolean;
  driveSearchResults: any[];
  searchDrive: (query: string) => Promise<void>;
  importDriveAsset: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides") => Promise<boolean>;
  clearDriveSearchResults: () => void;
}export function OpenDesignSlidesSection({
  slides,
  isExporting,
  isUploading,
  fileRef,
  onExport,
  onUpload,
  isSearchingDrive,
  isImportingDrive,
  driveSearchResults,
  searchDrive,
  importDriveAsset,
  clearDriveSearchResults,
}: OpenDesignSlidesSectionProps) {
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);

  return (
    <div className="p-3 rounded-xl border border-gray-200 dark:border-[#6C757D]/10 bg-gray-50/50 dark:bg-[#0F1419]/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wand2 size={14} className="text-purple-500" />
          <span className="text-xs font-bold text-gray-700 dark:text-gray-300">Diapositivas (Open Design)</span>
          {slides?.html_public_url && (
            <span className="flex items-center gap-0.5 text-[10px] font-semibold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/10 px-1.5 py-0.5 rounded-full">
              <CheckCircle2 size={10} /> Compilado
            </span>
          )}
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
            <span>Subir ZIP</span>
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

      {(slides?.open_design_project_id || slides?.html_public_url) && (
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-[#6C757D]/10 text-[10px]">
          {slides?.open_design_project_id && (
            <span className="font-mono text-gray-450 dark:text-gray-400 bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 rounded">
              ID: {slides.open_design_project_id}
            </span>
          )}
          {slides?.html_public_url && (
            <a
              href={slides.html_public_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-purple-600 hover:text-purple-550 dark:text-purple-400 dark:hover:text-purple-300 font-bold"
            >
              <ExternalLink size={10} /> Ver Slides HTML
            </a>
          )}
        </div>
      )}

      <input
        type="file"
        ref={fileRef}
        onChange={onUpload}
        className="hidden"
        accept=".zip,text/html"
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
  importDriveAsset: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides") => Promise<boolean>;
  clearDriveSearchResults: () => void;
}

export function BRollClipsSection({
  clips,
  isUploading,
  fileRef,
  onUpload,
  onDelete,
  isSearchingArtlist,
  isImportingArtlist,
  artlistSearchResults,
  searchArtlist,
  importArtlistAsset,
  clearArtlistSearchResults,
  bRollPrompts,
  isSearchingDrive,
  isImportingDrive,
  driveSearchResults,
  searchDrive,
  importDriveAsset,
  clearDriveSearchResults,
}: BRollClipsSectionProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);
  const videoSuggestions = parseBrollSuggestions(bRollPrompts);

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
          
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1 rounded-lg border border-[#00D4B3]/30 bg-[#00D4B3]/5 px-2.5 py-1.5 text-[10px] font-bold text-[#00D4B3] hover:bg-[#00D4B3]/10 transition-all cursor-pointer"
          >
            <Search size={10} />
            <span>Artlist</span>
          </button>

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

      <ArtlistSearchModal
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
      />

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
  
  // Drive props
  isSearchingDrive: boolean;
  isImportingDrive: boolean;
  driveSearchResults: any[];
  searchDrive: (query: string) => Promise<void>;
  importDriveAsset: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides") => Promise<boolean>;
  clearDriveSearchResults: () => void;
}export function AvatarVideoSection({
  avatarVideo,
  isUploading,
  isSyncing,
  syncProgress,
  syncError,
  fileRef,
  onUpload,
  onHeygenSync,
  isSearchingDrive,
  isImportingDrive,
  driveSearchResults,
  searchDrive,
  importDriveAsset,
  clearDriveSearchResults,
}: AvatarVideoSectionProps) {
  const [heygenId, setHeygenId] = useState("");
  const [isDriveModalOpen, setIsDriveModalOpen] = useState(false);

  const handleSyncSubmit = () => {
    if (!heygenId) return;
    onHeygenSync(heygenId);
  };

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

      {!avatarVideo && !isSyncing && (
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
          ✗ Error: {syncError}
        </p>
      )}

      {avatarVideo && (
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-100 dark:border-[#6C757D]/10 text-[10px]">
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
// HELPER: PARSE B-ROLL CLIP SUGGESTIONS
// ---------------------------------------------------------
function parseBrollSuggestions(bRollPrompts: string | undefined): string[] {
  if (!bRollPrompts) return ["workspace", "coding", "meeting", "ai", "design"];
  try {
    const parsed = JSON.parse(bRollPrompts);
    const promptsList = parsed?.prompts || (Array.isArray(parsed) ? parsed : null);
    if (Array.isArray(promptsList)) {
      const allPrompts = promptsList
        .map((p: any) => p.generated_prompt || p.prompt || p)
        .filter(Boolean);
      
      const words = new Set<string>();
      allPrompts.forEach((p: string) => {
        const parts = p.split(/[,.]/);
        parts.forEach((part: string) => {
          const clean = part.replace(/cinematic|shot|4k|high quality|bokeh/gi, "").trim();
          if (clean.length > 3 && clean.length < 25) {
            words.add(clean.toLowerCase());
          }
        });
      });
      const list = Array.from(words);
      return list.length > 0 ? list.slice(0, 6) : ["workspace", "coding", "meeting", "ai", "design"];
    }
  } catch (e) {
    const lines = bRollPrompts
      .split(/[\n,;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3 && s.length < 30);
    if (lines.length > 0) return lines.slice(0, 6);
  }
  return ["workspace", "coding", "meeting", "ai", "design"];
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
                        <p className="text-[10px] text-gray-550">{track.artist} • {track.genre} • {track.mood}</p>
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
  results: DriveFile[];
  onSearch: (query: string) => Promise<void>;
  onImport: (urlOrId: string, type: "voice" | "music" | "broll" | "avatar" | "slides") => Promise<boolean>;
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
  const [searchQuery, setSearchQuery] = useState("");

  const handleLinkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkUrl.trim()) return;
    const success = await onImport(linkUrl.trim(), type);
    if (success) {
      setLinkUrl("");
      onClose();
    }
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    onSearch(searchQuery);
  };

  const handleFileClick = async (fileId: string) => {
    const success = await onImport(fileId, type);
    if (success) {
      onClose();
    }
  };

  const handleClose = () => {
    onClearResults();
    setLinkUrl("");
    setSearchQuery("");
    onClose();
  };

  // Pre-load file list on mount or open
  useEffect(() => {
    if (isOpen) {
      onSearch("");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const getAssetIcon = (mime: string) => {
    if (mime.includes("audio")) return <Mic className="text-blue-500" size={16} />;
    if (mime.includes("video")) return <FileVideo className="text-[#00D4B3]" size={16} />;
    if (mime.includes("zip") || mime.includes("html")) return <Wand2 className="text-purple-500" size={16} />;
    return <HardDrive className="text-gray-400" size={16} />;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-[#6C757D]/20 dark:bg-[#151A21] flex flex-col shadow-2xl animate-in fade-in-50 zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-[#6C757D]/10 px-6 py-4">
          <div className="flex items-center gap-2">
            <HardDrive className="text-blue-500 animate-pulse" size={20} />
            <div>
              <h3 className="text-sm font-bold text-gray-950 dark:text-white">
                Google Drive - Importar Recurso
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                Pega un enlace privado/compartido o navega por tus archivos
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
        <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          
          {/* Option A: Paste URL */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
              Opción A: Pegar Enlace de Google Drive
            </label>
            <form onSubmit={handleLinkSubmit} className="flex gap-2">
              <input
                type="text"
                placeholder="https://drive.google.com/file/d/... o enlace directo"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                disabled={isImporting}
                className="flex-1 p-2 text-xs rounded-lg border border-gray-305 bg-white text-gray-900 placeholder-gray-400 focus:border-[#1F5AF6] focus:outline-none dark:border-[#6C757D]/20 dark:bg-[#0F1419] dark:text-white"
              />
              <button
                type="submit"
                disabled={isImporting || !linkUrl.trim()}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-550 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {isImporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                Importar Enlace
              </button>
            </form>
          </div>

          <div className="relative flex items-center justify-center py-1">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-100 dark:border-[#6C757D]/10"></div>
            </div>
            <span className="relative px-3 bg-white dark:bg-[#151A21] text-[10px] font-bold text-gray-400 uppercase">
              O
            </span>
          </div>

          {/* Option B: Search in Account Drive files */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                Opción B: Seleccionar de la Unidad de Drive
              </label>
              
              {/* Mini Search input */}
              <form onSubmit={handleSearchSubmit} className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="Buscar archivos..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-2.5 py-1 text-[11px] rounded-lg border border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:outline-none dark:border-[#6C757D]/20 dark:bg-[#0F1419] dark:text-white"
                />
                <button
                  type="submit"
                  disabled={isSearching}
                  className="px-2.5 py-1 text-[10px] font-bold text-white bg-gray-800 hover:bg-gray-750 dark:bg-white/5 dark:hover:bg-white/10 border border-gray-300 dark:border-[#6C757D]/10 rounded-lg transition-colors"
                >
                  {isSearching ? <Loader2 size={10} className="animate-spin" /> : "Buscar"}
                </button>
              </form>
            </div>

            {/* List results */}
            <div className="border border-gray-100 dark:border-[#6C757D]/10 rounded-xl overflow-hidden bg-gray-50/30 dark:bg-[#0F1419]/20">
              {isSearching ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500 space-y-2">
                  <Loader2 className="animate-spin text-blue-500" size={24} />
                  <p className="text-xs">Buscando archivos en tu unidad...</p>
                </div>
              ) : results.length === 0 ? (
                <div className="text-center py-12 text-xs text-gray-400">
                  No se encontraron archivos en tu unidad de Drive.
                </div>
              ) : (
                <div className="max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-[#6C757D]/10 custom-scrollbar">
                  {results.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors text-xs text-left"
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        {getAssetIcon(file.mimeType)}
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-gray-900 dark:text-white truncate" title={file.name}>
                            {file.name}
                          </p>
                          <p className="text-[10px] text-gray-400">
                            {file.mimeType.split("/").pop()} • {file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "Unidad"}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => handleFileClick(file.id)}
                        disabled={isImporting}
                        className="ml-3 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-500/10 dark:hover:bg-blue-500/20 dark:text-blue-300 transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        {isImporting ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                        Seleccionar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-gray-50 dark:bg-[#151A21] px-6 py-3 border-t border-gray-100 dark:border-[#6C757D]/10 flex justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-xs font-bold rounded-lg border border-gray-300 dark:border-[#6C757D]/20 text-gray-750 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

