import assert from "node:assert/strict";
import test from "node:test";
import { load } from "../../../app/login/__tests__/source-test-loader";
import * as videoPolicy from "../../video-duration/video-duration-policy";
import { CourseSourceError } from "../course-source-error";
import { SOURCE_GENERATION_LIMITS } from "../course-source-generation";
const course = "10000000-0000-4000-8000-000000000001";
function fixture(documentary = false, authorized = true) {
  const writes: Record<string, unknown>[] = [];
  const filters: Record<string, unknown> = {};
  let dirty = 0;
  const query = {
    update: (value: Record<string, unknown>) => {
      writes.push(value);
      return query;
    },
    eq: (key: string, value: unknown) => {
      filters[key] = value;
      return query;
    },
    is: (key: string, value: unknown) => {
      filters[key] = value;
      return query;
    },
    select: () => query,
    maybeSingle: async () => ({ data: { id: course }, error: null }),
  };
  const action = load<{
    updateArtifactContentAction: (
      id: string,
      updates: unknown,
    ) => Promise<{ success: boolean; error?: string }>;
  }>("src/domains/artifacts/actions/artifact.actions.ts", {
    "@/lib/server/background-function-client": {},
    "../lib/artifact-generation-failure": {},
    "@/lib/pipeline-generation-policy": {},
    "@/lib/errors": {},
    "@/utils/supabase/server": {
      createClient: async () => ({
        from: () => {
          throw new Error("La escritura no debe usar el cliente de sesión");
        },
      }),
    },
    "@/utils/auth/session": {},
    "@/lib/server/tenant-context": {},
    "@/lib/server/artifact-action-auth": {
      getAuthenticatedUser: async () => ({ userId: course }),
      getAuthorizedArtifactAdmin: async () =>
        authorized
          ? {
              artifact: { organization_id: course },
              admin: {
                from: (table: string) => {
                  assert.equal(table, "artifacts");
                  return query;
                },
              },
            }
          : null,
    },
    "@/lib/server/pipeline-dirty-actions": {
      markDownstreamDirtyAction: async () => {
        dirty++;
      },
    },
    "@/domains/video-duration/video-duration-policy": videoPolicy,
    "@/domains/course-sources/course-source-settings": {
      readCourseSourcePolicy: async () =>
        documentary ? { policy: "DOCUMENTS_ONLY" } : null,
    },
    "@/domains/course-sources/course-source-error": { CourseSourceError },
    "@/domains/course-sources/course-source-generation": {
      SOURCE_GENERATION_LIMITS,
    },
  });
  return { action, writes, filters, dirty: () => dirty };
}
test("edición histórica usa autorización del recurso y campos permitidos, sin depender de grants documentales al navegador", async () => {
  const current = fixture();
  assert.equal(
    (
      await current.action.updateArtifactContentAction(course, {
        nombres: ["Curso revisado"],
      })
    ).success,
    true,
  );
  assert.deepEqual(JSON.parse(JSON.stringify(current.writes)), [
    { nombres: ["Curso revisado"] },
  ]);
  assert.equal(current.filters.organization_id, course);
  assert.equal(current.dirty(), 1);
  const forged = fixture();
  assert.equal(
    (
      await forged.action.updateArtifactContentAction(course, {
        nombres: ["Cambio"],
        organization_id: course,
      })
    ).success,
    false,
  );
  assert.equal(forged.writes.length, 0);
});
test("la edición directa no hereda recibos documentales ni evita autorización", async () => {
  const current = fixture(true);
  const result = await current.action.updateArtifactContentAction(course, {
    objetivos: ["Un objetivo nuevo sin comprobar"],
  });
  assert.equal(result.success, false);
  assert.match(result.error!, /Regenerar/);
  assert.equal(current.writes.length, 0);
  assert.equal(current.dirty(), 0);
  const denied = fixture(false, false);
  assert.equal(
    (
      await denied.action.updateArtifactContentAction(course, {
        nombres: ["Cambio"],
      })
    ).success,
    false,
  );
  assert.equal(denied.writes.length, 0);
});
