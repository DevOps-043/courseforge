import JSZip from "jszip";
import {
  SYLLABUS_SOURCE_DOCUMENT_MAX_CHARACTERS,
  SYLLABUS_SOURCE_DOCUMENT_MAX_FILE_BYTES,
  type SyllabusSourceDocument,
} from "../syllabus-source-documents";

const MINIMUM_USABLE_CHARACTERS = 50;
const MAX_OFFICE_XML_BYTES = 10 * 1024 * 1024;
const MAX_PPTX_SLIDES = 500;

export async function extractSyllabusSourceDocument(
  file: File,
): Promise<SyllabusSourceDocument> {
  if (!file.name.trim() || file.name.length > 255) {
    throw new Error("El nombre del documento debe tener entre 1 y 255 caracteres.");
  }
  if (file.size < 1 || file.size > SYLLABUS_SOURCE_DOCUMENT_MAX_FILE_BYTES) {
    throw new Error(`${file.name}: el archivo debe pesar entre 1 byte y 15 MB.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = file.name.toLowerCase().split(".").pop();
  const mimeType = resolveMimeType(file.type, extension);
  let text: string;

  if (mimeType === "application/pdf") {
    text = await extractPdfText(bytes);
  } else if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    text = await extractDocxText(bytes);
  } else if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    text = await extractPptxText(bytes);
  } else {
    text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }

  const normalizedText = normalizeDocumentText(text).slice(
    0,
    SYLLABUS_SOURCE_DOCUMENT_MAX_CHARACTERS,
  );
  if (normalizedText.length < MINIMUM_USABLE_CHARACTERS) {
    throw new Error(
      `${file.name}: no contiene suficiente texto extraíble. Si es un PDF escaneado, aplica OCR antes de subirlo.`,
    );
  }

  return {
    characterCount: normalizedText.length,
    fileId: crypto.randomUUID(),
    filename: file.name,
    mimeType,
    sizeBytes: file.size,
    text: normalizedText,
  };
}

async function extractPdfText(bytes: Uint8Array) {
  if (Buffer.from(bytes.slice(0, 5)).toString("ascii") !== "%PDF-") {
    throw new Error("El archivo PDF no tiene una cabecera válida.");
  }

  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractDocxText(bytes: Uint8Array) {
  const zip = await loadOfficeArchive(bytes, "DOCX");
  const documentEntry = zip.file("word/document.xml");
  assertOfficeEntrySize(documentEntry, "El contenido XML del DOCX");
  const documentXml = await documentEntry?.async("string");
  if (!documentXml) throw new Error("El DOCX no contiene word/document.xml.");

  return extractXmlText(
    documentXml
      .replace(/<w:tab\b[^>]*\/>/g, "\t")
      .replace(/<w:br\b[^>]*\/>/g, "\n")
      .replace(/<\/w:p>/g, "\n"),
  );
}

async function extractPptxText(bytes: Uint8Array) {
  const zip = await loadOfficeArchive(bytes, "PPTX");
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/i.test(path))
    .sort((left, right) => slideNumber(left) - slideNumber(right));
  if (slidePaths.length === 0) {
    throw new Error("El PPTX no contiene diapositivas válidas.");
  }
  if (slidePaths.length > MAX_PPTX_SLIDES) {
    throw new Error(`El PPTX excede el límite de ${MAX_PPTX_SLIDES} diapositivas.`);
  }

  const slideEntries = slidePaths.map((path) => zip.file(path));
  const totalXmlBytes = slideEntries.reduce(
    (total, entry) => total + getOfficeEntrySize(entry),
    0,
  );
  if (totalXmlBytes > MAX_OFFICE_XML_BYTES) {
    throw new Error("El contenido XML del PPTX excede el límite permitido.");
  }

  const slides: string[] = [];
  for (const [index, entry] of slideEntries.entries()) {
    const xml = await entry?.async("string");
    if (!xml) continue;
    slides.push(`Diapositiva ${index + 1}\n${extractXmlText(xml)}`);
  }
  return slides.join("\n\n");
}

function assertOfficeEntrySize(
  entry: JSZip.JSZipObject | null,
  label: string,
) {
  if (getOfficeEntrySize(entry) > MAX_OFFICE_XML_BYTES) {
    throw new Error(`${label} excede el límite permitido.`);
  }
}

function getOfficeEntrySize(entry: JSZip.JSZipObject | null) {
  return (
    entry as (JSZip.JSZipObject & {
      _data?: { uncompressedSize?: number };
    }) | null
  )?._data?.uncompressedSize || 0;
}

async function loadOfficeArchive(bytes: Uint8Array, label: string) {
  try {
    return await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch {
    throw new Error(`El archivo ${label} está dañado o no es un documento válido.`);
  }
}

function extractXmlText(xml: string) {
  return decodeXmlEntities(
    xml
      .replace(/<a:br\b[^>]*\/>/g, "\n")
      .replace(/<\/a:p>/g, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function normalizeDocumentText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").trim())
    .filter((line, index, lines) => line || Boolean(lines[index - 1]))
    .join("\n")
    .trim();
}

function resolveMimeType(rawMimeType: string, extension?: string) {
  if (rawMimeType === "application/pdf" || extension === "pdf") {
    return "application/pdf" as const;
  }
  if (
    rawMimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extension === "docx"
  ) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const;
  }
  if (
    rawMimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    extension === "pptx"
  ) {
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation" as const;
  }
  if (rawMimeType === "text/plain" || extension === "txt") {
    return "text/plain" as const;
  }
  throw new Error("Formato no compatible. Usa PDF, DOCX, PPTX o TXT.");
}

function slideNumber(path: string) {
  return Number(path.match(/slide(\d+)\.xml$/i)?.[1] || 0);
}
