"use client";

import type { ChangeEvent, RefObject } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  MonitorPlay,
  Play,
  Sparkles,
  Upload,
  X,
} from "lucide-react";

interface ProductionAssetPromptsSectionProps {
  bRollPrompts: string;
  copyToClipboard: (text: string, label?: string) => void;
  isGenerating: boolean;
  onGeneratePrompts: () => Promise<void> | void;
  onPromptsChange: (value: string) => void;
}

export function ProductionAssetPromptsSection({
  bRollPrompts,
  copyToClipboard,
  isGenerating,
  onGeneratePrompts,
  onPromptsChange,
}: ProductionAssetPromptsSectionProps) {
  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-xs font-bold text-[#E9ECEF]">
        <Sparkles size={14} className="text-purple-400" /> AI B-ROLL PROMPTS
      </h4>

      {bRollPrompts ? (
        <div className="space-y-2">
          <textarea
            value={bRollPrompts}
            onChange={(event) => onPromptsChange(event.target.value)}
            className="custom-scrollbar h-32 w-full resize-none rounded-lg border border-[#6C757D]/20 bg-[#0F1419] p-3 text-xs text-white focus:border-[#1F5AF6] focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => copyToClipboard(bRollPrompts)}
              className="flex items-center gap-1 text-xs text-[#6C757D] hover:text-white"
            >
              <Copy size={12} /> Copiar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onGeneratePrompts}
            disabled={isGenerating}
            className={`flex w-full items-center justify-center gap-2 rounded-lg border py-3 text-xs font-bold transition-all ${
              isGenerating
                ? "cursor-not-allowed border-purple-500/10 bg-purple-500/5 text-purple-400/50"
                : "border-purple-500/20 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20"
            }`}
          >
            {isGenerating ? (
              <Loader2 className="animate-spin" size={14} />
            ) : (
              <Sparkles size={14} />
            )}
            {isGenerating ? "Generando Prompts..." : "Generar Prompts con Gemini"}
          </button>
          {isGenerating && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-blue-500/10 bg-blue-500/5 p-2 animate-pulse">
              <span className="text-[10px] text-blue-400">
                Analizando storyboard y generando prompts tecnicos...
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ProductionAssetFinalVideoSectionProps {
  fileRef: RefObject<HTMLInputElement | null>;
  finalVideoSource: "upload" | "link" | null;
  finalVideoUrl: string;
  isSaving: boolean;
  isUploading: boolean;
  isValidUrl: (url: string) => boolean;
  onClearVideo: () => void;
  onTriggerFilePicker: () => void;
  onUploadVideo: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onVideoUrlChange: (value: string) => void;
  urlError: string | null;
}

export function ProductionAssetFinalVideoSection({
  fileRef,
  finalVideoSource,
  finalVideoUrl,
  isSaving,
  isUploading,
  isValidUrl,
  onClearVideo,
  onTriggerFilePicker,
  onUploadVideo,
  onVideoUrlChange,
  urlError,
}: ProductionAssetFinalVideoSectionProps) {
  return (
    <div className="mt-4 space-y-3 border-t border-[#6C757D]/20 pt-4">
      <h4 className="flex items-center gap-2 text-xs font-bold text-[#E9ECEF]">
        <Play size={14} className="text-green-400" /> VIDEO FINAL (Post-Produccion)
        {finalVideoUrl && (
          <span className="ml-auto flex items-center gap-1 text-xs text-green-400">
            <CheckCircle2 size={12} /> Completado
            {finalVideoSource === "upload" && " (subido)"}
            {finalVideoSource === "link" && " (enlace)"}
          </span>
        )}
      </h4>

      {!finalVideoUrl && (
        <p className="text-[10px] text-[#6C757D]">
          Pega un enlace o sube un archivo de video. Solo se permite una opcion.
        </p>
      )}

      <div className="relative">
        <input
          type="text"
          placeholder="https://... URL del video final"
          value={finalVideoUrl}
          onChange={(event) => onVideoUrlChange(event.target.value)}
          disabled={finalVideoSource === "upload"}
          className={`w-full rounded-lg border p-2.5 pr-24 text-xs text-white transition-colors focus:outline-none ${
            urlError
              ? "border-red-500/50 bg-[#0F1419] focus:border-red-500"
              : finalVideoUrl
                ? "border-green-500/30 bg-[#0F1419] focus:border-green-500"
                : "border-[#6C757D]/20 bg-[#0F1419] focus:border-[#1F5AF6]"
          } ${finalVideoSource === "upload" ? "cursor-not-allowed opacity-70" : ""}`}
        />

        {finalVideoUrl && (
          <button
            type="button"
            onClick={onClearVideo}
            className="absolute bottom-1 right-20 top-1 flex items-center rounded-md px-2 text-[#6C757D] transition-colors hover:text-red-400"
            title="Limpiar URL"
          >
            <X size={14} />
          </button>
        )}

        <input
          type="file"
          ref={fileRef}
          onChange={onUploadVideo}
          className="hidden"
          accept="video/mp4,video/webm,video/ogg,video/quicktime"
        />
        <button
          type="button"
          onClick={onTriggerFilePicker}
          disabled={
            isUploading || isSaving || (finalVideoSource === "link" && !!finalVideoUrl)
          }
          className={`absolute bottom-1 right-1 top-1 flex items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors ${
            finalVideoSource === "link" && finalVideoUrl
              ? "cursor-not-allowed bg-[#6C757D]/10 text-[#6C757D]/50"
              : "bg-[#1F5AF6]/10 text-[#1F5AF6] disabled:opacity-50 hover:bg-[#1F5AF6]/20"
          }`}
          title={
            finalVideoSource === "link" && finalVideoUrl
              ? "Limpia el enlace primero para subir"
              : "Subir video local"
          }
        >
          {isUploading ? <Loader2 className="animate-spin" size={14} /> : <Upload size={14} />}
          <span className="hidden sm:inline">{isUploading ? "..." : "Subir"}</span>
        </button>
      </div>

      {urlError && (
        <p className="flex items-center gap-1 text-[10px] text-red-400">
          <AlertTriangle size={10} /> {urlError}
        </p>
      )}

      {isUploading && (
        <p className="animate-pulse text-[10px] text-[#1F5AF6]">
          Subiendo video... Por favor no cierres esta pagina.
        </p>
      )}

      {finalVideoUrl && isValidUrl(finalVideoUrl) && (
        <a
          href={finalVideoUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-xs text-green-400 hover:text-green-300"
        >
          <ExternalLink size={12} /> Ver video final
        </a>
      )}
    </div>
  );
}

interface ProductionAssetScreencastSectionProps {
  onScreencastUrlChange: (value: string) => void;
  screencastUrl: string;
}

export function ProductionAssetScreencastSection({
  onScreencastUrlChange,
  screencastUrl,
}: ProductionAssetScreencastSectionProps) {
  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2 text-xs font-bold text-[#E9ECEF]">
        <MonitorPlay size={14} /> SCREENCAST
      </h4>
      <input
        type="text"
        placeholder="Paste Screencast URL here..."
        value={screencastUrl}
        onChange={(event) => onScreencastUrlChange(event.target.value)}
        className="w-full rounded-lg border border-[#6C757D]/20 bg-[#0F1419] p-2.5 text-xs text-white focus:border-[#1F5AF6] focus:outline-none"
      />
    </div>
  );
}
