import assert from "node:assert/strict";
import test from "node:test";
import { resolveBackgroundFunctionOrigin } from "../background-function-origin";
import {
  buildLocalBackgroundHandlerUrl,
  isLocalBackgroundInvocation,
  shouldDispatchBackgroundInProcess,
} from "../background-request-environment";

test("staging y previews conservan el despliegue aunque la URL pública apunte a producción", () => {
  for (const origin of ["https://build-staging--courseforge.netlify.app", "https://build-preview--courseforge.netlify.app",
    "https://build-production--courseforge.netlify.app"]) {
    assert.equal(resolveBackgroundFunctionOrigin({ NODE_ENV: "production", URL: "https://courseforge.netlify.app",
      NEXT_PUBLIC_APP_URL: "https://courseforge.netlify.app", DEPLOY_URL: "https://otro--courseforge.netlify.app" }, origin), origin);
  }
});

test("el metadato del build funciona cuando Netlify no expone DEPLOY_URL en ejecución", () => {
  assert.equal(resolveBackgroundFunctionOrigin({ NODE_ENV: "production", URL: "https://courseforge.netlify.app" },
    "https://build--courseforge.netlify.app"), "https://build--courseforge.netlify.app");
});

test("sin captura usa DEPLOY_URL explícito y nunca la dirección pública ni el origen de un request", () => {
  assert.equal(resolveBackgroundFunctionOrigin({ NODE_ENV: "production", DEPLOY_URL: "https://build--courseforge.netlify.app/" }, null),
    "https://build--courseforge.netlify.app");
  for (const NODE_ENV of ["production", undefined, "test"]) {
    assert.throws(() => resolveBackgroundFunctionOrigin({ NODE_ENV, URL: "https://courseforge.netlify.app",
      NEXT_PUBLIC_APP_URL: "https://courseforge.netlify.app", DEPLOY_PRIME_URL: "https://staging--courseforge.netlify.app" }, null), /Falta el destino/);
  }
});

test("rechaza destinos inválidos sin recurrir a otro entorno", () => {
  for (const origin of ["", "no-url", "http://localhost:8888", "https://user:password@example.com", "https://example.com/path",
    "https://example.com?token=secret", "https://example.com#fragment"]) {
    assert.throws(() => resolveBackgroundFunctionOrigin({ NODE_ENV: "production", DEPLOY_URL: "https://valid.example.com" }, origin));
  }
});

test("desarrollo directo conserva destino local y Netlify nunca cae a localhost", () => {
  assert.equal(resolveBackgroundFunctionOrigin({ NODE_ENV: "development" }, "https://old--courseforge.netlify.app"), "http://localhost:8888");
  assert.throws(() => resolveBackgroundFunctionOrigin({ NODE_ENV: "development", NETLIFY: "true" }, null), /Falta el destino/);
});

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

test("missing build flags never imply local execution or bypass replay protection", () => {
  for (const nodeEnv of [undefined, "", "test"]) {
    assert.equal(shouldDispatchBackgroundInProcess({ hasLocalHandler: true, nodeEnv }), false);
    assert.equal(isLocalBackgroundInvocation({
      nodeEnv,
      rawUrl: buildLocalBackgroundHandlerUrl("materials-generation-background"),
    }), false);
  }
});
