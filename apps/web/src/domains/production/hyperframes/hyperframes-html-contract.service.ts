import JSZip from "jszip";
import {
  HYPERFRAMES_ASSET_DELIVERY_MODES,
  type HyperframesAssetDeliveryMode,
} from "./hyperframes.types";

export type HyperframesHtmlContractValidation = {
  errors: string[];
  valid: boolean;
};

const MEDIA_ELEMENT_PATTERN = /<(?:audio|video|img)\b[^>]*>/gi;

/** Validates the media-binding subset of the generated HyperFrames HTML contract. */
export function validateHyperframesHtmlContract(params: {
  deliveryMode: HyperframesAssetDeliveryMode;
  html: string;
}): HyperframesHtmlContractValidation {
  const errors: string[] = [];
  if (/\bdata-hf-src\s*=/i.test(params.html)) {
    errors.push("El HTML usa data-hf-src, un atributo que el runtime de HyperFrames no resuelve.");
  }

  if (params.deliveryMode === HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES) {
    const mediaElements = params.html.match(MEDIA_ELEMENT_PATTERN) ?? [];
    for (const element of mediaElements) {
      if (!isCourseforgeTimelineMedia(element)) continue;
      const variableName = readAttribute(element, "data-var-src");
      const source = readAttribute(element, "src");
      if (hasAttribute(element, "data-var-src") && !variableName) {
        errors.push("Un elemento multimedia declara data-var-src vacío.");
      } else if (!variableName && !source) {
        errors.push("Un elemento multimedia remoto no declara data-var-src ni src.");
      }
    }
  }

  return { errors: [...new Set(errors)], valid: errors.length === 0 };
}

export async function validateHyperframesArchiveHtmlContract(params: {
  archive: Uint8Array;
  deliveryMode: HyperframesAssetDeliveryMode;
  entryPoint: string;
}): Promise<HyperframesHtmlContractValidation> {
  const entryPoint = normalizeEntryPoint(params.entryPoint);
  if (!entryPoint) {
    return { errors: ["El entry point HTML de la revisión no es una ruta segura."], valid: false };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(params.archive);
  } catch {
    return { errors: ["El archivo de proyecto no es un ZIP válido."], valid: false };
  }
  const entry = zip.file(entryPoint);
  if (!entry) {
    return { errors: [`El archivo de proyecto no contiene ${entryPoint}.`], valid: false };
  }
  const html = await entry.async("string");
  return validateHyperframesHtmlContract({ deliveryMode: params.deliveryMode, html });
}

function hasAttribute(element: string, name: string) {
  return new RegExp(`\\s${name}(?:\\s*=|\\s|>)`, "i").test(element);
}

function isCourseforgeTimelineMedia(element: string) {
  return /\bcomposition-(?:audio|media)\b/i.test(element)
    || hasAttribute(element, "data-var-src")
    || hasAttribute(element, "data-hf-src");
}

function readAttribute(element: string, name: string) {
  const match = element.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function normalizeEntryPoint(entryPoint: string) {
  const normalized = entryPoint.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) return null;
  return normalized;
}
