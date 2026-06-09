import type { ComponentType } from "react";
import {
  ASSEMBLY_TEMPLATES,
  DEFAULT_ASSEMBLY_TEMPLATE,
  type AssemblyInputProps,
  type AssemblyTemplate,
} from "../types";
import { FullSlides } from "./FullSlides";
import { SplitAvatar } from "./SplitAvatar";
import { AvatarFocus } from "./AvatarFocus";

/**
 * Mapa estable slug-de-plantilla -> composición React.
 *
 * Es la fuente compartida que usan tanto `Root.tsx` (registro para el CLI) como
 * el `<Player>` del navegador, evitando que la preview tenga que importar
 * `Root.tsx` y disparar `registerRoot` como efecto secundario.
 */
export const ASSEMBLY_COMPOSITIONS: Record<
  AssemblyTemplate,
  ComponentType<AssemblyInputProps>
> = {
  [ASSEMBLY_TEMPLATES.FULL_SLIDES]: FullSlides,
  [ASSEMBLY_TEMPLATES.SPLIT_AVATAR]: SplitAvatar,
  [ASSEMBLY_TEMPLATES.AVATAR_FOCUS]: AvatarFocus,
};

/** Devuelve la composición de una plantilla, con fallback seguro. */
export function getAssemblyComposition(
  template: AssemblyTemplate,
): ComponentType<AssemblyInputProps> {
  return (
    ASSEMBLY_COMPOSITIONS[template] ??
    ASSEMBLY_COMPOSITIONS[DEFAULT_ASSEMBLY_TEMPLATE]
  );
}