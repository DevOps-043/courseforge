"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, ImageIcon, Loader2, Play, RefreshCw } from "lucide-react";
import type { ExternalBundlePreviewData } from "@/domains/production/actions/templates.actions";
import { useExternalTemplatePreview } from "@/domains/materials/hooks/useExternalTemplatePreview";

interface RemotionExternalPreviewPlayerProps {
  templateId: string;
  componentId?: string | null;
  initialPreviewData?: ExternalBundlePreviewData | null;
  variables?: Record<string, unknown>;
  overlay?: ReactNode;
  onPreviewDataChange?: (previewData: ExternalBundlePreviewData | null) => void;
  seekSeconds?: number | null;
  onPlaybackSecondsChange?: (seconds: number) => void;
}

function isBrowserReachableUrl(value: string | null | undefined): value is string {
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

export function RemotionExternalPreviewPlayer({
  templateId,
  componentId,
  initialPreviewData = null,
  variables = {},
  overlay,
  onPreviewDataChange,
  seekSeconds = null,
  onPlaybackSecondsChange,
}: RemotionExternalPreviewPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [videoStatus, setVideoStatus] = useState<"idle" | "loading" | "ready" | "playing" | "error">("idle");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [hasVideoStarted, setHasVideoStarted] = useState(false);
  const {
    error,
    isLoading,
    isRequestingPreview,
    previewData,
    reload,
    requestPreview,
    variablesKey,
  } = useExternalTemplatePreview({
    templateId,
    componentId,
    initialPreviewData,
    variables,
    onPreviewDataChange,
  });

  useEffect(() => {
    setVideoError(null);
    setVideoStatus(previewData?.previewVideoUrl ? "loading" : "idle");
    setHasVideoStarted(false);
  }, [previewData?.previewVideoUrl, variablesKey]);

  useEffect(() => {
    if (seekSeconds === null || seekSeconds === undefined) return;

    const video = videoRef.current;
    if (!video || !Number.isFinite(seekSeconds)) return;

    const boundedSeconds = Math.min(
      Math.max(0, seekSeconds),
      Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.05) : seekSeconds,
    );

    if (Math.abs(video.currentTime - boundedSeconds) > 0.05) {
      video.currentTime = boundedSeconds;
    }
  }, [seekSeconds]);

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
          ref={videoRef}
          key={previewData.previewVideoUrl}
          src={previewData.previewVideoUrl}
          poster={previewData.previewPosterUrl || undefined}
          className="h-full w-full bg-black object-contain"
          controls
          playsInline
          preload="auto"
          onLoadedData={() => {
            setVideoStatus("ready");
            console.info("[ExternalPreviewPlayer] Video de preview cargo datos", {
              videoUrl: previewData.previewVideoUrl,
            });
          }}
          onCanPlay={() => {
            setVideoStatus((current) => current === "playing" ? "playing" : "ready");
          }}
          onTimeUpdate={(event) => onPlaybackSecondsChange?.(event.currentTarget.currentTime)}
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
            console.warn("[ExternalPreviewPlayer] Error reproduciendo video de preview", {
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
              alt="Poster del preview"
              className="h-full w-full object-contain"
              onLoad={() => {
                console.info("[ExternalPreviewPlayer] Poster de preview cargado", {
                  posterUrl: previewData.previewPosterUrl,
                });
              }}
              onError={() => {
                console.warn("[ExternalPreviewPlayer] No se pudo cargar el poster de preview", {
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
        {overlay}
      </div>
    );
  }

  if (previewData?.previewPosterUrl) {
    const isStalePoster = previewData.previewStatus === "STALE";
    const isRefreshingPoster = previewData.previewStatus === "QUEUED" || previewData.previewStatus === "RUNNING";
    return (
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black shadow-inner">
        <a
          href={previewData.previewPosterUrl}
          target="_blank"
          rel="noreferrer"
          title="Abrir poster del preview"
          className="absolute right-2 top-2 z-20 inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-black/70 text-white shadow-sm transition hover:bg-black/90 focus:outline-none focus:ring-2 focus:ring-purple-400"
        >
          <ImageIcon size={14} />
        </a>
        <img
          src={previewData.previewPosterUrl}
          alt="Poster del preview"
          className="h-full w-full bg-black object-contain"
        />
        {(isStalePoster || isRefreshingPoster) && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex items-center gap-2 rounded-lg bg-black/75 px-3 py-2 text-[11px] font-medium leading-relaxed text-white">
            {isRefreshingPoster ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <RefreshCw size={13} className="shrink-0" />}
            <span>
              {isRefreshingPoster
                ? "Generando preview actualizado..."
                : "Mostrando el ultimo preview mientras se genera la version actualizada."}
            </span>
          </div>
        )}
        {overlay}
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
          title="Preview externo"
          allow="autoplay; fullscreen"
        />
        {overlay}
      </div>
    );
  }

  const statusLabel = previewData?.previewStatus === "QUEUED"
    ? "Preview en cola"
    : previewData?.previewStatus === "RUNNING"
      ? "Preview generandose"
      : previewData?.previewStatus === "FAILED"
        ? "Preview fallido"
        : previewData?.previewStatus === "STALE"
          ? "Preview desactualizado"
          : "Bundle externo listo para preview";

  return (
    <div className="flex aspect-video min-w-0 flex-col justify-center gap-3 overflow-hidden rounded-xl border border-green-500/20 bg-green-500/10 p-4">
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-300">
        {previewData?.previewStatus === "RUNNING" || previewData?.previewStatus === "QUEUED" ? (
          <Loader2 size={18} className="shrink-0 animate-spin" />
        ) : previewData?.previewStatus === "FAILED" ? (
          <AlertTriangle size={18} className="shrink-0" />
        ) : (
          <CheckCircle2 size={18} className="shrink-0" />
        )}
        {statusLabel}
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
          {previewData?.previewError ||
            "El build esta listo, pero aun no hay un poster o URL HTTP para editarlo visualmente en el navegador."}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={requestPreview}
          disabled={isRequestingPreview || previewData?.previewStatus === "QUEUED" || previewData?.previewStatus === "RUNNING"}
          className="inline-flex items-center gap-1.5 rounded-lg bg-green-700 px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-green-600 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {isRequestingPreview ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {previewData?.previewStatus === "STALE" ? "Actualizar preview" : "Generar preview"}
        </button>
        <button
          type="button"
          onClick={reload}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-green-600/30 px-3 py-1.5 text-[11px] font-semibold text-green-800 transition hover:bg-green-500/10 disabled:cursor-not-allowed disabled:opacity-60 dark:text-green-200"
        >
          <RefreshCw size={13} />
          Actualizar estado
        </button>
      </div>
    </div>
  );
}
