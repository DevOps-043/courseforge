import assert from "node:assert/strict";
import test from "node:test";
import { load } from "../../../app/login/__tests__/source-test-loader";
import { CourseSourceError } from "../course-source-error";
test("la entrega documental exige revisión vigente y la versión exacta del paquete encolado", async () => {
  let effects = 0;
  const service = load<{
    assertCourseSourcePublication: (...args: unknown[]) => Promise<unknown>;
    assertNoPrivateSourceReferences: (payload: unknown) => void;
  }>("src/domains/course-sources/course-source-publication.ts", {
    "./course-source-settings": {
      readCourseSourcePolicy: async () => ({
        policy: "DOCUMENTS_ONLY",
        revision: 3,
      }),
    },
    "./course-source-error": { CourseSourceError },
  });
  const database = {
    rpc: async (name: string, payload: Record<string, unknown>) => {
      assert.equal(payload.p_artifact, "course");
      effects++;
      return {
        data: name === "course_source_generation_fingerprint" ? "hash" : null,
        error: null,
      };
    },
  };
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await service.assertCourseSourcePublication(database, "course", {
          revision: 3,
          fingerprint: "hash",
        }),
      ),
    ),
    { revision: 3, fingerprint: "hash" },
  );
  await assert.rejects(
    service.assertCourseSourcePublication(database, "course", {
      revision: 2,
      fingerprint: "hash",
    }),
    /encolado/,
  );
  assert.equal(effects, 4);
  for (const reference of [
    "private://curation-sources/file.pdf",
    "https://db/storage/v1/object/sign/course-source-originals/file",
    "organizations/org/courses/course/document",
  ]) {
    assert.throws(
      () => service.assertNoPrivateSourceReferences({ reference }),
      /privadas/,
    );
  }
  service.assertNoPrivateSourceReferences({
    content: "Contenido educativo",
    sources: ["Título del manual"],
  });
});
