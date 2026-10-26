import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

// PostgreSQL local en memoria. Dependencia temporal documentada; nunca usa .env.
const modulePath = resolve(process.env.COURSE_DELIVERY_PGLITE_PATH || ".tmp/sql-verification/node_modules/@electric-sql/pglite/dist/index.js");
const { PGlite } = await import(pathToFileURL(modulePath).href);
const database = new PGlite();
const course = "10000000-0000-4000-8000-000000000001";
const org = "20000000-0000-4000-8000-000000000001";
const otherOrg = "20000000-0000-4000-8000-000000000002";
const user = "30000000-0000-4000-8000-000000000001";
const token = "40000000-0000-4000-8000-000000000001";
const document = { config: { mode: "SYNCHRONOUS" }, agenda: [], plans: {}, materials: {}, planApproval: null, materialsApproval: null };
await database.exec(`
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE organizations(id uuid PRIMARY KEY);
  CREATE TABLE profiles(id uuid PRIMARY KEY);
  CREATE TABLE artifacts(id uuid PRIMARY KEY,organization_id uuid REFERENCES organizations(id));
  CREATE TABLE syllabus(artifact_id uuid PRIMARY KEY,modules jsonb,state text);
  CREATE TABLE instructional_plans(artifact_id uuid PRIMARY KEY,lesson_plans jsonb,state text,approvals jsonb,updated_at timestamptz);
  CREATE TABLE materials(id uuid PRIMARY KEY,artifact_id uuid UNIQUE,state text,qa_decision jsonb,updated_at timestamptz);
  CREATE TABLE curation(id uuid PRIMARY KEY,artifact_id uuid UNIQUE,state text);
  CREATE TABLE curation_rows(id uuid PRIMARY KEY,curation_id uuid,apta boolean);
  CREATE TABLE model_settings(id serial PRIMARY KEY,organization_id uuid,setting_type text,scope text,is_active boolean,model_name text,fallback_model text,temperature numeric,thinking_level text,
    CONSTRAINT model_settings_setting_type_check CHECK (setting_type IN ('SYLLABUS','INSTRUCTIONAL_PLAN','MATERIALS')));
  CREATE TABLE system_prompts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,code text,scope text,version text,content text,description text,is_active boolean,created_by uuid,source text,
    UNIQUE(code,version,organization_id));
  ALTER TABLE model_settings ENABLE ROW LEVEL SECURITY;
  ALTER TABLE system_prompts ENABLE ROW LEVEL SECURITY;
  CREATE POLICY legacy_models ON model_settings FOR ALL USING(true) WITH CHECK(true);
  CREATE POLICY legacy_prompts ON system_prompts FOR ALL USING(true) WITH CHECK(true);
  GRANT SELECT,INSERT,UPDATE ON model_settings,system_prompts TO authenticated;
  GRANT USAGE,SELECT ON SEQUENCE model_settings_id_seq TO authenticated;
  INSERT INTO organizations VALUES ('${org}'),('${otherOrg}');
  INSERT INTO profiles VALUES ('${user}');
  INSERT INTO artifacts VALUES ('${course}','${org}');
  INSERT INTO syllabus VALUES ('${course}','[]','STEP_APPROVED');
`);
await database.exec(await readFile("supabase/migrations/20261026160000_synchronous_course_delivery.sql", "utf8"));
const query = (sql, args = []) => database.query(sql, args);
const save = (revision, next = document, organization = org) => query("SELECT save_course_delivery($1,$2,$3,$4::jsonb) AS revision", [course, organization, revision, JSON.stringify(next)]);
const reserve = revision => query("SELECT reserve_course_delivery_run($1,$2,$3,'AGENDA','{}',$4::jsonb) AS id", [course, org, revision, JSON.stringify([{ id: "unit", ready: false }])]);

await test("migración aplica en PostgreSQL local y conserva allowlist previo", async () => {
  await query("INSERT INTO model_settings(organization_id,setting_type) VALUES($1,'SYLLABUS'),($1,'SYNCHRONOUS_PLAN')", [org]);
  await assert.rejects(query("INSERT INTO model_settings(setting_type) VALUES('TIPO_AJENO')"), /check constraint/);
});
await test("curso de otra organización no puede crear ni modificar el agregado", async () => {
  await assert.rejects(save(0, document, otherOrg), /DELIVERY_NOT_FOUND/);
  assert.equal((await save(0)).rows[0].revision, 1);
  await assert.rejects(save(1, document, otherOrg), /DELIVERY_NOT_FOUND/);
});
await test("comparación de revisión impide sobrescritura concurrente", async () => {
  assert.equal((await save(1)).rows[0].revision, 2);
  await assert.rejects(save(1), /DELIVERY_REVISION_CONFLICT/);
});
let runId;
await test("reserva única por curso y claim idempotente", async () => {
  runId = (await reserve(2)).rows[0].id;
  await assert.rejects(reserve(2), /unique constraint/);
  assert.equal((await query("SELECT claim_course_delivery_run($1,$2) AS claimed", [runId, token])).rows[0].claimed, true);
  assert.equal((await query("SELECT claim_course_delivery_run($1,$2) AS claimed", [runId, token])).rows[0].claimed, false);
});
await test("commit rechaza token ajeno y guarda unidad/revisión atómicamente", async () => {
  const units = JSON.stringify([{ id: "unit", ready: true }]);
  await assert.rejects(query("SELECT commit_course_delivery_unit($1,$2,$3,$4)", [runId, user, JSON.stringify(document), units]), /DELIVERY_STALE_RUN/);
  assert.equal((await query("SELECT commit_course_delivery_unit($1,$2,$3,$4) AS revision", [runId, token, JSON.stringify(document), units])).rows[0].revision, 3);
  const run = (await query("SELECT expected_revision,units FROM course_delivery_runs WHERE id=$1", [runId])).rows[0];
  assert.equal(run.expected_revision, 3); assert.equal(run.units[0].ready, true);
});
await test("edición cancela ejecución y bloquea resultado tardío conservando snapshot", async () => {
  await save(3);
  assert.equal((await query("SELECT status FROM course_delivery_runs WHERE id=$1", [runId])).rows[0].status, "CANCELLED");
  await assert.rejects(query("SELECT commit_course_delivery_unit($1,$2,$3,'[]')", [runId, token, JSON.stringify(document)]), /DELIVERY_STALE_RUN/);
  assert.equal((await query("SELECT count(*) AS count FROM course_delivery_runs")).rows[0].count, 1);
  const history = (await query("SELECT document FROM course_delivery_versions WHERE artifact_id=$1 AND revision=1", [course])).rows;
  assert.deepEqual(history[0].document, document);
});
await test("aprobación rechaza syllabus cambiado y curación sin aprobar", async () => {
  await assert.rejects(query("SELECT approve_course_delivery($1,$2,4,$3,'[1]',NULL,NULL,'[]','PLAN')", [course, org, JSON.stringify(document)]), /DELIVERY_SYLLABUS_CHANGED/);
  await assert.rejects(query("SELECT approve_course_delivery($1,$2,4,$3,'[]',NULL,NULL,'[]','MATERIALS')", [course, org, JSON.stringify(document)]), /DELIVERY_CURATION_APPROVAL_REQUIRED/);
  assert.equal((await query("SELECT approve_course_delivery($1,$2,4,$3,'[]',NULL,NULL,'[]','PLAN') AS revision", [course, org, JSON.stringify(document)])).rows[0].revision, 5);
});
await test("aprobación no compite con una generación activa", async () => {
  await reserve(5);
  await assert.rejects(query("SELECT approve_course_delivery($1,$2,5,$3,'[]',NULL,NULL,'[]','PLAN')", [course, org, JSON.stringify(document)]), /DELIVERY_GENERATION_ACTIVE/);
  await save(5);
});
await test("prompts se versionan y modelo puede volver a herencia de forma atómica", async () => {
  const model = JSON.stringify({ model_name: "gpt-4o", fallback_model: null, temperature: 0.3, thinking_level: "medium" });
  await query("SELECT save_course_delivery_setting($1,$2,'SYNCHRONOUS_AGENDA',$3,'Primero')", [org, user, model]);
  await query("SELECT save_course_delivery_setting($1,$2,'SYNCHRONOUS_AGENDA',NULL,'Segundo')", [org, user]);
  const prompts = (await query("SELECT content,is_active FROM system_prompts ORDER BY version")).rows;
  assert.equal(prompts.length, 2); assert.equal(prompts.filter(row => row.is_active).length, 1);
  assert.equal((await query("SELECT count(*) AS count FROM model_settings WHERE setting_type='SYNCHRONOUS_AGENDA' AND is_active")).rows[0].count, 0);
});
await test("aprobación híbrida no autoaprueba Nexus ni materiales sin QA", async () => {
  const hybrid = { ...document, config: { mode: "HYBRID" } };
  await save(6, hybrid);
  const nexus = [{ lesson_id: "lesson" }];
  await query("INSERT INTO instructional_plans(artifact_id,lesson_plans,state) VALUES($1,$2,'STEP_READY_FOR_REVIEW')", [course, JSON.stringify(nexus)]);
  await assert.rejects(query("SELECT approve_course_delivery($1,$2,7,$3,'[]',$4,NULL,'[]','PLAN')", [course, org, JSON.stringify(hybrid), JSON.stringify(nexus)]), /DELIVERY_NEXUS_APPROVAL_REQUIRED/);
  assert.equal((await query("SELECT state FROM instructional_plans WHERE artifact_id=$1", [course])).rows[0].state, "STEP_READY_FOR_REVIEW");
  await query("UPDATE instructional_plans SET state='STEP_APPROVED' WHERE artifact_id=$1", [course]);
  await query("INSERT INTO curation(id,artifact_id,state) VALUES($1,$2,'PHASE2_APPROVED')", [token, course]);
  await assert.rejects(query("SELECT approve_course_delivery($1,$2,7,$3,'[]',$4,NULL,'[]','MATERIALS')", [course, org, JSON.stringify(hybrid), JSON.stringify(nexus)]), /DELIVERY_NEXUS_MATERIALS_APPROVAL_REQUIRED/);
});
await test("roles de navegador no leen contenido privado ni ejecutan mutaciones privilegiadas", async () => {
  await database.exec("SET ROLE authenticated");
  try {
    await assert.rejects(query("SELECT * FROM course_delivery_workspaces"), /permission denied/);
    await assert.rejects(save(6), /permission denied/);
    await assert.rejects(query("INSERT INTO model_settings(organization_id,setting_type) VALUES($1,'SYNCHRONOUS_AGENDA')", [org]), /row-level security/);
    assert.equal((await query("SELECT count(*) AS count FROM system_prompts WHERE code='SYNCHRONOUS_AGENDA'")).rows[0].count, 0);
  } finally { await database.exec("RESET ROLE"); }
  await database.exec("SET ROLE anon");
  try { await assert.rejects(query("SELECT * FROM course_delivery_runs"), /permission denied/); }
  finally { await database.exec("RESET ROLE"); }
});
await database.close();
