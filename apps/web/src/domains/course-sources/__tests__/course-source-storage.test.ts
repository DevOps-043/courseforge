import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanDeletedArtifactSources } from "../../artifacts/services/artifact-source-cleanup";
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

test("la limpieza confirma solo rutas reclamadas y conserva la cola ante un error de Storage", async () => {
  const paths = ["ruta-reclamada"];
  const acknowledged: string[][] = [];
  const removalAttempts: string[][] = [];
  const storageError = new Error("Fallo simulado de Storage");
  let failure = true;
  const dueQuery = {
    lte() { return this; },
    order() { return this; },
    async limit() {
      return { data: [{ storage_path: paths[0] }, { storage_path: "ruta-tomada-por-otro-worker" }], error: null };
    },
  };
  const admin = {
    from(table: string) {
      assert.equal(table, "artifact_source_storage_cleanup");
      return {
        select: () => dueQuery,
        update: ({ next_attempt_at }: { next_attempt_at: string }) => ({ in: () => ({
          lte: (_column: string, cutoff: string) => {
            assert.ok(next_attempt_at > cutoff);
            return { select: async () => ({ data: [{ storage_path: paths[0] }], error: null }) };
          },
        }) }),
        delete: () => ({ in: async (_column: string, deleted: string[]) => {
          acknowledged.push(deleted);
          return { error: null };
        } }),
      };
    },
    storage: { from(bucket: string) {
      assert.equal(bucket, COURSE_SOURCE_BUCKET);
      return { remove: async (claimed: string[]) => {
        removalAttempts.push(claimed);
        return { error: failure ? storageError : null };
      } };
    } },
  } as unknown as SupabaseClient;

  await assert.rejects(cleanDeletedArtifactSources(admin), storageError);
  assert.deepEqual(acknowledged, []);
  failure = false;
  assert.equal(await cleanDeletedArtifactSources(admin), 1);
  assert.deepEqual(removalAttempts, [paths, paths]);
  assert.deepEqual(acknowledged, [paths]);
});
