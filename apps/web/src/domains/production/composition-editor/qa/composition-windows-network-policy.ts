import {createHash} from "node:crypto";
import {z} from "zod";
import {windowsAppContainerSidSchema} from "./composition-windows-reduced-token-policy";

export const WINDOWS_NETWORK_CONTROLLER_POLICY = "WINDOWS_PACKAGE_EXACT_LOOPBACK_CONTROLLER_V1" as const;
export const windowsNetworkScopeSchema = z.object({hostId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  organizationId: z.string().uuid(), executionId: z.string().uuid(),
  appContainerSid: windowsAppContainerSidSchema}).strict();
export const windowsLoopbackEndpointSchema = z.object({address: z.enum(["127.0.0.1", "::1"]),
  port: z.number().int().min(1).max(65535), protocol: z.literal("TCP")}).strict();
export type WindowsNetworkScope = z.infer<typeof windowsNetworkScopeSchema>;
export type WindowsLoopbackEndpoint = z.infer<typeof windowsLoopbackEndpointSchema>;
const layers = ["ALE_AUTH_CONNECT_V4", "ALE_AUTH_CONNECT_V6", "ALE_AUTH_RECV_ACCEPT_V4", "ALE_AUTH_RECV_ACCEPT_V6"] as const;
type Layer = typeof layers[number];
type Condition = {field: "PACKAGE_ID" | "PROTOCOL" | "REMOTE_ADDRESS" | "LOCAL_ADDRESS" | "REMOTE_PORT" | "LOCAL_PORT";
  comparison: "EQUAL" | "NOT_EQUAL"; value: string | number};
type BlockRule = {layer: Layer; action: "BLOCK"; conditions: Condition[]};
export type WindowsNetworkPlan = ReturnType<typeof buildWindowsNetworkPlan>;

/** Declarative compiler, not native filters or proof of enforcement. No permissive override rules.
 * The backend must implement persistent, transactional policy and verify effective arbitration. */
export function buildWindowsNetworkPlan(rawScope: WindowsNetworkScope, rawEndpoint?: WindowsLoopbackEndpoint) {
  const scope = windowsNetworkScopeSchema.parse(rawScope);
  const endpoint = rawEndpoint === undefined ? undefined : windowsLoopbackEndpointSchema.parse(rawEndpoint);
  const rules: BlockRule[] = [];
  for (const layer of layers) {
    const packageCondition: Condition = {field: "PACKAGE_ID", comparison: "EQUAL", value: scope.appContainerSid};
    const compatibleFamily = endpoint && layer.endsWith(endpoint.address === "::1" ? "V6" : "V4");
    if (!compatibleFamily) {rules.push({layer, action: "BLOCK", conditions: [packageCondition]}); continue;}
    const outbound = layer.startsWith("ALE_AUTH_CONNECT");
    const deniedConditions: Condition[] = [
      {field: "PROTOCOL", comparison: "NOT_EQUAL", value: 6},
      {field: outbound ? "REMOTE_ADDRESS" : "LOCAL_ADDRESS", comparison: "NOT_EQUAL", value: endpoint!.address},
      {field: outbound ? "REMOTE_PORT" : "LOCAL_PORT", comparison: "NOT_EQUAL", value: endpoint!.port},
      ...(!outbound ? [{field: "REMOTE_ADDRESS" as const, comparison: "NOT_EQUAL" as const, value: endpoint!.address}] : []),
    ];
    // OR of disallowed predicates is represented by distinct block filters, not AND in one filter.
    for (const condition of deniedConditions) rules.push({layer, action: "BLOCK", conditions: [packageCondition, condition]});
  }
  const plan = {policy: WINDOWS_NETWORK_CONTROLLER_POLICY, scope, mode: endpoint ? "EXACT_LOOPBACK" as const : "DENY_ALL" as const,
    ...(endpoint ? {endpoint} : {}), lifetime: "PERSISTENT_UNTIL_EXPLICIT_RECONCILIATION" as const, rules};
  return {...plan, sha256: createHash("sha256").update(JSON.stringify(plan)).digest("hex")};
}
