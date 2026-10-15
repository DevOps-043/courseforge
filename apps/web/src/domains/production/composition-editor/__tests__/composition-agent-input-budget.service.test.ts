import assert from "node:assert/strict";
import test from "node:test";
import { assertCompositionAgentJsonInputBudget, COMPOSITION_AGENT_JSON_INPUT_LIMITS, CompositionAgentInputBudgetError } from "../composition-agent-input-budget.service";
import { createCompositionAgentReadSession } from "../composition-agent-read-session.service";
import { CompositionAgentReadError } from "../composition-agent-read-tools.service";
import { simulateCompositionAgentPlan, CompositionAgentPlanError, COMPOSITION_AGENT_PLAN_LIMITS } from "../composition-agent-plan.service";
import { parseCompositionAgentBoundProposal, parseCompositionAgentProposalConsent, parseCompositionAgentProposalReceipt, CompositionAgentIntegrationContractError } from "../composition-agent-integration.contract";
import { hashCompositionDocument } from "../composition-document-hash";
import { AGENT_TEST_PROPOSAL_ID, compositionAgentFixture } from "./composition-agent-test-fixture";

const inputError = (reason: string) => (error: unknown) => error instanceof CompositionAgentInputBudgetError && error.reason === reason;
function nested(depth: number): unknown {
  let value: unknown = null;
  for (let index = 0; index < depth; index += 1) value = [value];
  return value;
}

test("preflight matches UTF-8 JSON bytes for escapes, Unicode, keys and numeric forms", () => {
  const shared = { text: "á漢🎬" };
  const vectors = [null, true, false, 0, -0, 1e21, 1e-7, Number.MAX_VALUE,
    "\"\\\b\t\n\f\r\u0000\u001f", "\ud800x\udfff", "\ud800\udfff", "\u2028\u2029",
    { "🎬\n": [shared, shared, [], {}, null], numbers: [0.1, -1, Number.MIN_VALUE] },
    Object.assign(Object.create(null), { safe: "object" })];
  for (const value of vectors) {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    assert.equal(assertCompositionAgentJsonInputBudget(value, bytes), bytes);
    if (bytes > 1) assert.throws(() => assertCompositionAgentJsonInputBudget(value, bytes - 1), inputError("BYTES"));
    else assert.throws(() => assertCompositionAgentJsonInputBudget(value, 0), RangeError);
  }
});

test("byte overflow stops before serializing large strings or traversing their siblings", () => {
  let calls = 0;
  const value = { padding: "x".repeat(1_000_000), get late() { calls += 1; return "secret"; } };
  assert.throws(() => assertCompositionAgentJsonInputBudget(value, 4_096), inputError("BYTES"));
  assert.equal(calls, 0);
});

test("depth cap is inclusive and rejects excessive nesting without stack overflow", () => {
  assert.ok(assertCompositionAgentJsonInputBudget(nested(COMPOSITION_AGENT_JSON_INPUT_LIMITS.maxDepth), 1_000) > 0);
  assert.throws(() => assertCompositionAgentJsonInputBudget(nested(10_000), 1_000_000), inputError("DEPTH"));
});

test("node cap counts array values and object keys, including repeated alias occurrences", () => {
  const max = COMPOSITION_AGENT_JSON_INPUT_LIMITS.maxNodes;
  assert.ok(assertCompositionAgentJsonInputBudget(Array(max - 1).fill(null), 2_000_000) > 0);
  assert.throws(() => assertCompositionAgentJsonInputBudget(Array(max).fill(null), 2_000_000), inputError("NODES"));
  const shared = Array(100).fill(null);
  assert.throws(() => assertCompositionAgentJsonInputBudget(Array(1_000).fill(shared), 2_000_000), inputError("NODES"));
  assert.throws(() => assertCompositionAgentJsonInputBudget(Object.fromEntries(Array.from({ length: max / 2 }, (_, i) => [`key-${i}`, null])), 2_000_000), inputError("NODES"));
});

test("cycles and non-JSON values fail closed, without silently dropping or coercing fields", () => {
  const cyclic: { child?: unknown } = {};
  cyclic.child = cyclic;
  const extraArray = Object.assign([1], { extra: true });
  const hidden = Object.defineProperty({}, "hidden", { value: true });
  for (const value of [cyclic, undefined, 1n, NaN, Infinity, -Infinity, () => null, Symbol("x"), new Date(0), new Map(), [, 1], extraArray, hidden, { missing: undefined }, { symbol: Symbol("x") }, { [Symbol("x")]: true }]) {
    assert.throws(() => assertCompositionAgentJsonInputBudget(value, 10_000), inputError("JSON"));
  }
});

test("getters and toJSON callbacks are rejected without invoking them or mutating input", () => {
  let calls = 0;
  const serializer = { toJSON() { calls += 1; return {}; } };
  const hiddenSerializer = Object.defineProperty({}, "toJSON", { value() { calls += 1; return {}; } });
  const accessor = { get input() { calls += 1; return {}; } };
  for (const value of [serializer, hiddenSerializer, accessor]) {
    assert.throws(() => assertCompositionAgentJsonInputBudget(value, 10_000), inputError("JSON"));
  }
  const ordinary = { children: [{ text: "safe" }] };
  const before = structuredClone(ordinary);
  assertCompositionAgentJsonInputBudget(ordinary, 10_000);
  assert.deepEqual(ordinary, before);
  assert.equal(Object.isFrozen(ordinary), false);
  assert.equal(calls, 0);
});

test("invalid host budgets cannot disable preflight", () => {
  for (const budget of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertCompositionAgentJsonInputBudget({}, budget), RangeError);
  }
});

test("read failures consume attempts but no response bytes or domain work", () => {
  const session = createCompositionAgentReadSession({ ...compositionAgentFixture(), budget: { maxCalls: 2 } });
  assert.throws(() => session.read(nested(10_000)), (error: unknown) => error instanceof CompositionAgentReadError && error.code === "AGENT_READ_LIMIT_EXCEEDED");
  const cyclic: unknown[] = []; cyclic.push(cyclic);
  assert.throws(() => session.read(cyclic), inputError("JSON"));
  assert.deepEqual(session.usage(), { calls: 2, responseBytes: 0, workUnits: 0 });
  assert.throws(() => session.read({ tool: "get_operation_catalog", arguments: {} }), (error: unknown) => error instanceof CompositionAgentReadError && error.code === "AGENT_READ_LIMIT_EXCEEDED");
});

test("plan preflight rejects depth/bytes/cycles without network, mutation or partial simulation", (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("No provider allowed"); });
  const f = compositionAgentFixture();
  const before = structuredClone(f.document);
  for (const input of [nested(10_000), "🎬".repeat(COMPOSITION_AGENT_PLAN_LIMITS.maxInputBytes)]) {
    assert.throws(() => simulateCompositionAgentPlan({ ...f, input, proposalId: AGENT_TEST_PROPOSAL_ID }), (error: unknown) => error instanceof CompositionAgentPlanError && error.code === "AGENT_PLAN_LIMIT_EXCEEDED");
  }
  const cyclic: unknown[] = []; cyclic.push(cyclic);
  assert.throws(() => simulateCompositionAgentPlan({ ...f, input: cyclic, proposalId: AGENT_TEST_PROPOSAL_ID }), inputError("JSON"));
  assert.deepEqual(f.document, before);
  assert.equal(hashCompositionDocument(f.document), f.scope.documentHash);
  assert.equal(fetch.mock.callCount(), 0);
});

test("all integration decoders preflight before recursive schemas and expected metadata", () => {
  const decoders = [
    (input: unknown) => parseCompositionAgentBoundProposal(input),
    (input: unknown) => parseCompositionAgentProposalConsent(input, null as never),
    (input: unknown) => parseCompositionAgentProposalReceipt(input, null as never),
  ];
  const cyclic: unknown[] = []; cyclic.push(cyclic);
  for (const decode of decoders) {
    assert.throws(() => decode(nested(10_000)), (error: unknown) => error instanceof CompositionAgentIntegrationContractError && error.code === "AGENT_INTEGRATION_PAYLOAD_LIMIT");
    assert.throws(() => decode(cyclic), inputError("JSON"));
  }
});
