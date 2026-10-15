import {z} from "zod";
import type {WindowsOwnedRootControl, WindowsOwnedRootIdentity} from "./composition-windows-job-bridge";
import type {createWindowsNetworkCommandClient} from "./composition-windows-network-command-client";

const candidateSchema = z.object({address: z.literal("127.0.0.1"), port: z.number().int().min(1).max(65535),
  serverUrl: z.string().max(64)}).strict().refine(value => value.serverUrl === `http://localhost:${value.port}`);
const rootSchema = z.object({pid: z.number().int().min(1).max(0xffffffff),
  creationFileTime: z.string().regex(/^[1-9][0-9]{0,19}$/).refine(value => BigInt(value) <= 0xffffffffffffffffn)}).strict();
const failure = () => new Error("CONTROLLED_RENDER_NETWORK_CONTROLLER_RECOVERY_REQUIRED");

/** Supervisor-side composition, never a renderer/HTML callback or a concrete IPC transport.
 * Client must already have DENY_BEFORE_START acknowledged for this execution/package.
 * Caller binds owned control and operator client; no callback is deserialized from a job.
 * Socket snapshots are not durable leases or proof of global effective WFP arbitration. */
export function createWindowsOriginalServerAuthorization(root: WindowsOwnedRootIdentity, control: WindowsOwnedRootControl,
  client: ReturnType<typeof createWindowsNetworkCommandClient>) {
  const identity = rootSchema.parse(root);
  const observe = control.observeOriginalListener.bind(control);
  let failed = false, busy = false, boundPort: number | undefined;
  return async (rawCandidate: unknown, signal: AbortSignal) => {
    if (failed || busy || !(signal instanceof AbortSignal) || signal.aborted) throw failure();
    busy = true;
    try {
      const candidate = candidateSchema.parse(rawCandidate);
      if (boundPort !== undefined && candidate.port !== boundPort) throw failure();
      const verify = async () => {
        signal.throwIfAborted();
        const observation = await observe(candidate.port);
        signal.throwIfAborted();
        if (observation.address !== candidate.address || observation.port !== candidate.port
          || observation.rootIdentity.pid !== identity.pid || observation.rootIdentity.creationFileTime !== identity.creationFileTime)
          throw failure();
      };
      await verify();
      const phase = client.status();
      if (phase === "DENIED") await client.allowOriginalServer({address: candidate.address, port: candidate.port, protocol: "TCP"}, signal);
      else if (phase !== "LOCAL_ONLY" || boundPort === undefined) throw failure();
      signal.throwIfAborted();
      if (client.status() !== "LOCAL_ONLY") throw failure();
      // No ACK to the producer if the owner exits or changes during the broker transaction.
      await verify();
      boundPort = candidate.port;
      return Object.freeze({status: "AUTHORIZED" as const, address: candidate.address, port: candidate.port});
    } catch {failed = true; throw failure();}
    finally {busy = false;}
  };
}
