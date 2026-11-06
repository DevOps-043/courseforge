import assert from "node:assert/strict";
import test from "node:test";
import { fragmentSourceText } from "../course-source-extraction";
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
