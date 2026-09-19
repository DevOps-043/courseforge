const FONT_MIME_TYPE_BY_EXTENSION = {
  otf: "font/otf",
  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
} as const;

export type OrganizationFontExtension = keyof typeof FONT_MIME_TYPE_BY_EXTENSION;

export const MAX_ORGANIZATION_FONT_BYTES = 10 * 1024 * 1024;

export function isAllowedGoogleFontCssUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "fonts.googleapis.com"
      && url.username === ""
      && url.password === "";
  } catch {
    return false;
  }
}

export function resolveOrganizationFontUpload(file: { name: string; size: number }) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !(extension in FONT_MIME_TYPE_BY_EXTENSION)) {
    throw new Error("Sube una fuente .woff, .woff2, .ttf u .otf.");
  }
  if (file.size <= 0 || file.size > MAX_ORGANIZATION_FONT_BYTES) {
    throw new Error("La fuente debe pesar entre 1 byte y 10 MB.");
  }

  return {
    contentType: FONT_MIME_TYPE_BY_EXTENSION[extension as OrganizationFontExtension],
    extension: extension as OrganizationFontExtension,
  };
}

export function validateOrganizationFontBinary(
  bytes: Uint8Array,
  expectedExtension: OrganizationFontExtension,
) {
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_ORGANIZATION_FONT_BYTES) {
    throw new Error("El archivo no contiene una fuente válida.");
  }
  const signature = readTag(bytes, 0);
  const detectedExtension = signature === "wOF2"
    ? "woff2"
    : signature === "wOFF"
      ? "woff"
      : signature === "OTTO"
        ? "otf"
        : readUint32(bytes, 0) === 0x00010000 || signature === "true"
          ? "ttf"
          : null;
  if (!detectedExtension || detectedExtension !== expectedExtension) {
    throw new Error("La extensión no coincide con la firma binaria de la fuente.");
  }

  if (detectedExtension === "woff" || detectedExtension === "woff2") {
    const minimumHeaderBytes = detectedExtension === "woff2" ? 48 : 44;
    const declaredLength = readUint32(bytes, 8);
    const tableCount = readUint16(bytes, 12);
    if (bytes.byteLength < minimumHeaderBytes || declaredLength !== bytes.byteLength || tableCount < 1 || tableCount > 256) {
      throw new Error("La cabecera WOFF de la fuente es inválida.");
    }
    return { detectedExtension, embedding: "UNVERIFIED_COMPRESSED" as const };
  }

  const tableCount = readUint16(bytes, 4);
  if (tableCount < 1 || tableCount > 256 || 12 + tableCount * 16 > bytes.byteLength) {
    throw new Error("El directorio de tablas de la fuente es inválido.");
  }
  let hasNameTable = false;
  for (let index = 0; index < tableCount; index += 1) {
    const tableOffset = 12 + index * 16;
    const tag = readTag(bytes, tableOffset);
    const offset = readUint32(bytes, tableOffset + 8);
    const length = readUint32(bytes, tableOffset + 12);
    if (offset > bytes.byteLength || length > bytes.byteLength - offset) {
      throw new Error("Una tabla de la fuente apunta fuera del archivo.");
    }
    if (tag === "name") hasNameTable = true;
    if (tag === "OS/2" && length >= 10) {
      const fsType = readUint16(bytes, offset + 8);
      if ((fsType & 0x0002) !== 0) {
        throw new Error("La licencia interna de la fuente restringe su embedding.");
      }
    }
  }
  if (!hasNameTable) throw new Error("La fuente no contiene una tabla de nombres válida.");
  return { detectedExtension, embedding: "ALLOWED" as const };
}

export function organizationFontFormat(extension: OrganizationFontExtension) {
  if (extension === "otf") return "opentype" as const;
  if (extension === "ttf") return "truetype" as const;
  return extension;
}

function readTag(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.byteLength) return "";
  return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}

function readUint16(bytes: Uint8Array, offset: number) {
  if (offset + 2 > bytes.byteLength) return 0;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, false);
}

function readUint32(bytes: Uint8Array, offset: number) {
  if (offset + 4 > bytes.byteLength) return 0;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}
