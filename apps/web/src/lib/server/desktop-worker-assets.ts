import type { MaterialAssets } from "../../domains/materials/types/materials.types";
import { safeParseMaterialAssets } from "../../domains/materials/validators/assets.validators";

/**
 * Validates the JSONB material asset document before it reaches Remotion.
 * Provider payload details are deliberately omitted from the thrown error.
 */
export function parseDesktopWorkerMaterialAssets(value: unknown): MaterialAssets {
  const parsed = safeParseMaterialAssets(value ?? {});
  if (!parsed.success) {
    throw new Error("MATERIAL_ASSETS_INVALID_FOR_DESKTOP_RENDER");
  }

  return parsed.data;
}
