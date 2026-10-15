import assert from "node:assert/strict";
import test from "node:test";
import { createGoogleFontBundleStorage } from "../google-font-bundle-adapters.server";
import { createGoogleFontBundleFixture } from "./google-font-bundle-fixture";

test("uploads without overwrite and verifies the exact private object bytes", async () => {
  const fixture = await createGoogleFontBundleFixture(), calls: Array<{ url: string; method?: string }> = [];
  const file = fixture.candidate.files[0];
  const storage = createGoogleFontBundleStorage({ supabaseUrl: "https://project.supabase.co", serviceRoleKey: "test-only-key", fetchImpl: async (url, options) => {
    calls.push({ url: String(url), method: options?.method });
    assert.equal(options?.redirect, "error"); assert.equal(options?.credentials, "omit");
    assert.equal(new Headers(options?.headers).get("apikey"), "test-only-key");
    if (options?.method === "POST") {
      assert.equal(new Headers(options.headers).get("x-upsert"), "false");
      return new Response("duplicate", { status: 409 });
    }
    return new Response(new Uint8Array(file.bytes).buffer, { headers: { "content-type": file.mimeType, "content-length": String(file.bytes.length) } });
  } });
  const { bytes, ...metadata } = file;
  await storage.ensureFile({ organizationId: fixture.input.organizationId, candidateSha256: fixture.identity.candidateSha256, file: metadata, bytes, signal: fixture.input.signal });
  assert.equal(calls.length, 2); assert.ok(calls[0].url.startsWith("https://project.supabase.co/storage/v1/object/organization-fonts/"));
  assert.ok(calls[1].url.includes("/object/authenticated/organization-fonts/"));
});

test("unknown upload response is only accepted after exact readback", async () => {
  const fixture = await createGoogleFontBundleFixture(), file = fixture.candidate.files[0];
  const storage = createGoogleFontBundleStorage({ supabaseUrl: "https://project.supabase.co", serviceRoleKey: "test-only-key", fetchImpl: async (_url, options) => {
    if (options?.method === "POST") throw new Error("upload result unknown");
    return new Response(new Uint8Array(file.bytes).buffer, { headers: { "content-type": file.mimeType } });
  } });
  const { bytes, ...metadata } = file;
  await storage.ensureFile({ organizationId: fixture.input.organizationId, candidateSha256: fixture.identity.candidateSha256, file: metadata, bytes, signal: fixture.input.signal });
});

test("replay verifies bytes without POST or provider URLs", async () => {
  const fixture = await createGoogleFontBundleFixture(), file = fixture.candidate.files[0];
  const storage = createGoogleFontBundleStorage({ supabaseUrl: "https://project.supabase.co", serviceRoleKey: "test-only-key", fetchImpl: async (url, options) => {
    assert.equal(options?.method, "GET"); assert.equal(new URL(String(url)).hostname, "project.supabase.co");
    return new Response(new Uint8Array(file.bytes).buffer, { headers: { "content-type": file.mimeType } });
  } });
  const metadata = { checksumSha256: file.checksumSha256, fileSizeBytes: file.fileSizeBytes, mimeType: file.mimeType, embeddingCheck: file.embeddingCheck };
  await storage.ensureFile({ organizationId: fixture.input.organizationId, candidateSha256: fixture.identity.candidateSha256, file: metadata, signal: fixture.input.signal });
});

for (const failure of ["missing", "redirect", "wrong MIME", "wrong hash", "truncated", "oversized", "range", "encoding", "declared length"]) {
  test(`rejects ${failure} private Storage readback`, async () => {
    const fixture = await createGoogleFontBundleFixture(), file = fixture.candidate.files[0];
    const storage = createGoogleFontBundleStorage({ supabaseUrl: "https://project.supabase.co", serviceRoleKey: "test-only-key", fetchImpl: async () => {
      const bytes = new Uint8Array(file.bytes), headers: Record<string, string> = { "content-type": file.mimeType };
      if (failure === "missing") return new Response(null, { status: 404 });
      if (failure === "redirect") return new Response(null, { status: 302, headers: { location: "https://evil.test" } });
      if (failure === "wrong MIME") headers["content-type"] = "text/html";
      if (failure === "wrong hash") bytes[47] ^= 1;
      if (failure === "range") headers["content-range"] = "bytes 0-47/48";
      if (failure === "encoding") headers["content-encoding"] = "gzip";
      if (failure === "declared length") headers["content-length"] = "9999";
      return new Response(failure === "oversized" ? new Uint8Array(49).buffer : failure === "truncated" ? bytes.slice(0, 47).buffer : bytes.buffer, { headers });
    } });
    const metadata = { checksumSha256: file.checksumSha256, fileSizeBytes: file.fileSizeBytes, mimeType: file.mimeType, embeddingCheck: file.embeddingCheck };
    await assert.rejects(storage.ensureFile({ organizationId: fixture.input.organizationId, candidateSha256: fixture.identity.candidateSha256, file: metadata, signal: fixture.input.signal }));
  });
}

test("invalid host/key configuration never produces a Storage request", () => {
  for (const supabaseUrl of ["http://project.supabase.co", "https://user@project.supabase.co", "https://project.supabase.co:8443", "https://project.supabase.co/path"]) {
    assert.throws(() => createGoogleFontBundleStorage({ supabaseUrl, serviceRoleKey: "test" }));
  }
  assert.throws(() => createGoogleFontBundleStorage({ supabaseUrl: "https://project.supabase.co", serviceRoleKey: "test\r\nkey" }));
});
