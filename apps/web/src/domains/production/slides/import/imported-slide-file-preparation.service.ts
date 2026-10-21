import { Parser } from "htmlparser2";
import { HTML_SLIDE_IMPORT_LIMITS, HTML_SLIDE_SOURCE_SIZE_LABEL } from "./imported-slide-design.contract";
import { HTML_SLIDE_FILE_LIMITS, HTML_SLIDE_FILE_SIZE_LABEL, type PreparedSlideFile } from "./imported-slide-file.contract";
import { createImportedCssUrlReducer } from "./imported-slide-css-url-reducer";
import { createImportedSlideAssetCollector } from "./imported-slide-asset-collector";

const discardedContainers = new Set(["script", "iframe", "object", "video", "audio", "nav"]);
const discardedResources = new Set(["img", "image", "use", "embed", "link"]);
const voidTags = new Set(["area", "base", "basefont", "br", "col", "command", "embed", "frame", "hr", "img", "input", "isindex", "keygen", "link", "meta", "param", "source", "track", "wbr"]);
const retainedAttributes = new Set(["id", "class", "style", "src", "alt", "data-od-id", "data-cf-design-id", "viewbox", "width", "height", "x", "y", "x1", "x2", "y1", "y2",
  "cx", "cy", "r", "rx", "ry", "d", "points", "fill", "stroke", "stroke-width", "opacity", "fill-opacity", "stroke-opacity", "transform", "text-anchor", "font-size"]);

function escapeMarkup(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Prepara transporte sin DOM ni ejecución. El servidor debe volver a sanearlo. */
export async function prepareImportedSlideFile(file: Blob, onProgress: (percent: number) => void = () => {}, preserveAssets = false): Promise<PreparedSlideFile> {
  if (!file.size || file.size > HTML_SLIDE_FILE_LIMITS.bytes) throw new Error(`Selecciona un archivo HTML de hasta ${HTML_SLIDE_FILE_SIZE_LABEL}.`);
  const encoder = new TextEncoder();
  const collector = createImportedSlideAssetCollector();
  const resolveResource = preserveAssets ? collector.register : undefined;
  const output: string[] = [];
  let preparedBytes = 0;
  let removedScripts = 0, removedResources = 0, removedCssUrls = 0;
  let elements = 0, suppressedDepth = 0;
  const stack: Array<{ name: string; discarded: boolean }> = [];
  let cssReducer: ReturnType<typeof createImportedCssUrlReducer> | undefined;
  const preparedSizeError = () => new Error(`El archivo se admite, pero su HTML/CSS sin recursos supera ${HTML_SLIDE_SOURCE_SIZE_LABEL}. Divide la familia de diseños o simplifica su contenido.`);
  const emit = (value: string) => {
    if (!value) return;
    preparedBytes += encoder.encode(value).byteLength;
    if (preparedBytes > HTML_SLIDE_IMPORT_LIMITS.sourceBytes) throw preparedSizeError();
    output.push(value);
  };
  const countCssUrl = () => { removedCssUrls++; };
  const parser = new Parser({
    onopentag(name, attributes) {
      if (++elements > HTML_SLIDE_FILE_LIMITS.elements || stack.length >= HTML_SLIDE_FILE_LIMITS.depth) throw new Error("El archivo excede la complejidad HTML admitida para preparar la plantilla.");
      const navigation = /(?:^|\s)(?:deck-counter|deck-hint|notes)(?:\s|$)/.test(attributes.class ?? "");
      const imageReference = preserveAssets && !suppressedDepth && name === "img" ? collector.register(attributes.src ?? "") : null;
      const discarded = suppressedDepth > 0 || navigation || discardedContainers.has(name) || discardedResources.has(name) && !imageReference || ["meta", "base"].includes(name);
      if (name === "script") removedScripts++;
      if (discardedResources.has(name) && !imageReference || ["iframe", "object", "video", "audio"].includes(name)) removedResources++;
      if (!voidTags.has(name)) { stack.push({ name, discarded }); if (discarded) suppressedDepth++; }
      if (discarded) return;
      emit(`<${name}`);
      for (const [attribute, value] of Object.entries(attributes)) {
        if (!retainedAttributes.has(attribute)) continue;
        let compact = value;
        if (attribute === "src") { if (!imageReference) continue; compact = imageReference; }
        if (attribute === "style") {
          const chunks: string[] = [];
          let characters = 0;
          const reducer = createImportedCssUrlReducer(css => {
            characters += css.length;
            if (characters > HTML_SLIDE_IMPORT_LIMITS.sourceBytes) throw preparedSizeError();
            chunks.push(css);
          }, countCssUrl, resolveResource);
          reducer.write(value); reducer.end(); compact = chunks.join("");
        }
        if (compact.length > HTML_SLIDE_IMPORT_LIMITS.sourceBytes) throw preparedSizeError();
        const normalizedAttribute = attribute === "data-od-id" ? "data-cf-design-id" : attribute;
        emit(` ${normalizedAttribute}="${escapeMarkup(compact)}"`);
      }
      emit(">");
      if (name === "style") cssReducer = createImportedCssUrlReducer(emit, countCssUrl, resolveResource);
    },
    ontext(text) {
      if (suppressedDepth) return;
      if (cssReducer) cssReducer.write(text);
      else emit(escapeMarkup(text));
    },
    onclosetag(name) {
      if (voidTags.has(name)) return;
      const frame = stack.pop();
      if (!frame) return;
      if (frame.discarded) { suppressedDepth--; return; }
      if (name === "style") { cssReducer?.end(); cssReducer = undefined; }
      emit(`</${name}>`);
    },
  }, { decodeEntities: true, recognizeSelfClosing: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let offset = 0; offset < file.size; offset += HTML_SLIDE_FILE_LIMITS.chunkBytes) {
    const chunk = await file.slice(offset, offset + HTML_SLIDE_FILE_LIMITS.chunkBytes).arrayBuffer();
    let text: string;
    try { text = decoder.decode(chunk, { stream: true }); }
    catch { throw new Error("El archivo HTML debe estar codificado en UTF-8."); }
    parser.write(text);
    onProgress(Math.round(Math.min(file.size, offset + chunk.byteLength) / file.size * 100));
  }
  try { parser.end(decoder.decode()); }
  catch (error) { if (error instanceof TypeError) throw new Error("El archivo HTML debe estar codificado en UTF-8."); throw error; }
  return { html: output.join(""), originalBytes: file.size, preparedBytes, removedScripts, removedResources, removedCssUrls,
    ...(preserveAssets ? { editingMode: "html-text" as const, assets: collector.assets() } : {}) };
}
