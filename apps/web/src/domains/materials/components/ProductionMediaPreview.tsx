"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, FileAudio, FileImage, FileVideo } from "lucide-react";
import {
  formatProductionMediaDuration,
  isAllowedProductionMediaSource,
  type ProductionMediaKind,
} from "./production-media-preview";

interface ProductionMediaPreviewProps {
  className?: string;
  durationSeconds?: number | null;
  kind: ProductionMediaKind;
  label: string;
  mimeType?: string;
  src: string;
}

const MEDIA_ICON = {
  audio: FileAudio,
  image: FileImage,
  video: FileVideo,
} as const;

export function ProductionMediaPreview({
  className = "",
  durationSeconds,
  kind,
  label,
  mimeType,
  src,
}: ProductionMediaPreviewProps) {
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const normalizedSource = src.trim();
  const sourceAllowed = isAllowedProductionMediaSource(normalizedSource);
  const durationLabel = formatProductionMediaDuration(durationSeconds);
  const MediaIcon = MEDIA_ICON[kind];

  useEffect(() => {
    setPlaybackFailed(false);
  }, [kind, normalizedSource]);

  if (!sourceAllowed) {
    return null;
  }

  return (
    <div className={`overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-[var(--engine-muted)]/20 dark:bg-[var(--engine-surface-solid)] ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-2.5 py-2 text-[10px] dark:border-white/10">
        <span className="flex min-w-0 items-center gap-1.5 font-bold text-gray-700 dark:text-gray-200">
          <MediaIcon size={12} className="shrink-0 text-[var(--engine-info)]" />
          <span className="truncate" title={label}>{label}</span>
          {durationLabel ? <span className="shrink-0 font-medium text-gray-400">· {durationLabel}</span> : null}
        </span>
        <a
          href={normalizedSource}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 font-bold text-[var(--engine-info)] hover:underline"
        >
          <ExternalLink size={10} /> Abrir
        </a>
      </div>

      {playbackFailed ? (
        <div role="status" className="flex items-start gap-2 bg-amber-50 p-3 text-[10px] leading-relaxed text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>Este proveedor no permite reproducir el asset aquí. Puedes revisarlo con “Abrir”.</span>
        </div>
      ) : kind === "audio" ? (
        <div className="p-2.5">
          <audio controls preload="metadata" className="h-9 w-full" onError={() => setPlaybackFailed(true)}>
            <source src={normalizedSource} type={mimeType} />
          </audio>
        </div>
      ) : kind === "video" ? (
        <video controls playsInline preload="metadata" className="aspect-video w-full bg-black object-contain" onError={() => setPlaybackFailed(true)}>
          <source src={normalizedSource} type={mimeType} />
        </video>
      ) : (
        <img
          src={normalizedSource}
          alt={label}
          loading="lazy"
          className="aspect-video w-full bg-black object-contain"
          onError={() => setPlaybackFailed(true)}
        />
      )}
    </div>
  );
}
