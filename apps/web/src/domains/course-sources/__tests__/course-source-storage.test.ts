import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSourceStorage } from "../course-source-storage";
import { COURSE_SOURCE_BUCKET } from "../course-source-policy";

function fixture(size: number | undefined = 3) {
  const effects: string[] = [];
  const client = { storage: { from(bucket: string) {
    assert.equal(bucket, COURSE_SOURCE_BUCKET);
    return {
      async createSignedUploadUrl(path: string, options: { upsert: boolean }) {
        effects.push("sign"); assert.equal(path, "ruta-reservada"); assert.equal(options.upsert, false);
        return { data: { signedUrl: "https://example.invalid", token: "sintetico" }, error: null };
      },
      async info() { effects.push("info"); return { data: { size }, error: null }; },
      async download() { effects.push("download"); return { data: new Blob(["abc"]), error: null }; },
    };
  } } } as unknown as SupabaseClient;
  return { effects, storage: createSourceStorage(client) };
}

test("Storage firma sin sobrescribir y verifica metadata antes de descargar", async () => {
  const f = fixture(); await f.storage.sign("ruta-reservada");
  assert.deepEqual(await f.storage.read("ruta-reservada", 3), new TextEncoder().encode("abc"));
  assert.deepEqual(f.effects, ["sign", "info", "download"]);
});

test("metadata ausente o tamaño real distinto bloquea descarga", async () => {
  for (const size of [0, 100, 16 * 1024 * 1024, undefined]) {
    const f = fixture(size === undefined ? Number.NaN : size);
    await assert.rejects(f.storage.read("ruta-reservada", 3));
    assert.deepEqual(f.effects, ["info"]);
  }
});
