import { z } from "zod";

export const compositionVisualMaskSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("CIRCLE") }).strict(),
  z.object({ shape: z.literal("ELLIPSE") }).strict(),
  z.object({ shape: z.literal("ROUNDED_RECT"), radiusPercent: z.number().finite().min(0).max(50) }).strict(),
]);
export type CompositionVisualMask = z.infer<typeof compositionVisualMaskSchema>;

/** Función autocontenida compartida por renderer y receptor del iframe. */
export function compositionVisualMaskClipPath(mask: CompositionVisualMask | null): string {
  if (mask === null) return "none";
  if (!mask || typeof mask !== "object") throw new Error("Máscara visual inválida.");
  const keys = Object.keys(mask);
  if (mask.shape === "CIRCLE" && keys.length === 1) return "circle(closest-side at 50% 50%)";
  if (mask.shape === "ELLIPSE" && keys.length === 1) return "ellipse(50% 50% at 50% 50%)";
  if (mask.shape === "ROUNDED_RECT" && keys.length === 2 && keys.includes("radiusPercent")
    && Number.isFinite(mask.radiusPercent) && mask.radiusPercent >= 0 && mask.radiusPercent <= 50) {
    return `inset(0 round ${mask.radiusPercent}%)`;
  }
  throw new Error("Máscara visual inválida.");
}
