import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, routes, componentId, otherComponentId, htmlPath, jobId, identityErrors, tenantErrors, authErrors, type Gate } from "./slides-authority-http.fixture";

const isPreview = (route: string) => route.includes("[runId]");
for (const route of routes) {
  const gates: Gate[] = isPreview(route) ? ["identity", "tenant"] : ["identity", ...(route === "slides/appearance" ? ["review" as const] : []), "component", ...(route === "slides/generate" ? ["context" as const] : [])];
  test(`${route}: caída conocida detiene efectos y devuelve 503 seguro`, async () => {
    for (const gate of gates) for (const Failure of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
      const failure = Object.assign(new Failure(), { message: "CANARIO_PRIVADO" });
      const context = fixture(route, { gate, failure });
      const response = await context.request();
      assert.equal(response.status, 503, `${gate}/${failure.name}`);
      const body = await response.json();
      assert.equal(body.code, "DEPENDENCY_UNAVAILABLE");
      assert.equal(body.retryable, true);
      assert.equal(body.requestId, "slides-autoridad-test");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.match(response.headers.get("vary") || "", /Cookie/);
      assert.doesNotMatch(JSON.stringify([body, context.effects.filter(effect => effect.kind.startsWith("log"))]), /CANARIO_PRIVADO/);
      const failedGate = context.effects.findIndex(effect => effect.kind === gate);
      assert.ok(failedGate >= 0);
      assert.equal(context.effects.slice(failedGate + 1).filter(effect => !effect.kind.startsWith("log")).length, 0);
    }
  });
  test(`${route}: conserva denegaciones y no convierte impostores en autoridad`, async () => {
    assert.equal((await fixture(route, { deny: "identity" }).request()).status, 401);
    assert.equal((await fixture(route, { deny: isPreview(route) ? "tenant" : "component" }).request()).status, isPreview(route) ? 403 : 404);
    const impostor = Object.assign(new Error("Fallo ordinario"), { name: "TenantContextLookupError", code: "TENANT_LOOKUP_UNAVAILABLE" });
    assert.equal((await fixture(route, { gate: "identity", failure: impostor }).request()).status, 500);
  });
  test(`${route}: conserva respuesta válida y efectos atribuidos`, async () => {
    const context = fixture(route);
    const response = await context.request();
    assert.equal(response.status, route === "slides/generate" ? 202 : 200);
    if (route.includes("preview")) {
      assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
      assert.equal(response.headers.get("cache-control"), "private, no-store");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.ok(response.headers.get("content-security-policy"));
      assert.match(await response.text(), /<html/);
      if (isPreview(route)) {
        assert.equal(context.effects.filter(effect => effect.kind === "filter" && (effect.value as { column: string }).column === "organization_id").length, 2);
        assert.equal(context.effects.filter(effect => effect.kind === "hydrate").length, 1);
      }
    } else {
      const body = await response.json();
      assert.equal(body.success, true);
      if (route === "slides/jobs") { assert.equal(body.data.status, "RUNNING"); assert.equal(body.data.job.id, jobId); }
      if (route === "slides/generate") {
        assert.equal(body.jobId, jobId);
        const job = context.effects.find(effect => effect.kind === "job")?.value as { createdBy: string; context: { organizationId: string } };
        assert.equal(job.createdBy, "actor"); assert.equal(job.context.organizationId, "organizacion");
        const signed = context.effects.find(effect => effect.kind === "sign")?.value as { createdBy: string; organizationId: string };
        assert.equal(signed.createdBy, "actor"); assert.equal(signed.organizationId, "organizacion");
        assert.equal(context.effects.filter(effect => effect.kind === "dispatch").length, 1);
      }
      if (route === "slides/appearance") {
        const upload = context.effects.find(effect => effect.kind === "upload")?.value as { bytes: string };
        assert.match(upload.bytes, /data-appearance="dark"/);
        assert.equal(body.assets.final_video_assembly_stale, true);
      }
      if (route === "slides/animated-deck/prepare") assert.equal(body.animatedDeck.status, "READY_FOR_RENDER");
      if (route === "open-design/html-to-png") { assert.equal(body.slideImages.length, 1); assert.equal(body.assets.slides.html_content_path, undefined); }
      if (route === "open-design/export") { assert.equal(body.slideImages.length, 1); assert.equal(body.htmlPublicUrl, null); assert.match(body.html, /<!DOCTYPE html>/); }
    }
  });
  if (!route.includes("preview") && route !== "slides/jobs") test(`${route}: conserva 400/413 antes de autoridad`, async () => {
    for (const overrides of [{ rawBody: "{" }, { headers: { "content-length": "100000" } }]) {
      const context = fixture(route);
      assert.equal((await context.request(overrides)).status, "rawBody" in overrides ? 400 : 413);
      assert.equal(context.effects.length, 0);
    }
  });
}

test("apariencia: conserva 403 de revisión", async () => { assert.equal((await fixture("slides/appearance", { deny: "review" }).request()).status, 403); });

for (const route of ["slides/appearance", "slides/animated-deck/prepare", "open-design/html-to-png"] as const) {
  test(`${route}: HTML de otro componente en assets se rechaza antes de Storage`, async () => {
    const context = fixture(route, { registeredPath: `slides/${otherComponentId}-slides-source.html` });
    assert.equal((await context.request()).status, 404);
    assert.equal(context.effects.filter(effect => ["download", "rasterize", "upload", "prepare", "rpc"].includes(effect.kind)).length, 0);
  });
  test(`${route}: ausencia de HTML conserva 409`, async () => { assert.equal((await fixture(route, { missingHtml: true }).request()).status, 409); });
}
for (const route of ["slides/animated-deck/prepare", "open-design/html-to-png"] as const) {
  test(`${route}: path hostil de payload no concede acceso`, async () => {
    for (const path of [`slides/${otherComponentId}-slides-source.html`, `slides/${componentId}0-slides-source.html`]) {
      const context = fixture(route);
      assert.equal((await context.request({ body: { componentId, htmlContentPath: path } })).status, 404);
      assert.equal(context.effects.filter(effect => ["download", "rasterize", "upload", "prepare", "rpc"].includes(effect.kind)).length, 0);
    }
  });
  test(`${route}: acepta HTML propio recién subido sin referencia persistida`, async () => {
    const response = await fixture(route, { missingHtml: true }).request({ body: { componentId, htmlContentPath: htmlPath } });
    assert.equal(response.status, 200);
  });
  test(`${route}: traversal conserva 400 antes de efectos`, async () => {
    const context = fixture(route);
    assert.equal((await context.request({ body: { componentId, htmlContentPath: "slides/../secreto.html" } })).status, 400);
    assert.equal(context.effects.filter(effect => ["download", "rasterize", "rpc"].includes(effect.kind)).length, 0);
  });
}

test("preview HTML solo descarga el path registrado y conserva 400/404", async () => {
  for (const [query, status] of [["", 400], ["path=slides/../secreto.html", 400], [`path=slides/${componentId}-otro.html`, 404]] as const) {
    const context = fixture("slides/html-preview");
    assert.equal((await context.request({ query })).status, status);
    assert.equal(context.effects.filter(effect => effect.kind === "download").length, 0);
  }
  assert.equal((await fixture("slides/html-preview", { downloadFailure: true }).request()).status, 404);
});
test("preview plantilla conserva UUID inválido, ausencia y error de diseño", async () => {
  assert.equal((await fixture("slides/templates/[runId]/preview").request({ param: "inválido" })).status, 400);
  assert.equal((await fixture("slides/templates/[runId]/preview", { missingRun: true }).request()).status, 404);
  assert.equal((await fixture("slides/templates/[runId]/preview", { badDesign: true }).request()).status, 422);
});
test("jobs: validación y filtros de jobId/fecha siguen distintos", async () => {
  assert.equal((await fixture("slides/jobs").request({ query: "componentId=inválido" })).status, 400);
  const context = fixture("slides/jobs");
  assert.equal((await context.request({ query: `componentId=${componentId}&jobId=${jobId}&createdAfter=2026-11-05T00:00:00Z` })).status, 200);
  assert.equal(context.effects.filter(effect => effect.kind === "gte").length, 0);
  assert.equal((await fixture("slides/jobs", { queryFailure: true }).request()).status, 500);
});
test("generación: reutiliza QUEUED/RUNNING/SUCCEEDED sin nuevo despacho", async () => {
  for (const status of ["QUEUED", "RUNNING", "SUCCEEDED"]) {
    const context = fixture("slides/generate", { jobStatus: status });
    const response = await context.request();
    assert.equal(response.status, 202); assert.equal((await response.json()).reused, true);
    assert.equal(context.effects.filter(effect => ["sign", "dispatch", "update"].includes(effect.kind)).length, 0);
  }
});
test("generación: despacho fallido compensa antes de responder", async () => {
  const context = fixture("slides/generate", { dispatchFailure: new Error("worker no disponible") });
  assert.equal((await context.request()).status, 503);
  assert.ok(context.effects.findIndex(effect => effect.kind === "compensate") > context.effects.findIndex(effect => effect.kind === "dispatch"));
});
test("preparación: error de compilación persiste FAILED antes de responder", async () => {
  const context = fixture("slides/animated-deck/prepare", { prepareFailure: new Error("CANARIO_PRIVADO") });
  const response = await context.request();
  assert.equal(response.status, 500);
  const body = await response.json(); assert.equal(body.animatedDeck.status, "FAILED");
  assert.doesNotMatch(JSON.stringify(body), /CANARIO_PRIVADO/);
  assert.equal(context.effects.filter(effect => effect.kind === "rpc").length, 1);
});

test("apariencia: caída de contexto editorial ocurre antes de sobrescribir HTML", async () => {
  for (const Failure of [identityErrors.AuthIdentityLookupError, tenantErrors.TenantContextLookupError]) {
    const context = fixture("slides/appearance", { editorialContext: true, gate: "context", failure: new Failure() });
    assert.equal((await context.request()).status, 503);
    assert.equal(context.effects.filter(effect => effect.kind === "download").length, 1);
    assert.equal(context.effects.filter(effect => ["upload", "rpc"].includes(effect.kind)).length, 0);
  }
});
test("generación: indisponibilidad de consulta conserva Retry-After y su código específico", async () => {
  const context = fixture("slides/generate", { gate: "component", failure: new authErrors.MaterialComponentLookupUnavailableError() });
  const response = await context.request();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.equal((await response.json()).details.reason, "MATERIAL_COMPONENT_LOOKUP_UNAVAILABLE");
  assert.equal(context.effects.filter(effect => effect.kind === "job").length, 0);
});
test("generación: header de automatización inválido no concede identidad", async () => {
  const context = fixture("slides/generate", { deny: "identity" });
  const response = await context.request({ headers: { "x-production-automation": JSON.stringify({ createdBy: "intruso", organizationId: "ajena" }) } });
  assert.equal(response.status, 401);
  assert.equal(context.effects.filter(effect => effect.kind === "admin").length, 0);
  assert.equal(context.effects.filter(effect => effect.kind === "job").length, 0);
});
test("generación: contexto firmado simulado conserva actor/organización y verifica artefacto", async () => {
  const signedActor = { componentId, createdBy: "automatizacion", organizationId: "organizacion" };
  const context = fixture("slides/generate", { signedActor });
  assert.equal((await context.request({ headers: { "x-production-automation": "{}" }, body: { componentId, createdBy: "intruso", organizationId: "ajena" } })).status, 202);
  assert.equal(context.effects.filter(effect => effect.kind === "identity").length, 0);
  const signed = context.effects.find(effect => effect.kind === "sign")?.value as { createdBy: string; organizationId: string; payload: Record<string, unknown> };
  assert.equal(signed.createdBy, "automatizacion"); assert.equal(signed.organizationId, "organizacion");
  assert.equal(signed.payload.createdBy, undefined); assert.equal(signed.payload.organizationId, undefined);
  const denied = fixture("slides/generate", { signedActor, internalOrganization: "ajena" });
  assert.equal((await denied.request({ headers: { "x-production-automation": "{}" } })).status, 404);
  assert.equal(denied.effects.filter(effect => effect.kind === "job").length, 0);
});
test("generación: contenido manual incompleto conserva 400 antes de autoridad", async () => {
  const context = fixture("slides/generate");
  const response = await context.request({ body: { componentId, customSlides: [{ title: "Vacía" }] } });
  assert.equal(response.status, 400);
  assert.equal(context.effects.length, 0);
});
test("generación: fallo de despacho conocido sigue compensando sin saltar al catch externo", async () => {
  const context = fixture("slides/generate", { dispatchFailure: new tenantErrors.TenantContextLookupError() });
  const response = await context.request();
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /worker de slides/);
  assert.equal(context.effects.filter(effect => effect.kind === "compensate").length, 1);
});
test("preparación: error corregible conserva 400 y parche FAILED", async () => {
  const context = fixture("slides/animated-deck/prepare", { prepareFailure: new Error("Solo se permiten assets remotos HTTPS.") });
  const response = await context.request();
  assert.equal(response.status, 400); assert.equal((await response.json()).animatedDeck.status, "FAILED");
  assert.equal(context.effects.filter(effect => effect.kind === "rpc").length, 1);
});
test("preparación: clase conocida después de comenzar efectos conserva recuperación FAILED", async () => {
  const context = fixture("slides/animated-deck/prepare", { prepareFailure: new tenantErrors.TenantContextLookupError() });
  const response = await context.request();
  assert.equal(response.status, 500); assert.equal((await response.json()).animatedDeck.status, "FAILED");
  assert.equal(context.effects.filter(effect => effect.kind === "rpc").length, 1);
});
for (const route of ["slides/appearance", "open-design/export", "open-design/html-to-png"] as const) {
  test(`${route}: persistencia fallida conserva 500 sin afirmar éxito`, async () => {
    const context = fixture(route, { persistFailure: true });
    const response = await context.request();
    assert.equal(response.status, 500); assert.equal((await response.json()).success, false);
  });
}
