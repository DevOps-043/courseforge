// Isolated PostgreSQL regression tests. PGlite is a test-only runtime installed
// outside the repository; pass its package directory as the first argument.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { PGlite } = require(resolve(process.argv[2]));
const db = new PGlite();
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table artifacts(id uuid primary key);
    create table profiles(id uuid primary key);
    create function update_updated_at_column() returns trigger language plpgsql as $$
    begin NEW.updated_at = now(); return NEW; end $$;
  `);
  for (const table of ["curation", "curation_rows", "materials", "material_lessons", "material_components"]) {
    await db.exec(await readFile(`supabase/Scripts/${table}.sql`, "utf8"));
  }
  const sourceMigration = await readFile("supabase/migrations/20260723120000_curation_sources_v2.sql", "utf8");
  await db.exec(sourceMigration.slice(0, sourceMigration.indexOf("insert into storage.buckets")));
  await db.exec(`alter table material_components add column assets jsonb default '{}';
    create unique index on material_components(material_lesson_id,type);`);
  await db.exec(await readFile("supabase/migrations/20260915120000_pipeline_generation_commits.sql", "utf8"));

  const artifactId = "00000000-0000-4000-8000-000000000001";
  const curationId = "00000000-0000-4000-8000-000000000002";
  const materialsId = "00000000-0000-4000-8000-000000000003";
  const lessonId = "00000000-0000-4000-8000-000000000004";
  await db.query("insert into artifacts values ($1)", [artifactId]);
  await db.query("insert into curation(id,artifact_id,state) values ($1,$2,'PHASE2_GENERATING')", [curationId, artifactId]);
  await db.query("insert into materials(id,artifact_id,state) values ($1,$2,'PHASE3_GENERATING')", [materialsId, artifactId]);
  await db.query(`insert into material_lessons(id,materials_id,lesson_id,lesson_title,module_id,module_title,oa_text)
    values ($1,$2,'lesson-1','Lesson','module-1','Module','Apply')`, [lessonId, materialsId]);
  const scalar = async (sql, params) => Object.values((await db.query(sql, params)).rows[0])[0];
  const source = { lesson_id: "lesson-1", lesson_title: "Lesson", component: "LESSON_SOURCE",
    is_critical: true, source_ref: "https://example.org/source", apta: true, url_status: "OK",
    cobertura_completa: true, auto_evaluated: true, origin: "automatic", source_kind: "url", validation_report: { status: "valid" } };
  const commitSources = (attempt, rows, completion = null) => scalar(
    "select commit_curation_progress($1,$2,$3::jsonb,$4::jsonb)",
    [curationId, attempt, JSON.stringify(rows), completion && JSON.stringify(completion)]);
  assert.equal(await commitSources(1, [source]), true);
  assert.equal(await commitSources(1, [source]), true);
  assert.equal(await scalar("select count(*)::int from curation_rows"), 1, "duplicate delivery preserves one source");
  await db.query("update curation set state='STOPPED' where id=$1", [curationId]);
  assert.equal(await commitSources(1, [], { state: "PHASE2_APPROVED" }), false, "cancel cannot be overwritten");
  await db.query("update curation set state='PHASE2_GENERATING', attempt_number=3 where id=$1", [curationId]);
  assert.equal(await commitSources(1, [source]), false, "old attempt is fenced");
  assert.equal(await commitSources(3, [], { state: "PHASE2_APPROVED", qa_decision: { decision: "APPROVED" } }), true);

  const claim = (version) => scalar("select claim_material_generation($1,$2)", [materialsId, version]);
  assert.equal(await claim(9), null);
  assert.equal((await claim(1)).iteration_count, 1);
  assert.equal(await claim(1), null, "active lesson cannot be claimed again");
  const component = { type: "EXERCISE", content: { title: "Practice" }, source_refs: ["source"],
    assets: {}, validation_status: "PASS", validation_errors: [], iteration_number: 1, generated_at: new Date().toISOString() };
  const commitLesson = (version, iteration, rows, success = true) => scalar(
    "select commit_material_generation($1,$2,$3,$4,$5::jsonb,$6,$7)",
    [materialsId, version, lessonId, iteration, JSON.stringify(rows), success, success ? null : "Incomplete video"]);
  await assert.rejects(commitLesson(1, 1, [{ ...component, content: null }]));
  assert.equal(await scalar("select state from material_lessons where id=$1", [lessonId]), "GENERATING", "write failure rolls back state");
  await db.query("update materials set state='PHASE3_DRAFT' where id=$1", [materialsId]);
  assert.equal(await commitLesson(1, 1, [component]), false);
  assert.equal(await scalar("select count(*)::int from material_components"), 0);
  await db.query("update materials set state='PHASE3_GENERATING',version=2 where id=$1", [materialsId]);
  assert.equal(await commitLesson(1, 1, [component]), false);
  assert.equal(await commitLesson(2, 2, [component]), false, "stale lesson iteration is rejected");
  assert.equal(await commitLesson(2, 1, [component], false), true);
  assert.equal(await scalar("select state from material_lessons where id=$1", [lessonId]), "NEEDS_FIX");
  assert.equal(await scalar("select count(*)::int from material_components"), 1, "partial output is preserved");
  assert.equal(await commitLesson(2, 1, [component]), false, "completed iteration is not overwritten");
  await db.query("update material_lessons set state='PENDING' where id=$1", [lessonId]);
  assert.equal((await claim(2)).iteration_count, 2);
  assert.equal(await commitLesson(2, 2, [{ ...component, iteration_number: 2 }]), true);
  assert.equal(await scalar("select state from material_lessons where id=$1", [lessonId]), "GENERATED");
  assert.deepEqual(await scalar("select dod->'errors' from material_lessons where id=$1", [lessonId]), []);
  assert.equal(await scalar("select count(*)::int from material_components"), 1);
  await db.query("update material_lessons set state='PENDING' where id=$1", [lessonId]);
  await claim(2);
  assert.equal(await scalar("select reset_material_generation($1,$2,$3)", [materialsId, 2, new Date(0).toISOString()]), false, "fresh work is not stale");
  assert.equal(await scalar("select reset_material_generation($1,$2,null)", [materialsId, 2]), true);
  assert.equal(await commitLesson(2, 3, [component]), false);
  assert.equal(await scalar("select state from material_lessons where id=$1", [lessonId]), "PENDING");
  assert.equal(await scalar("select start_material_generation($1,$2)", [artifactId, 2]), null);
  assert.equal((await scalar("select start_material_generation($1,$2)", [artifactId, 3])).version, 4);
  assert.equal(await scalar("select start_material_generation($1,$2)", [artifactId, 3]), null, "only one restart owns the version");
  await db.exec("set role authenticated");
  await assert.rejects(claim(2), /permission denied/);
  await assert.rejects(commitSources(3, []), /permission denied/);
  await assert.rejects(commitLesson(2, 2, []), /permission denied/);
  await assert.rejects(scalar("select start_material_generation($1,$2)", [artifactId, 4]), /permission denied/);
  await assert.rejects(scalar("select reset_material_generation($1,$2,null)", [materialsId, 4]), /permission denied/);
  console.log("Pipeline PostgreSQL regression tests passed: ownership, cancellation, retries, atomic rollback, partial results, permissions.");
} finally {
  await db.close();
}
