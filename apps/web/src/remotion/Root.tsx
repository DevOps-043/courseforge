import { Composition, type CalculateMetadataFunction } from "remotion";
import {
  ASSEMBLY_FPS,
  ASSEMBLY_HEIGHT,
  ASSEMBLY_WIDTH,
  ASSEMBLY_FALLBACK_DURATION_FRAMES,
  ASSEMBLY_TEMPLATES,
  createDefaultAssemblyProps,
  parseAssemblyInputProps,
  type AssemblyInputProps,
  type AssemblyTemplate,
} from "./types";
import { ASSEMBLY_COMPOSITIONS } from "./compositions/registry";

/**
 * Punto de entrada Remotion para el renderizado server-side (CLI). Inerte para
 * Next: ningún módulo de la app web importa este archivo, así que `registerRoot`
 * no corre en el navegador.
 *
 * NOTA: `registerRoot(RemotionRoot)` lo invoca el `index.ts` de entrada del
 * bundle Remotion en la Fase 5 (render server-side), no este archivo.
 */

/**
 * Normaliza las props entrantes y deriva la duración/fps reales desde ellas, de
 * modo que la longitud de la composición siempre coincida con el audio/clips.
 */
const calculateMetadata: CalculateMetadataFunction<AssemblyInputProps> = ({
  props,
}) => {
  const parsed = parseAssemblyInputProps(props);
  return {
    durationInFrames: parsed.totalDurationInFrames,
    fps: parsed.fps,
    props: parsed,
  };
};

const TEMPLATE_IDS: AssemblyTemplate[] = [
  ASSEMBLY_TEMPLATES.FULL_SLIDES,
  ASSEMBLY_TEMPLATES.SPLIT_AVATAR,
  ASSEMBLY_TEMPLATES.AVATAR_FOCUS,
];

export function RemotionRoot() {
  return (
    <>
      {TEMPLATE_IDS.map((templateId) => (
        <Composition
          key={templateId}
          id={templateId}
          component={ASSEMBLY_COMPOSITIONS[templateId]}
          width={ASSEMBLY_WIDTH}
          height={ASSEMBLY_HEIGHT}
          fps={ASSEMBLY_FPS}
          durationInFrames={ASSEMBLY_FALLBACK_DURATION_FRAMES}
          defaultProps={createDefaultAssemblyProps(templateId)}
          calculateMetadata={calculateMetadata}
        />
      ))}
    </>
  );
}