import { assertHtmlEditingPreviewParentOrigin, createHtmlEditingPreviewSession, htmlEditingPreviewSessionSchema, type HtmlEditingPreviewSession } from "./composition-html-editing-preview-channel.contract";
import { prepareCompositionHtmlEditingPreviewResources } from "./composition-html-editing-preview-resources.server";
import { mountHtmlEditingPreviewRuntime, readHtmlEditingPreviewRuntimeBundle } from "./composition-html-editing-preview-runtime.server";

type Input = Parameters<typeof prepareCompositionHtmlEditingPreviewResources>[0] & {
  /** Operator configuration; never take either value from a request payload. */
  runtimeWebRoot: string;
  parentOrigin: string;
  previewGeneration: number;
  /** Optional host-created handshake identity; never an authorization grant. */
  session?: HtmlEditingPreviewSession;
};

/** Host preparation boundary. Load/pin runtime before signing resources, and
 * mount immediately after the portfolio's final authorization recheck.
 * Local resource aliases still require a browser-delivery transport. */
export async function prepareCompositionHtmlEditingSecurePreview(input: Input) {
  input.signal?.throwIfAborted();
  assertHtmlEditingPreviewParentOrigin(input.parentOrigin);
  const session = input.session ? htmlEditingPreviewSessionSchema.parse(input.session) : createHtmlEditingPreviewSession(input.documentHash, input.previewGeneration);
  if (session.documentHash !== input.documentHash || session.previewGeneration !== input.previewGeneration) throw new Error("HTML_PREVIEW_SESSION_MISMATCH");
  const packagedRuntime = await readHtmlEditingPreviewRuntimeBundle(input.runtimeWebRoot);
  input.signal?.throwIfAborted();
  const prepared = await prepareCompositionHtmlEditingPreviewResources(input);
  try {
    input.signal?.throwIfAborted();
    const mounted = mountHtmlEditingPreviewRuntime({ trustedCompiledPage: prepared.previewHtml,
      packagedRuntime, session, parentOrigin: input.parentOrigin });
    return { ...prepared, previewHtml: mounted.html, contentSecurityPolicy: mounted.contentSecurityPolicy, session,
      scope: "AUTHORIZED_SECURE_LOCAL_PREVIEW_NOT_BROWSER_DELIVERY_OR_RENDER_EVIDENCE" as const };
  } catch (error) {
    await prepared.dispose();
    throw error;
  }
}
