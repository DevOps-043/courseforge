import type { ConformanceFontManifest } from "../composition-conformance-font-bindings";
import type { CompositionQaCdpClient } from "./composition-qa-browser";

export const CONFORMANCE_FONT_LOADING_LIMITS = { maximumFaces: 128, timeoutMilliseconds: 5000 } as const;

/** Browser-local, self-contained. Loading existing faces is not glyph/fallback certification. */
export async function verifyDeclaredFontFaces(families: string[], load: boolean, limits: {
  maximumFaces: number; timeoutMilliseconds: number;
}) {
  const familyKey = (family: string) => family.trim().replace(/^(["'])(.*)\1$/, "$2").normalize("NFC").toLowerCase();
  const faces: FontFace[] = [];
  for (const face of document.fonts) {
    if (faces.length >= limits.maximumFaces) throw new Error("CONFORMANCE_FONT_FACE_LIMIT");
    faces.push(face);
  }
  const expected = new Set(families.map(familyKey));
  for (const family of expected) {
    if (!faces.some((face) => familyKey(face.family) === family)) throw new Error("CONFORMANCE_FONT_FACE_MISSING");
  }
  const declared = faces.filter((face) => expected.has(familyKey(face.family)));
  if (load && declared.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(declared.map((face) => face.load())),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("CONFORMANCE_FONT_LOAD_TIMEOUT")), limits.timeoutMilliseconds);
        }),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  }
  if (declared.some((face) => face.status !== "loaded")) throw new Error("CONFORMANCE_FONT_FACE_NOT_LOADED");
  return true;
}

/** Fail closed on missing declarations, decoding errors, timeouts or changed loading status. */
export async function verifyConformanceFontLoading(client: CompositionQaCdpClient, fonts: ConformanceFontManifest, load: boolean) {
  if (!fonts.length) return;
  const families = [...new Set(fonts.map((font) => font.family))];
  const response = await client.send("Runtime.evaluate", {awaitPromise: true, returnByValue: true,
    expression: `(${verifyDeclaredFontFaces.toString()})(${JSON.stringify(families)},${load},${JSON.stringify(CONFORMANCE_FONT_LOADING_LIMITS)})`});
  if (response.exceptionDetails || (response.result as {value?: unknown} | undefined)?.value !== true) {
    // Do not persist browser exception text, URLs, font contents or document text.
    throw new Error("CONFORMANCE_CAPTURE_FONT_LOADING_FAILED");
  }
}
