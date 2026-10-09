import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

// Bundle the real runner, repository and provider contract; replace only external
// boundaries. No environment file is loaded and every network call is forbidden.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(
  root,
  "apps/web/.tmp/syllabus-import-qa/orchestration.cjs",
);
await mkdir(path.dirname(output), { recursive: true });
const boundaryModules = {
  "model-settings": `export async function getPipelineModelSettings(step, organizationId) {
    const runtime = globalThis.__syllabusImportQA;
    runtime.settingsCalls.push({step, organizationId});
    if (runtime.settingsError) throw runtime.settingsError;
    return {model_name: runtime.model};
  }`,
  env: `export const getGeminiApiKey = () => 'qa-placeholder'; export const getOptionalOpenAIApiKey = () => 'qa-placeholder';`,
  "operational-logger": `export function createOperationalLogger() {
    return {info: (event, fields) => globalThis.__syllabusImportQA.logs.push({event, fields}),
      warn: (event, fields) => globalThis.__syllabusImportQA.logs.push({event, fields})};
  }`,
  "usage-telemetry": `export const recordAiFailure = async () => {};
    export const recordGeminiUsage = async () => {}; export const recordOpenAiUsage = async () => {};`,
};
await build({
  entryPoints: [
    path.join(
      root,
      "apps/web/src/domains/syllabus/import/syllabus-import.service.ts",
    ),
  ],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  plugins: [
    {
      name: "isolated-external-boundaries",
      setup(builder) {
        builder.onLoad(
          {
            filter:
              /[/\\](model-settings|env|operational-logger|usage-telemetry)\.ts$/,
          },
          (args) => {
            const name = path.basename(args.path, ".ts");
            return { contents: boundaryModules[name], loader: "js" };
          },
        );
        builder.onResolve({ filter: /^(openai|@google\/genai)$/ }, (args) => ({
          path: args.path,
          namespace: "qa-sdk",
        }));
        builder.onLoad({ filter: /.*/, namespace: "qa-sdk" }, (args) => ({
          loader: "js",
          contents:
            args.path === "openai"
              ? `export default class OpenAI { constructor(options) {
          globalThis.__syllabusImportQA.clients.push({provider:'openai', options});
          this.responses = {create: async request => {
            const runtime=globalThis.__syllabusImportQA; runtime.requests.push(request);
            if(runtime.providerError) throw runtime.providerError;
            return {output_text: runtime.responseText(), status: runtime.truncated ? 'incomplete' : 'completed',
              incomplete_details: runtime.truncated ? {reason:'max_output_tokens'} : null};
          }};
        }}`
              : `export class GoogleGenAI { constructor(options) {
          globalThis.__syllabusImportQA.clients.push({provider:'gemini', options});
          this.models = {generateContent: async request => {
            const runtime=globalThis.__syllabusImportQA; runtime.requests.push(request);
            if(runtime.providerError) throw runtime.providerError;
            return {text:runtime.responseText(), candidates:[{finishReason:runtime.truncated?'MAX_TOKENS':'STOP'}]};
          }};
        }}`,
        }));
      },
    },
  ],
});
const { executeSyllabusImport } = createRequire(import.meta.url)(output);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error("Network is forbidden in isolated syllabus QA");
};
test.after(() => {
  globalThis.fetch = originalFetch;
  delete globalThis.__syllabusImportQA;
});

const ids = {
  artifact: "2908b47b-77a0-4591-a527-ac95882fc782",
  import: "9bcc6fe7-08ac-446c-98ab-b3b035d2c7b0",
  primary: "85777010-cb1f-468f-8ddb-2d4e3cbd2c50",
  support: "85777010-cb1f-468f-8ddb-2d4e3cbd2c51",
  module: "a333ed83-4133-4616-b2c9-3a7a36521286",
  lesson: "8409b1e8-47e0-4aa9-a793-45ead47ff397",
};
const baseline = [
  {
    id: ids.module,
    title: "Seguridad",
    objective_general_ref: "Identificar límites de confianza",
    sourceQuote: "Seguridad",
    lessons: [
      {
        id: ids.lesson,
        title: "Validación",
        objective_specific: "Validar entradas no confiables",
        topics: ["Tipos", "Límites"],
        sourceQuote: "Validación",
      },
    ],
  },
];
const extracted = () => ({
  modules: baseline.map(({ id, ...module }) => ({
    ...module,
    lessons: module.lessons.map(({ id, ...lesson }) => lesson),
  })),
  issues: [],
  unassignedTopics: [],
});

function fixture({
  operation = "enrich",
  outline = baseline,
  model = "gpt-5-qa",
  result = { modules: [], lessons: [] },
  expired = false,
} = {}) {
  const runtime = {
    model,
    result,
    requests: [],
    clients: [],
    logs: [],
    settingsCalls: [],
    providerError: null,
    settingsError: null,
    truncated: false,
    responseText() {
      return typeof this.result === "string"
        ? this.result
        : JSON.stringify(this.result);
    },
  };
  globalThis.__syllabusImportQA = runtime;
  let entry = {
    id: ids.import,
    artifact_id: ids.artifact,
    primary_document_id: ids.primary,
    support_document_ids: [ids.support],
    status: operation === "parse" ? "PARSING" : "ENRICHING",
    revision: 4,
    confirmed_revision: 3,
    candidate_outline: structuredClone(outline),
    confirmed_outline: structuredClone(outline),
    extracted_outline: structuredClone(outline),
    issues: [],
    unassigned_topics: [],
    proposals: [],
    operation,
    lease_expires_at: new Date(
      Date.now() + (expired ? -60_000 : 600_000),
    ).toISOString(),
    attempt_count: 1,
    source_syllabus_version: 0,
  };
  const documents = [
    {
      id: ids.primary,
      artifact_id: ids.artifact,
      filename: "principal.txt",
      extracted_text: "Seguridad\nValidación\nTipos\nLímites",
      content_sha256: "a".repeat(64),
      size_bytes: 100,
    },
    {
      id: ids.support,
      artifact_id: ids.artifact,
      filename: "apoyo.txt",
      extracted_text: "SUPPORT_ONLY_PRIVATE_TEXT",
      content_sha256: "b".repeat(64),
      size_bytes: 100,
    },
  ];
  const calls = [];
  const writes = [];
  let savedSyllabus = null;
  let conflict = false;
  const admin = {
    from(table) {
      calls.push(table);
      const filters = new Map();
      const result = () => {
        if (table === "artifacts")
          return {
            data: {
              organization_id: "qa-organization",
              objetivos: ["Aplicar controles"],
              generation_metadata: {},
            },
            error: null,
          };
        if (table === "syllabus_imports")
          return {
            data:
              filters.get("artifact_id") === ids.artifact &&
              filters.get("id") === ids.import
                ? structuredClone(entry)
                : null,
            error: null,
          };
        if (table === "syllabus_source_documents")
          return {
            data: documents.filter(
              (document) =>
                document.artifact_id === filters.get("artifact_id") &&
                filters.get("id").includes(document.id),
            ),
            error: null,
          };
        throw new Error(`Unexpected table ${table}`);
      };
      const query = {
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
        single: async () => result(),
        maybeSingle: async () => result(),
        then(resolve, reject) {
          return Promise.resolve(result()).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, payload) {
      assert.equal(name, "transition_syllabus_import");
      assert.equal(payload.p_artifact_id, ids.artifact);
      assert.equal(payload.p_import_id, ids.import);
      if (conflict || payload.p_revision !== entry.revision)
        return { data: null, error: { message: "SYLLABUS_IMPORT_CONFLICT" } };
      writes.push(structuredClone(payload));
      if (payload.p_action === "enriched")
        savedSyllabus = structuredClone(payload.p_payload);
      if (payload.p_action === "parsed") {
        entry.candidate_outline = payload.p_payload.outline;
        entry.extracted_outline = payload.p_payload.outline;
        entry.issues = payload.p_payload.issues;
      }
      if (payload.p_action === "failed" || payload.p_action === "recover")
        entry.status = "FAILED";
      entry.revision++;
      entry.lease_expires_at = null;
      return { data: structuredClone(entry), error: null };
    },
  };
  return {
    admin,
    runtime,
    calls,
    writes,
    documents,
    entry: () => entry,
    saved: () => savedSyllabus,
    replaceEntry(value) {
      entry = value;
    },
    loseReservation() {
      conflict = true;
    },
    run: (revision = 4) =>
      executeSyllabusImport(admin, ids.artifact, ids.import, revision),
  };
}

test("complete supplied syllabus succeeds without model configuration, SDK or support reads", async () => {
  const current = fixture();
  current.runtime.settingsError = new Error("Unavailable model settings");
  await current.run();
  assert.equal(current.runtime.settingsCalls.length, 0);
  assert.equal(current.runtime.clients.length, 0);
  assert.equal(current.calls.includes("syllabus_source_documents"), false);
  assert.equal(current.saved().metadata.models_used.architect, "deterministic");
  assert.equal(current.saved().metadata.import_revision, 3);
  assert.equal(current.saved().metadata.import_baseline[0].sourceQuote, "");
  assert.equal(current.saved().modules[0].lessons[0].title, "Validación");
});

test("titles-only syllabus completes module and lesson objectives without inventing structure", async () => {
  const outline = structuredClone(baseline);
  outline[0].objective_general_ref = "";
  outline[0].lessons[0].objective_specific = "";
  const current = fixture({
    outline,
    result: {
      modules: [
        {
          id: ids.module,
          objective_general_ref: "Identificar riesgos de seguridad",
        },
      ],
      lessons: [
        {
          id: ids.lesson,
          objective_specific: "Validar entradas no confiables",
        },
      ],
    },
  });
  await current.run();
  assert.equal(current.saved().modules.length, 1);
  assert.equal(current.saved().modules[0].lessons.length, 1);
  assert.equal(current.saved().modules[0].title, "Seguridad");
  assert.equal(current.saved().modules[0].lessons[0].title, "Validación");
  assert.equal(current.saved().validation.automatic_pass, true);
});

for (const model of ["gpt-5-qa", "gemini-3.5-flash"]) {
  test(`${model}: parsing uses primary document only and assigns identities on the server`, async () => {
    const current = fixture({ operation: "parse", model, result: extracted() });
    await current.run();
    const prompt =
      current.runtime.requests[0].input || current.runtime.requests[0].contents;
    assert.equal(prompt.includes("SUPPORT_ONLY_PRIVATE_TEXT"), false);
    assert.match(current.entry().candidate_outline[0].id, /^[0-9a-f-]{36}$/);
    assert.notEqual(current.entry().candidate_outline[0].id, ids.module);
    assert.deepEqual(current.entry().candidate_outline[0].lessons[0].topics, [
      "Tipos",
      "Límites",
    ]);
    assert.equal(current.writes[0].p_action, "parsed");
    assert.equal(current.saved(), null);
    assert.equal(
      current.runtime.settingsCalls[0].organizationId,
      "qa-organization",
    );
    const client = current.runtime.clients[0];
    assert.equal(
      client.options.timeout || client.options.httpOptions.timeout,
      90_000,
    );
    if (client.provider === "openai")
      assert.equal(client.options.maxRetries, 0);
  });
  test(`${model}: missing objectives are completed without changing supplied fields`, async () => {
    const outline = structuredClone(baseline);
    outline[0].lessons[0].objective_specific = "";
    const current = fixture({
      model,
      outline,
      result: {
        modules: [],
        lessons: [
          {
            id: ids.lesson,
            objective_specific: "Validar entradas no confiables",
          },
        ],
      },
    });
    await current.run();
    assert.equal(current.saved().modules[0].id, ids.module);
    assert.equal(
      current.saved().modules[0].objective_general_ref,
      baseline[0].objective_general_ref,
    );
    assert.deepEqual(current.saved().modules[0].lessons[0].topics, [
      "Tipos",
      "Límites",
    ]);
    assert.equal(current.saved().validation.automatic_pass, true);
  });
}

test("ambiguous flat document remains a review candidate rather than inventing modules", async () => {
  const current = fixture({
    operation: "parse",
    result: {
      modules: [],
      issues: ["Jerarquía ambigua"],
      unassignedTopics: ["Tema A", "Tema B"],
    },
  });
  await current.run();
  assert.deepEqual(current.writes[0].p_payload.outline, []);
  assert.deepEqual(current.writes[0].p_payload.unassignedTopics, [
    "Tema A",
    "Tema B",
  ]);
  assert.equal(current.saved(), null);
});

test("invented heading receives a visible provenance issue and requires review", async () => {
  const result = extracted();
  result.modules[0].lessons[0].title = "Tema inventado";
  const current = fixture({ operation: "parse", result });
  await current.run();
  assert.match(current.writes[0].p_payload.issues.join(" "), /procedencia/);
  assert.equal(current.saved(), null);
});

for (const result of [
  {
    modules: [],
    lessons: [
      {
        id: ids.lesson,
        objective_specific: "Validar entradas",
        title: "Cambiar título",
      },
    ],
  },
  {
    modules: [],
    lessons: [
      {
        id: "b333ed83-4133-4616-b2c9-3a7a36521286",
        objective_specific: "Validar entradas",
      },
    ],
  },
  {
    modules: [
      { id: ids.module, objective_general_ref: "Cambiar objetivo explícito" },
    ],
    lessons: [{ id: ids.lesson, objective_specific: "Validar entradas" }],
  },
  { modules: [], lessons: [] },
]) {
  test(`adverse enrichment is rejected and the confirmed syllabus survives: ${JSON.stringify(result)}`, async () => {
    const outline = structuredClone(baseline);
    outline[0].lessons[0].objective_specific = "";
    const current = fixture({ outline, result });
    await assert.rejects(current.run());
    assert.equal(current.saved(), null);
    assert.deepEqual(current.entry().confirmed_outline, outline);
    assert.equal(current.writes.at(-1).p_action, "failed");
    assert.equal(
      JSON.stringify(current.runtime.logs).includes(
        "SUPPORT_ONLY_PRIVATE_TEXT",
      ),
      false,
    );
  });
}

test("provider failure never logs private response text or replaces a confirmed syllabus", async () => {
  const outline = structuredClone(baseline);
  outline[0].lessons[0].objective_specific = "";
  const current = fixture({ outline });
  current.runtime.providerError = new Error("PRIVATE_RESPONSE_BODY");
  await assert.rejects(current.run());
  assert.equal(current.saved(), null);
  assert.deepEqual(current.entry().confirmed_outline, outline);
  assert.equal(
    JSON.stringify(current.runtime.logs).includes("PRIVATE_RESPONSE_BODY"),
    false,
  );
  assert.deepEqual(current.writes.at(-1).p_payload, {});
});

for (const model of ["gpt-5-qa", "gemini-3.5-flash"]) {
  test(`${model}: truncated output is rejected even if the partial JSON happens to be valid`, async () => {
    const current = fixture({ operation: "parse", model, result: extracted() });
    current.runtime.truncated = true;
    await assert.rejects(current.run(), /TRUNCATED_SYLLABUS_RESPONSE/);
    assert.deepEqual(
      current.writes.map((write) => write.p_action),
      ["failed"],
    );
  });
}

test("repeated titles in different modules retain separate server-assigned identities", async () => {
  const result = extracted();
  result.modules.push(structuredClone(result.modules[0]));
  const current = fixture({ operation: "parse", result });
  await current.run();
  const outline = current.entry().candidate_outline;
  assert.equal(outline.length, 2);
  assert.equal(outline[0].title, outline[1].title);
  assert.notEqual(outline[0].id, outline[1].id);
  assert.notEqual(outline[0].lessons[0].id, outline[1].lessons[0].id);
});

test("duration overflow preserves every lesson and saves a draft blocked for approval", async () => {
  const outline = structuredClone(baseline);
  outline[0].lessons = Array.from({ length: 20 }, (_, index) => ({
    ...baseline[0].lessons[0],
    id: crypto.randomUUID(),
    title: `Lección ${index + 1}`,
    objective_specific: "Crear una solución segura mediante pruebas y análisis",
  }));
  const current = fixture({ outline });
  await current.run();
  assert.equal(current.saved().modules[0].lessons.length, 20);
  assert.equal(current.saved().validation.automatic_pass, false);
  assert.equal(
    current.saved().validation.checks.find((check) => check.code === "[V06]")
      .pass,
    false,
  );
  assert.equal(current.runtime.requests.length, 0);
});

test("invalid proposal anchor is rejected without changing the baseline", async () => {
  const current = fixture({
    operation: "propose",
    result: {
      proposals: [
        {
          moduleId: ids.module,
          afterLessonId: "b333ed83-4133-4616-b2c9-3a7a36521286",
          title: "Nueva lección",
          objective_specific: "Validar controles",
          topics: [],
          reason: "Vacío concreto",
        },
      ],
    },
  });
  await assert.rejects(current.run(), /ubicación inválida/);
  assert.deepEqual(current.entry().confirmed_outline, baseline);
  assert.equal(current.saved(), null);
});

test("valid proposal is stored separately and never materializes automatically", async () => {
  const current = fixture({
    operation: "propose",
    result: {
      proposals: [
        {
          moduleId: ids.module,
          afterLessonId: ids.lesson,
          title: "Nueva lección",
          objective_specific: "Validar controles",
          topics: [],
          reason: "Vacío concreto",
        },
      ],
    },
  });
  await current.run();
  assert.equal(current.writes[0].p_action, "proposed");
  assert.equal(current.writes[0].p_payload.proposals.length, 1);
  assert.deepEqual(current.entry().confirmed_outline, baseline);
  assert.equal(current.saved(), null);
});

test("stale revision exits before artifact, provider and persistence work", async () => {
  const current = fixture();
  await current.run(3);
  assert.deepEqual(current.calls, ["syllabus_imports"]);
  assert.equal(current.runtime.requests.length, 0);
  assert.equal(current.writes.length, 0);
});

test("expired lease is recovered before any provider work", async () => {
  const current = fixture({ expired: true });
  await current.run();
  assert.deepEqual(
    current.writes.map((write) => write.p_action),
    ["recover"],
  );
  assert.equal(current.runtime.requests.length, 0);
  assert.deepEqual(current.entry().confirmed_outline, baseline);
});

test("losing the revision during model execution cannot overwrite or mark the new owner failed", async () => {
  const current = fixture({ operation: "parse", result: extracted() });
  current.runtime.responseText = () => {
    current.loseReservation();
    return JSON.stringify(extracted());
  };
  await assert.rejects(current.run(), /revisión/);
  assert.equal(current.writes.length, 0);
  assert.equal(current.saved(), null);
});
