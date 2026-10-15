import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createPrivateHtmlOperatorSession } from "./operator-session.mjs";

const require = createRequire(import.meta.url);
const compiled = "../../.tmp/cap029-tests/domains/production/composition-editor/";
const sha = value => createHash("sha256").update(value).digest("hex");
const validHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

export async function readPinnedOperatorJson(path, expectedSha256, maximumBytes = 128 * 1024) {
  if (!isAbsolute(path ?? "") || !validHash(expectedSha256) || !Number.isSafeInteger(maximumBytes)
    || maximumBytes < 1 || maximumBytes > 16 * 1024 * 1024) throw new Error();
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.size <= 0 || opened.size > maximumBytes
      || opened.dev !== stat.dev || opened.ino !== stat.ino) throw new Error();
    const bytes = Buffer.alloc(opened.size + 1); let length = 0;
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break; length += result.bytesRead;
    }
    const after = await file.stat(), content = bytes.subarray(0, length);
    if (length !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs
      || after.ctimeMs !== opened.ctimeMs || sha(content) !== expectedSha256) throw new Error();
    return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(content));
  } finally {await file.close();}
}

/** Private authenticated CLI. Never loads dotenv, arbitrary JS adapters or source
 * paths from input. No credentials in args/output; no automatic SQL/flags/retry. */
export async function runHistoricalOperator(args, environment = process.env, emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)) {
  try {
    if (environment.HTML_HISTORICAL_OPERATOR_ENABLED !== "true" || args.length !== 4
      || args[0] !== "--request" || args[2] !== "--sha256") throw new Error();
    const env = {...environment};
    if (!/^[a-f0-9]{64}$/.test(env.HTML_HISTORICAL_HANDOFF_KEY_HEX ?? "")
      || !isAbsolute(env.HTML_HISTORICAL_HANDOFF_ROOT ?? "") || !env.COURSEFORGE_JWT_SECRET
      || env.COURSEFORGE_JWT_SECRET.length < 32 || !env.HTML_HISTORICAL_OPERATOR_ACCESS_TOKEN
      || env.HTML_HISTORICAL_OPERATOR_ACCESS_TOKEN.length > 16_384) throw new Error();
    const endpoint = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash
      || endpoint.pathname !== "/" || endpoint.port && endpoint.port !== "443" || !env.SUPABASE_SERVICE_ROLE_KEY
      || /[\r\n]/.test(env.SUPABASE_SERVICE_ROLE_KEY)) throw new Error();
    const input = await readPinnedOperatorJson(args[1], args[3]);
    const signal = AbortSignal.timeout(120_000);
    const {client, authenticate} = createPrivateHtmlOperatorSession({signal, supabaseUrl: endpoint.href, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      jwtSecret: env.COURSEFORGE_JWT_SECRET, accessToken: env.HTML_HISTORICAL_OPERATOR_ACCESS_TOKEN,
      organizationId: env.HTML_HISTORICAL_OPERATOR_ORGANIZATION});
    const {createHistoricalHtmlCandidatePreparer} = require(compiled + "composition-html-editing-historical-candidate.server.js");
    const {createHistoricalHtmlOperatorHandoff} = require(compiled + "composition-html-editing-historical-handoff.server.js");
    const {createHistoricalHtmlOperatorWorkflow} = require(compiled + "composition-html-editing-historical-operator.server.js");
    const {HistoricalHtmlPublicationRepository} = require(compiled + "composition-html-editing-historical-publication-repository.server.js");
    const {createHtmlEditingSnapshotArchiveStore} = require(compiled + "composition-html-editing-snapshot-storage.server.js");
    const {executeHistoricalHtmlOperatorCommand} = require(compiled + "composition-html-editing-historical-operator-command.server.js");
    const repository = new HistoricalHtmlPublicationRepository(client);
    const host = {supabase: client, supabaseUrl: endpoint.href, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY};
    const workflow = createHistoricalHtmlOperatorWorkflow({prepare: createHistoricalHtmlCandidatePreparer(host), repository,
      handoff: createHistoricalHtmlOperatorHandoff({rootDirectory: env.HTML_HISTORICAL_HANDOFF_ROOT,
        integrityKey: Buffer.from(env.HTML_HISTORICAL_HANDOFF_KEY_HEX, "hex")}),
      storeArchive: createHtmlEditingSnapshotArchiveStore(host),
      recordStagingLocator: async (locator, stagingSignal) => {
        // Metadata needed to reconcile even if the following claim ACK is lost.
        // Backend journal, not stdout, is the durable authority.
        emit({status: "STAGING_ATTEMPT_LOCATOR_NOT_ACK", locator});
        return repository.recordStagingLocator(locator, stagingSignal);
      }});
    const result = await executeHistoricalHtmlOperatorCommand(input, {workflow, signal,
      authenticate,
      runtime: () => readPinnedOperatorJson(env.HTML_HISTORICAL_OPERATOR_RUNTIME_PATH, env.HTML_HISTORICAL_OPERATOR_RUNTIME_SHA256),
    });
    emit(result); return 0;
  } catch {
    emit({status: "UNCONFIRMED", reason: "HTML_HISTORICAL_OPERATOR_UNAVAILABLE", retryable: false}); return 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = await runHistoricalOperator(process.argv.slice(2));
