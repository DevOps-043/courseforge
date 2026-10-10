import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { readPinnedOperatorJson } from "./historical-operator.mjs";
import { createPrivateHtmlOperatorSession } from "./operator-session.mjs";

const require = createRequire(import.meta.url), compiled = "../../.tmp/cap029-tests/domains/production/composition-editor/";
/** Private operator entry: no dotenv/JS plugins, browser source/approval fields,
 * automatic install/adoption, retries or migration/flag changes. */
export async function runLegacyOperator(args, environment = process.env, emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)) {
  try {
    const env = {...environment};
    if (env.HTML_LEGACY_OPERATOR_ENABLED !== "true" || args.length !== 4 || args[0] !== "--request" || args[2] !== "--sha256"
      || !/^[a-f0-9]{64}$/.test(env.HTML_LEGACY_OPERATOR_KEY_HEX ?? "")
      || ![env.HTML_LEGACY_OPERATOR_HANDOFF_ROOT, env.HTML_LEGACY_OPERATOR_INTENT_ROOT].every(path => isAbsolute(path ?? ""))) throw new Error();
    const {HTML_LEGACY_OPERATOR_POLICY: policy, htmlLegacyOperatorCommandSchema} = require(compiled + "composition-html-editing-legacy-operator.contract.js");
    const {createHtmlLegacyOperatorHost} = require(compiled + "composition-html-editing-legacy-operator-host.server.js");
    const {HtmlEditingTemplateCatalog, HTML_EDITING_CATALOG_POLICY} = require(compiled + "html-editing/html-editing-template-catalog.server.js");
    const signal = AbortSignal.timeout(policy.timeoutMs), session = createPrivateHtmlOperatorSession({signal,
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, jwtSecret: env.COURSEFORGE_JWT_SECRET,
      accessToken: env.HTML_LEGACY_OPERATOR_ACCESS_TOKEN, organizationId: env.HTML_LEGACY_OPERATOR_ORGANIZATION});
    const identity = await session.authenticate();
    const input = htmlLegacyOperatorCommandSchema.parse(await readPinnedOperatorJson(args[1], args[3], policy.commandBytes));
    signal.throwIfAborted();
    let catalog;
    if (input.action === "STAGE_REVIEWED") catalog = new HtmlEditingTemplateCatalog(JSON.stringify(await readPinnedOperatorJson(
      env.HTML_LEGACY_OPERATOR_CATALOG_PATH, env.HTML_LEGACY_OPERATOR_CATALOG_SHA256, HTML_EDITING_CATALOG_POLICY.maximumBytes)));
    const workflow = await createHtmlLegacyOperatorHost({supabase: session.client, handoffRoot: env.HTML_LEGACY_OPERATOR_HANDOFF_ROOT,
      intentRoot: env.HTML_LEGACY_OPERATOR_INTENT_ROOT, integrityKey: Buffer.from(env.HTML_LEGACY_OPERATOR_KEY_HEX, "hex"),
      readCatalog: () => {if (!catalog) throw new Error(); return catalog;}});
    emit(await workflow.execute(input, identity, signal)); return 0;
  } catch {
    emit({status: "UNCONFIRMED", reason: "HTML_LEGACY_OPERATOR_UNAVAILABLE", retryable: false}); return 1;
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await runLegacyOperator(process.argv.slice(2));
