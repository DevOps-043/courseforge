import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { load } from "../../../app/login/__tests__/source-test-loader";
import { documentFixture } from "./delivery-documents.fixture";
import { deliveryHash } from "../lib/delivery-hash";
import * as policy from "../types/session-broll";
import { inspectStandaloneMedia } from "../../production/media-inspection.service";
import { readFileSync } from "node:fs";

function fixture() {
  const { workspace, id } = documentFixture();
  const rows = new Map<string, Record<string, unknown>>();
  const objects = new Map<string, Blob>();
  let reviewer = true, revisionHash = "current", inspections = 0, publicBucket = false;
  let inspectHook = () => {};
  let metadata = { width: 1920, height: 1080, duration: 5, hasAudio: false };
  const signed: string[] = [];
  const admin = { storage: { getBucket: async () => ({ data: { public: publicBucket }, error: null }), from: () => ({
    createSignedUploadUrl: async (path: string, options: { upsert: boolean }) => { assert.equal(options.upsert, false); return { data: { signedUrl: `https://storage.example.test/upload/${path}` }, error: null }; },
    info: async (path: string) => ({ data: objects.has(path) ? { size: objects.get(path)!.size } : null, error: null }),
    download: async (path: string) => ({ data: objects.get(path), error: null }),
    createSignedUrl: async (path: string, ttl: number) => { signed.push(path); assert.equal(ttl, 300); return { data: { signedUrl: "https://storage.example.test/private" }, error: null }; },
  }) }, from: (table: string) => {
    assert.equal(table, "production_assets");
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    let patch: Record<string, unknown> | null = null, limit = Infinity;
    const value = (row: Record<string, unknown>, key: string) => key.startsWith("metadata->>") ? String((row.metadata as Record<string, unknown>)[key.slice(11)]) : row[key];
    const matches = () => [...rows.values()].filter(row => filters.every(filter => filter(row))).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, limit);
    const result = () => { const data = matches(); if (patch) data.forEach(row => Object.assign(row, structuredClone(patch))); return { data: structuredClone(data), error: null }; };
    const query = { select: () => query,
      eq: (key: string, expected: unknown) => { filters.push(row => value(row, key) === expected); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(value(row, key))); return query; },
      gt: (key: string, expected: string) => { filters.push(row => String(value(row, key)) > expected); return query; },
      limit: (count: number) => { limit = count; return query; }, order: () => query,
      maybeSingle: async () => { const r = result(); return { data: r.data[0] || null, error: null }; },
      update: (input: Record<string, unknown>) => { patch = input; return query; },
      upsert: async (row: Record<string, unknown>, options: { ignoreDuplicates: boolean }) => { assert.equal(options.ignoreDuplicates, true); if (!rows.has(row.id as string)) rows.set(row.id as string, structuredClone(row)); return { error: null }; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }; return query;
  } } as unknown as SupabaseClient;
  class SessionDeckError extends Error { constructor(message: string, public status = 409) { super(message); } }
  const deckAccess = async () => ({ admin, tenant: { userId: "user", organizationId: workspace.organization_id }, workspace,
    identity: { session: workspace.document.agenda[0] } });
  const service = load<typeof import("../services/session-broll.server")>("src/domains/course-delivery/services/session-broll.server.ts", {
    "./delivery-deck.server": { SessionDeckError, sessionDeckAccess: deckAccess },
    "./delivery-access": { requireDeliveryAccess: async () => { if (!reviewer) throw new Error("Acceso de revisión denegado"); } },
    "../lib/delivery-hash": { deliveryHash: () => revisionHash },
    "../../production/media-storage.config": { HYPERFRAMES_PRIVATE_SOURCE_BUCKET: "production-render-sources" },
    "../../production/media-inspection.service": { inspectStandaloneMedia: async () => { inspections++; inspectHook(); return metadata; } },
    "../types/session-broll": policy,
  });
  const init = { action: "INIT" as const, assetId: "20000000-0000-4000-8000-000000000001", revision: workspace.revision, name: "Apoyo.mp4", extension: "mp4" as const, size: 4 };
  return { service, workspace, rows, objects, signed, init, access: () => service.sessionBrollAccess(id, id),
    reviewer: (value: boolean) => { reviewer = value; }, change: () => { revisionHash = "changed"; }, inspections: () => inspections,
    publicBucket: () => { publicBucket = true; }, inspectHook: (callback: () => void) => { inspectHook = callback; },
    metadata: (value: typeof metadata) => { metadata = value; } };
}

test("contrato solo permite clips acotados y rutas de sesión, no URLs ni componentes de video", () => {
  const { init } = fixture();
  assert.equal(policy.sessionBrollCommandSchema.safeParse(init).success, true);
  for (const patch of [{ extension: "html" }, { size: policy.SESSION_BROLL_MAX_BYTES + 1 }, { name: "../clip.mp4" }, { avatarId: "avatar" }, { url: "https://example.test" }])
    assert.equal(policy.sessionBrollCommandSchema.safeParse({ ...init, ...patch }).success, false);
});

test("carga, validación, revisión humana y retiro idempotentes sin exigir otros assets", async () => {
  const f = fixture(), access = await f.access();
  assert.deepEqual((await f.service.listSessionBrolls(access)).clips, []);
  const result = await f.service.commandSessionBroll(access, f.init);
  assert.ok("upload" in result);
  await f.service.commandSessionBroll(access, f.init);
  assert.equal(f.rows.size, 1);
  await assert.rejects(f.service.sessionBrollMedia(access, f.init.assetId), /Valida/);
  await assert.rejects(f.service.commandSessionBroll(access, { ...f.init, action: "CONFIRM" }), /no está disponible/);
  const row = f.rows.get(f.init.assetId)!;
  f.objects.set(row.storage_path as string, new Blob([new Uint8Array([1, 2, 3, 4])]));
  f.metadata({ width: 1920, height: 1080, duration: 5.1, hasAudio: false });
  await f.service.commandSessionBroll(access, { action: "CONFIRM", assetId: f.init.assetId, revision: f.init.revision });
  await f.service.commandSessionBroll(access, { action: "CONFIRM", assetId: f.init.assetId, revision: f.init.revision });
  assert.equal(f.inspections(), 1);
  assert.equal(row.qa_status, "GENERATED");
  assert.equal(row.duration_seconds, 6, "La persistencia utiliza segundos enteros del contrato existente");
  await f.service.sessionBrollMedia(access, f.init.assetId);
  assert.equal(f.signed.length, 1);
  f.reviewer(false);
  await assert.rejects(f.service.commandSessionBroll(access, { action: "APPROVE", assetId: f.init.assetId, revision: f.init.revision }), /denegado/);
  f.reviewer(true);
  await f.service.commandSessionBroll(access, { action: "APPROVE", assetId: f.init.assetId, revision: f.init.revision });
  assert.equal(row.qa_status, "APPROVED");
  await f.service.commandSessionBroll(access, { action: "ARCHIVE", assetId: f.init.assetId, revision: f.init.revision });
  await f.service.commandSessionBroll(access, { action: "ARCHIVE", assetId: f.init.assetId, revision: f.init.revision });
  assert.equal((await f.service.listSessionBrolls(access)).clips.length, 0);
  assert.equal(f.objects.size, 1, "Retirar no elimina archivos");
});

test("revocación por cambio de revisión y rechazo de archivos o referencias ajenas", async () => {
  const f = fixture(), access = await f.access();
  const original = deliveryHash(f.workspace.document);
  await f.service.commandSessionBroll(access, f.init);
  await assert.rejects(f.service.commandSessionBroll(access, { ...f.init, revision: 99 }), /curso cambió/);
  await assert.rejects(f.service.sessionBrollMedia({ ...access, organizationId: "other" }, f.init.assetId), /no encontrado/);
  const row = f.rows.get(f.init.assetId)!;
  f.objects.set(row.storage_path as string, new Blob([new Uint8Array([1])]));
  await assert.rejects(f.service.commandSessionBroll(access, { action: "CONFIRM", assetId: f.init.assetId, revision: f.init.revision }), /tamaño real/);
  row.qa_status = "GENERATED"; f.change();
  await assert.rejects(f.service.sessionBrollMedia(await f.access(), f.init.assetId), /revisión vigente/);
  assert.equal((await f.service.listSessionBrolls(await f.access())).clips[0].current, false);
  row.storage_path = "session-broll/other/file.mp4";
  await assert.rejects(f.service.sessionBrollMedia(access, f.init.assetId), /integridad/);
  assert.equal(deliveryHash(f.workspace.document), original, "Los apoyos no alteran las aprobaciones del curso");
});

test("se rechaza almacenamiento público y el inspector real rechaza un falso MP4", async () => {
  const f = fixture(); f.publicBucket();
  await assert.rejects(f.service.commandSessionBroll(await f.access(), f.init), /privado/);
  await assert.rejects(inspectStandaloneMedia(new Uint8Array([1, 2, 3, 4]), "video/mp4"));
});

test("inspector real reconoce MP4 sin audio: no se requiere locución ni avatar", async () => {
  const bytes = new Uint8Array(readFileSync("src/domains/course-delivery/__tests__/fixtures/session-broll.mp4"));
  const media = await inspectStandaloneMedia(bytes, "video/mp4");
  assert.equal(media.width, 64); assert.equal(media.height, 64);
  assert.equal(media.hasAudio, false);
  assert.ok(media.duration && media.duration > 0 && media.duration <= 2);
  await assert.rejects(inspectStandaloneMedia(bytes, "video/webm"));
});

test("no revive clips retirados ni confirma archivos de una revisión que cambió durante la inspección", async () => {
  for (const scenario of ["revision", "archive", "dimensions", "duration"] as const) {
    const f = fixture(), access = await f.access();
    await f.service.commandSessionBroll(access, f.init);
    const row = f.rows.get(f.init.assetId)!;
    f.objects.set(row.storage_path as string, new Blob([new Uint8Array([1, 2, 3, 4])]));
    if (scenario === "revision") f.inspectHook(() => f.change());
    if (scenario === "archive") f.inspectHook(() => { row.qa_status = "ARCHIVED"; });
    if (scenario === "dimensions") f.metadata({ width: 3840, height: 2160, duration: 5, hasAudio: false });
    if (scenario === "duration") f.metadata({ width: 1920, height: 1080, duration: 601, hasAudio: false });
    await assert.rejects(f.service.commandSessionBroll(access, { action: "CONFIRM", assetId: f.init.assetId, revision: f.init.revision }));
    assert.notEqual(row.qa_status, "GENERATED");
  }
});

test("una colisión de identificador o sesión ajena no obtiene una URL de carga", async () => {
  const f = fixture(), access = await f.access();
  await f.service.commandSessionBroll(access, f.init);
  const row = f.rows.get(f.init.assetId)!;
  (row.metadata as Record<string, unknown>).session_id = "otra-sesion";
  await assert.rejects(f.service.commandSessionBroll(access, f.init), /no encontrado/);
  assert.equal(f.rows.size, 1);
});
