import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import JSZip from "jszip";
import { CourseSourceService } from "../course-source.service";
import { COURSE_SOURCE_FORMATS } from "../course-source-policy";
import { createSourceDraftSchema, reserveSourceUploadSchema, sourcePageSchema, type CourseSourceDocument } from "../course-source.schema";
import { verifySourceUpload } from "../course-source-upload-verification";
import { verifyOfficeDirectoryHeader } from "../course-source-office-header";

const course = "10000000-0000-4000-8000-000000000001";
const actor = "20000000-0000-4000-8000-000000000001";
const text = new TextEncoder().encode("Información propia del curso para desarrollar competencias.");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function document(changes: Partial<CourseSourceDocument> = {}): CourseSourceDocument {
  return { id: course, artifact_id: course, organization_id: course, created_by: actor, request_key: course,
    filename: "manual.txt", mime_type: "text/plain", size_bytes: text.length, expected_sha256: hash(text),
    content_sha256: null, storage_path: "ruta-servidor", status: "RESERVED",
    expires_at: "2026-11-05T12:00:00Z", created_at: "2026-11-05T10:00:00Z", uploaded_at: null, ...changes };
}
function fixture(entry = document(), bytes = text) {
  const effects: string[] = [];
  const repository = {
    async reserve() { effects.push("reserve"); return entry; },
    async get() { effects.push("get"); return entry; },
    async confirm(_course: string, _id: string, sha256: string, size: number) {
      effects.push("confirm"); assert.equal(sha256, hash(bytes)); assert.equal(size, bytes.length);
      return { ...entry, status: "UPLOADED" as const, content_sha256: sha256 };
    },
  };
  const storage = {
    async sign(path: string) { effects.push("sign"); assert.equal(path, entry.storage_path); return { signedUrl: "https://example.invalid/privado", token: "token-sintetico" }; },
    async read() { effects.push("read"); return bytes; },
  };
  return { effects, service: new CourseSourceService(repository, storage, actor, () => Date.parse("2026-11-05T11:00:00Z")) };
}

test("contratos rechazan autoridad del payload, rutas y tipos incompatibles", () => {
  const input = { idempotencyKey: course, filename: "manual.txt", mimeType: "text/plain", sizeBytes: text.length, sha256: hash(text) };
  assert.equal(reserveSourceUploadSchema.safeParse(input).success, true);
  for (const patch of [{ artifactId: course }, { organizationId: course }, { storagePath: "otra-ruta" },
    { filename: "../manual.txt" }, { filename: "manual.pdf" }, { sizeBytes: 16 * 1024 * 1024 }, { sha256: "falso" }]) {
    assert.equal(reserveSourceUploadSchema.safeParse({ ...input, ...patch }).success, false);
  }
  assert.equal(createSourceDraftSchema.safeParse({ idempotencyKey: course, title: "Curso", state: "GENERATING" }).success, false);
  assert.equal(sourcePageSchema.safeParse({ limit: "51" }).success, false);
});

test("reserva firma únicamente la ruta persistida y no devuelve hash o identidad privada", async () => {
  const f = fixture(); const result = await f.service.reserve(course, {
    idempotencyKey: course, filename: "manual.txt", mimeType: "text/plain", sizeBytes: text.length, sha256: hash(text),
  });
  assert.deepEqual(f.effects, ["reserve", "sign"]);
  assert.equal(result.upload?.path, "ruta-servidor");
  assert.equal("created_by" in result.document, false);
});

test("confirmación verifica bytes y termina en UPLOADED, nunca READY", async () => {
  const f = fixture(); const result = await f.service.confirm(course, course);
  assert.equal(result.document.status, "UPLOADED");
  assert.deepEqual(f.effects, ["get", "read", "confirm"]);
});

test("confirmación repetida conserva el estado sin descargar ni escribir", async () => {
  for (const status of ["UPLOADED", "PROCESSING", "READY"] as const) {
    const f = fixture(document({ status }));
    assert.equal((await f.service.confirm(course, course)).document.status, status);
    assert.deepEqual(f.effects, ["get"]);
  }
});

test("otro actor, reserva vencida y estado retirado no acceden a Storage", async () => {
  for (const changes of [{ created_by: course }, { expires_at: "2026-11-05T10:00:00Z" }, { status: "RETIRED" as const }]) {
    const f = fixture(document(changes)); await assert.rejects(f.service.confirm(course, course));
    assert.deepEqual(f.effects, ["get"]);
  }
});

test("hash o tamaño diferentes no confirman el documento", async () => {
  for (const entry of [document({ expected_sha256: "b".repeat(64) }), document({ size_bytes: text.length + 1 })]) {
    const f = fixture(entry); await assert.rejects(f.service.confirm(course, course));
    assert.deepEqual(f.effects, ["get", "read"]);
  }
});

test("inspección de recepción acepta los cuatro formatos sin extraerlos", async () => {
  const docx = new JSZip(); docx.file("[Content_Types].xml", "<Types/>"); docx.file("word/document.xml", "<document/>");
  const pptx = new JSZip(); pptx.file("[Content_Types].xml", "<Types/>"); pptx.file("ppt/slides/slide1.xml", "<slide/>");
  for (const [mime, bytes] of [
    [COURSE_SOURCE_FORMATS.txt, text], [COURSE_SOURCE_FORMATS.pdf, new TextEncoder().encode("%PDF-1.7\n")],
    [COURSE_SOURCE_FORMATS.docx, await docx.generateAsync({ type: "uint8array" })],
    [COURSE_SOURCE_FORMATS.pptx, await pptx.generateAsync({ type: "uint8array" })],
  ] as const) {
    const result = await verifySourceUpload(document({ mime_type: mime, size_bytes: bytes.length, expected_sha256: hash(bytes) }), bytes);
    assert.equal(result.sha256, hash(bytes));
  }
});

test("rechaza MIME falsificado y texto binario sin marcar aptitud curricular", async () => {
  const bytes = new Uint8Array([0, 255, 12]);
  for (const mime of Object.values(COURSE_SOURCE_FORMATS)) {
    await assert.rejects(verifySourceUpload(document({ mime_type: mime, size_bytes: bytes.length, expected_sha256: hash(bytes) }), bytes));
  }
});

test("Office rechaza directorios masivos antes de cargar JSZip", async () => {
  const archive = new JSZip(); archive.file("document.xml", "texto");
  const bytes = await archive.generateAsync({ type: "nodebuffer" });
  verifyOfficeDirectoryHeader(bytes);
  bytes.writeUInt16LE(5000, bytes.length - 12);
  bytes.writeUInt16LE(5000, bytes.length - 14);
  assert.throws(() => verifyOfficeDirectoryHeader(bytes));
  bytes.writeUInt16LE(0, bytes.length - 12);
  bytes.writeUInt16LE(0, bytes.length - 14);
  assert.throws(() => verifyOfficeDirectoryHeader(bytes), "No confiar en un contador de entradas falsificado.");
});
