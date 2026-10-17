/** Preflight for decoded JSON inputs, before recursive schemas or serialization. */
export const COMPOSITION_AGENT_JSON_INPUT_LIMITS = Object.freeze({ maxDepth: 32, maxNodes: 100_000 });

export class CompositionAgentInputBudgetError extends Error {
  constructor(readonly code: "AGENT_INPUT_LIMIT_EXCEEDED" | "AGENT_INPUT_INVALID_JSON", readonly reason: "BYTES" | "DEPTH" | "NODES" | "JSON") {
    super(`${code}:${reason}`);
  }
}

/**
 * Measures the UTF-8 JSON representation without invoking getters/toJSON or creating
 * the serialized payload. This is an input guard, not an HTTP body limit or sandbox
 * for arbitrary JavaScript proxies. Accept plain decoded JSON only.
 */
export function assertCompositionAgentJsonInputBudget(input: unknown, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new RangeError("Invalid host byte budget");
  let bytes = 0;
  let nodes = 0;
  const active = new WeakSet<object>();
  const add = (count: number) => {
    bytes += count;
    if (bytes > maxBytes) limit("BYTES");
  };
  const node = () => {
    if (++nodes > COMPOSITION_AGENT_JSON_INPUT_LIMITS.maxNodes) limit("NODES");
  };
  const string = (value: string) => {
    // UTF-16 length is a lower bound on the escaped UTF-8 JSON size.
    if (value.length + 2 > maxBytes - bytes) limit("BYTES");
    add(2);
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code === 34 || code === 92 || code === 8 || code === 9 || code === 10 || code === 12 || code === 13) add(2);
      else if (code < 32) add(6);
      else if (code < 128) add(1);
      else if (code < 2048) add(2);
      else if (code >= 0xd800 && code <= 0xdbff && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
        add(4);
        index += 1;
      } else if (code >= 0xd800 && code <= 0xdfff) add(6);
      else add(3);
    }
  };
  const visit = (value: unknown, depth: number) => {
    if (depth > COMPOSITION_AGENT_JSON_INPUT_LIMITS.maxDepth) limit("DEPTH");
    node();
    if (value === null) { add(4); return; }
    switch (typeof value) {
      case "string": string(value); return;
      case "boolean": add(value ? 4 : 5); return;
      case "number":
        if (!Number.isFinite(value)) invalid();
        add(String(value).length);
        return;
      case "object": break;
      default: invalid();
    }
    const object = value as object;
    if (active.has(object)) invalid();
    const array = Array.isArray(object);
    const prototype = Object.getPrototypeOf(object);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) invalid();
    // Even non-enumerable serializers are forbidden; they must not run downstream.
    if (Object.getOwnPropertyDescriptor(object, "toJSON")) invalid();
    const length = array ? (object as unknown[]).length : 0;
    if (length > COMPOSITION_AGENT_JSON_INPUT_LIMITS.maxNodes - nodes) limit("NODES");
    const keys = Reflect.ownKeys(object);
    if (keys.length > COMPOSITION_AGENT_JSON_INPUT_LIMITS.maxNodes - nodes + (array ? 1 : 0)) limit("NODES");
    if (array && keys.length !== length + 1) invalid(); // sparse arrays and extra fields
    active.add(object);
    add(2); // braces or brackets
    let count = 0;
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string") invalid();
      const descriptor = Object.getOwnPropertyDescriptor(object, key)!;
      if (!descriptor.enumerable || !("value" in descriptor)) invalid();
      if (array && key !== String(count)) invalid();
      if (count++ > 0) add(1);
      if (!array) { node(); string(key); add(1); }
      visit(descriptor.value, depth + 1);
    }
    active.delete(object);
  };
  visit(input, 0);
  return bytes;
}

function limit(reason: "BYTES" | "DEPTH" | "NODES"): never {
  throw new CompositionAgentInputBudgetError("AGENT_INPUT_LIMIT_EXCEEDED", reason);
}
function invalid(): never {
  throw new CompositionAgentInputBudgetError("AGENT_INPUT_INVALID_JSON", "JSON");
}
