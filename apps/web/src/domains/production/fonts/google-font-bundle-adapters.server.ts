import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GOOGLE_FONT_BUNDLE_TABLE, googleFontBundleStoragePath } from "./google-font-bundle.contract";
import { ORGANIZATION_FONT_STORAGE_BUCKET, ORGANIZATION_FONT_TABLE } from "./organization-font.types";
import { GoogleFontBundleCommitError, type GoogleFontBundleStorage, type GoogleFontBundleStore } from "./google-font-bundle-store.server";
import { validateOrganizationFontBinary } from "./organization-font-upload-policy.service";
import type { GoogleFontAdmissionRepository } from "./google-font-admission.server";

export function createGoogleFontAdmissionRepository(supabase: SupabaseClient): GoogleFontAdmissionRepository {
  const bundles = createGoogleFontBundleStore(supabase);
  return { readFont: bundles.readFont, readBundle: bundles.readBundle, async commitAdmission(input) {
    const result = await supabase.rpc("admit_decoded_google_font_bundle", { p_org: input.organizationId, p_actor: input.actorId,
      p_font: input.fontId, p_bundle: input.bundleId, p_candidate_sha256: input.candidateSha256, p_proof_text: input.proofText }).abortSignal(input.signal);
    if (result.error) {
      const known = new Map<string, "FORBIDDEN" | "STALE" | "REVOKED">([
        ["GOOGLE_FONT_BUNDLE_ACTOR_FORBIDDEN", "FORBIDDEN"], ["GOOGLE_FONT_BUNDLE_REGISTRATION_CHANGED", "STALE"],
        ["GOOGLE_FONT_BUNDLE_REVOKED", "REVOKED"],
      ]);
      const reason = known.get(result.error.message);
      if (reason) throw new GoogleFontBundleCommitError(reason);
      throw new Error("GOOGLE_FONT_ADMISSION_COMMIT_UNAVAILABLE");
    }
    return result.data;
  } };
}

export function createGoogleFontBundleStore(supabase: SupabaseClient): GoogleFontBundleStore {
  return {
    async readFont(organizationId, fontId, signal) {
      const result = await supabase.from(ORGANIZATION_FONT_TABLE).select("id,organization_id,family,source,css_url,status")
        .eq("organization_id", organizationId).eq("id", fontId).abortSignal(signal).maybeSingle();
      if (result.error) throw new Error("GOOGLE_FONT_REGISTRY_UNAVAILABLE");
      return result.data;
    },
    async readBundle(organizationId, fontId, candidateSha256, signal) {
      const result = await supabase.from(GOOGLE_FONT_BUNDLE_TABLE)
        .select("id,organization_id,font_id,candidate_sha256,manifest_text,registration_css_url,status")
        .eq("organization_id", organizationId).eq("font_id", fontId).eq("candidate_sha256", candidateSha256).abortSignal(signal).maybeSingle();
      if (result.error) throw new Error("GOOGLE_FONT_BUNDLE_REGISTRY_UNAVAILABLE");
      return result.data;
    },
    async commitBundle(input) {
      const result = await supabase.rpc("commit_google_font_candidate_bundle", { p_org: input.organizationId, p_actor: input.actorId,
        p_font: input.fontId, p_family: input.family, p_css_url: input.cssUrl, p_candidate_sha256: input.candidateSha256,
        p_manifest_text: input.manifestText }).abortSignal(input.signal);
      if (result.error) {
        const known = new Map<string, "FORBIDDEN" | "STALE" | "REVOKED">([
          ["GOOGLE_FONT_BUNDLE_ACTOR_FORBIDDEN", "FORBIDDEN"], ["GOOGLE_FONT_BUNDLE_REGISTRATION_CHANGED", "STALE"],
          ["GOOGLE_FONT_BUNDLE_REVOKED", "REVOKED"],
        ]);
        const reason = known.get(result.error.message);
        if (reason) throw new GoogleFontBundleCommitError(reason);
        throw new Error("GOOGLE_FONT_BUNDLE_COMMIT_UNAVAILABLE");
      }
      return result.data;
    },
  };
}

/** Trusted host URL/key only. Candidate paths derive from tenant+hash+MIME, never
 * from external CSS or a request. Readback is mandatory even after upload success. */
export function createGoogleFontBundleStorage(configuration: { supabaseUrl: string;
  serviceRoleKey: string; fetchImpl?: typeof fetch }): GoogleFontBundleStorage & {
    readFile(input: Omit<Parameters<GoogleFontBundleStorage["ensureFile"]>[0], "bytes">): Promise<Uint8Array>;
  } {
  const origin = new URL(configuration.supabaseUrl);
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash
    || origin.port && origin.port !== "443" || !configuration.serviceRoleKey || /[\r\n]/.test(configuration.serviceRoleKey)) throw new Error("GOOGLE_FONT_STORAGE_CONFIGURATION_INVALID");
  const fetchImpl = configuration.fetchImpl ?? fetch;
  const authorization = { apikey: configuration.serviceRoleKey, Authorization: `Bearer ${configuration.serviceRoleKey}` };
  const verifiedFile = async (input: Parameters<GoogleFontBundleStorage["ensureFile"]>[0]) => {
    input.signal.throwIfAborted();
    const path = googleFontBundleStoragePath(input.organizationId, input.candidateSha256, input.file);
    if (input.bytes) {
      if (input.bytes.length !== input.file.fileSizeBytes || createHash("sha256").update(input.bytes).digest("hex") !== input.file.checksumSha256) throw new Error("GOOGLE_FONT_BUNDLE_BYTES_CHANGED");
      // No overwrite or rollback deletion: other concurrent requests may own the same object.
      try {
        const uploaded = await fetchImpl(new URL(`/storage/v1/object/${ORGANIZATION_FONT_STORAGE_BUCKET}/${path}`, origin).href,
          { method: "POST", signal: input.signal, redirect: "error", credentials: "omit", cache: "no-store",
            headers: { ...authorization, "Content-Type": input.file.mimeType, "x-upsert": "false", "cache-control": "max-age=31536000" },
            body: new Uint8Array(input.bytes).buffer });
        await uploaded.body?.cancel().catch(() => undefined);
      } catch { input.signal.throwIfAborted(); /* Unknown outcome: resolve only by exact readback. */ }
      input.signal.throwIfAborted();
    }
    const url = new URL(`/storage/v1/object/authenticated/${ORGANIZATION_FONT_STORAGE_BUCKET}/${path}`, origin).href;
    const response = await fetchImpl(url, { method: "GET", signal: input.signal, redirect: "error", credentials: "omit", cache: "no-store",
      headers: authorization });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const cancel = () => { void reader?.cancel().catch(() => undefined); };
    try {
      input.signal.throwIfAborted();
      const length = response.headers.get("content-length"), encoding = response.headers.get("content-encoding");
      if (response.status !== 200 || response.redirected || response.url && response.url !== url || !response.body || response.headers.has("content-range")
        || encoding && encoding !== "identity" || response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== input.file.mimeType
        || length !== null && (!/^\d+$/.test(length) || Number(length) !== input.file.fileSizeBytes)) throw new Error("GOOGLE_FONT_STORAGE_READBACK_INVALID");
      reader = response.body.getReader(); input.signal.addEventListener("abort", cancel, { once: true });
      const chunks: Uint8Array[] = []; const hash = createHash("sha256"); let size = 0;
      while (true) {
        input.signal.throwIfAborted(); const chunk = await reader.read(); input.signal.throwIfAborted(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > input.file.fileSizeBytes) throw new Error("GOOGLE_FONT_STORAGE_READBACK_INVALID");
        hash.update(chunk.value); chunks.push(new Uint8Array(chunk.value));
      }
      if (size !== input.file.fileSizeBytes || hash.digest("hex") !== input.file.checksumSha256) throw new Error("GOOGLE_FONT_STORAGE_READBACK_INVALID");
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const extension = input.file.mimeType.slice(5) as "woff" | "woff2" | "ttf" | "otf";
      if (validateOrganizationFontBinary(bytes, extension).embedding !== input.file.embeddingCheck) throw new Error("GOOGLE_FONT_STORAGE_READBACK_INVALID");
      return bytes;
    } finally {
      input.signal.removeEventListener("abort", cancel);
      if (reader) { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      else await response.body?.cancel().catch(() => undefined);
    }
  };
  return { async ensureFile(input) { await verifiedFile(input); }, readFile: verifiedFile };
}
