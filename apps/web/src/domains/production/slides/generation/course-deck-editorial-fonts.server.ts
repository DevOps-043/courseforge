import type { SupabaseClient } from "@supabase/supabase-js";
import { readReadyCompositionFontRows } from "../../composition-editor/composition-font-registry.server";
import { compositionFontReferenceSchema, COMPOSITION_FONT_REFERENCE_LIMIT, type CompositionFontReference } from "../../composition-editor/composition-font-references";
import { HTML_EDITING_REPOSITORY_POLICY } from "../../composition-editor/composition-html-editing-repository-policy";
import { readReadyGoogleFontFaces } from "../../fonts/google-font-native-face-reader.server";
import { googleFontFaceBinding, type GoogleFontNativePin } from "../../fonts/google-font-native-face.contract";

type Requirement = { family: string; source: "google" | "uploaded"; fontAssetId?: string; googleNativePin?: GoogleFontNativePin };
export async function assertCourseDeckEditorialFontReady(input: {
  font?: Requirement; organizationId: string; supabase: SupabaseClient; signal?: AbortSignal;
}) {
  if (!input.font) return;
  const requirements = [input.font];
  const bindings = await resolveGeneratedCourseDeckFonts({ ...input, requirements });
  if (!generatedDeckFontBindingsMatch(requirements, bindings)) throw new Error("COURSE_DECK_EDITORIAL_FONT_BINDING_REQUIRED");
}

/** External stylesheets do not identify native bytes. No network fallback or family substitution. */
export async function resolveGeneratedCourseDeckFonts(input: {
  requirements: Requirement[]; organizationId: string; supabase: SupabaseClient; signal?: AbortSignal;
}): Promise<CompositionFontReference[] | null> {
  if (!input.requirements.length) return [];
  if (input.requirements.some(font => !font.fontAssetId || font.source === "google" && !font.googleNativePin)) return null;
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs)])
    : AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
  const references: CompositionFontReference[] = [];
  const uploaded = input.requirements.filter(font => font.source === "uploaded");
  const rows = uploaded.length ? await readReadyCompositionFontRows(input.supabase, input.organizationId, uploaded.map(font => font.fontAssetId!), signal) : [];
  for (const font of input.requirements) {
    if (font.source === "uploaded") {
      if (rows.find(row => row.id === font.fontAssetId)?.family !== font.family) return null;
      references.push(compositionFontReferenceSchema.parse({ fontAssetId: font.fontAssetId, fontFamily: font.family }));
    } else {
      if (font.googleNativePin!.fontId !== font.fontAssetId) return null;
      const faces = await readReadyGoogleFontFaces({ ...input, selection: { pin: font.googleNativePin! }, signal });
      if (faces.some(face => face.family !== font.family)) return null;
      references.push(...faces.map(face => compositionFontReferenceSchema.parse({ fontAssetId: face.id, fontFamily: face.family,
        googleFace: googleFontFaceBinding(face) })));
    }
  }
  if (references.length > COMPOSITION_FONT_REFERENCE_LIMIT || new Set(references.map(font => font.fontAssetId)).size !== references.length) return null;
  return references;
}

export function generatedDeckFontBindingsMatch(requirements: Requirement[], bindings: CompositionFontReference[] | null): boolean {
  if (bindings === null || requirements.length && !bindings.length || new Set(bindings.map(font => font.fontAssetId)).size !== bindings.length) return false;
  if (requirements.every(font => font.source === "uploaded") && requirements.length !== bindings.length) return false;
  return requirements.every(requirement => bindings.some(binding => matchesRequirement(requirement, binding)))
    && bindings.every(binding => requirements.some(requirement => matchesRequirement(requirement, binding)));
}
function matchesRequirement(requirement: Requirement, binding: CompositionFontReference) {
  if (binding.fontFamily !== requirement.family) return false;
  if (requirement.source === "uploaded") return !binding.googleFace && binding.fontAssetId === requirement.fontAssetId;
  const pin = requirement.googleNativePin, face = binding.googleFace;
  return !!pin && !!face && pin.fontId === requirement.fontAssetId && face.fontId === pin.fontId
    && face.bundleId === pin.bundleId && face.candidateSha256 === pin.candidateSha256;
}
