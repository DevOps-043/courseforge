import { z } from "zod";
import { COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS } from "./composition-document.types.constants";

export const editorIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i);
export const finiteNumberSchema = z.number().finite();
export const boundedSecondsSchema = finiteNumberSchema.min(0).max(COMPOSITION_DOCUMENT_MAX_DURATION_SECONDS);
