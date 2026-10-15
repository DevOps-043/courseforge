import { createHash } from "node:crypto";
import { load } from "cheerio";
import { assertHtmlEditingPreviewParentOrigin } from "./composition-html-editing-preview-channel.contract";

export const HTML_EDITING_PREVIEW_CSP_POLICY = Object.freeze({ pageBytes: 4 * 1024 * 1024, nodes: 20_000, headerBytes: 12 * 1024 });
export class HtmlEditingPreviewCspError extends Error {
  constructor() { super("HTML_EDITING_PREVIEW_CSP_REJECTED"); this.name = "HtmlEditingPreviewCspError"; }
}
const hashSource = (content: string) => `'sha256-${createHash("sha256").update(content, "utf8").digest("base64")}'`;
const sources = (values: Set<string>) => values.size ? [...values].sort().join(" ") : "'none'";

/** Only accepts the successful host compiler's page AFTER editable source and
 * all imported fragments passed admission. This is not a sanitizer: hashing
 * arbitrary user HTML would authorize its scripts. Never expose a raw-HTML API.
 * Keep bytes intact so browser hashes, renderer output and source stay aligned. */
export function buildCompositionHtmlEditingPreviewCsp(trustedCompiledPage: string, resourceEndpoint?: string): string {
  try {
    if (typeof trustedCompiledPage !== "string" || Buffer.byteLength(trustedCompiledPage, "utf8") > HTML_EDITING_PREVIEW_CSP_POLICY.pageBytes) throw new Error();
    const page = load(trustedCompiledPage), scripts = new Set<string>(), styleBlocks = new Set<string>(), styleAttributes = new Set<string>();
    const pending = [...page.root().contents().toArray()];
    let nodes = 0;
    while (pending.length) {
      const node = pending.pop()!;
      if (++nodes > HTML_EDITING_PREVIEW_CSP_POLICY.nodes) throw new Error();
      if ("children" in node) pending.push(...node.children);
      if (!("attribs" in node)) continue;
      if (Object.keys(node.attribs).some(name => /^on/i.test(name))) throw new Error();
      if (node.name.toLowerCase() === "script") {
        if (node.attribs.src !== undefined) throw new Error();
        scripts.add(hashSource(page(node).html() ?? ""));
      }
      if (node.name.toLowerCase() === "style") styleBlocks.add(hashSource(page(node).html() ?? ""));
      if (node.attribs.style !== undefined) styleAttributes.add(hashSource(node.attribs.style));
    }
    const allStyles = new Set([...styleBlocks, ...styleAttributes]);
    let resourceSource = "'self' blob:";
    if (resourceEndpoint !== undefined) {
      const endpoint = new URL(resourceEndpoint);
      assertHtmlEditingPreviewParentOrigin(endpoint.origin);
      if (endpoint.href !== resourceEndpoint || endpoint.search || endpoint.hash || endpoint.username || endpoint.password
        || !/^\/api\/production\/hyperframes\/drafts\/[a-f0-9-]{36}\/html-preview\/resources$/.test(endpoint.pathname)) throw new Error();
      resourceSource = resourceEndpoint;
    }
    const policy = ["default-src 'none'", `script-src ${sources(scripts)}`, "script-src-attr 'none'",
      `style-src ${allStyles.size ? "'unsafe-hashes' " : ""}${sources(allStyles)}`,
      `style-src-elem ${sources(styleBlocks)}`, `style-src-attr ${styleAttributes.size ? "'unsafe-hashes' " : ""}${sources(styleAttributes)}`,
      `img-src ${resourceSource}`, `media-src ${resourceSource}`, `font-src ${resourceSource}`,
      "connect-src 'none'", "worker-src 'none'", "frame-src 'none'", "object-src 'none'",
      "frame-ancestors 'self'", "base-uri 'none'", "form-action 'none'", "navigate-to 'none'",
      "sandbox allow-scripts"].join("; ");
    if (Buffer.byteLength(policy, "utf8") > HTML_EDITING_PREVIEW_CSP_POLICY.headerBytes) throw new Error();
    return policy;
  } catch { throw new HtmlEditingPreviewCspError(); }
}
