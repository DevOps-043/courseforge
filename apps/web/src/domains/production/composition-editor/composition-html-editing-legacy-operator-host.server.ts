import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { HtmlEditingTemplateCatalog } from "./html-editing/html-editing-template-catalog.server";
import { readAuthorizedHtmlLegacyBootstrapContext } from "./composition-html-editing-legacy-context.server";
import { createHtmlLegacyOperatorHandoff } from "./composition-html-editing-legacy-operator-handoff.server";
import { createHtmlLegacyOperatorWorkflow } from "./composition-html-editing-legacy-operator.server";
import { SupabaseHtmlLegacyAdoptionRepository } from "./composition-html-editing-legacy-adoption-repository.server";

/** No installation/flags/migrations/root creation; OS ACL must be independently
 * installed. Different roots prevent preparation from masquerading as intent. */
export async function createHtmlLegacyOperatorHost(configuration: {supabase: SupabaseClient; handoffRoot: string; intentRoot: string;
  integrityKey: Uint8Array; readCatalog: () => HtmlEditingTemplateCatalog}) {
  const {supabase, readCatalog} = configuration;
  const roots = [configuration.handoffRoot, configuration.intentRoot], key = Buffer.from(configuration.integrityKey);
  if (key.length !== 32 || roots.some(path => !isAbsolute(path))) throw new Error("HTML_LEGACY_HOST_CONFIGURATION_INVALID");
  const resolved: string[] = [];
  for (const root of roots) {
    const stat = await lstat(root); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("HTML_LEGACY_HOST_CONFIGURATION_INVALID");
    resolved.push(await realpath(root));
  }
  const contains = (parent: string, child: string) => {
    const difference = relative(parent, child);
    return difference === "" || !isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`);
  };
  if (contains(resolved[0]!, resolved[1]!) || contains(resolved[1]!, resolved[0]!)) throw new Error("HTML_LEGACY_HOST_ROOTS_MUST_BE_DISJOINT");
  return createHtmlLegacyOperatorWorkflow({handoff: createHtmlLegacyOperatorHandoff({handoffRoot: resolved[0]!, intentRoot: resolved[1]!, integrityKey: key}),
    readContext: (request, signal) => readAuthorizedHtmlLegacyBootstrapContext({supabase, request, signal}),
    readCatalog, repository: catalog => new SupabaseHtmlLegacyAdoptionRepository(supabase, catalog)});
}
