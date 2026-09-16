import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeExternalMediaUrl,
  readResponseWithLimit,
} from "../external-media-import-policy";

test("rejects loopback, private networks, credentials and non-HTTPS URLs", async () => {
  await assert.rejects(() => assertSafeExternalMediaUrl("https://127.0.0.1/video.mp4"));
  await assert.rejects(() => assertSafeExternalMediaUrl("https://10.0.0.8/video.mp4"));
  await assert.rejects(() => assertSafeExternalMediaUrl("https://[::1]/video.mp4"));
  await assert.rejects(() => assertSafeExternalMediaUrl("http://example.com/video.mp4"));
  await assert.rejects(() => assertSafeExternalMediaUrl("https://user:secret@example.com/video.mp4"));
});

test("reads a response only while it remains within the byte budget", async () => {
  const accepted = await readResponseWithLimit(
    new Response(new Uint8Array([1, 2, 3, 4])),
    4,
  );
  assert.deepEqual([...accepted], [1, 2, 3, 4]);

  await assert.rejects(
    () => readResponseWithLimit(new Response(new Uint8Array([1, 2, 3, 4, 5])), 4),
    /EXTERNAL_MEDIA_TOO_LARGE/,
  );
});
