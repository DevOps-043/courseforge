import type {KeyObject} from "node:crypto";
import type {SupabaseClient} from "@supabase/supabase-js";
import {CompositionRenderCheckpointStore} from "./composition-render-checkpoint-store";
import {CompositionRenderSupervisorService} from "./composition-render-supervisor.service";
import {createMaterializedControlledRenderer} from "./composition-materialized-supervisor-renderer";
import {controlledRenderQueueClaimSchema,type ControlledRenderQueueClaim} from "./composition-controlled-render-worker-contract";
import {createControlledHtmlEditingAuthorityReader} from "./composition-controlled-html-authority.service";
import {createOwnedControlledExecutor, type ControlledOwnedExecutorConfiguration} from "./composition-controlled-owned-executor";
import {CompositionConformanceRenderReservationService} from "./composition-conformance-render-reservation.service";

type RendererConfiguration = Parameters<typeof createMaterializedControlledRenderer>[0];

/** Explicit operator composition. Requires a real executor; never substitutes the synthetic prototype. */
export function createControlledRenderWorkerHost(input:{supabase:SupabaseClient<any,any,any>;supabaseUrl:string;
  checkpoints:CompositionRenderCheckpointStore;
  resolveSigningKey:(issuer:Pick<ControlledRenderQueueClaim,"organizationId"|"supervisorId"|"keyId">) => KeyObject|Promise<KeyObject>;
  renderStorage:Pick<RendererConfiguration["storage"],"outputParentDirectory"|"animationRuntimeSha256">;
  dependencyInventory:NonNullable<RendererConfiguration["dependencyInventory"]>;
  ownedExecutor:ControlledOwnedExecutorConfiguration;fetchImpl?:typeof fetch;clock?:() => number;
  deferConformanceReservation?: boolean}) {
  if (input.deferConformanceReservation !== undefined && typeof input.deferConformanceReservation !== "boolean")
    throw new Error("CONTROLLED_RENDER_RESERVATION_CONFIGURATION_INVALID");
  const reservations = input.deferConformanceReservation === true
    ? new CompositionConformanceRenderReservationService(input.supabase) : undefined;
  let execute:ReturnType<typeof createOwnedControlledExecutor> | undefined;
  return async (raw:ControlledRenderQueueClaim) => {
    const claim = controlledRenderQueueClaimSchema.parse(raw);
    if (!input.dependencyInventory) throw new Error("CONTROLLED_RENDER_DEPENDENCY_INVENTORY_REQUIRED");
    if (!input.ownedExecutor) throw new Error("CONTROLLED_RENDER_EXECUTOR_OWNERSHIP_REQUIRED");
    if (!input.ownedExecutor.fence) throw new Error("CONTROLLED_RENDER_EXECUTION_FENCE_REQUIRED");
    execute ??= createOwnedControlledExecutor(input.ownedExecutor);
    if (execute.isQuarantined()) throw new Error("CONTROLLED_RENDER_EXECUTOR_TERMINATION_UNCONFIRMED");
    const privateKey = await input.resolveSigningKey({organizationId:claim.organizationId,supervisorId:claim.supervisorId,keyId:claim.keyId});
    const renderer = createMaterializedControlledRenderer({storage:{...input.renderStorage,supabase:input.supabase,
      supabaseUrl:input.supabaseUrl,fetchImpl:input.fetchImpl,
      readHtmlEditingAuthority:createControlledHtmlEditingAuthorityReader({supabase:input.supabase,claim})},
      dependencyInventory:input.dependencyInventory,execute});
    return {checkpoints:input.checkpoints,supervisor:new CompositionRenderSupervisorService(input.supabase,input.supabaseUrl,
      privateKey,renderer,input.fetchImpl,input.clock,claim.leaseToken,
      reservations ? (checkpoint, signal) => reservations.defer(checkpoint, signal) : undefined)};
  };
}
