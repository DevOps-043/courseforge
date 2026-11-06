import assert from "node:assert/strict";
import test from "node:test";
import { load } from "../../../app/login/__tests__/source-test-loader";
import { CourseSourceError } from "../course-source-error";
import {
  COURSE_SOURCE_BUCKET,
  COURSE_SOURCE_LIMITS,
} from "../course-source-policy";

function fixture(
  kind: "SYLLABUS_DOCUMENT" | "CURATION_PDF",
  sourceOverride: Record<string, unknown> = {},
  size = 100,
) {
  const effects: Record<string, unknown>[] = [];
  let downloads = 0;
  const source =
    kind === "SYLLABUS_DOCUMENT"
      ? {
          filename: "Manual.pdf",
          extracted_text: "Texto histórico recuperado de manera explícita.",
          content_sha256: "a".repeat(64),
          ...sourceOverride,
        }
      : {
          file_name: "Manual.pdf",
          storage_bucket: "curation-sources",
          storage_path: "organizations/org/curation-sources/course/file.pdf",
          content_sha256: null,
          ...sourceOverride,
        };
  const document = {
    id: "document",
    storage_path: "organizations/org/courses/course/document",
    status: "RESERVED",
  };
  const service = load<{
    importLegacySource: (
      ...args: unknown[]
    ) => Promise<{ originalAvailable: boolean }>;
  }>("src/domains/course-sources/course-source-legacy.ts", {
    "./course-source-policy": { COURSE_SOURCE_BUCKET, COURSE_SOURCE_LIMITS },
    "./course-source-error": {
      CourseSourceError,
      sourcePersistenceError: (error: unknown) => {
        throw error;
      },
    },
    "./course-source.repository": {
      CourseSourceRepository: class {
        constructor(_admin: unknown, actor: unknown) {
          assert.deepEqual(actor, { organizationId: "org", userId: "user" });
        }
        async reserve(artifact: string, input: unknown) {
          assert.equal(artifact, "course");
          effects.push({ reservation: input });
          return document;
        }
        async get() {
          return document;
        }
      },
    },
    "./course-source.service": {
      CourseSourceService: class {
        async confirm() {
          document.status = "UPLOADED";
        }
      },
    },
    "./course-source-storage": { createSourceStorage: () => ({}) },
    "./course-source.schema": {
      publicSourceDocument: (value: unknown) => value,
    },
  });
  const database = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value;
          return query;
        },
        maybeSingle: async () => {
          if (table === "course_source_legacy_imports")
            return { data: null, error: null };
          assert.equal(filters.id, "source");
          assert.equal(
            filters[
              kind === "SYLLABUS_DOCUMENT"
                ? "artifact_id"
                : "curation.artifact_id"
            ],
            "course",
          );
          return { data: source, error: null };
        },
        insert: async (payload: Record<string, unknown>) => {
          effects.push(payload);
          return { error: null };
        },
      };
      return query;
    },
    storage: {
      from: (bucket: string) => ({
        info: async () => ({ data: { size }, error: null }),
        download: async () => {
          downloads++;
          return { data: new Blob([new Uint8Array(size)]), error: null };
        },
        upload: async (path: string, bytes: ArrayBuffer, options: unknown) => {
          assert.equal(bucket, COURSE_SOURCE_BUCKET);
          effects.push({
            path,
            text: new TextDecoder().decode(bytes),
            options,
          });
          return { error: null };
        },
      }),
    },
  };
  return {
    run: () =>
      service.importLegacySource(
        database,
        "course",
        { organizationId: "org", userId: "user" },
        { kind, sourceId: "source", idempotencyKey: "key" },
      ),
    effects,
    downloads: () => downloads,
  };
}
test("el temario histórico crea TXT derivado y conserva procedencia sin fingir un original", async () => {
  const current = fixture("SYLLABUS_DOCUMENT");
  const result = await current.run();
  assert.equal(result.originalAvailable, false);
  const reservation = current.effects[0].reservation as Record<string, unknown>;
  assert.equal(reservation.mimeType, "text/plain");
  assert.match(String(reservation.filename), /-texto-importado.txt$/);
  assert.equal(current.effects.at(-1)!.origin_kind, "SYLLABUS_DOCUMENT");
  assert.equal(current.effects.at(-1)!.original_available, false);
  assert.equal(current.downloads(), 0);
});
test("un PDF ajeno, con traversal, excesivo o sin integridad no se copia", async () => {
  for (const overrides of [
    { storage_path: "organizations/otra/curation-sources/course/file.pdf" },
    { storage_path: "organizations/org/curation-sources/course/../file.pdf" },
    {
      storage_path: "organizations/org/curation-sources/course/%2e%2e/file.pdf",
    },
    { storage_bucket: "public" },
  ]) {
    const current = fixture("CURATION_PDF", overrides);
    await assert.rejects(current.run(), /no disponible/);
    assert.equal(current.downloads(), 0);
    assert.equal(current.effects.length, 0);
  }
  const excessive = fixture(
    "CURATION_PDF",
    {},
    COURSE_SOURCE_LIMITS.fileBytes + 1,
  );
  await assert.rejects(excessive.run(), /tamaño válido/);
  assert.equal(excessive.downloads(), 0);
  const corrupt = fixture("CURATION_PDF", { content_sha256: "a".repeat(64) });
  await assert.rejects(corrupt.run(), /integridad/);
  assert.equal(corrupt.effects.length, 0);
});
