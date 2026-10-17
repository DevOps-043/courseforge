import {isAbsolute, resolve} from "node:path";
const fail = () => {throw new Error("CONTROLLED_RENDER_OBSERVED_OPERATOR_REFERENCE_INVALID");};
/** Host launch metadata only; not fields of a composition/job request. */
export function parseObservedOperatorReference(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
    || JSON.stringify(Object.keys(raw).sort()) !== JSON.stringify(["path", "sha256"])
    || typeof raw.path !== "string" || !isAbsolute(raw.path) || resolve(raw.path) !== raw.path
    || raw.path.includes("\0") || raw.path.length > 512 || typeof raw.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.sha256)) fail();
  return {...raw};
}
export const encodeObservedOperatorReference = raw => Buffer.from(JSON.stringify(parseObservedOperatorReference(raw))).toString("base64");
export function decodeObservedOperatorReference(encoded) {
  try {
    if (typeof encoded !== "string" || encoded.length > 1024) fail();
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded) fail();
    return parseObservedOperatorReference(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
  } catch {fail();}
}
