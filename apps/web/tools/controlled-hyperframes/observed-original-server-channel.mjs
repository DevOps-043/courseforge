import {createPublicKey} from "node:crypto";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
import {hashBytes, readPinnedPackageFile} from "./producer-extension-files.mjs";
import {ORIGINAL_SERVER_FILE_CHANNEL_POLICY} from "./original-server-channel-policy.mjs";

const fail = () => {throw new Error("CONTROLLED_RENDER_NETWORK_CHANNEL_RECOVERY_REQUIRED");};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const exact = (value, fields) => value && Object.getPrototypeOf(value) === Object.prototype
  && Object.keys(value).sort().join(",") === [...fields].sort().join(",");
const transportPath = fileURLToPath(new URL("./original-server-file-channel.mjs", import.meta.url));

/** Public-only operator metadata. Never permits a private key, arbitrary module or callback path. */
export function parseObservedOriginalServerChannel(raw) {
  if (!exact(raw, ["policy", "directory", "executionId", "operationNonce", "publicKeySpki", "publicKeySha256", "transportSha256", "transportSizeBytes"])
    || raw.policy !== ORIGINAL_SERVER_FILE_CHANNEL_POLICY.id || !uuid.test(raw.executionId) || !uuid.test(raw.operationNonce)
    || typeof raw.directory !== "string" || raw.directory.length > 1024 || raw.directory.includes("\0")
    || typeof raw.publicKeySpki !== "string" || raw.publicKeySpki.length > 256
    || !/^[a-f0-9]{64}$/.test(raw.publicKeySha256 ?? "") || !/^[a-f0-9]{64}$/.test(raw.transportSha256 ?? "")
    || !Number.isSafeInteger(raw.transportSizeBytes) || raw.transportSizeBytes < 1
    || raw.transportSizeBytes > ORIGINAL_SERVER_FILE_CHANNEL_POLICY.maximumTransportBytes) fail();
  try {
    const der = Buffer.from(raw.publicKeySpki, "base64");
    if (der.toString("base64") !== raw.publicKeySpki || hashBytes(der) !== raw.publicKeySha256) fail();
    const key = createPublicKey({key: der, type: "spki", format: "der"});
    if (key.asymmetricKeyType !== "ed25519" || key.export({type: "spki", format: "der"}).toString("base64") !== raw.publicKeySpki) fail();
    return {...raw};
  } catch {fail();}
}

/** Mailbox is a preprovisioned sibling, not the output directory created exclusively by the SDK adapter. */
export async function createObservedOriginalServerChannel(raw, request, assertOperatorUnchanged, signal) {
  const configuration = parseObservedOriginalServerChannel(raw);
  if (configuration.executionId !== request.executionId
    || configuration.directory !== join(request.outputParentDirectory, `${request.executionId}.original-server-channel`)) fail();
  const assertTransport = async () => {
    signal.throwIfAborted(); await assertOperatorUnchanged();
    const bytes = await readPinnedPackageFile(transportPath, ORIGINAL_SERVER_FILE_CHANNEL_POLICY.maximumTransportBytes);
    if (bytes.length !== configuration.transportSizeBytes || hashBytes(bytes) !== configuration.transportSha256) fail();
    signal.throwIfAborted();
  };
  await assertTransport();
  const {createOriginalServerFileClient} = await import("./original-server-file-channel.mjs");
  await assertTransport();
  const client = await createOriginalServerFileClient({directory: configuration.directory,
    binding: {executionId: configuration.executionId, operationNonce: configuration.operationNonce},
    publicKey: createPublicKey({key: Buffer.from(configuration.publicKeySpki, "base64"), type: "spki", format: "der"})});
  return async candidate => {
    await assertTransport();
    const ack = await client(candidate);
    await assertTransport(); candidate.signal.throwIfAborted(); return ack;
  };
}
