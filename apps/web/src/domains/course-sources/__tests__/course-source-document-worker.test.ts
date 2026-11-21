import assert from "node:assert/strict";
import test from "node:test";
import { load } from "../../../app/login/__tests__/source-test-loader";
import * as materialSet from "../course-source-material-set";
import { PIPELINE_GENERATION_LIMITS } from "../../../lib/pipeline-generation-policy";

function fixture(
  policy: "DOCUMENTS_ONLY" | "DOCUMENTS_AND_WEB",
  complete = false,
  cancelAfterSearch = false,
) {
  let searches = 0;
  let clients = 0;
  let active = true;
  const writes: Record<string, unknown>[] = [];
  const worker = load<{
    runDocumentCuration: (params: Record<string, unknown>) => Promise<number>;
  }>("netlify/functions/shared/curation-v2/document-workflow.ts", {
    openai: {
      default: class {
        constructor() {
          clients++;
        }
      },
    },
    "../../../../src/domains/course-sources/course-source-review.service": {
      readSourceReview: async () => ({
        policy,
        planReady: true,
          organizationId:"org-sintetica",
        revision: 3,
        curriculumHash: "hash",
        approved: complete,
        lessons: [
          {
            id: "lesson",
            title: "Seguridad",
            webRequired: 2,
            requirements: [
              { id: "objective", label: "Verificar identidad" },
              { id: "topic:0", label: "Permisos" },
            ],
          },
        ],
        evidence: [
          { id: "doc", type: "DOCUMENT", title: "Manual", text: "Contenido" },
          ...(complete ? [1,2].map(index => ({ id: `web-${index}`, type: "WEB", lessonId: "lesson", title: "Web", text: "Contenido validado", sourceRef: `https://example.invalid/${index}` })) : []),
        ],
        associations: [
          {
            lessonId: "lesson",
            evidenceType: "DOCUMENT",
            evidenceId: "doc",
            requirementIds: complete ? ["objective", "topic:0"] : ["objective"],
            verified: true,
            conflict: false,
            resolution: "",
          },
        ],
      }),
    },
    "../../../../src/domains/course-sources/course-source-material-set": materialSet,
    "./search": {
      searchLessonCandidates: async (input: {
          lessons: { topics: string[]; remaining_sources: number }[];
          organizationId?:string|null;
      }) => {
        searches++;
          assert.equal(input.organizationId,"org-sintetica");
        assert.deepEqual(input.lessons[0].topics, ["Verificar identidad", "Permisos"]);
        assert.equal(input.lessons[0].remaining_sources, 2);
        if (cancelAfterSearch) active = false;
        return [
          {
            lesson_id: "lesson",
            url: "https://example.invalid/permisos",
            title: "Permisos",
            rationale: "Vacío documental",
          },
        ];
      },
    },
    "./validation": {
      SOURCE_VALIDATION_TIMEOUT_MS:15000,
      validateUrlSource: async (url: string) => ({
        isValid: true,
        normalizedUrl: url,
        report: { status: "valid", reason: "Contenido válido", content_excerpt: "El contenido de la fuente respalda los permisos." },
      }),
    },
    "../../../../src/lib/pipeline-generation-policy": {
      PIPELINE_GENERATION_LIMITS,
    },
  });
  return {
    searches: () => searches,
    clients: () => clients,
    writes,
    run: () =>
      worker.runDocumentCuration({
        artifactId: "course",
        curationId: "curation",
        attemptNumber: 1,
        model: "modelo-sintetico",
        openAiApiKey: "no-real",
        supabase: {
          rpc: async (_name: string, payload: Record<string, unknown>) => {
            if (!active) return { error: null, data: false };
            writes.push(payload);
            return { error: null, data: true };
          },
        },
      }),
  };
}
test("solo archivos usa documentos procesados sin cliente web ni aprobación humana", async () => {
  const f = fixture("DOCUMENTS_ONLY");
  assert.equal(await f.run(), 0);
  assert.equal(f.searches(), 0);
  assert.equal(f.clients(), 0);
  assert.equal(
    (f.writes.at(-1)?.p_completion as { state: string }).state,
    "PHASE2_APPROVED",
  );
});
test("conjunto web ya completo no vuelve a buscar en modo mixto", async () => {
  const f = fixture("DOCUMENTS_AND_WEB", true);
  await f.run();
  assert.equal(f.searches(), 0);
  assert.equal(f.clients(), 0);
  assert.equal(
    (f.writes.at(-1)?.p_completion as { state: string }).state,
    "PHASE2_APPROVED",
  );
});
test("mixto completa la investigación y conserva el documento junto a la nueva fuente válida", async () => {
  const f = fixture("DOCUMENTS_AND_WEB");
  assert.equal(await f.run(), 1);
  assert.equal(f.searches(), 1);
  assert.equal(
    (f.writes.at(-1)?.p_completion as { state: string }).state,
    "PHASE2_APPROVED",
  );
});
test("cancelación durante búsqueda no confirma filas ni aprobación", async () => {
  const f = fixture("DOCUMENTS_AND_WEB", false, true);
  await f.run();
  assert.equal(f.writes.length, 2);
  assert.ok(
    f.writes.every((write) => (write.p_rows as unknown[]).length === 0),
  );
});
