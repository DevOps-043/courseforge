import assert from "node:assert/strict";
import test from "node:test";
import { LiveAvatarApiError, LiveAvatarClient } from "../liveavatar.client";

test("LiveAvatar parses JSON only inside the response budget", async () => {
  const accepted = new LiveAvatarClient("test-key", async () =>
    new Response('{"credits":42}', { headers: { "Content-Type": "application/json" } }));
  assert.deepEqual(await accepted.getCredits(), { credits: 42 });

  const oversized = new LiveAvatarClient("test-key", async () =>
    new Response("ignored", {
      headers: {
        "Content-Length": String((2 * 1024 * 1024) + 1),
        "Content-Type": "application/json",
      },
    }));
  await assert.rejects(oversized.listAvatars(), /excede el limite/);
});

test("LiveAvatar bounds provider errors and preserves a safe fallback", async () => {
  const client = new LiveAvatarClient("test-key", async () =>
    new Response("ignored", {
      headers: { "Content-Length": String((32 * 1024) + 1) },
      status: 503,
    }));
  await assert.rejects(
    client.getCredits(),
    (error) => error instanceof LiveAvatarApiError
      && error.status === 503
      && error.message === "LiveAvatar rechazó la solicitud (503).",
  );
});
