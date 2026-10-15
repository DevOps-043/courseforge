import {z} from "zod";
import {isAbsolute, resolve} from "node:path";

const desktopSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,80}\\[a-zA-Z0-9_-]{1,80}$/)
  .refine(value => !/[\r\n]/.test(value) && value.split("\\")[1].toLowerCase() !== "default");
/** Private capability SID only; never Everyone, Users or the caller's account SID. */
export const windowsRestrictingSidSchema = z.string().max(184)
  .regex(/^S-1-15-3-1024(?:-(?:0|[1-9][0-9]{0,9})){8}$/)
  .refine(value => !/[\r\n]/.test(value) && value.split("-").slice(5).every(part => Number(part) <= 0xffffffff));
export const windowsAppContainerSidSchema = z.string().max(90)
  .regex(/^S-1-15-2(?:-(?:0|[1-9][0-9]{0,9})){7}$/)
  .refine(value => !/[\r\n]/.test(value) && value.split("-").slice(4).every(part => Number(part) <= 0xffffffff));
const treeAuditSchema = z.object({maximumEntries: z.number().int().min(1).max(50000), maximumDepth: z.number().int().min(1).max(64),
  timeoutMilliseconds: z.number().int().min(100).max(60000)}).strict();
const reducedV1Schema = z.object({
  policy: z.literal("WINDOWS_LUA_NO_PRIVILEGES_V1"),
  desktop: desktopSchema,
}).strict();
const aclPathsSchema = z.array(z.string().min(1).max(4096).refine(value => isAbsolute(value)
  && resolve(value) === value && !value.includes("\0") && !value.startsWith("\\\\")))
  .min(1).max(32).refine(paths => new Set(paths.map(path => path.toLowerCase())).size === paths.length);
/** Restricting SID enables the second ACL access check; ACL provisioning remains operator-owned. */
export const windowsReducedTokenSchema = z.discriminatedUnion("policy", [reducedV1Schema,
  z.object({policy: z.literal("WINDOWS_LUA_RESTRICTING_CAPABILITY_V2"), desktop: desktopSchema,
    restrictingSid: windowsRestrictingSidSchema}).strict(),
  z.object({policy: z.literal("WINDOWS_LUA_ACL_PREFLIGHT_V3"), desktop: desktopSchema,
    restrictingSid: windowsRestrictingSidSchema, readOnlyPaths: aclPathsSchema, deniedPaths: aclPathsSchema}).strict(),
  z.object({policy: z.literal("WINDOWS_LUA_ACL_TREE_PREFLIGHT_V4"), desktop: desktopSchema,
    restrictingSid: windowsRestrictingSidSchema, readOnlyPaths: aclPathsSchema, deniedPaths: aclPathsSchema,
    treeAudit: treeAuditSchema}).strict(),
  z.object({policy: z.literal("WINDOWS_APPCONTAINER_NO_NETWORK_V5"), desktop: desktopSchema,
    appContainerSid: windowsAppContainerSidSchema, readOnlyPaths: aclPathsSchema, deniedPaths: aclPathsSchema,
    treeAudit: treeAuditSchema}).strict()])
  .superRefine((token, context) => {
    if (token.policy !== "WINDOWS_LUA_ACL_PREFLIGHT_V3" && token.policy !== "WINDOWS_LUA_ACL_TREE_PREFLIGHT_V4"
      && token.policy !== "WINDOWS_APPCONTAINER_NO_NETWORK_V5") return;
    const readOnly = new Set(token.readOnlyPaths.map(path => path.toLowerCase()));
    if (token.deniedPaths.some(path => readOnly.has(path.toLowerCase())))
      context.addIssue({code: "custom", message: "CONTROLLED_RENDER_ACL_PATH_CONFLICT"});
  });
export type WindowsReducedToken = z.infer<typeof windowsReducedTokenSchema>;
