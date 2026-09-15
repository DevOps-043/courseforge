import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { buildSyllabusDocumentContext } from "../syllabus-generation";
import { extractSyllabusSourceDocument } from "../syllabus-document-extractor";

test("extracts normalized text from multiple supported document formats", async () => {
  const docx = new JSZip();
  docx.file(
    "word/document.xml",
    "<w:document><w:body><w:p><w:r><w:t>Concepto central</w:t></w:r></w:p><w:p><w:r><w:t>Proceso y aplicación práctica para el participante.</w:t></w:r></w:p></w:body></w:document>",
  );
  const pptx = new JSZip();
  pptx.file(
    "ppt/slides/slide1.xml",
    "<p:sld><a:p><a:r><a:t>Introducción del curso</a:t></a:r></a:p><a:p><a:r><a:t>Ejemplo empresarial desarrollado paso a paso.</a:t></a:r></a:p></p:sld>",
  );

  const documents = await Promise.all([
    extractSyllabusSourceDocument(new File([
      "Principios del curso y metodología detallada para desarrollar las competencias esperadas.",
    ], "fuente.txt", { type: "text/plain" })),
    extractSyllabusSourceDocument(new File([
      await docx.generateAsync({ type: "arraybuffer" }),
    ], "manual.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    })),
    extractSyllabusSourceDocument(new File([
      await pptx.generateAsync({ type: "arraybuffer" }),
    ], "presentacion.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    })),
  ]);

  assert.equal(documents.length, 3);
  assert.match(documents[1].text, /Concepto central\nProceso y aplicación práctica/);
  assert.match(documents[2].text, /Diapositiva 1\nIntroducción del curso/);
});

test("makes attached documents the primary generation context", () => {
  const context = buildSyllabusDocumentContext("A_WITH_SOURCE", [{
    characterCount: 68,
    fileId: "f391ff14-030d-45ec-98ff-027f47eb5387",
    filename: "programa.txt",
    mimeType: "text/plain",
    sizeBytes: 1024,
    text: "Este documento define el alcance, la secuencia y los conceptos del curso.",
  }]);

  assert.match(context, /FUENTES DOCUMENTALES PRIMARIAS/);
  assert.match(context, /fuente principal/);
  assert.match(context, /investigación web solo como complemento secundario/i);
  assert.match(context, /Este documento define el alcance/);
  assert.equal(buildSyllabusDocumentContext("B_NO_SOURCE", []), "");
  assert.throws(
    () => buildSyllabusDocumentContext("A_WITH_SOURCE", []),
    /requiere al menos un documento/,
  );
});
