import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createNarrativeFragmentReadRepository } from "../composition-narrative-fragment.repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const draftId = "22222222-2222-4222-8222-222222222222";
const componentId = "33333333-3333-4333-8333-333333333333";
const anchorId = "44444444-4444-4444-8444-444444444444";
const visualId = "55555555-5555-4555-8555-555555555555";
type Call = { table: string; filters: Record<string, unknown>; fields?: string; maximum?: number; retry?: boolean; signal?: AbortSignal };
function fakeClient(results: { data: unknown; error: unknown }[]) {
  const calls: Call[] = [];
  const client = { from(table: string) {
    const call: Call = { table, filters: {} }; calls.push(call);
    const result = results.shift(); if (!result) throw Error("Unexpected query");
    const chain = {
      select(fields: string) { call.fields = fields; return chain; },
      eq(key: string, value: unknown) { call.filters[key] = value; return chain; },
      in(key: string, values: unknown) { call.filters[key] = values; return chain; },
      limit(maximum: number) { call.maximum = maximum; return chain; },
      retry(value: boolean) { call.retry = value; return chain; },
      abortSignal(signal: AbortSignal) { call.signal = signal; return chain; },
      maybeSingle() { return Promise.resolve(result); },
      then(resolve: (value: typeof result) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve(result).then(resolve, reject); },
    };
    return chain;
  } };
  return { client: client as unknown as SupabaseClient, calls };
}
const success = (data: unknown) => ({ data, error: null });
test("batch metadata and anchor reads carry exact tenant/draft/component filters without N asset queries", async () => {
  const anchor = { id: anchorId, metadata: { script_hash: "a".repeat(64) } };
  const { client, calls } = fakeClient([success([{ production_asset_id: anchorId }, { production_asset_id: visualId }]),
    success([{ id: anchorId }, { id: visualId }]), success({ production_asset_id: anchorId }), success(anchor)]);
  const signal = new AbortController().signal;
  const repository = createNarrativeFragmentReadRepository(client, signal);
  assert.deepEqual(await repository.readAssets({ organizationId, draftId, componentId }, [anchorId, visualId], anchorId), [anchor, { id: visualId }]);
  assert.equal(calls.length, 4);
  for (const call of calls) { assert.equal(call.filters.organization_id, organizationId); assert.equal(call.signal, signal); }
  assert.equal(calls[0]?.filters.draft_id, draftId); assert.equal(calls[2]?.filters.draft_id, draftId);
  assert.equal(calls[1]?.filters.material_component_id, componentId); assert.equal(calls[3]?.filters.material_component_id, componentId);
  assert.equal(calls[1]?.fields?.includes("metadata"), false); assert.equal(calls[0]?.maximum, 3);
  assert.equal(calls[0]?.retry, false); assert.equal(calls[1]?.retry, false);
});
test("missing draft link stops before registry queries; errors do not fall back to unrelated assets", async () => {
  const missing = fakeClient([success([{ production_asset_id: anchorId }])]);
  const repository = createNarrativeFragmentReadRepository(missing.client, new AbortController().signal);
  assert.deepEqual(await repository.readAssets({ organizationId, draftId, componentId }, [anchorId, visualId], anchorId), []);
  assert.equal(missing.calls.length, 1);
  const failed = fakeClient([{ data: null, error: new Error("read failed") }]);
  await assert.rejects(createNarrativeFragmentReadRepository(failed.client, new AbortController().signal)
    .readAssets({ organizationId, draftId, componentId }, [anchorId], anchorId), /read failed/);
});
test("font reads are tenant-scoped, bounded, metadata-only and abort-aware", async () => {
  const { client, calls } = fakeClient([success([{ id: visualId }])]);
  const signal = new AbortController().signal;
  assert.deepEqual(await createNarrativeFragmentReadRepository(client, signal).readFonts(organizationId, [visualId]), [{ id: visualId }]);
  assert.equal(calls[0]?.table, "organization_slide_fonts"); assert.equal(calls[0]?.filters.organization_id, organizationId);
  assert.equal(calls[0]?.maximum, 2); assert.equal(calls[0]?.retry, false); assert.equal(calls[0]?.signal, signal);
  assert.equal(calls[0]?.fields?.includes("storage_path"), false);
});
test("bad identifiers, oversized responses and aborted requests fail closed", async () => {
  const noQueries = fakeClient([]); const aborted = new AbortController(); aborted.abort();
  await assert.rejects(createNarrativeFragmentReadRepository(noQueries.client, aborted.signal).readFonts(organizationId, [visualId]));
  assert.equal(noQueries.calls.length, 0);
  await assert.rejects(createNarrativeFragmentReadRepository(noQueries.client, new AbortController().signal).readFonts(organizationId, ["invalid"]));
  const oversized = fakeClient([success([{ id: visualId, unexpected: "x".repeat(2 * 1024 * 1024) }])]);
  await assert.rejects(createNarrativeFragmentReadRepository(oversized.client, new AbortController().signal).readFonts(organizationId, [visualId]), /RESPONSE_LIMIT/);
});
