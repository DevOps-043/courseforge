import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { load } from "cheerio";
import { assertHtmlEditingPreviewParentOrigin, htmlEditingPreviewSessionSchema, type HtmlEditingPreviewSession } from "./composition-html-editing-preview-channel.contract";
import { buildCompositionHtmlEditingPreviewCsp } from "./composition-html-editing-preview-csp.server";

const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const PACKAGE_LIMITS = Object.freeze({ manifestBytes: 128 * 1024, bundleBytes: 512 * 1024,
  sourceBytes: 4 * 1024 * 1024, totalSourceBytes: 32 * 1024 * 1024 });
const manifestSchema = z.object({ format: z.literal("courseforge-html-preview-runtime-v1"), esbuildVersion: z.string().max(32),
  bundleSha256: z.string().regex(/^[a-f0-9]{64}$/), bundleBytes: z.number().int().positive().max(512 * 1024),
  inputs: z.array(z.object({ path: z.string().max(512).regex(/^[a-zA-Z0-9_.@/-]+$/).refine(value => !value.startsWith("/") && !value.split("/").includes("..")),
    sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict()).min(1).max(512),
}).strict();
export class HtmlEditingPreviewRuntimeError extends Error {
  constructor() { super("HTML_EDITING_PREVIEW_RUNTIME_UNAVAILABLE"); this.name = "HtmlEditingPreviewRuntimeError"; }
}

async function readBoundedFile(filePath: string, maximumBytes: number) {
  const file = await open(filePath, "r");
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size <= 0 || before.size > maximumBytes) throw new Error();
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) throw new Error();
      offset += result.bytesRead;
    }
    const extra = await file.read(Buffer.alloc(1), 0, 1, offset);
    const after = await file.stat();
    if (extra.bytesRead || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error();
    return bytes;
  } finally { await file.close(); }
}

/** Reads an operator-built local package, never builds/spawns during a request.
 * SHA/input pins detect stale artifacts, not signed execution attestations.
 * Deployments must package the runtime and its source inputs before enabling. */
export async function readHtmlEditingPreviewRuntimeBundle(webRoot: string) {
  try {
    const root = path.resolve(webRoot), repositoryRoot = path.resolve(root, "../..");
    const directory = path.join(root, ".tmp/html-preview-runtime");
    const manifestBytes = await readBoundedFile(path.join(directory, "manifest.json"), PACKAGE_LIMITS.manifestBytes);
    const manifest = manifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
    if (new Set(manifest.inputs.map(input => input.path)).size !== manifest.inputs.length) throw new Error();
    let sourceBytes = 0;
    for (const input of manifest.inputs) {
      const bytes = await readBoundedFile(path.join(repositoryRoot, input.path), Math.min(PACKAGE_LIMITS.sourceBytes,
        PACKAGE_LIMITS.totalSourceBytes - sourceBytes));
      sourceBytes += bytes.length;
      if (hash(bytes) !== input.sha256) throw new Error();
    }
    const bytes = await readBoundedFile(path.join(directory, "runtime.js"), PACKAGE_LIMITS.bundleBytes);
    if (bytes.length !== manifest.bundleBytes || hash(bytes) !== manifest.bundleSha256) throw new Error();
    return bytes.toString("utf8");
  } catch { throw new HtmlEditingPreviewRuntimeError(); }
}

const messageHeader = `window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return;
        const message = event.data;
        if (!message || typeof message.type !== "string") return;
        if ((message.protocolVersion ?? 1) !== 1) return;`;
function replaceOnce(value: string, source: string, replacement: string) {
  if (value.split(source).length !== 2) throw new HtmlEditingPreviewRuntimeError();
  return value.replace(source, replacement);
}

/** Transport adapter for the SUCCESSFUL trusted compiler output. It changes only
 * the known controller transport ABI, never source HTML, timeline or render path.
 * ABI drift rejects; this is not a generic script/HTML transformation endpoint. */
export function mountHtmlEditingPreviewRuntime(input: {
  trustedCompiledPage: string; packagedRuntime: string; session: HtmlEditingPreviewSession; parentOrigin: string;
}) {
  try {
    const session = htmlEditingPreviewSessionSchema.parse(input.session);
    assertHtmlEditingPreviewParentOrigin(input.parentOrigin);
    if (Buffer.byteLength(input.trustedCompiledPage) > 4 * 1024 * 1024 || Buffer.byteLength(input.packagedRuntime) > 512 * 1024) throw new Error();
    const page = load(input.trustedCompiledPage);
    const controllers = page("script").filter((_index, element) => (page(element).html() ?? "").includes("const compiledDocumentHash ="));
    if (controllers.length !== 1) throw new Error();
    const controller = controllers.first();
    let source = controller.html()!;
    if (!source.includes(`const compiledDocumentHash = ${JSON.stringify(session.documentHash)};`)
      || !source.includes(`const previewGeneration = ${session.previewGeneration};`)) throw new Error();
    const oldPost = `const postParentMessage = (message) => window.parent.postMessage({
        ...message,
        previewGeneration,
        protocolVersion: 1,
      }, "*");`;
    source = replaceOnce(source, oldPost, `const postParentMessage = (message) => window.__courseforgeHtmlPreviewBridge.post({ ...message, previewGeneration, protocolVersion: 1 });`);
    source = replaceOnce(source, messageHeader, `window.__courseforgeHtmlPreviewBridge.attach((message) => {`);
    if (source.includes('window.addEventListener("message"') || source.includes("window.parent.postMessage")) throw new Error();
    controller.text(source);
    const serialized = JSON.stringify({ session, parentOrigin: input.parentOrigin }).replaceAll("<", "\\u003c");
    const runtime = input.packagedRuntime.replace(/<\/script/gi, "<\\/script");
    controller.before(`<script>${runtime}\nObject.defineProperty(window, "__courseforgeHtmlPreviewBridge", { value: CourseforgeHtmlPreviewRuntime.installHtmlEditingPreviewRuntime(${serialized}), writable: false, configurable: false });</script>`);
    const html = page.html();
    return { html, contentSecurityPolicy: buildCompositionHtmlEditingPreviewCsp(html), session,
      scope: "SECURE_TRANSPORT_MOUNTED_NOT_RESOURCE_DELIVERY_OR_RENDER_EVIDENCE" as const };
  } catch { throw new HtmlEditingPreviewRuntimeError(); }
}
