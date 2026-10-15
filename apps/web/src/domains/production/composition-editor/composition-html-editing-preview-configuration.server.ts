import { assertHtmlEditingPreviewParentOrigin } from "./composition-html-editing-preview-channel.contract";
import { HTML_PREVIEW_CAPABILITY_POLICY } from "./composition-html-editing-preview-capability.server";

/** Operator values only. Never derive audience or storage host from a request. */
export function resolveHtmlPreviewOperatorConfiguration(values: { encodedKey?: string; audience?: string; storageOrigin?: string }): {
  key: Uint8Array; audience: string; storageOrigin: string;
} {
  const { encodedKey, audience, storageOrigin } = values;
  if (!encodedKey || !/^[a-f0-9]{64}$/.test(encodedKey) || !audience || !storageOrigin) throw new Error("HTML_PREVIEW_DELIVERY_NOT_CONFIGURED");
  assertHtmlEditingPreviewParentOrigin(audience);
  const storage = new URL(storageOrigin);
  assertHtmlEditingPreviewParentOrigin(storage.origin);
  if (storage.username || storage.password || storage.search || storage.hash || storage.pathname !== "/") throw new Error("HTML_PREVIEW_DELIVERY_NOT_CONFIGURED");
  const key = Buffer.from(encodedKey, "hex");
  if (key.byteLength !== HTML_PREVIEW_CAPABILITY_POLICY.keyBytes) throw new Error("HTML_PREVIEW_DELIVERY_NOT_CONFIGURED");
  return { key, audience, storageOrigin: storage.origin };
}
