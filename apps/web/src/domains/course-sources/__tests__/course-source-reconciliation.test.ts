import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { observeSourceObject, purgeAbandonedSource } from "../course-source-reconciliation";

function fixture(options: { status?: string; expired?: string; observations?: string[]; recorded?: string; referenced?: boolean; removeError?: boolean } = {}) {
  const effects: string[] = [];
  const observations = [...(options.observations || ["v1", "404"])];
  const client = {
    from(table: string) {
      let updating = false; let references = false;
      const query = {
        select() { return query; }, eq(field: string) { if (field === "supersedes_id") references = true; return query; },
        update() { updating = true; effects.push("audit"); return query; },
        async maybeSingle() {
          return { error: null, data: table === "course_source_documents" ? {
            id: "doc", status: options.status || "RESERVED", expires_at: options.expired || "2000-01-01T00:00:00Z", storage_path: "private/path",
          } : { observation: options.recorded || "PRESENT", object_version: "v1", purged_at: null } };
        },
        async limit() { return { error: null, data: options.referenced && (table === "course_source_fragments" || references) ? [{ id: "reference" }] : [] }; },
        then(resolve: (value: object) => void) { resolve({ error: null, data: updating ? [] : null }); },
      }; return query;
    },
    storage: { from() { return {
      async info() { effects.push("info"); const state = observations.shift(); return state === "404" || state === "503"
        ? { data: null, error: { statusCode: state } } : { data: { version: state }, error: null }; },
      async remove(paths: string[]) { effects.push("remove"); assert.deepEqual(paths, ["private/path"]); return { error: options.removeError ? {} : null }; },
    }; } },
  } as unknown as SupabaseClient;
  return { client, effects };
}
test("purga vuelve a comprobar objeto y registra ausencia confirmada sin borrar historial", async () => {
  const f = fixture(); assert.equal((await purgeAbandonedSource(f.client,"course","org","actor","doc")).purged,true);
  assert.deepEqual(f.effects,["info","remove","info","audit"]);
});
test("incertidumbre, objeto cambiado, referencias y retención impiden el borrado", async () => {
  for (const options of [{ observations:["503"] }, { observations:["v2"] }, { referenced:true },
    { expired: new Date().toISOString() }, { status:"READY" }, { recorded:"UNKNOWN" }]) {
    const f=fixture(options); await assert.rejects(purgeAbandonedSource(f.client,"course","org","actor","doc"));
    assert.equal(f.effects.includes("remove"),false); assert.equal(f.effects.includes("audit"),false);
  }
});
test("un resultado incierto al borrar no acredita purga exitosa", async () => {
  const f=fixture({removeError:true}); await assert.rejects(purgeAbandonedSource(f.client,"course","org","actor","doc"));
  assert.equal(f.effects.includes("audit"),false);
});
test("solo 404 significa ausente; no interpreta errores del proveedor como archivo perdido", async () => {
  assert.equal((await observeSourceObject(fixture({observations:["404"]}).client,"path")).observation,"MISSING");
  assert.equal((await observeSourceObject(fixture({observations:["503"]}).client,"path")).observation,"UNKNOWN");
});
