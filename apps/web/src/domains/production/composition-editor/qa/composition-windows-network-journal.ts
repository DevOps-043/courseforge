import {createHash, randomUUID} from "node:crypto";
import {lstat, open, realpath} from "node:fs/promises";
import {isAbsolute, join, resolve} from "node:path";
import {z} from "zod";
import {windowsNetworkCommandSchema, type WindowsNetworkCommand} from "./composition-windows-network-channel-contract";
import {readOwnedMeasurementFile} from "./composition-owned-measurement-files";
import {buildWindowsNetworkPlan, windowsNetworkScopeSchema, windowsLoopbackEndpointSchema,
  type WindowsNetworkScope, type WindowsNetworkPlan} from "./composition-windows-network-policy";

export const WINDOWS_NETWORK_JOURNAL_POLICY = Object.freeze({id: "LOCAL_WINDOWS_NETWORK_INTENT_JOURNAL_V1", maximumRecordBytes: 32768});
const POLICY = WINDOWS_NETWORK_JOURNAL_POLICY.id;
const MAXIMUM_RECORD_BYTES = WINDOWS_NETWORK_JOURNAL_POLICY.maximumRecordBytes;
const leaseSchema = z.object({policy: z.literal(POLICY), scope: windowsNetworkScopeSchema, leaseId: z.string().uuid()}).strict();
const intentSchema = leaseSchema.extend({generation: z.number().int().min(1).max(3),
  plan: z.unknown(), filterKeys: z.array(z.string().uuid()).min(4).max(9)}).strict();
export const windowsNetworkObservationSchema = z.object({policy: z.literal(POLICY), leaseId: z.string().uuid(),
  generation: z.number().int().min(1).max(3), intentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  planSha256: z.string().regex(/^[a-f0-9]{64}$/), filterKeys: z.array(z.string().uuid()).min(4).max(9),
  persistent: z.literal(true)}).strict();
const observationSchema = windowsNetworkObservationSchema;
type Intent = z.infer<typeof intentSchema> & {plan: WindowsNetworkPlan};
export type WindowsNetworkIntent = Intent & {sha256: string};
const failure = () => new Error("CONTROLLED_RENDER_NETWORK_JOURNAL_RECOVERY_REQUIRED");

function exactPlan(raw: unknown, scope: WindowsNetworkScope): WindowsNetworkPlan {
  if (!raw || typeof raw !== "object") throw failure();
  const candidate = raw as {mode?: unknown; endpoint?: unknown};
  if (candidate.mode !== "DENY_ALL" && candidate.mode !== "EXACT_LOOPBACK") throw failure();
  const plan = buildWindowsNetworkPlan(scope, candidate.mode === "EXACT_LOOPBACK"
    ? windowsLoopbackEndpointSchema.parse(candidate.endpoint) : undefined);
  if (JSON.stringify(raw) !== JSON.stringify(plan)) throw failure();
  return plan;
}

/** Local operator-owned journal. File sync, immutable intents, no reclaim or automatic retry.
 * Requires a stable dedicated root/ACL. Not a cross-host lock or power-loss guarantee. */
export class CompositionWindowsNetworkJournal {
  constructor(private readonly directory: string) {}

  /** Reserve a command BEFORE controller effects. Restart cannot replay the same sequence. */
  async reserveCommand(raw: WindowsNetworkCommand, signal: AbortSignal) {
    try {
      const request = windowsNetworkCommandSchema.parse(raw), root = await this.root();
      const path = join(root.path, `${request.channelId}.${request.sequence}.command.json`);
      await this.write(path, request, signal);
      const stored = windowsNetworkCommandSchema.parse((await this.read(path, signal)).value);
      if (JSON.stringify(stored) !== JSON.stringify(request)) throw failure();
      await this.unchangedRoot(root); signal.throwIfAborted();
    } catch {throw failure();}
  }

  async acquire(rawScope: WindowsNetworkScope, rawLeaseId: string, rawPlan: WindowsNetworkPlan, signal: AbortSignal) {
    try {
      signal.throwIfAborted();
      const lease = leaseSchema.parse({policy: POLICY, scope: rawScope, leaseId: rawLeaseId});
      const plan = exactPlan(rawPlan, lease.scope);
      if (plan.mode !== "DENY_ALL") throw failure();
      const root = await this.root();
      // Permanent package reservation: different tenants/executions cannot acquire the same SID.
      await this.write(join(root.path, `${this.slot(lease.scope)}.lease.json`), lease, signal);
      await this.unchangedRoot(root);
      return await this.writeIntent(lease, 1, plan, signal);
    } catch {throw failure();}
  }

  async reserveNext(rawScope: WindowsNetworkScope, leaseId: string, previousGeneration: number,
    rawPlan: WindowsNetworkPlan, signal: AbortSignal) {
    try {
      const previous = await this.readIntent(rawScope, leaseId, previousGeneration, signal);
      await this.readObservation(previous, signal);
      const plan = exactPlan(rawPlan, previous.scope);
      if (!(previousGeneration === 1 && plan.mode === "EXACT_LOOPBACK"
        || previousGeneration === 2 && plan.mode === "DENY_ALL")) throw failure();
      return await this.writeIntent({policy: POLICY, scope: previous.scope, leaseId}, previousGeneration + 1, plan, signal);
    } catch {throw failure();}
  }

  async readIntent(rawScope: WindowsNetworkScope, leaseId: string, generation: number, signal: AbortSignal): Promise<WindowsNetworkIntent> {
    try {
      signal.throwIfAborted();
      const lease = leaseSchema.parse({policy: POLICY, scope: rawScope, leaseId});
      z.number().int().min(1).max(3).parse(generation);
      const root = await this.root(), slot = this.slot(lease.scope);
      const storedLease = leaseSchema.parse((await this.read(join(root.path, `${slot}.lease.json`), signal)).value);
      if (JSON.stringify(storedLease) !== JSON.stringify(lease)) throw failure();
      const encoded = await this.read(join(root.path, `${slot}.${leaseId}.${generation}.intent.json`), signal);
      const parsed = intentSchema.parse(encoded.value);
      if (parsed.leaseId !== leaseId || parsed.generation !== generation || JSON.stringify(parsed.scope) !== JSON.stringify(lease.scope)
        || new Set(parsed.filterKeys).size !== parsed.filterKeys.length) throw failure();
      const plan = exactPlan(parsed.plan, lease.scope);
      if (parsed.filterKeys.length !== plan.rules.length || (generation === 2) !== (plan.mode === "EXACT_LOOPBACK")) throw failure();
      await this.unchangedRoot(root); signal.throwIfAborted();
      return {...parsed, plan, sha256: encoded.sha256};
    } catch {throw failure();}
  }

  /** Only after independent native readback. This metadata is NOT itself kernel attestation. */
  async recordObservation(rawIntent: WindowsNetworkIntent, rawObservation: unknown, signal: AbortSignal) {
    try {
      const intent = await this.readIntent(rawIntent.scope, rawIntent.leaseId, rawIntent.generation, signal);
      if (JSON.stringify(intent) !== JSON.stringify(rawIntent)) throw failure();
      const observation = observationSchema.parse(rawObservation);
      this.matchObservation(intent, observation);
      const root = await this.root();
      await this.write(this.observationPath(root.path, intent), observation, signal);
      await this.unchangedRoot(root);
      return await this.readObservation(intent, signal);
    } catch {throw failure();}
  }

  async readObservation(rawIntent: WindowsNetworkIntent, signal: AbortSignal) {
    try {
      const intent = await this.readIntent(rawIntent.scope, rawIntent.leaseId, rawIntent.generation, signal);
      if (JSON.stringify(intent) !== JSON.stringify(rawIntent)) throw failure();
      const root = await this.root();
      const observation = observationSchema.parse((await this.read(this.observationPath(root.path, intent), signal)).value);
      this.matchObservation(intent, observation); await this.unchangedRoot(root); signal.throwIfAborted();
      return observation;
    } catch {throw failure();}
  }

  private matchObservation(intent: WindowsNetworkIntent, observation: z.infer<typeof observationSchema>) {
    if (observation.leaseId !== intent.leaseId || observation.generation !== intent.generation
      || observation.intentSha256 !== intent.sha256 || observation.planSha256 !== intent.plan.sha256
      || JSON.stringify(observation.filterKeys) !== JSON.stringify(intent.filterKeys)) throw failure();
  }
  private async writeIntent(lease: z.infer<typeof leaseSchema>, generation: number, plan: WindowsNetworkPlan, signal: AbortSignal) {
    const root = await this.root();
    const intent = intentSchema.parse({...lease, generation, plan, filterKeys: plan.rules.map(() => randomUUID())});
    await this.write(join(root.path, `${this.slot(lease.scope)}.${lease.leaseId}.${generation}.intent.json`), intent, signal);
    await this.unchangedRoot(root);
    return await this.readIntent(lease.scope, lease.leaseId, generation, signal);
  }
  private observationPath(root: string, intent: WindowsNetworkIntent) {
    return join(root, `${this.slot(intent.scope)}.${intent.leaseId}.${intent.generation}.observed.json`);
  }
  private slot(scope: WindowsNetworkScope) {return createHash("sha256").update(scope.appContainerSid).digest("hex");}
  private async root() {
    if (!isAbsolute(this.directory) || resolve(this.directory) !== this.directory) throw failure();
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(this.directory) !== this.directory) throw failure();
    return {path: this.directory, device: stat.dev, inode: stat.ino};
  }
  private async unchangedRoot(expected: Awaited<ReturnType<CompositionWindowsNetworkJournal["root"]>>) {
    const actual = await this.root();
    if (actual.device !== expected.device || actual.inode !== expected.inode) throw failure();
  }
  private async write(path: string, value: unknown, signal: AbortSignal) {
    signal.throwIfAborted(); const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > MAXIMUM_RECORD_BYTES) throw failure();
    const handle = await open(path, "wx", 0o600);
    try {signal.throwIfAborted(); await handle.writeFile(bytes); await handle.sync(); signal.throwIfAborted();}
    finally {await handle.close();}
    // Partial writes and cancelled operations remain reserved for explicit recovery; never unlink.
  }
  private async read(path: string, signal: AbortSignal) {
    const file = await readOwnedMeasurementFile(path, MAXIMUM_RECORD_BYTES, signal);
    return {value: JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(file.bytes)), sha256: file.pin.sha256};
  }
}
