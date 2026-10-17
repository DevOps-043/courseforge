import {z} from "zod";
import {windowsNetworkScopeSchema} from "./composition-windows-network-policy";
export const WINDOWS_NETWORK_CHANNEL_POLICY = Object.freeze({id: "WINDOWS_NETWORK_AUTHENTICATED_COMMAND_V1", maximumPayloadBytes: 32768});
export const WINDOWS_NETWORK_COMMAND_ORDER = ["DENY_BEFORE_START", "ALLOW_ORIGINAL_SERVER", "SEAL_AFTER_STOP"] as const;
export const windowsNetworkChannelBindingSchema = z.object({channelId: z.string().uuid(), operationNonce: z.string().uuid(), scope: windowsNetworkScopeSchema}).strict();
export const windowsNetworkCommandSchema = z.object({policy: z.literal(WINDOWS_NETWORK_CHANNEL_POLICY.id),
  channelId: z.string().uuid(), operationNonce: z.string().uuid(), requestId: z.string().uuid(),
  scope: windowsNetworkScopeSchema, sequence: z.number().int().min(1).max(3),
  command: z.enum(WINDOWS_NETWORK_COMMAND_ORDER)}).strict().refine(request =>
    request.command === WINDOWS_NETWORK_COMMAND_ORDER[request.sequence - 1]);
export type WindowsNetworkCommand = z.infer<typeof windowsNetworkCommandSchema>;
export const windowsNetworkCommandResponseSchema = z.object({policy: z.literal(WINDOWS_NETWORK_CHANNEL_POLICY.id),
  channelId: z.string().uuid(), operationNonce: z.string().uuid(), requestId: z.string().uuid(),
  scope: windowsNetworkScopeSchema, sequence: z.number().int().min(1).max(3), command: z.enum(WINDOWS_NETWORK_COMMAND_ORDER),
  receipt: z.object({leaseId: z.string().uuid(), generation: z.number().int().min(1).max(3),
    planSha256: z.string().regex(/^[a-f0-9]{64}$/), persistent: z.literal(true)}).strict()}).strict();
