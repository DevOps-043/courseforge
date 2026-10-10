import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { readPinnedOperatorJson } from "./historical-operator.mjs";
import { createPrivateHtmlOperatorSession } from "./operator-session.mjs";

const require = createRequire(import.meta.url), compiled = "../../.tmp/cap029-tests/domains/production/composition-editor/";

/** Closed private CLI; no dotenv, plugin imports, automatic retries, migrations,
 * public endpoint or historical executor. Configuration is host-owned only. */
export async function runReconstructionOperator(args, environment = process.env, emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)) {
  try {
    const env = {...environment};
    if (env.HTML_RECONSTRUCTION_OPERATOR_ENABLED !== "true" || args.length !== 4 || args[0] !== "--request" || args[2] !== "--sha256"
      || !/^[a-f0-9]{64}$/.test(env.HTML_RECONSTRUCTION_KEY_HEX ?? "")
      || ![env.HTML_RECONSTRUCTION_HANDOFF_ROOT, env.HTML_RECONSTRUCTION_REVIEW_ROOT, env.HTML_RECONSTRUCTION_OPERATION_ROOT].every(path => isAbsolute(path ?? ""))
      || (env.COURSEFORGE_JWT_SECRET?.length ?? 0) < 32 || !env.HTML_RECONSTRUCTION_OPERATOR_ACCESS_TOKEN
      || env.HTML_RECONSTRUCTION_OPERATOR_ACCESS_TOKEN.length > 16_384) throw new Error();
    const endpoint = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || endpoint.pathname !== "/" || endpoint.port && endpoint.port !== "443" || !env.SUPABASE_SERVICE_ROLE_KEY
      || /[\r\n]/.test(env.SUPABASE_SERVICE_ROLE_KEY)) throw new Error();
    const {HTML_RECONSTRUCTION_POLICY: policy} = require(compiled + "composition-html-editing-reconstruction.contract.js");
    const {executeHtmlReconstructionOperatorCommand, htmlReconstructionOperatorCommandSchema} = require(compiled + "composition-html-editing-reconstruction-operator-command.server.js");
    const {createHtmlReconstructionOperatorHost} = require(compiled + "composition-html-editing-reconstruction-operator-host.server.js");
    const {HtmlEditingTemplateCatalog, HTML_EDITING_CATALOG_POLICY} = require(compiled + "html-editing/html-editing-template-catalog.server.js");
    const input = htmlReconstructionOperatorCommandSchema.parse(await readPinnedOperatorJson(args[1], args[3], policy.registrationBytes));
    const signal = AbortSignal.timeout(policy.preparationTimeoutMs);
    const {client, authenticate} = createPrivateHtmlOperatorSession({signal, supabaseUrl: endpoint.href, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      jwtSecret: env.COURSEFORGE_JWT_SECRET, accessToken: env.HTML_RECONSTRUCTION_OPERATOR_ACCESS_TOKEN,
      organizationId: env.HTML_RECONSTRUCTION_OPERATOR_ORGANIZATION});
    await authenticate();
    // Managed configuration snapshot per invocation, NOT a SQL-linearizable
    // template registry. Every CREATE reloads current host config independently
    // from the candidate/review. Recovery needs no catalog/runtime/source files.
    let catalog;
    if (["PREPARE", "STAGE", "CREATE"].includes(input.action)) catalog = new HtmlEditingTemplateCatalog(JSON.stringify(await readPinnedOperatorJson(
      env.HTML_RECONSTRUCTION_CATALOG_PATH, env.HTML_RECONSTRUCTION_CATALOG_SHA256, HTML_EDITING_CATALOG_POLICY.maximumBytes)));
    const workflow = await createHtmlReconstructionOperatorHost({supabase: client, supabaseUrl: endpoint.href, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      handoffRoot: env.HTML_RECONSTRUCTION_HANDOFF_ROOT, reviewRoot: env.HTML_RECONSTRUCTION_REVIEW_ROOT,
      operationRoot: env.HTML_RECONSTRUCTION_OPERATION_ROOT, integrityKey: Buffer.from(env.HTML_RECONSTRUCTION_KEY_HEX, "hex"),
      readCatalog: () => {if (!catalog) throw new Error(); return catalog;}});
    emit(await executeHtmlReconstructionOperatorCommand(input, {authenticate, workflow, signal,
      runtime: () => readPinnedOperatorJson(env.HTML_RECONSTRUCTION_RUNTIME_PATH, env.HTML_RECONSTRUCTION_RUNTIME_SHA256)}));
    return 0;
  } catch {
    emit({status: "UNCONFIRMED", reason: "HTML_RECONSTRUCTION_OPERATOR_UNAVAILABLE", retryable: false}); return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await runReconstructionOperator(process.argv.slice(2));
