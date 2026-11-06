import assert from "node:assert/strict";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { test } from "node:test";
import { load } from "./source-test-loader";

const organizationId = "abcdefab-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const key = "clave-sintetica-exclusiva-para-tests-0123456789";
const file = "src/domains/production/providers/heygen/heygen-standalone-video-access.server.ts";
type AccessModule = typeof import("../../../domains/production/providers/heygen/heygen-standalone-video-access.server");
const runtime = (secret: () => string = () => key) => load<AccessModule>(file, { "../../../../lib/server/env": { getBackgroundFunctionSecret: secret } });
const encode = (value: unknown, prefix = "courseforge:heygen-standalone-video-access:v1:") => {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(prefix + payload).digest("hex")}`;
};

test("el comprobante vincula ID exacto y organización normalizada, sin renovar en polling", () => {
  let clock = 1_800_000_000_000;
  const accessRuntime = runtime(); const access = accessRuntime.createHeygenStandaloneVideoAccess(organizationId.toUpperCase(), () => clock);
  const token = access.issue("video-1");
  assert.equal(access.verify(token, "video-1"), true);
  assert.equal(access.verify(token, "video-2"), false);
  assert.equal(accessRuntime.createHeygenStandaloneVideoAccess(otherOrganizationId, () => clock).verify(token, "video-1"), false);
  assert.equal(accessRuntime.HEYGEN_STANDALONE_VIDEO_TOKEN_MAX_AGE_MS, 7 * 24 * 60 * 60 * 1000);
  clock += accessRuntime.HEYGEN_STANDALONE_VIDEO_TOKEN_MAX_AGE_MS;
  assert.equal(access.verify(token, "video-1"), true);
  clock++; assert.equal(access.verify(token, "video-1"), false);
});
test("tolera 30 segundos de reloj futuro y rechaza emisión posterior", () => {
  let clock = 1_800_000_000_000;
  const access = runtime().createHeygenStandaloneVideoAccess(organizationId, () => clock);
  const token = access.issue("video"); clock -= 30_000;
  assert.equal(access.verify(token, "video"), true);
  clock--; assert.equal(access.verify(token, "video"), false);
});
test("rechaza formato, firma, tamaño y payload alterados sin excepciones", () => {
  const access = runtime().createHeygenStandaloneVideoAccess(organizationId);
  const token = access.issue("video"); const [payload, signature] = token.split(".");
  for (const invalid of [null, "", "a".repeat(2049), `${payload}.x`, `${payload}.${signature}00`, `${payload}.${"0".repeat(64)}`, `A${payload}.${signature}`, `${token}.extra`, encode("texto"), encode(null)]) {
    assert.equal(access.verify(invalid, "video"), false);
  }
});
test("valida propósito, versión y schema incluso con MAC sintética válida", () => {
  const access = runtime().createHeygenStandaloneVideoAccess(organizationId);
  const value = { version: 1, purpose: "heygen-standalone-video", organizationId, videoId: "video", issuedAt: Date.now() };
  for (const patch of [{ version: 2 }, { purpose: "background" }, { organizationId: "inválido" }, { issuedAt: -1 }, { issuedAt: "ahora" }, { videoId: "" }, { extra: true }]) {
    assert.equal(access.verify(encode({ ...value, ...patch }), "video"), false);
  }
  assert.equal(access.verify(encode(value, ""), "video"), false);
});
test("no se intercambia con background y la rotación invalida comprobantes", () => {
  const token = runtime().createHeygenStandaloneVideoAccess(organizationId).issue("video");
  const [payload, mac] = token.split(".");
  const backgroundMac = createHmac("sha256", key).update(payload).digest("hex");
  assert.notEqual(mac, backgroundMac);
  assert.equal(runtime(() => key + "rotada").createHeygenStandaloneVideoAccess(organizationId).verify(token, "video"), false);
  const background = load<typeof import("../../../lib/server/background-payload-signature")>("src/lib/server/background-payload-signature.ts", {
    "node:crypto": { default: { createHmac, timingSafeEqual, randomUUID } }, "./env": { getBackgroundFunctionSecret: () => key },
  });
  assert.throws(() => background.verifyBackgroundPayload({ payload, signature: mac }), /Firma de background inválida/);
  const signed = background.signBackgroundPayload({ organizationId, videoId: "video" });
  assert.equal(runtime().createHeygenStandaloneVideoAccess(organizationId).verify(`${signed.payload}.${signed.signature}`, "video"), false);
});
test("la redacción operacional protege el campo del DTO y el header del comprobante", () => {
  const logger = load<typeof import("../../../lib/server/operational-logger")>("src/lib/server/operational-logger.ts");
  const token = runtime().createHeygenStandaloneVideoAccess(organizationId).issue("video");
  const sanitized = logger.sanitizeLogValue({ standaloneAccessToken: token, headers: { "x-heygen-video-token": token } });
  assert.doesNotMatch(JSON.stringify(sanitized), new RegExp(token.replace(/\./g, "\\.")));
  assert.deepEqual(JSON.parse(JSON.stringify(sanitized)), { standaloneAccessToken: "[REDACTED]", headers: { "x-heygen-video-token": "[REDACTED]" } });
});
test("preflight deniega clave ausente/débil y contexto inválido sin exponer internals", () => {
  for (const secret of [() => "", () => "corta", () => { throw new Error("CANARIO_PRIVADO"); }]) {
    const accessRuntime = runtime(secret);
    assert.throws(() => accessRuntime.createHeygenStandaloneVideoAccess(organizationId), error => error instanceof accessRuntime.HeygenStandaloneVideoAccessUnavailableError && !String(error).includes("CANARIO_PRIVADO"));
  }
  const accessRuntime = runtime(); assert.throws(() => accessRuntime.createHeygenStandaloneVideoAccess("inválido"), accessRuntime.HeygenStandaloneVideoAccessUnavailableError);
  assert.throws(() => accessRuntime.createHeygenStandaloneVideoAccess(organizationId).issue(""), /identificador/);
});
