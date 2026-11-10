import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { extractCourseSource, fragmentSourceText } from "../course-source-extraction";
import { COURSE_SOURCE_FORMATS } from "../course-source-policy";

test("DOCX y TXT largos conservan la sección final con un presupuesto de laboratorio", async t => {
  const text = "Procedimiento de acceso y excepción aplicable. ".repeat(4500) + "Sección final: solicitar autorización. 😀";
  const archive = new JSZip();
  archive.file("word/document.xml", `<w:document><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:document>`);
  const docx = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  for (const file of [
    new File([text], "largo.txt", { type: COURSE_SOURCE_FORMATS.txt }),
    new File([Uint8Array.from(docx).buffer], "largo.docx", { type: COURSE_SOURCE_FORMATS.docx }),
  ]) {
    const started = performance.now();
    const initialRss = process.memoryUsage().rss;
    const extracted = await extractSyllabusSourceDocument(file, { maxCharacters: 250_000 });
    assert.equal(extracted.text, text);
    assert.equal(fragmentSourceText(extracted.text).map(fragment => fragment.text).join(""), text);
    t.diagnostic(`${file.name}: ${file.size} bytes, ${text.length} unidades UTF-16, ${Math.round(performance.now() - started)} ms, delta RSS ${process.memoryUsage().rss - initialRss} bytes`);
    await assert.rejects(extractSyllabusSourceDocument(file), /40,000/);
  }
});
import { extractSyllabusSourceDocument } from "../../syllabus/lib/syllabus-document-extractor";

test("fragmentación preserva todo el texto y localizadores posteriores al extracto histórico", () => {
  const text = "Contenido con acentos y ejemplos. ".repeat(1000);
  const fragments = fragmentSourceText(text);
  assert.equal(fragments.map(fragment => fragment.text).join(""), text);
  assert.ok(fragments.some(fragment => fragment.locator.characterStart > 12000));
  for (const fragment of fragments) {
    assert.equal(text.slice(fragment.locator.characterStart, fragment.locator.characterEnd), fragment.text);
    assert.match(fragment.sha256, /^[a-f0-9]{64}$/);
  }
});

test("un carácter Unicode en el límite se conserva íntegro en el JSON de PostgreSQL", () => {
  const text = "a".repeat(1999) + "😀" + " texto final";
  const fragments = fragmentSourceText(text);
  assert.equal(fragments[0].locator.characterEnd, 1999);
  assert.equal(fragments[1].locator.characterStart, 1999);
  assert.equal(fragments.map(fragment => fragment.text).join(""), text);
  assert.doesNotMatch(JSON.stringify(fragments), /\\ud[89a-f][0-9a-f]{2}/i);
});

test("TXT y DOCX superiores al tope anterior llegan íntegros al commit documental", async () => {
  const text = "a".repeat(1999) + "😀 " + "Sección del manual. ".repeat(27000) + "Texto al final del manual.";
  const archive = new JSZip();
  archive.file("[Content_Types].xml", "<Types/>");
  archive.file("word/document.xml", `<w:document><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:document>`);
  const inputs = [
    { format: "txt" as const, bytes: Buffer.from(text) },
    { format: "docx" as const, bytes: await archive.generateAsync({ type: "nodebuffer" }) },
  ];
  for (const { format, bytes } of inputs) {
    const document = {
      id: randomUUID(), artifact_id: randomUUID(), organization_id: randomUUID(), created_by: randomUUID(),
      request_key: randomUUID(), filename: `prueba.${format}`, mime_type: COURSE_SOURCE_FORMATS[format],
      size_bytes: bytes.length, expected_sha256: createHash("sha256").update(bytes).digest("hex"),
      content_sha256: null, storage_path: "original", status: "UPLOADED",
      expires_at: "", created_at: "", uploaded_at: null,
    };
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: document }) };
    const calls: { p_action: string; p_fragments?: unknown }[] = [];
    const admin = {
      from: () => query,
      storage: { from: () => ({
        info: async () => ({ data: { size: bytes.length } }),
        download: async () => ({ data: new Blob([Uint8Array.from(bytes).buffer]) }),
      }) },
      rpc: async (_rpc: string, input: (typeof calls)[number]) => {
        calls.push(input);
        return { data: "lease" };
      },
    } as unknown as SupabaseClient;
    await extractCourseSource(admin, document.artifact_id, document.id, document.organization_id);
    assert.equal(calls[0].p_action, "reserve");
    assert.deepEqual(calls[0].p_fragments, { textLimitUnits: 600_000 });
    assert.equal(calls.at(-1)?.p_action, "publish");
    const appends = calls.slice(1, -1);
    assert.ok(appends.length > 1 && appends.every(call => call.p_action === "append"));
    assert.equal(appends.flatMap(call => call.p_fragments as ReturnType<typeof fragmentSourceText>).map(fragment => fragment.text).join(""), text);
    assert.doesNotMatch(JSON.stringify(appends), /\\ud[89a-f][0-9a-f]{2}/i);
  }
});

test("PDF textual real se extrae y un documento sin texto suficiente se rechaza", async () => {
  const content = "Procedimiento corporativo para verificar identidad y mantener la seguridad de cada participante.";
  const stream = `BT /F1 12 Tf 72 720 Td (${content}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const start = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  const extracted = await extractSyllabusSourceDocument(new File([pdf], "manual.pdf", { type: "application/pdf" }));
  assert.ok(extracted.text.includes(content));
  await assert.rejects(extractSyllabusSourceDocument(new File(["Texto corto"], "vacio.txt", { type: "text/plain" })), /suficiente texto/);
});
