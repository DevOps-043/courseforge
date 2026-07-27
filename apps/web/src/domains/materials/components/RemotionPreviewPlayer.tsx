"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { AlertTriangle, Loader2 } from "lucide-react";
import { getAssemblyAssetReadiness } from "@/remotion/assembly-assets.normalizer";
import { buildAssemblyProps } from "@/remotion/buildAssemblyProps";
import { getAssemblyComposition } from "@/remotion/compositions/registry";
import type { LayoutOverrideManifest } from "@/remotion/layout-overrides";
import type { TimelineOverrideManifest } from "@/remotion/timeline-overrides";
import type { TemplateRenderConfigInput } from "@/remotion/template-config";
import { ASSEMBLY_FPS, ASSEMBLY_HEIGHT, ASSEMBLY_WIDTH } from "@/remotion/types";
import { verifyBrowserMediaDurationsFromUrls } from "@/remotion/browser-media-duration-verification";
import { buildVisualTimeline } from "@/remotion/visual-timeline";
import type { RemotionEditableLayerId } from "@/remotion/layout-override-styles";
import type { MaterialAssets } from "../types/materials.types";
import { RemotionTimelineInspector } from "./RemotionTimelineInspector";

interface RemotionPreviewPlayerProps {
  assets: MaterialAssets | null | undefined;
  /** Slug de composicion de la plantilla. */
  templateSlug: string | null | undefined;
  templateConfig?: TemplateRenderConfigInput;
  layoutOverrides?: LayoutOverrideManifest[];
  timelineOverrides?: TimelineOverrideManifest[];
  overlay?: ReactNode;
  sidePanel?: ReactNode;
  showTimeline?: boolean;
  selectedLayerId?: RemotionEditableLayerId;
  onSelectedLayerChange?: (layerId: RemotionEditableLayerId) => void;
  componentId?: string;
  templateId?: string | null;
  templateVersionId?: string | null;
  timelineOverrideValue?: TimelineOverrideManifest[];
  onTimelineOverrideChange?: (nextOverrides: TimelineOverrideManifest[]) => void;
  disabled?: boolean;
}

/**
 * Preview en vivo del posible ensamblado en navegador.
 *
 * Renderiza la composición seleccionada con los assets actuales SIN renderizar
 * en el servidor: el usuario ve slides + voz + avatar + B-roll compuestos al
 * instante en el navegador.
 *
 * Resiliencia:
 *  - Solo monta tras `mounted` (cliente) para evitar acceso a `window` en SSR.
 *  - `buildAssemblyProps` puede lanzar ante assets inconsistentes; se captura y
 *    se muestra un mensaje claro en vez de romper la página.
 */
export function RemotionPreviewPlayer({
  assets,
  templateSlug,
  templateConfig,
  layoutOverrides = [],
  timelineOverrides,
  overlay,
  sidePanel,
  showTimeline = true,
  selectedLayerId,
  onSelectedLayerChange,
  componentId,
  templateId,
  templateVersionId,
  timelineOverrideValue,
  onTimelineOverrideChange,
  disabled,
}: RemotionPreviewPlayerProps) {
  const [mounted, setMounted] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [verifiedAssets, setVerifiedAssets] = useState<MaterialAssets | null | undefined>(assets);
  const playerRef = useRef<PlayerRef>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setVerifiedAssets(assets);

    verifyBrowserMediaDurationsFromUrls(assets)
      .then((nextAssets) => {
        if (!cancelled) {
          setVerifiedAssets(nextAssets);
        }
      })
      .catch((error) => {
        console.warn("[RemotionPreviewPlayer] No se pudieron verificar duraciones de assets", error);
        if (!cancelled) {
          setVerifiedAssets(assets);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [assets]);

  const readiness = useMemo(
    () => getAssemblyAssetReadiness(verifiedAssets, ASSEMBLY_FPS),
    [verifiedAssets],
  );

  const built = useMemo(() => {
    try {
      return {
        ok: true as const,
        props: buildAssemblyProps(
          verifiedAssets,
          templateSlug,
          templateConfig,
          layoutOverrides,
          timelineOverrides,
        ),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Assets inválidos para preview";
      return { ok: false as const, error: message };
    }
  }, [verifiedAssets, templateSlug, templateConfig, layoutOverrides, timelineOverrides]);

  useEffect(() => {
    setCurrentFrame(0);
  }, [built]);

  useEffect(() => {
    if (!built.ok) return;

    const player = playerRef.current;
    if (!player) return;

    const handleFrameUpdate = (event: { detail: { frame: number } }) => {
      setCurrentFrame(event.detail.frame);
    };

    player.addEventListener("frameupdate", handleFrameUpdate);

    return () => {
      player.removeEventListener("frameupdate", handleFrameUpdate);
    };
  }, [built]);

  const handleSeekFrame = useCallback((frame: number) => {
    const normalizedFrame = Math.max(0, Math.round(frame));
    playerRef.current?.seekTo(normalizedFrame);
    setCurrentFrame(normalizedFrame);
  }, []);

  if (!mounted) {
    return (
      <div className="flex min-h-[280px] items-center justify-center rounded-xl bg-gray-100 dark:bg-black/90">
        <Loader2 className="animate-spin text-purple-400" size={28} />
      </div>
    );
  }

  if (!readiness.hasRenderableAssets && readiness.warnings.length > 0) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-6 text-center">
        <AlertTriangle className="text-amber-500" size={24} />
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {readiness.warnings[0].message}
        </p>
      </div>
    );
  }

  if (!built.ok) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 p-6 text-center">
        <AlertTriangle className="text-amber-500" size={24} />
        <p className="text-xs text-amber-600 dark:text-amber-400">
          No se pudo construir la previsualización: {built.error}
        </p>
      </div>
    );
  }

  const Composition = getAssemblyComposition(built.props.template);
  const timeline = buildVisualTimeline(built.props);
  const previewPane = (
    <div className="flex min-h-[280px] items-center justify-center rounded-xl bg-white p-3 dark:bg-[#070A0F]">
      <div
        className="relative aspect-video overflow-hidden rounded-lg bg-gray-100 shadow-inner dark:bg-black"
        style={{ width: "min(100%, 82vh)" }}
      >
        <Player
          ref={playerRef}
          component={Composition}
          inputProps={built.props}
          durationInFrames={built.props.totalDurationInFrames}
          fps={built.props.fps}
          compositionWidth={ASSEMBLY_WIDTH}
          compositionHeight={ASSEMBLY_HEIGHT}
          controls
          acknowledgeRemotionLicense
          style={{ width: "100%", height: "100%" }}
        />
        {overlay}
      </div>
    </div>
  );

  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3 shadow-inner dark:border-[#1D2835] dark:bg-[#0B1118]">
      {sidePanel ? (
        <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          {previewPane}
          <aside className="min-h-0 overflow-y-auto rounded-xl bg-white dark:bg-[#070A0F] xl:max-h-[calc(46vh+4.5rem)]">
            {sidePanel}
          </aside>
        </div>
      ) : (
        previewPane
      )}
      {showTimeline ? (
        <RemotionTimelineInspector
          timeline={timeline}
          currentFrame={currentFrame}
          onSeekFrame={handleSeekFrame}
          selectedLayerId={selectedLayerId}
          onSelectedLayerChange={onSelectedLayerChange}
          componentId={componentId}
          templateId={templateId}
          templateVersionId={templateVersionId}
          value={timelineOverrideValue}
          onChange={onTimelineOverrideChange}
          disabled={disabled}
        />
      ) : null}
    </div>
  );
}
