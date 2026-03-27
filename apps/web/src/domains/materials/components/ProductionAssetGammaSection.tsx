"use client";

import { Copy, ExternalLink, FileText, Maximize2, Wand2, X } from "lucide-react";
import type { MaterialComponent } from "../types/materials.types";
import { formatGammaContent } from "../lib/production-formatters";

interface ProductionAssetGammaSectionProps {
  component: MaterialComponent;
  copyFeedback: string | null;
  copyToClipboard: (text: string, label?: string) => void;
  gammaEmbedUrl: string | null;
  onOpenInGamma: () => void;
  onOpenPreview: () => void;
  onSlidesUrlChange: (value: string) => void;
  slidesUrl: string;
}

export function ProductionAssetGammaSection({
  component,
  copyFeedback,
  copyToClipboard,
  gammaEmbedUrl,
  onOpenInGamma,
  onOpenPreview,
  onSlidesUrlChange,
  slidesUrl,
}: ProductionAssetGammaSectionProps) {
  const rawContent = component.content as Record<string, unknown>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 text-xs font-bold text-[#E9ECEF]">
          <FileText size={14} /> GAMMA SLIDES
          {copyFeedback && (
            <span className="ml-auto animate-pulse text-xs font-normal text-green-400">
              ✓ {copyFeedback}
            </span>
          )}
        </h4>
        {component.assets?.gamma_deck_id && (
          <div
            onClick={() =>
              copyToClipboard(component.assets?.gamma_deck_id || "", "ID Copiado")
            }
            className="flex cursor-pointer items-center gap-1 rounded border border-[#1F5AF6]/20 bg-[#1F5AF6]/10 px-2 py-0.5 text-[10px] font-mono text-[#1F5AF6] transition-colors hover:bg-[#1F5AF6]/20"
            title="Click para copiar ID compuesto"
          >
            #{component.assets.gamma_deck_id}
          </div>
        )}
      </div>

      {gammaEmbedUrl ? (
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg border border-[#6C757D]/20 bg-[#0F1419]">
            <iframe
              src={gammaEmbedUrl || undefined}
              className="h-48 w-full border-0"
              allow="fullscreen"
              title="Gamma Presentation Preview"
            />
            <div className="absolute right-2 top-2 flex gap-1">
              <button
                type="button"
                onClick={onOpenPreview}
                className="rounded-lg bg-black/60 p-1.5 text-white transition-colors hover:bg-black/80"
                title="Ver en pantalla completa"
              >
                <Maximize2 size={14} />
              </button>
              <a
                href={slidesUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-black/60 p-1.5 text-white transition-colors hover:bg-black/80"
                title="Abrir en Gamma"
              >
                <ExternalLink size={14} />
              </a>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="URL del deck de Gamma..."
              value={slidesUrl}
              onChange={(event) => onSlidesUrlChange(event.target.value)}
              className="flex-1 rounded-lg border border-[#6C757D]/20 bg-[#0F1419] p-2 text-xs text-white focus:border-[#1F5AF6] focus:outline-none"
            />
            <button
              type="button"
              onClick={onOpenInGamma}
              className="flex items-center gap-1 rounded-lg border border-purple-500/30 bg-purple-500/20 px-3 text-xs text-purple-400 transition-colors hover:bg-purple-500/30"
              title="Crear nueva presentacion en Gamma"
            >
              <Wand2 size={12} /> Nueva
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            type="button"
            onClick={onOpenInGamma}
            className="group flex w-full items-center justify-center gap-2 rounded-lg border border-purple-500/30 bg-gradient-to-r from-purple-500/20 to-blue-500/20 py-3 text-white transition-all hover:from-purple-500/30 hover:to-blue-500/30"
          >
            <Wand2 size={16} className="text-purple-400 group-hover:animate-pulse" />
            <span className="font-bold">Crear en Gamma</span>
            <span className="text-xs text-gray-400">(copia y abre)</span>
          </button>

          <div className="space-y-2">
            <p className="text-[10px] text-[#6C757D]">Copiar estructura para Gamma:</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  copyToClipboard(
                    formatGammaContent(rawContent),
                    "Estructura copiada",
                  )
                }
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-[#1F5AF6]/20 bg-[#1F5AF6]/10 py-2 text-xs text-[#1F5AF6] transition-colors hover:bg-[#1F5AF6]/20"
                title="Copia el guion estructurado para generar slides de texto en Gamma"
              >
                <Copy size={12} /> Copiar Estructura Gamma
              </button>
            </div>
            <button
              type="button"
              onClick={() =>
                copyToClipboard(
                  JSON.stringify(rawContent.storyboard || rawContent.script, null, 2),
                  "JSON copiado",
                )
              }
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#6C757D]/20 bg-[#2D333B] py-1.5 text-xs text-[#6C757D] transition-colors hover:bg-[#373E47]"
              title="Copiar datos raw como JSON"
            >
              <Copy size={10} /> JSON Raw
            </button>
          </div>

          <input
            type="text"
            placeholder="Pega aqui la URL del deck de Gamma..."
            value={slidesUrl}
            onChange={(event) => onSlidesUrlChange(event.target.value)}
            className="w-full rounded-lg border border-[#6C757D]/20 bg-[#0F1419] p-2.5 text-xs text-white placeholder-gray-500 focus:border-[#1F5AF6] focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}

interface ProductionAssetPreviewModalProps {
  gammaEmbedUrl: string | null;
  onClose: () => void;
  slidesUrl: string;
}

export function ProductionAssetPreviewModal({
  gammaEmbedUrl,
  onClose,
  slidesUrl,
}: ProductionAssetPreviewModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
    >
      <div
        className="relative h-[80vh] w-full max-w-6xl overflow-hidden rounded-2xl border border-[#6C757D]/20 bg-[#151A21]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="absolute left-0 right-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent p-4">
          <div className="flex items-center gap-3">
            <FileText size={20} className="text-purple-400" />
            <span className="font-bold text-white">Vista Previa - Gamma Slides</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={slidesUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white transition-colors hover:bg-white/20"
            >
              <ExternalLink size={14} /> Abrir en Gamma
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-white transition-colors hover:bg-white/10"
              title="Cerrar"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <iframe
          src={gammaEmbedUrl || undefined}
          className="h-full w-full border-0"
          allow="fullscreen"
          title="Gamma Presentation"
        />
      </div>
    </div>
  );
}
