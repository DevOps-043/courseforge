"use client";

import { useEffect, useMemo, useState } from "react";
import { Player } from "@remotion/player";
import { AlertTriangle, Loader2 } from "lucide-react";
import { buildAssemblyProps } from "@/remotion/buildAssemblyProps";
import { getAssemblyComposition } from "@/remotion/compositions/registry";
import { ASSEMBLY_HEIGHT, ASSEMBLY_WIDTH } from "@/remotion/types";
import type { MaterialAssets } from "../types/materials.types";

interface RemotionPreviewPlayerProps {
  assets: MaterialAssets | null | undefined;
  /** Slug de composición (remotion_templates.composition_id). */
  templateSlug: string | null | undefined;
}

/**
 * Preview en vivo del "posible ensamblado" con `@remotion/player`.
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
}: RemotionPreviewPlayerProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const built = useMemo(() => {
    try {
      return { ok: true as const, props: buildAssemblyProps(assets, templateSlug) };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Assets inválidos para preview";
      return { ok: false as const, error: message };
    }
  }, [assets, templateSlug]);

  if (!mounted) {
    return (
      <div className="flex-1 flex items-center justify-center aspect-video bg-black/90 rounded-xl">
        <Loader2 className="animate-spin text-purple-400" size={28} />
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

  return (
    <div className="relative aspect-video bg-black rounded-xl overflow-hidden shadow-inner">
      <Player
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
    </div>
  );
}