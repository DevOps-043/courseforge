import { prepareGoogleFontBytes } from "../google-font-preparation.server";
import { googleFontCandidateBundle } from "../google-font-bundle-identity.server";
import type { GoogleFontBundleStore, GoogleFontBundleStorage } from "../google-font-bundle-store.server";

export const BUNDLE_FONT_ID = "00000000-0000-4000-8000-000000000011";
export const BUNDLE_ORG_ID = "00000000-0000-4000-8000-000000000012";
export const BUNDLE_ACTOR_ID = "00000000-0000-4000-8000-000000000013";
export const BUNDLE_ID = "00000000-0000-4000-8000-000000000014";
export const BUNDLE_OTHER_ID = "00000000-0000-4000-8000-000000000015";
export const BUNDLE_CSS_URL = "https://fonts.googleapis.com/css2?family=Inter:wght@400;700";
export function candidateWoff2(marker = 0) {
  // Header-only structural fixture: never decode, coverage or render evidence.
  const bytes = new Uint8Array(48), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("wOF2")); view.setUint32(8, 48); view.setUint16(12, 1); bytes[16] = marker;
  return bytes;
}
export const candidateCss = [400, 700].map(weight => `@font-face{font-family:'Inter';font-style:normal;font-weight:${weight};unicode-range:U+0000-00FF;src:url(https://fonts.gstatic.com/s/inter/v18/Face${weight}.woff2) format('woff2');}`).join("");
export const candidateFetch: typeof fetch = async url => String(url) === BUNDLE_CSS_URL
  ? new Response(candidateCss, { headers: { "content-type": "text/css" } })
  : new Response(candidateWoff2(String(url).includes("700") ? 1 : 0).buffer, { headers: { "content-type": "font/woff2" } });

export async function createGoogleFontBundleFixture() {
  const candidate = await prepareGoogleFontBytes({ family: "Inter", cssUrl: BUNDLE_CSS_URL }, { fetchImpl: candidateFetch });
  const identity = googleFontCandidateBundle(candidate);
  const state = { font: { id: BUNDLE_FONT_ID, organization_id: BUNDLE_ORG_ID, family: "Inter", source: "google", css_url: BUNDLE_CSS_URL, status: "READY" },
    stored: null as Record<string, unknown> | null, commits: 0, reads: 0,
    ensured: [] as Parameters<GoogleFontBundleStorage["ensureFile"]>[0][], loseCommitResponse: false };
  const repository: GoogleFontBundleStore = {
    async readFont() { state.reads++; return { ...state.font }; },
    async readBundle() { return state.stored; },
    async commitBundle(input) {
      state.commits++; const created = state.stored === null;
      if (!state.stored) state.stored = { id: BUNDLE_ID, organization_id: input.organizationId, font_id: input.fontId,
        candidate_sha256: input.candidateSha256, manifest_text: input.manifestText, registration_css_url: input.cssUrl, status: "PREPARED" };
      if (state.loseCommitResponse) { state.loseCommitResponse = false; throw new Error("unknown commit outcome"); }
      return { bundleId: BUNDLE_ID, candidateSha256: input.candidateSha256, status: "PREPARED", renderEligible: false, created };
    },
  };
  const storage: GoogleFontBundleStorage = { async ensureFile(input) { state.ensured.push(input); } };
  const input = { organizationId: BUNDLE_ORG_ID, actorId: BUNDLE_ACTOR_ID, fontId: BUNDLE_FONT_ID,
    expectedCandidateSha256: identity.candidateSha256, repository, storage, signal: new AbortController().signal, fetchImpl: candidateFetch };
  return { candidate, identity, state, input };
}
