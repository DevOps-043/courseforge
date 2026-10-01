import { createHash } from "node:crypto";
import { z } from "zod";
import type { CompositionQaCdpClient } from "./composition-qa-browser";

const boundedIdentity = z.string().min(1).max(512).regex(/^[\x20-\x7e]+$/);
export const browserVersionSchema = z.object({protocolVersion: boundedIdentity, product: boundedIdentity,
  revision: boundedIdentity, userAgent: boundedIdentity, jsVersion: boundedIdentity}).strict();
export const browserIdentitySchema = z.object({policy: z.literal("CDP_BROWSER_VERSION_FORWARD_REVERSE_V1"),
  scope: z.literal("CAPTURE_BROWSER_SELF_REPORTED_VERSION_ONLY"), version: browserVersionSchema,
}).strict();
export type BrowserIdentity = z.infer<typeof browserIdentitySchema>;
export const browserIdentityHash = (input: unknown) => createHash("sha256").update(JSON.stringify(browserIdentitySchema.parse(input))).digest("hex");

/** No paths, flags, cookies or environment values are queried or persisted. Not binary attestation. */
export async function readCaptureBrowserIdentity(client: CompositionQaCdpClient): Promise<BrowserIdentity> {
  const response = await client.send("Browser.getVersion");
  const parsed = browserVersionSchema.safeParse(response);
  if (!parsed.success) throw new Error("CONFORMANCE_BROWSER_IDENTITY_INVALID");
  return {policy: "CDP_BROWSER_VERSION_FORWARD_REVERSE_V1", scope: "CAPTURE_BROWSER_SELF_REPORTED_VERSION_ONLY", version: parsed.data};
}

export function assertCaptureBrowserIdentityUnchanged(before: BrowserIdentity, after: BrowserIdentity) {
  if (browserIdentityHash(before) !== browserIdentityHash(after)) throw new Error("CONFORMANCE_BROWSER_IDENTITY_CHANGED");
}
