import {isAbsolute, resolve, dirname} from "node:path";
import {lstat, realpath} from "node:fs/promises";
import {z} from "zod";
import {windowsNetworkChannelBindingSchema} from "./composition-windows-network-channel-contract";
import {windowsNetworkNativeConfigurationSchema} from "./composition-windows-network-native-record";
import {readOwnedMeasurementFile} from "./composition-owned-measurement-files";
import {pinConformanceFile, assertConformanceFileUnchanged} from "./composition-conformance-file-integrity";

export const WINDOWS_NETWORK_BROKER_CONFIGURATION_POLICY = Object.freeze({id: "WINDOWS_NETWORK_OPERATOR_BROKER_V2", maximumBytes: 65536});
const path = z.string().min(1).max(4096).refine(value => isAbsolute(value) && resolve(value) === value
  && !value.includes("\0") && !value.startsWith("\\\\"));
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const component = "(?:0|[1-9][0-9]{0,9})";
const accountSid = z.string().max(184).regex(new RegExp(`^S-1-5-(?:21(?:-${component}){4}|80(?:-${component}){5})$`))
  .refine(value => !/[\r\n]/.test(value) && value.split("-").slice(4).every(part => Number(part) <= 0xffffffff));
const logonSid = z.string().regex(new RegExp(`^S-1-5-5-${component}-${component}$`))
  .refine(value => !/[\r\n]/.test(value) && value.split("-").slice(4).every(part => Number(part) <= 0xffffffff));
const peer = z.object({pid: z.number().int().min(1).max(0xffffffff),
  creationFileTime: z.string().regex(/^[1-9][0-9]{0,19}$/).refine(value => BigInt(value) <= 0xffffffffffffffffn),
  accountSid, logonSid}).strict();
const file = z.object({path, sha256: hash, sizeBytes: z.number().int().positive().max(32 * 1024 ** 2)}).strict();
const schema = z.object({policy: z.literal(WINDOWS_NETWORK_BROKER_CONFIGURATION_POLICY.id),
  binding: windowsNetworkChannelBindingSchema, authority: windowsNetworkNativeConfigurationSchema,
  journalDirectory: path, clientPeer: peer, brokerPeer: peer,
  files: z.object({server: file, client: file, loader: file, invocation: file, nativeLibrary: file}).strict()}).strict()
  .refine(value => value.clientPeer.pid !== value.brokerPeer.pid && value.clientPeer.accountSid !== value.brokerPeer.accountSid
    && value.clientPeer.logonSid !== value.brokerPeer.logonSid
    && new Set(Object.values(value.files).map(file => file.path.toLowerCase())).size === 5
    && Object.values(value.authority).every(id => id !== "00000000-0000-0000-0000-000000000000"));
export type WindowsNetworkBrokerConfiguration = z.infer<typeof schema>;
const fail = () => new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED");

/** Read-only operator admission. No compilation, DLL load, pipe, service or native activation. */
export async function loadWindowsNetworkBrokerConfiguration(input: {path: string; sha256: string}, signal: AbortSignal) {
  try {
    path.parse(input.path); hash.parse(input.sha256); signal.throwIfAborted();
    const configurationFile = await readOwnedMeasurementFile(input.path, WINDOWS_NETWORK_BROKER_CONFIGURATION_POLICY.maximumBytes, signal);
    if (configurationFile.pin.sha256 !== input.sha256) throw fail();
    const configuration = schema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(configurationFile.bytes)));
    const directories = new Map<string, {device: number; inode: number}>();
    // Audit ancestor identity/reparse status too; immutable ACL provisioning still belongs to operator.
    for (const start of [dirname(input.path), configuration.journalDirectory, ...Object.values(configuration.files).map(file => dirname(file.path))]) {
      let current = start, depth = 0;
      while (!directories.has(current)) {
        if (++depth > 64) throw fail();
        const stat = await lstat(current); signal.throwIfAborted();
        if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(current) !== current) throw fail();
        directories.set(current, {device: stat.dev, inode: stat.ino});
        const parent = dirname(current); if (parent === current) break; current = parent;
      }
    }
    const pinned = await Promise.all(Object.values(configuration.files).map(async file => {
      if ((await lstat(file.path)).nlink !== 1) throw fail();
      const pin = await pinConformanceFile(file.path, file.sizeBytes, false, signal);
      if (pin.sha256 !== file.sha256 || pin.sizeBytes !== file.sizeBytes) throw fail();
      return {path: file.path, pin};
    }));
    const assertUnchanged = async (ownedSignal: AbortSignal) => {
      ownedSignal.throwIfAborted();
      for (const [directory, previous] of directories) {
        const stat = await lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== previous.device || stat.ino !== previous.inode
          || await realpath(directory) !== directory) throw fail();
      }
      await assertConformanceFileUnchanged(input.path, configurationFile.pin, WINDOWS_NETWORK_BROKER_CONFIGURATION_POLICY.maximumBytes, false, ownedSignal);
      for (const file of pinned) {
        if ((await lstat(file.path)).nlink !== 1) throw fail();
        await assertConformanceFileUnchanged(file.path, file.pin, file.pin.sizeBytes, false, ownedSignal);
      }
      ownedSignal.throwIfAborted();
    };
    await assertUnchanged(signal);
    return {configuration: structuredClone(configuration), assertUnchanged};
  } catch {throw fail();}
}
