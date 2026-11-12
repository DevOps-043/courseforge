import assert from "node:assert/strict";
import test from "node:test";
import { load } from "../../../app/login/__tests__/source-test-loader";
import * as generation from "../course-source-generation";
import * as baseBatches from "../course-source-base-batches";
import { CourseSourceError } from "../course-source-error";
const id = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const text =
  "El manual exige verificar la identidad antes de conceder acceso al curso.";
const source: generation.GenerationSource = {
  id: id(1),
  documentId: id(2),
  kind: "DOCUMENT",
  title: "Manual.txt",
  text,
  hash: generation.sourceTextHash(text),
  locator: { characterStart: 16000, characterEnd: 16000 + text.length },
};
const context: generation.CourseGenerationContext = {
  snapshotId: id(3),
  artifactId: id(4),
  stage: "MATERIALS",
  lessonId: "lesson-1",
  revision: 4,
  fingerprint: "hash",
  policy: "DOCUMENTS_ONLY",
  sources: [source],
};
const output = {
  text: "Verificar la identidad antes de conceder acceso al curso.",
};
const grounding = {
  supported: true,
  explanation: "Respaldado",
  citations: [{ sourceId: source.id, quote: text, claim: output.text }],
};

test("la política documental contrasta la organización del curso y bloquea una configuración ajena", async () => {
  const settings = load<{
    readCourseSourcePolicy: (...args: unknown[]) => Promise<unknown>;
  }>("src/domains/course-sources/course-source-settings.ts", {
    "./course-source-error": {
      CourseSourceError,
      sourcePersistenceError: (error: unknown) => {
        throw error;
      },
    },
  });
  function database(organization: string) {
    return {
      from: (table: string) => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({
            data:
              table === "artifacts"
                ? { organization_id: organization }
                : {
                    policy: "DOCUMENTS_ONLY",
                    revision: 1,
                    approved_revision: null,
                    organization_id: id(1),
                  },
            error: null,
          }),
        };
        return query;
      },
    };
  }
  await settings.readCourseSourcePolicy(database(id(1)), id(4));
  await assert.rejects(
    settings.readCourseSourcePolicy(database(id(2)), id(4)),
    /organización actual/,
  );
});

test("citas requieren texto y afirmación literales, IDs vigentes y juicio favorable", () => {
  assert.deepEqual(
    generation.validateSourceGrounding(context, output, grounding),
    grounding,
  );
  for (const [groundingReason, candidate] of Object.entries({
    UNSUPPORTED_OUTPUT: { ...grounding, supported: false },
    SOURCE_NOT_IN_CONTEXT: {
      ...grounding,
      citations: [{ ...grounding.citations[0], sourceId: id(90) }],
    },
    QUOTE_NOT_IN_SOURCE: {
      ...grounding,
      citations: [
        { ...grounding.citations[0], quote: "Una cita totalmente inexistente" },
      ],
    },
    CLAIM_NOT_IN_OUTPUT: {
      ...grounding,
      citations: [
        { ...grounding.citations[0], claim: "Una afirmación que no aparece" },
      ],
    },
  })) {
    assert.throws(
      () => generation.validateSourceGrounding(context, output, candidate),
      { name: "CourseSourceError", status: 409, groundingReason },
    );
  }
  assert.throws(
    () =>
      generation.validateSourceGrounding(
        context,
        {
          ...output,
          private:
            "https://db/storage/v1/object/sign/course-source-originals/a",
        },
        grounding,
      ),
    /privada/,
  );
});
test("el presupuesto rechaza excesos y conserva evidencia posterior a 12000 caracteres", () => {
  generation.checkGenerationBudget([source], true);
  assert.match(generation.courseSourcePrompt(context), /characterStart.*16000/);
  assert.match(
    generation.courseSourcePrompt(context),
    /El manual exige verificar/,
  );
  assert.throws(
    () =>
      generation.checkGenerationBudget(
        [{ ...source, text: "a".repeat(60_001) }],
        true,
      ),
    /presupuesto/,
  );
  assert.throws(() => generation.checkGenerationBudget([]), /Faltan/);
});

function fixture(policy: string | null = "DOCUMENTS_ONLY", approved = true, longSources: generation.GenerationSource[] = []) {
  const effects: { name: string; payload: Record<string, unknown> }[] = [];
  let modelCalls = 0;
  const service = load<{
    prepareCourseGeneration: (
      ...args: unknown[]
    ) => Promise<generation.CourseGenerationContext | null>;
    attestCourseGeneration: (...args: unknown[]) => Promise<string | null>;
  }>(
    "src/domains/course-sources/course-source-generation.service.ts",
    {
      ai: {
        generateObject: async (request: Record<string, unknown>) => {
          modelCalls++;
          assert.equal(request.tools, undefined);
          assert.match(String(request.prompt), /Audita el respaldo/);
          return { object: grounding, usage: {} };
        },
      },
      "../../../netlify/functions/shared/bootstrap": {
        resolveAiModel: (model: string) => model,
      },
      "../../shared/ai/usage-telemetry": { recordAiSdkUsage: async () => {} },
      "./course-source-review.service": {
        readCourseSourcePolicy: async () =>
          policy === "LEGACY"
            ? null
            : { policy, revision: 4, organization_id: id(20) },
        readSourceReview: async () => ({
          approved,
          revision: 4,
          coverage: [{ complete: true }],
          associations: [
            { lessonId: "lesson-1", evidenceId: source.id },
            { lessonId: "lesson-2", evidenceId: id(8) },
          ],
          evidence: [],
        }),
      },
      "./course-source-error": {
        CourseSourceError,
        sourcePersistenceError: (error: unknown) => {
          throw error;
        },
      },
      "./course-source-generation": generation,
      "./course-source-base-batches": baseBatches,
    },
    { AbortSignal },
  );
  const database = {
    from: (table: string) => {
      assert.equal(table, "course_source_fragments");
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: async () => ({
          data: longSources.length ? longSources.map(item => ({
            id: item.id, document_id: item.documentId, text_content: item.text,
            content_sha256: item.hash, locator: item.locator, course_source_documents: { filename: item.title },
          })) : [
            {
              id: source.id,
              document_id: source.documentId,
              text_content: source.text,
              content_sha256: source.hash,
              locator: source.locator,
              course_source_documents: { filename: source.title },
            },
            {
              id: id(8),
              document_id: id(9),
              text_content: "Evidencia de otra lección que no se enviará.",
              content_sha256: "b".repeat(64),
              locator: {},
              course_source_documents: { filename: "Otro.txt" },
            },
          ],
          error: null,
        }),
      };
      return builder;
    },
    rpc: async (name: string, payload: Record<string, unknown>) => {
      effects.push({ name, payload });
      return {
        data:
          name === "course_source_generation_fingerprint"
            ? "hash"
            : name === "course_source_snapshot_current"
              ? true
              : name === "read_course_source_base_batch_progress"
                ? { status: "COMPLETE", findings: [[{ fragmentId: longSources.at(-1)!.id,
                  quote: "La última regla exige autorización.", finding: "Aplicar autorización" }]] }
              : name === "course_source_curriculum"
                ? {
                    modules: [{ id: "current" }],
                    plans: [],
                    base: { objetivos: ["Aplicar"] },
                    syllabusVersion: 7,
                  }
                : id(3),
        error: null,
      };
    },
  };
  return { service, database, effects, calls: () => modelCalls };
}

test("Base vincula el manifiesto completo y reutiliza solo evidencia confirmada de una fuente larga", async () => {
  const sources = Array.from({ length: 64 }, (_, index) => ({
    ...source, id: id(index + 100), text: "La última regla exige autorización.".padEnd(2000, "a"),
  }));
  const { service, database, effects, calls } = fixture("DOCUMENTS_ONLY", true, sources);
  const context = await service.prepareCourseGeneration(database, id(4), "BASE", null, undefined, "nuevo-intento", undefined, {
    purpose: "Taller de permisos", model: "gemini-primary", deadline: Date.now() + 10_000,
  });
  assert.deepEqual(context!.sources.map(item => item.id), [sources.at(-1)!.id]);
  assert.equal(context!.sources[0].text, "La última regla exige autorización.");
  const snapshot = effects.find(effect => effect.name === "snapshot_course_source_generation");
  const manifest = snapshot?.payload.p_manifest as { id: string; text?: string }[];
  assert.deepEqual(Array.from(manifest, item => item.id), sources.map(item => item.id));
  assert.ok(manifest.every(item => item.text === undefined));
  assert.ok(effects.some(effect => effect.name === "create_course_source_batch_run"));
  assert.equal(calls(), 0);
});

test("no vincula inputs anteriores a un fingerprint nuevo y conserva la clave de ejecución", async () => {
  const stale = fixture();
  await assert.rejects(
    stale.service.prepareCourseGeneration(
      stale.database,
      id(4),
      "PLAN",
      null,
      undefined,
      "plan:1",
      { modules: [{ id: "old" }] },
    ),
    /entradas curriculares cambiaron/,
  );
  assert.equal(
    stale.effects.some(
      (item) => item.name === "snapshot_course_source_generation",
    ),
    false,
  );
  const current = fixture();
  for (let attempt = 0; attempt < 2; attempt++) {
    const prepared = await current.service.prepareCourseGeneration(
      current.database,
      id(4),
      "PLAN",
      null,
      undefined,
      "plan:1",
      { modules: [{ id: "current" }] },
    );
    assert.equal(prepared!.syllabusVersion, 7);
  }
  const snapshots = current.effects.filter(
    (item) => item.name === "snapshot_course_source_generation",
  );
  assert.equal(
    snapshots[0].payload.p_execution,
    snapshots[1].payload.p_execution,
  );
});
test("contexto por lección usa revisión aprobada, localizador real y manifiesto sin duplicar texto documental", async () => {
  const { service, database, effects, calls } = fixture();
  const resolved = await service.prepareCourseGeneration(
    database,
    id(4),
    "MATERIALS",
    "lesson-1-G2",
  );
  assert.equal(resolved!.sources.length, 1);
  assert.deepEqual(resolved!.sources[0].locator, source.locator);
  const snapshot = effects.find(
    (item) => item.name === "snapshot_course_source_generation",
  )!;
  assert.equal(snapshot.payload.p_organization, id(20));
  assert.equal(snapshot.payload.p_lesson, "lesson-1");
  assert.equal(
    (snapshot.payload.p_manifest as Record<string, unknown>[])[0].text,
    undefined,
  );
  await service.attestCourseGeneration(
    database,
    resolved,
    output,
    "gemini-test",
  );
  assert.equal(calls(), 1);
  assert.ok(
    effects.some((item) => item.name === "attest_course_source_generation"),
  );
});
test("cursos históricos no reciben snapshots; política vacía y revisión pendiente bloquean antes de generar", async () => {
  for (const policy of ["LEGACY", "WEB_ONLY"]) {
    const { service, database, effects, calls } = fixture(policy);
    assert.equal(
      await service.prepareCourseGeneration(database, id(4), "BASE"),
      null,
    );
    assert.equal(effects.length, 0);
    assert.equal(calls(), 0);
  }
  const pending = fixture(null);
  await assert.rejects(
    pending.service.prepareCourseGeneration(pending.database, id(4), "BASE"),
    /Elige/,
  );
  const unapproved = fixture("DOCUMENTS_ONLY", false);
  await assert.rejects(
    unapproved.service.prepareCourseGeneration(
      unapproved.database,
      id(4),
      "MATERIALS",
      "lesson-1",
    ),
    /Aprueba/,
  );
  assert.equal(
    unapproved.effects.some(
      (item) => item.name === "snapshot_course_source_generation",
    ),
    false,
  );
});
