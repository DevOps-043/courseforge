import { createHash } from "node:crypto";
import { generatedDeckIntegrationFixture } from "./generated-deck-integration-fixture";

export function generatedDeckFontFixture(source: "uploaded" | "google" = "uploaded") {
  const fontId = "00000000-0000-4000-8000-000000000026", family = "Workshop Font";
  // Synthetic bytes test acquisition and identity, not decoding or real glyphs.
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const fixture = generatedDeckIntegrationFixture(false, { family, source, fontAssetId: fontId });
  const row = { id: fontId, organization_id: fixture.organizationId, family, source: "uploaded", status: "READY",
    checksum_sha256: createHash("sha256").update(bytes).digest("hex"), mime_type: "font/woff2",
    file_size_bytes: bytes.length, storage_bucket: "organization-fonts", storage_path: "fonts/workshop.woff2" };
  fixture.state.fontRows.push(row);
  return { ...fixture, fontId, family, bytes, row };
}
