import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generatedDeckIntegrationFixture, generatedDeckFixtureIds } from "./generated-deck-integration-fixture";
import { googleFontBundleIdentity } from "../../fonts/google-font-bundle-identity.server";
import type { GoogleFontNativeFace } from "../../fonts/google-font-native-face.contract";

/** Real locally installed fonts; database/authority transport remains simulated.
 * Binary decoding and SQL admission have separate real runtime tests. */
export function generatedGoogleDeckFontFixture() {
  const fontId = "00000000-0000-4000-8000-000000000027", bundleId = "00000000-0000-4000-8000-000000000028";
  const admissionId = "00000000-0000-4000-8000-000000000029", family = "Space Mono";
  const files = [400, 700].map(weight => {
    const bytes = new Uint8Array(readFileSync(resolve(process.cwd(), `tools/controlled-hyperframes/node_modules/@fontsource/space-mono/files/space-mono-latin-${weight}-normal.woff2`)));
    return { bytes, weight, file: { checksumSha256: createHash("sha256").update(bytes).digest("hex"), fileSizeBytes: bytes.length,
      mimeType: "font/woff2" as const, embeddingCheck: "UNVERIFIED_COMPRESSED" as const } };
  });
  const identity = googleFontBundleIdentity({ format: "courseforge-google-font-candidate-bundle-v1", source: "google", family,
    stylesheetChecksumSha256: "a".repeat(64), files: files.map(entry => entry.file), faces: files.map(entry => ({ ...entry.file,
      style: "normal", weight: { minimum: entry.weight, maximum: entry.weight }, unicodeRange: "U+0000-00FF" })) });
  const pin = { fontId, bundleId, candidateSha256: identity.candidateSha256 };
  const faces: GoogleFontNativeFace[] = files.map((entry, index) => ({
    id: `00000000-0000-4000-8000-00000000003${index}`, organizationId: generatedDeckFixtureIds.organizationId, admissionId, pin, family,
    face: { ...entry.file, style: "normal", weight: { minimum: entry.weight, maximum: entry.weight }, unicodeRange: "U+0000-00FF" },
  }));
  const fixture = generatedDeckIntegrationFixture(false, { family, source: "google", fontAssetId: fontId, googleNativePin: pin,
    cssUrl: "https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700" });
  const nativeState = { faces, unavailable: false, calls: 0 };
  const client = Object.assign({}, fixture.client, {
    storage: { from(bucket: string) {
      return { async createSignedUrl(path: string) {
        return { data: { signedUrl: `https://storage.example.test/storage/v1/object/sign/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}?token=test-only` }, error: null };
      } };
    } },
    rpc(name: string, parameters: Record<string, unknown>) {
    nativeState.calls++; if (name !== "read_ready_google_font_faces") throw new Error("unexpected authority RPC");
    const selected = parameters.p_face_ids as string[] | null;
    const current = selected ? nativeState.faces.filter(face => selected.includes(face.id)) : nativeState.faces;
    return { async abortSignal(signal: AbortSignal) {
      signal.throwIfAborted();
      return { data: structuredClone(current), error: nativeState.unavailable ? { message: "revoked" } : null };
    } };
  } }) as unknown as SupabaseClient;
  return { ...fixture, client, pin, family, fontId, nativeState, files };
}
