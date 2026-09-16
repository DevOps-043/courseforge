import JSZip from "jszip";
import { load } from "cheerio";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "./hyperframes.types";

// Included in job identity so a corrected render never reuses a silent result.
export const HYPERFRAMES_MEDIA_BINDING_VERSION = 2;

/**
 * The immutable snapshot contains variable names, never expiring credentials.
 * Materialize a disposable upload copy immediately before sending it to HeyGen:
 * its audio extractor reads authored audio[id][src], before browser bindings run.
 */
export async function materializeHyperframesRenderMedia(params: {
  archive: Uint8Array;
  entryPoint: string;
  assetVariables: Record<string, string>;
}): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(params.archive);
  if (!zip.file(params.entryPoint)) throw new Error("El proyecto no contiene su HTML de entrada.");
  for (const file of Object.values(zip.files)) {
    if (file.dir || !/\.html?$/i.test(file.name)) continue;
    const $ = load(await file.async("string"));
    // Upgrade already-approved snapshots made with the old, unsupported binding.
    $("[data-hf-src], [data-var-src]").each((_, element) => {
      const media = $(element);
      const variable = media.attr("data-var-src") || media.attr("data-hf-src") || "";
      if (!variable.startsWith("cf_asset_")) return;
      const value = Object.hasOwn(params.assetVariables, variable) ? params.assetVariables[variable] : undefined;
      if (!value) throw new Error(`Falta la URL autorizada del medio ${variable}.`);
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) {
        throw new Error(`La URL del medio ${variable} debe usar HTTPS sin credenciales de usuario.`);
      }
      media.attr("src", value).attr("data-var-src", variable).removeAttr("data-hf-src");
    });
    $("video, audio").each((_, element) => {
      const media = $(element);
      if (!media.attr("src")?.trim()) {
        throw new Error(`El medio ${media.attr("id") || element.tagName} no tiene src para el renderizador.`);
      }
      if (element.tagName === "audio" && !media.attr("id")?.trim()) {
        throw new Error("Una pista de audio no tiene identificador para el mezclador del renderizador.");
      }
    });
    zip.file(file.name, $.html());
  }
  const archive = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (archive.byteLength > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES) {
    throw new Error("El proyecto preparado para renderizar excede el límite de 200 MB.");
  }
  return archive;
}
