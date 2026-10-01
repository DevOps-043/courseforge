import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { z } from "zod";

export const BROWSER_EXECUTABLE_MAX_BYTES = 1024 ** 3;
export const browserExecutableIdentitySchema = z.object({
  policy: z.literal("LAUNCH_FILE_SHA256_BEFORE_AFTER_V1"),
  scope: z.literal("LAUNCH_FILE_NOT_LOADED_MODULES_OR_REMOTE_RENDERER"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().max(BROWSER_EXECUTABLE_MAX_BYTES),
}).strict();
export type BrowserExecutableIdentity = z.infer<typeof browserExecutableIdentitySchema>;

export function browserExecutableIdentityHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(browserExecutableIdentitySchema.parse(input))).digest("hex");
}

/** Hash one opened regular file with bounded memory; paths are never returned or persisted. */
export async function readBrowserExecutableIdentity(path: string): Promise<BrowserExecutableIdentity> {
  const file = await open(path, "r");
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size <= 0 || before.size > BROWSER_EXECUTABLE_MAX_BYTES) {
      throw new Error("CONFORMANCE_BROWSER_EXECUTABLE_INVALID");
    }
    const digest = createHash("sha256");
    let bytes = 0;
    for await (const chunk of file.createReadStream({autoClose: false})) {
      bytes += chunk.length;
      if (bytes > before.size) throw new Error("CONFORMANCE_BROWSER_EXECUTABLE_CHANGED");
      digest.update(chunk);
    }
    const after = await file.stat();
    if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("CONFORMANCE_BROWSER_EXECUTABLE_CHANGED");
    }
    return browserExecutableIdentitySchema.parse({
      policy: "LAUNCH_FILE_SHA256_BEFORE_AFTER_V1",
      scope: "LAUNCH_FILE_NOT_LOADED_MODULES_OR_REMOTE_RENDERER",
      sha256: digest.digest("hex"),
      sizeBytes: bytes,
    });
  } finally {
    await file.close();
  }
}

export async function assertBrowserExecutableUnchanged(path: string, expected: BrowserExecutableIdentity) {
  if (browserExecutableIdentityHash(await readBrowserExecutableIdentity(path)) !== browserExecutableIdentityHash(expected)) {
    throw new Error("CONFORMANCE_BROWSER_EXECUTABLE_CHANGED");
  }
}
