"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, ImageIcon, Loader2, Play } from "lucide-react";
import {
  getExternalBundlePreviewDataAction,
  type ExternalBundlePreviewData,
} from "@/domains/production/actions/templates.actions";

interface RemotionExternalPreviewPlayerProps {
  templateId: string;
  componentId?: string | null;
  initialPreviewData?: ExternalBundlePreviewData | null;
  variables?: Record<string, unknown>;
}

function isBrowserReachableUrl(value: string | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function buildPreviewIframeUrl(previewData: ExternalBundlePreviewData | null): string | null {
  if (!previewData || !isBrowserReachableUrl(previewData.serveUrl)) {
    return null;
  }

  const url = new URL(previewData.serveUrl);
  if (previewData.compositionId) {
    url.searchParams.set("compositionId", previewData.compositionId);
  }
  if (previewData.propsHash) {
    url.searchParams.set("propsHash", previewData.propsHash);
  }
  return url.toString();
}

function formatHash(value: string | null | undefined): string {
  if (!value) return "pendiente";
  return value.length > 16 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function formatSeconds(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "0s";
  if (value < 60) return `${Math.round(value)}s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatPreviewError(value: unknown): string {
  if (!value) return "No se pudo cargar el preview externo.";

  if (value instanceof Error) {
    return value.message || "No se pudo cargar el preview externo.";
  }

  if (typeof value === "string") {
    return value || "No se pudo cargar el preview externo.";
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const message = record.message || record.error || record.detail || record.details;

    if (typeof message === "string" && message.trim()) {
      return message;
    }

    if (message && typeof message === "object") {
      return formatPreviewError(message);
    }

    try {
      return JSON.stringify(value);
    } catch {
      return "No se pudo cargar el preview externo.";
    }
  }

  return String(value) || "No se pudo cargar el preview externo.";
}

function serializePreviewVariables(variables: Record<string, unknown>): string {
  try {
    return JSON.stringify(variables ?? {});
  } catch {
    return "{}";
  }
}

function parsePreviewVariables(variablesKey: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(variablesKey);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function RemotionExternalPreviewPlayer({
  templateId,
  componentId,
  initialPreviewData = null,
  variables = {},
}: RemotionExternalPreviewPlayerProps) {
  const [previewData, setPreviewData] = useState<ExternalBundlePreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [videoStatus, setVideoStatus] = useState<"idle" | "loading" | "ready" | "playing" | "error">("idle");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [hasVideoStarted, setHasVideoStarted] = useState(false);

  const variablesKey = useMemo(() => serializePreviewVariables(variables), [variables]);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      setIsLoading(true);
      setError(null);
      setVideoError(null);
      setVideoStatus("idle");
      setHasVideoStarted(false);

      if (initialPreviewData?.serveUrl && initialPreviewData.compositionId) {
        setPreviewData(initialPreviewData);
        setIsLoading(false);
        return;
      }

      const requestVariables = parsePreviewVariables(variablesKey);
      console.info("[RemotionExternalPreviewPlayer] Solicitando preview externo", {
        templateId,
        componentId: componentId || null,
        variablesKey,
      });

      try {
        const result = await getExternalBundlePreviewDataAction({
          templateId,
          componentId,
          variables: requestVariables,
        });

        if (!result.success) {
          throw new Error(formatPreviewError(result.error));
        }

        if (!cancelled) {
          setPreviewData(result.data);
          setVideoStatus(result.data.previewVideoUrl ? "loading" : "idle");
          console.info("[RemotionExternalPreviewPlayer] Preview externo recibido", {
            templateId,
            componentId: componentId || null,
            hasVideo: Boolean(result.data.previewVideoUrl),
            hasPoster: Boolean(result.data.previewPosterUrl),
            buildId: result.data.buildId,
            propsHash: result.data.propsHash,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(formatPreviewError(err));
          setPreviewData(null);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadPreview();

    return () => {
      cancelled = true;
    };
  }, [templateId, componentId, initialPreviewData, variablesKey]);

  if (isLoading) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-xl bg-black/90">
        <Loader2 className="animate-spin text-purple-400" size={28} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex aspect-video min-w-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-amber-500/20 bg-amber-500/10 p-4 text-center">
        <AlertTriangle className="text-amber-500" size={24} />
        <p className="max-w-full break-words text-xs leading-relaxed text-amber-700 dark:text-amber-300">{error}</p>
      </div>
    );
  }

  const iframeUrl = buildPreviewIframeUrl(previewData);

  if (previewData?.previewVideoUrl) {
    const showPosterOverlay = Boolean(previewData.previewPosterUrl && !hasVideoStarted && videoStatus !== "error");
    const isTrimmedPreview = Boolean(
      previewData.previewDurationSeconds &&
      previewData.compositionDurationSeconds &&
      previewData.previewDurationSeconds < previewData.compositionDurationSeconds - 0.5,
    );

    return (
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black shadow-inner">
        <a
          href={previewData.previewVideoUrl}
          target="_blank"
          rel="noreferrer"
          title="Abrir preview renderizado"
          className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white shadow-sm transition hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-purple-400"
        >
          <ExternalLink size={14} />
        </a>
        {previewData.previewPosterUrl && (
          <a
            href={previewData.previewPosterUrl}
            target="_blank"
            rel="noreferrer"
            title="Abrir poster del preview"
            className="absolute right-12 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white shadow-sm transition hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-purple-400"
          >
            <ImageIcon size={14} />
          </a>
        )}
        <video
          key={previewData.previewVideoUrl}
          src={previewData.previewVideoUrl}
          poster={previewData.previewPosterUrl || undefined}
          className="h-full w-full bg-black object-contain"
          controls
          playsInline
          preload="auto"
          onLoadedData={() => {
            setVideoStatus("ready");
            console.info("[RemotionExternalPreviewPlayer] Video de preview cargo datos", {
              videoUrl: previewData.previewVideoUrl,
            });
          }}
          onCanPlay={() => {
            setVideoStatus((current) => current === "playing" ? "playing" : "ready");
          }}
          onPlay={() => {
            setHasVideoStarted(true);
            setVideoStatus("playing");
          }}
          onPause={() => setVideoStatus("ready")}
          onError={(event) => {
            const mediaError = event.currentTarget.error;
            const message = mediaError?.message || "El navegador no pudo reproducir el MP4 del preview.";
            setVideoStatus("error");
            setVideoError(message);
            console.warn("[RemotionExternalPreviewPlayer] Error reproduciendo video de preview", {
              message,
              code: mediaError?.code,
              videoUrl: previewData.previewVideoUrl,
              posterUrl: previewData.previewPosterUrl,
            });
          }}
        />
        {showPosterOverlay && (
          <div className="pointer-events-none absolute inset-x-0 top-0 bottom-12 flex items-center justify-center bg-black">
            <img
              src={previewData.previewPosterUrl || ""}
              alt="Poster del preview Remotion"
              className="h-full w-full object-contain"
              onLoad={() => {
                console.info("[RemotionExternalPreviewPlayer] Poster de preview cargado", {
                  posterUrl: previewData.previewPosterUrl,
                });
              }}
              onError={() => {
                console.warn("[RemotionExternalPreviewPlayer] No se pudo cargar el poster de preview", {
                  posterUrl: previewData.previewPosterUrl,
                });
              }}
            />
            {videoStatus === "loading" && (
              <div className="absolute bottom-3 left-3 rounded-full bg-black/70 px-3 py-1 text-[11px] font-medium text-white">
                Cargando video...
              </div>
            )}
          </div>
        )}
        {videoError && (
          <div className="absolute inset-x-3 bottom-3 z-10 rounded-lg border border-amber-500/30 bg-amber-500/95 p-3 text-xs leading-relaxed text-white shadow-lg">
            {videoError} Puedes abrir el MP4 o el poster con los botones superiores.
          </div>
        )}
        {isTrimmedPreview && !videoError && (
          <div className="pointer-events-none absolute inset-x-3 bottom-14 z-10 rounded-lg bg-black/70 px-3 py-2 text-[11px] leading-relaxed text-white">
            Preview recortado a {formatSeconds(previewData.previewDurationSeconds)} de una composicion de {formatSeconds(previewData.compositionDurationSeconds)}.
          </div>
        )}
      </div>
    );
  }

  if (iframeUrl) {
    return (
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black shadow-inner">
        <a
          href={iframeUrl}
          target="_blank"
          rel="noreferrer"
          title="Abrir preview externo"
          className="absolute right-2 top-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white shadow-sm transition hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-purple-400"
        >
          <ExternalLink size={14} />
        </a>
        <iframe
          src={iframeUrl}
          className="h-full w-full border-0"
          title="Preview externo Remotion"
          allow="autoplay; fullscreen"
        />
      </div>
    );
  }

  return (
    <div className="flex aspect-video min-w-0 flex-col justify-center gap-3 overflow-hidden rounded-xl border border-green-500/20 bg-green-500/10 p-4">
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-300">
        <CheckCircle2 size={18} className="shrink-0" />
        Bundle externo listo para preview
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-1.5 text-[11px] text-green-800/80 dark:text-green-200/80">
        <p className="min-w-0 truncate" title={previewData?.compositionId || undefined}>
          <span className="font-medium">Composition:</span> {previewData?.compositionId || "sin composition"}
        </p>
        <p>
          <span className="font-medium">Modo:</span> {previewData?.exportMode || "component"}
        </p>
        <p className="min-w-0 truncate" title={previewData?.propsHash || undefined}>
          <span className="font-medium">Props:</span> {formatHash(previewData?.propsHash)}
        </p>
        <p className="min-w-0 truncate" title={previewData?.buildHash || undefined}>
          <span className="font-medium">Build:</span> {formatHash(previewData?.buildHash)}
        </p>
      </div>
      <div className="flex min-w-0 items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
        <Play size={14} className="mt-0.5 shrink-0" />
        <span>
          El build esta listo, pero aun no hay una URL HTTP para reproducirlo en el navegador.
        </span>
      </div>
    </div>
  );
}
