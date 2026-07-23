"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { AlertTriangle, Loader2 } from "lucide-react";
import { getAssemblyAssetReadiness } from "@/remotion/assembly-assets.normalizer";
import { buildAssemblyProps } from "@/remotion/buildAssemblyProps";
import { getAssemblyComposition } from "@/remotion/compositions/registry";
import type { LayoutOverrideManifest } from "@/remotion/layout-overrides";
import type { TemplateRenderConfigInput } from "@/remotion/template-config";
import { ASSEMBLY_FPS, ASSEMBLY_HEIGHT, ASSEMBLY_WIDTH } from "@/remotion/types";
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
  targetDurationSeconds?: number;
  overlay?: ReactNode;
  showTimeline?: boolean;
  selectedLayerId?: RemotionEditableLayerId;
  onSelectedLayerChange?: (layerId: RemotionEditableLayerId) => void;
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
  targetDurationSeconds,
  overlay,
  showTimeline = true,
  selectedLayerId,
  onSelectedLayerChange,
}: RemotionPreviewPlayerProps) {
  const [mounted, setMounted] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(0);
  const playerRef = useRef<PlayerRef>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const assetsWithTarget = useMemo(
    () =>
      targetDurationSeconds
        ? { ...(assets ?? {}), assembly_target_duration_seconds: targetDurationSeconds }
        : assets,
    [assets, targetDurationSeconds],
  );

  const readiness = useMemo(
    () => getAssemblyAssetReadiness(assetsWithTarget, ASSEMBLY_FPS),
    [assetsWithTarget],
  );

  const built = useMemo(() => {
    try {
      return {
        ok: true as const,
        props: buildAssemblyProps(
          assetsWithTarget,
          templateSlug,
          templateConfig,
          layoutOverrides,
        ),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Assets inválidos para preview";
      return { ok: false as const, error: message };
    }
  }, [assetsWithTarget, templateSlug, templateConfig, layoutOverrides]);

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
      <div className="flex-1 flex items-center justify-center aspect-video bg-black/90 rounded-xl">
        <Loader2 className="animate-spin text-purple-400" size={28} />
      </div>
    );
  }

  if (!readiness.hasRenderableAssets && readiness.warnings.length > 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 aspect-video bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 text-center">
        <AlertTriangle className="text-amber-500" size={24} />
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {readiness.warnings[0].message}
        </p>
      </div>
    );
  }

  if (!built.ok) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 aspect-video bg-amber-500/10 border border-amber-500/20 rounded-xl p-6 text-center">
        <AlertTriangle className="text-amber-500" size={24} />
        <p className="text-xs text-amber-600 dark:text-amber-400">
          No se pudo construir la previsualización: {built.error}
        </p>
      </div>
    );
  }

  const Composition = getAssemblyComposition(built.props.template);
  const timeline = buildVisualTimeline(built.props);

  return (
    <div className="space-y-3">
      <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-inner">
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
      {showTimeline ? (
        <RemotionTimelineInspector
          timeline={timeline}
          currentFrame={currentFrame}
          onSeekFrame={handleSeekFrame}
          selectedLayerId={selectedLayerId}
          onSelectedLayerChange={onSelectedLayerChange}
        />
      ) : null}
    </div>
  );
}
