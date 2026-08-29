const FONT_MIME_TYPE_BY_EXTENSION = {
  otf: "font/otf",
  ttf: "font/ttf",
  woff: "font/woff",
  woff2: "font/woff2",
} as const;

export const MAX_ORGANIZATION_FONT_BYTES = 10 * 1024 * 1024;

export function resolveOrganizationFontUpload(file: { name: string; size: number }) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!extension || !(extension in FONT_MIME_TYPE_BY_EXTENSION)) {
    throw new Error("Sube una fuente .woff, .woff2, .ttf u .otf.");
  }
  if (file.size <= 0 || file.size > MAX_ORGANIZATION_FONT_BYTES) {
    throw new Error("La fuente debe pesar entre 1 byte y 10 MB.");
  }

  return {
    contentType: FONT_MIME_TYPE_BY_EXTENSION[extension as keyof typeof FONT_MIME_TYPE_BY_EXTENSION],
    extension,
  };
}
