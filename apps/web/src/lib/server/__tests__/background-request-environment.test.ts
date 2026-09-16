import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLocalBackgroundHandlerUrl,
  isLocalBackgroundInvocation,
  shouldDispatchBackgroundInProcess,
} from "../background-request-environment";

test("builds direct-handler URLs independently from the configured public app URL", () => {
  const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = "https://soflia-coursegen.netlify.app";

  try {
    const rawUrl = buildLocalBackgroundHandlerUrl("generate-artifact-background");
    assert.equal(
      rawUrl,
      "http://localhost/.netlify/functions/generate-artifact-background",
    );
    assert.equal(isLocalBackgroundInvocation({
      nodeEnv: "development",
      rawUrl,
    }), true);
  } finally {
    if (previousAppUrl === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
    }
  }
});

test("recognizes only development loopback background invocations", () => {
  assert.equal(isLocalBackgroundInvocation({
    nodeEnv: "development",
    rawUrl: "http://localhost:8888/.netlify/functions/generate-artifact-background",
  }), true);
  assert.equal(isLocalBackgroundInvocation({
    nodeEnv: "development",
    rawUrl: "http://127.0.0.1:8888/.netlify/functions/generate-artifact-background",
  }), true);
  assert.equal(isLocalBackgroundInvocation({
    nodeEnv: "development",
    rawUrl: "https://localhost/.netlify/functions/generate-artifact-background",
  }), false);
});

test("always requires persistent replay protection when deployed", () => {
  const rawUrl = "http://localhost:8888/.netlify/functions/generate-artifact-background";

  assert.equal(isLocalBackgroundInvocation({
    nodeEnv: "production",
    rawUrl,
  }), false);
  assert.equal(isLocalBackgroundInvocation({
    netlify: "true",
    nodeEnv: "development",
    rawUrl,
  }), false);
  assert.equal(isLocalBackgroundInvocation({
    nodeEnv: "development",
    rawUrl: "https://courseforge.example.com/.netlify/functions/generate-artifact-background",
  }), false);
});

test("keeps chained handlers in-process only during direct Next development", () => {
  assert.equal(shouldDispatchBackgroundInProcess({
    hasLocalHandler: true,
    nodeEnv: "development",
  }), true);
  assert.equal(shouldDispatchBackgroundInProcess({
    hasLocalHandler: false,
    nodeEnv: "development",
  }), false);
  assert.equal(shouldDispatchBackgroundInProcess({
    hasLocalHandler: true,
    netlify: "true",
    nodeEnv: "development",
  }), false);
  assert.equal(shouldDispatchBackgroundInProcess({
    hasLocalHandler: true,
    nodeEnv: "production",
  }), false);
});
