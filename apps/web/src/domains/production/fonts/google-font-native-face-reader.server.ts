import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { googleFontNativePinSchema, googleFontNativeFacesSchema, type GoogleFontNativePin } from "./google-font-native-face.contract";
import { GOOGLE_FONT_PREPARATION_POLICY } from "./google-font-preparation-policy";

type Selection = { faceIds: string[] } | { pin: GoogleFontNativePin };
const selectionSchema = z.union([
  z.object({ faceIds: z.array(z.string().uuid()).min(1).max(GOOGLE_FONT_PREPARATION_POLICY.maximumFaces)
    .refine(ids => new Set(ids).size === ids.length) }).strict(),
  z.object({ pin: googleFontNativePinSchema }).strict(),
]);

/** Current authority, atomically read by service-only RPC. Exact bundle pins
 * survive later admissions; nothing chooses a mutable "latest" registration.
 * This verifies authority/metadata, not physical bytes or render glyph usage. */
export async function readReadyGoogleFontFaces(input: {
  organizationId: string; selection: Selection; supabase: SupabaseClient; signal: AbortSignal;
}) {
  z.string().uuid().parse(input.organizationId);
  const selection = selectionSchema.parse(input.selection);
  input.signal.throwIfAborted();
  const result = await input.supabase.rpc("read_ready_google_font_faces", {
    p_org: input.organizationId,
    p_face_ids: "faceIds" in selection ? selection.faceIds : null,
    p_font: "pin" in selection ? selection.pin.fontId : null,
    p_bundle: "pin" in selection ? selection.pin.bundleId : null,
    p_candidate_sha256: "pin" in selection ? selection.pin.candidateSha256 : null,
  }).abortSignal(input.signal);
  input.signal.throwIfAborted();
  if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "") > GOOGLE_FONT_PREPARATION_POLICY.manifestBytes)
    throw new Error("GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE");
  const faces = googleFontNativeFacesSchema.parse(result.data);
  if (faces.some(face => face.organizationId !== input.organizationId)) throw new Error("GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE");
  if ("faceIds" in selection) {
    if (faces.length !== selection.faceIds.length || faces.some(face => !selection.faceIds.includes(face.id)))
      throw new Error("GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE");
  } else if (faces.some(face => face.pin.fontId !== selection.pin.fontId || face.pin.bundleId !== selection.pin.bundleId
    || face.pin.candidateSha256 !== selection.pin.candidateSha256)) throw new Error("GOOGLE_FONT_NATIVE_FACES_UNAVAILABLE");
  return faces;
}
