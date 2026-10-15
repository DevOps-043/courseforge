import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "apps/web/.tmp/syllabus-import-qa/http.cjs");
await mkdir(path.dirname(output), { recursive: true });
const externalBoundaries = {
  "artifact-action-auth": `export async function getAuthenticatedUser() {return globalThis.__syllabusHttpQA.user;}
    export async function getAuthorizedArtifactAdminForTenant(id,tenant) {
      const runtime=globalThis.__syllabusHttpQA;
      runtime.authorizations.push({id,tenant});
      return id===runtime.artifactId && tenant.organizationId===runtime.organizationId ? {admin:runtime.admin} : null;
    }`,
  "tenant-context": `export async function resolveActiveTenantContext() {return globalThis.__syllabusHttpQA.tenant;}`,
  server: `export async function createClient() {return {};}`,
  "operational-logger": `export const resolveCorrelationId=id=>id||'qa-request';
    export function createOperationalLogger() {return {info(){},warn(){},error(){}};}`,
  env: `export const isNetlifyDeployment=()=>globalThis.__syllabusHttpQA.netlify;`,
  "background-function-client": `export async function dispatchBackgroundFunctionJson(name,payload) {
    const runtime=globalThis.__syllabusHttpQA;runtime.dispatches.push({name,payload});
    if(runtime.dispatchError) throw runtime.dispatchError;
  }`,
  "syllabus-import.service": `export async function executeSyllabusImport(admin,artifactId,importId,revision) {
    const runtime=globalThis.__syllabusHttpQA; runtime.executions.push({artifactId,importId,revision});
    runtime.entry.lease_expires_at=null; runtime.entry.operation=null;runtime.entry.status='CONFIRMED';runtime.entry.revision++;
  }`,
  "syllabus-document-extractor": `export async function extractSyllabusSourceDocument(file) {
    globalThis.__syllabusHttpQA.extractions++;
    const text=await file.text();
    return {fileId:'85777010-cb1f-468f-8ddb-2d4e3cbd2c50', filename:file.name,mimeType:file.type,sizeBytes:file.size,text,characterCount:text.length};
  }`,
};
const buildOptions = {
  entryPoints: [
    path.join(root, "apps/web/src/app/api/syllabus/imports/route.ts"),
  ],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  tsconfig: path.join(root, "apps/web/tsconfig.json"),
  plugins: [
    {
      name: "http-isolated-boundaries",
      setup(builder) {
        builder.onLoad(
          {
            filter:
              /[/\\](artifact-action-auth|tenant-context|operational-logger|env|background-function-client|syllabus-import\.service|syllabus-document-extractor)\.ts$/,
          },
          (args) => ({
            contents: externalBoundaries[path.basename(args.path, ".ts")],
            loader: "js",
          }),
        );
        builder.onLoad(
          { filter: /[/\\]utils[/\\]supabase[/\\]server\.ts$/ },
          () => ({ contents: externalBoundaries.server, loader: "js" }),
        );
        builder.onResolve({ filter: /^next\/server$/ }, () => ({
          path: "next-response",
          namespace: "qa-next",
        }));
        builder.onLoad({ filter: /.*/, namespace: "qa-next" }, () => ({
          loader: "js",
          contents: `export class NextResponse {
      static json(body, options={}) {return new Response(JSON.stringify(body),{...options,headers:{'Content-Type':'application/json',...Object.fromEntries(new Headers(options.headers))}});}
    }`,
        }));
      },
    },
  ],
};
await build(buildOptions);
const { GET, POST } = createRequire(import.meta.url)(output);
const documentOutput = path.join(path.dirname(output), "documents.cjs");
await build({
  ...buildOptions,
  entryPoints: [
    path.join(root, "apps/web/src/app/api/syllabus/documents/route.ts"),
  ],
  outfile: documentOutput,
});
const { POST: uploadDocuments } = createRequire(import.meta.url)(
  documentOutput,
);
const originalFetch = globalThis.fetch;
const originalFlags = {
  enabled: process.env.PROVIDED_SYLLABUS_ENABLED,
  organizations: process.env.PROVIDED_SYLLABUS_ORGANIZATIONS,
};
globalThis.fetch = async () => {
  throw new Error("Network forbidden in isolated HTTP QA");
};
test.after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__syllabusHttpQA;
  for (const [key, value] of [
    ["PROVIDED_SYLLABUS_ENABLED", originalFlags.enabled],
    ["PROVIDED_SYLLABUS_ORGANIZATIONS", originalFlags.organizations],
  ]) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
const ids = {
  artifact: "2908b47b-77a0-4591-a527-ac95882fc782",
  import: "9bcc6fe7-08ac-446c-98ab-b3b035d2c7b0",
  document: "85777010-cb1f-468f-8ddb-2d4e3cbd2c50",
  module: "a333ed83-4133-4616-b2c9-3a7a36521286",
  lesson: "8409b1e8-47e0-4aa9-a793-45ead47ff397",
};
const outline = [
  {
    id: ids.module,
    title: "Seguridad",
    objective_general_ref: "Identificar riesgos",
    sourceQuote: "Seguridad",
    lessons: [
      {
        id: ids.lesson,
        title: "Validación",
        objective_specific: "Validar entradas",
        sourceQuote: "Validación",
        topics: [],
      },
    ],
  },
];

function fixture() {
  process.env.PROVIDED_SYLLABUS_ENABLED = "true";
  process.env.PROVIDED_SYLLABUS_ORGANIZATIONS = "qa-org";
  const runtime = {
    artifactId: ids.artifact,
    organizationId: "qa-org",
    user: { userId: "qa-user" },
    tenant: { organizationId: "qa-org", userId: "qa-user" },
    netlify: false,
    dispatches: [],
    dispatchError: null,
    executions: [],
    authorizations: [],
    queries: [],
    extractions: 0,
    savedDocuments: [],
    writes: [],
    schemaError: false,
    entry: {
      id: ids.import,
      artifact_id: ids.artifact,
      primary_document_id: ids.document,
      support_document_ids: [],
      status: "REVIEW_REQUIRED",
      revision: 4,
      candidate_outline: structuredClone(outline),
      extracted_outline: structuredClone(outline),
      confirmed_outline: null,
      confirmed_revision: null,
      operation: null,
      lease_expires_at: null,
      attempt_count: 1,
      issues: [],
      unassigned_topics: [],
      proposals: [],
      source_syllabus_version: 0,
    },
  };
  runtime.admin = {
    from(table) {
      const filters = new Map();
      runtime.queries.push({ table, filters });
      const result = () => {
        if (runtime.schemaError)
          return { data: null, error: { message: "PRIVATE_SQL_DETAIL" } };
        if (table === "syllabus_imports")
          return {
            data:
              filters.get("artifact_id") === ids.artifact &&
              (!filters.has("id") || filters.get("id") === ids.import)
                ? structuredClone(runtime.entry)
                : null,
            error: null,
          };
        if (table === "syllabus_source_documents") {
          const document = {
            id: ids.document,
            artifact_id: ids.artifact,
            filename: "temario.txt",
            mime_type: "text/plain",
            size_bytes: 20,
            extracted_text: "PRIVATE_DOCUMENT_TEXT",
            content_sha256: "a".repeat(64),
          };
          return {
            data:
              filters.get("artifact_id") === ids.artifact &&
              (!filters.has("id") || filters.get("id").includes(document.id))
                ? [document]
                : [],
            error: null,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      };
      const query = {
        async insert(records) {
          assert.equal(table, "syllabus_source_documents");
          runtime.savedDocuments.push(...records);
          return { error: null };
        },
        select() {
          return query;
        },
        eq(column, value) {
          filters.set(column, value);
          return query;
        },
        in(column, value) {
          filters.set(column, value);
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle: async () => result(),
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, payload) {
      assert.equal(name, "transition_syllabus_import");
      assert.equal(payload.p_actor_id || "qa-user", "qa-user");
      if (payload.p_revision !== runtime.entry.revision)
        return { data: null, error: { message: "SYLLABUS_IMPORT_CONFLICT" } };
      runtime.writes.push(payload);
      runtime.entry.revision++;
      if (payload.p_action === "confirm") {
        runtime.entry.status = "CONFIRMED";
        runtime.entry.confirmed_outline = structuredClone(
          runtime.entry.candidate_outline,
        );
      }
      if (payload.p_action.startsWith("reserve_")) {
        runtime.entry.status = "ENRICHING";
        runtime.entry.operation = "enrich";
        runtime.entry.lease_expires_at = new Date(
          Date.now() + 600_000,
        ).toISOString();
      }
      if (payload.p_action === "failed") {
        runtime.entry.status = "FAILED";
        runtime.entry.lease_expires_at = null;
      }
      return { data: structuredClone(runtime.entry), error: null };
    },
  };
  globalThis.__syllabusHttpQA = runtime;
  return runtime;
}
const get = (artifactId = ids.artifact, extra = "") =>
  GET(
    new Request(
      `http://qa.local/api/syllabus/imports?artifactId=${artifactId}${extra}`,
    ),
  );
const post = (body) =>
  POST(
    new Request("http://qa.local/api/syllabus/imports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
const command = (action = "confirm") => ({
  action,
  artifactId: ids.artifact,
  importId: ids.import,
  expectedRevision: 4,
  ...(action === "confirm" ? { acknowledgeIssues: true } : {}),
});

test("anonymous request is rejected before privileged reads", async () => {
  const runtime = fixture();
  runtime.user = null;
  const response = await get();
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "AUTH_REQUIRED");
  assert.equal(runtime.queries.length, 0);
});
test("mismatched authentication and tenant sessions never reach privileged reads", async () => {
  const runtime = fixture();
  runtime.tenant.userId = "another-user";
  const response = await get();
  assert.equal(response.status, 401);
  assert.equal(runtime.authorizations.length, 0);
  assert.equal(runtime.queries.length, 0);
});
test("persistent multipart upload rejects a mismatched session before extraction or writes", async () => {
  const runtime = fixture();
  runtime.tenant.userId = "another-user";
  const form = new FormData();
  form.set("artifactId", ids.artifact);
  form.set("persistDocuments", "true");
  form.append(
    "files",
    new File(["Seguridad\nValidación"], "temario.txt", { type: "text/plain" }),
  );
  const response = await uploadDocuments(
    new Request("http://qa.local/api/syllabus/documents", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(response.status, 401);
  assert.equal(runtime.extractions, 0);
  assert.equal(runtime.savedDocuments.length, 0);
});
test("persistent multipart upload stores server-scoped provenance and file hash", async () => {
  const runtime = fixture();
  const form = new FormData();
  form.set("artifactId", ids.artifact);
  form.set("persistDocuments", "true");
  form.append(
    "files",
    new File(["Seguridad\nValidación"], "temario.txt", { type: "text/plain" }),
  );
  const response = await uploadDocuments(
    new Request("http://qa.local/api/syllabus/documents", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(runtime.savedDocuments.length, 1);
  assert.equal(runtime.savedDocuments[0].created_by, "qa-user");
  assert.equal(runtime.savedDocuments[0].artifact_id, ids.artifact);
  assert.match(runtime.savedDocuments[0].content_sha256, /^[0-9a-f]{64}$/);
});
test("missing active tenant returns the tenant authorization contract", async () => {
  const runtime = fixture();
  runtime.tenant = null;
  const response = await get();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "TENANT_FORBIDDEN");
  assert.equal(runtime.queries.length, 0);
});
test("another organization cannot retrieve private documents", async () => {
  const runtime = fixture();
  runtime.tenant.organizationId = "another-org";
  const response = await get();
  assert.equal(response.status, 404);
  assert.equal(runtime.queries.length, 0);
  assert.equal(
    (await response.text()).includes("PRIVATE_DOCUMENT_TEXT"),
    false,
  );
});
test("disabled feature remains compatible before migration and avoids new tables", async () => {
  const runtime = fixture();
  delete process.env.PROVIDED_SYLLABUS_ENABLED;
  runtime.schemaError = true;
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).enabled, false);
  assert.equal(runtime.queries.length, 0);
  assert.equal((await post(command())).status, 409);
  assert.equal(runtime.writes.length, 0);
});
test("pilot allowlist denies new operations outside the configured organizations", async () => {
  const runtime = fixture();
  process.env.PROVIDED_SYLLABUS_ORGANIZATIONS = "another-org";
  const response = await get();
  assert.equal((await response.json()).enabled, false);
  assert.equal(runtime.queries.length, 0);
});
test("authorized GET scopes documents and import reads and forbids caching private text", async () => {
  const runtime = fixture();
  const response = await get();
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(body.original.text, "PRIVATE_DOCUMENT_TEXT");
  assert.equal(
    runtime.queries.every(
      (query) => query.filters.get("artifact_id") === ids.artifact,
    ),
    true,
  );
});
test("foreign import identifier cannot reveal a baseline from another artifact", async () => {
  const runtime = fixture();
  const response = await get(
    ids.artifact,
    "&importId=6a0bdc0e-9612-451c-9cbc-62e8de2a602c",
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).import, null);
  assert.equal(runtime.writes.length, 0);
});
test("invalid identifiers and unrecognized command fields are rejected before reads", async () => {
  const runtime = fixture();
  assert.equal((await get("invalid")).status, 400);
  assert.equal((await post({ ...command(), unknownField: true })).status, 400);
  assert.equal(runtime.queries.length, 0);
});
test("oversized body uses the payload-too-large contract without privileged reads", async () => {
  const runtime = fixture();
  const response = await post({ ...command(), notes: "x".repeat(512 * 1024) });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, "PAYLOAD_TOO_LARGE");
  assert.equal(runtime.queries.length, 0);
});
test("confirmation requires explicit acknowledgement and rejects an empty candidate", async () => {
  const runtime = fixture();
  const body = command();
  delete body.acknowledgeIssues;
  assert.equal((await post(body)).status, 400);
  runtime.entry.candidate_outline = [];
  assert.equal((await post(command())).status, 422);
  assert.equal(runtime.writes.length, 0);
});
test("stale revision returns conflict and never overwrites a newer revision", async () => {
  const runtime = fixture();
  const response = await post({ ...command(), expectedRevision: 3 });
  assert.equal(response.status, 409);
  assert.equal(runtime.writes.length, 0);
});
test("confirmation records the authenticated actor and exact expected revision", async () => {
  const runtime = fixture();
  const response = await post(command());
  assert.equal(response.status, 200);
  assert.equal(runtime.writes[0].p_actor_id, "qa-user");
  assert.equal(runtime.writes[0].p_revision, 4);
  assert.equal((await response.json()).import.revision, 5);
});
test("local execution and Netlify dispatch carry the reserved revision and organization", async () => {
  for (const netlify of [false, true]) {
    const runtime = fixture();
    runtime.entry.status = "CONFIRMED";
    runtime.entry.confirmed_outline = structuredClone(outline);
    runtime.netlify = netlify;
    const response = await post(command("enrich"));
    assert.equal(response.status, netlify ? 202 : 200);
    if (netlify) {
      assert.equal(runtime.executions.length, 0);
      assert.equal(runtime.dispatches[0].name, "syllabus-import-background");
      assert.deepEqual(runtime.dispatches[0].payload, {
        artifactId: ids.artifact,
        importId: ids.import,
        revision: 5,
        organizationId: "qa-org",
      });
    } else
      assert.deepEqual(runtime.executions[0], {
        artifactId: ids.artifact,
        importId: ids.import,
        revision: 5,
      });
  }
});
test("failed dispatch releases the reservation while preserving the original", async () => {
  const runtime = fixture();
  runtime.entry.status = "CONFIRMED";
  runtime.entry.confirmed_outline = structuredClone(outline);
  runtime.netlify = true;
  runtime.dispatchError = new Error("PRIVATE_DISPATCH_DETAIL");
  const response = await post(command("enrich"));
  assert.equal(response.status, 503);
  assert.equal(runtime.entry.status, "FAILED");
  assert.equal(runtime.entry.lease_expires_at, null);
  assert.deepEqual(runtime.entry.confirmed_outline, outline);
  assert.equal(
    (await response.text()).includes("PRIVATE_DISPATCH_DETAIL"),
    false,
  );
});
