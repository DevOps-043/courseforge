import {z} from "zod";
import {createHash} from "node:crypto";
import {buildWindowsNetworkPlan, windowsNetworkScopeSchema} from "./composition-windows-network-policy";
import {WINDOWS_NETWORK_JOURNAL_POLICY, type WindowsNetworkIntent} from "./composition-windows-network-journal";

export const WINDOWS_NETWORK_NATIVE_RECORD_POLICY = Object.freeze({version: 1, maximumBytes: 512});
export const windowsNetworkNativeConfigurationSchema = z.object({providerId: z.string().uuid(), sublayerId: z.string().uuid()}).strict();
const fail = () => new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED");
function guidBytes(value: string) {
  z.string().uuid().parse(value);
  const bytes = Buffer.from(value.replaceAll("-", ""), "hex");
  // Windows GUID memory order, shared with Guid.ToByteArray; remaining eight bytes are unchanged.
  bytes.subarray(0, 4).reverse(); bytes.subarray(4, 6).reverse(); bytes.subarray(6, 8).reverse();
  return bytes;
}
/** Fixed wire format, not a native memory layout or authority source. Config is operator-only. */
export function encodeWindowsNetworkNativeRecord(raw: WindowsNetworkIntent, rawConfiguration: z.infer<typeof windowsNetworkNativeConfigurationSchema>) {
  try {
    const configuration = windowsNetworkNativeConfigurationSchema.parse(rawConfiguration);
    const scope = windowsNetworkScopeSchema.parse(raw.scope);
    const plan = buildWindowsNetworkPlan(scope, raw.plan.mode === "EXACT_LOOPBACK" ? raw.plan.endpoint : undefined);
    const {sha256, ...storedIntent} = raw;
    if (raw.policy !== WINDOWS_NETWORK_JOURNAL_POLICY.id || JSON.stringify(plan) !== JSON.stringify(raw.plan)
      || !/^[a-f0-9]{64}$/.test(sha256) || createHash("sha256").update(JSON.stringify(storedIntent)).digest("hex") !== sha256
      || !Number.isInteger(raw.generation) || raw.generation < 1 || raw.generation > 3
      || (raw.generation === 2) !== (plan.mode === "EXACT_LOOPBACK")
      || raw.filterKeys.length !== plan.rules.length || new Set(raw.filterKeys).size !== raw.filterKeys.length) throw fail();
    const sid = Buffer.from(scope.appContainerSid, "ascii"), header = Buffer.alloc(98);
    header.writeUInt32LE(WINDOWS_NETWORK_NATIVE_RECORD_POLICY.version, 0);
    guidBytes(configuration.providerId).copy(header, 4); guidBytes(configuration.sublayerId).copy(header, 20);
    guidBytes(raw.leaseId).copy(header, 36); header.writeBigUInt64LE(BigInt(raw.generation), 52);
    Buffer.from(plan.sha256, "hex").copy(header, 60);
    header[92] = plan.mode === "EXACT_LOOPBACK" ? 1 : 0;
    header[93] = plan.endpoint ? plan.endpoint.address === "::1" ? 6 : 4 : 0;
    header.writeUInt16LE(plan.endpoint?.port ?? 0, 94); header.writeUInt16LE(sid.length, 96);
    const count = Buffer.alloc(2); count.writeUInt16LE(raw.filterKeys.length);
    const encoded = Buffer.concat([header, sid, count, ...raw.filterKeys.map(guidBytes)]);
    if (encoded.length > WINDOWS_NETWORK_NATIVE_RECORD_POLICY.maximumBytes) throw fail();
    return encoded;
  } catch {throw fail();}
}
