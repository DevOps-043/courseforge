import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const runtime = resolve(process.env.COURSE_SOURCES_PGLITE_PATH || 'apps/web/.tmp/syllabus-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(runtime).href);
test('crear un artefacto respeta RLS sin abrir la configuración documental privada', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table public.course_source_settings(artifact_id uuid,policy text);
      create table public.artifacts(id uuid primary key,owner_name text default current_user,state text,nombres jsonb,objetivos jsonb,descripcion jsonb,source_evidence_id uuid,validation_report jsonb);
      create table public.course_source_documents(artifact_id uuid,status text);
      create function public.course_source_receipt_valid(uuid,uuid,text,jsonb) returns boolean language sql as 'select false';
      grant usage on schema public to authenticated;
      grant insert,select,update on public.artifacts to authenticated;
      alter table public.artifacts enable row level security;
      create policy own_artifact on public.artifacts to authenticated using(owner_name=current_user) with check(owner_name=current_user);`);
    const original = await readFile('supabase/migrations/20261106040000_course_source_generation.sql','utf8');
    const start = original.indexOf('create or replace function public.guard_course_source_structure_generation()');
    const end = original.indexOf('end $$;',start) + 'end $$;'.length;
    assert.ok(start >= 0 && end > start);
    await db.exec(original.slice(start,end));
    await db.exec(`create trigger course_source_base_generation before insert or update on public.artifacts for each row execute function public.guard_course_source_structure_generation(); set role authenticated;`);
    const first = '10000000-0000-4000-8000-000000000001';
    await assert.rejects(db.query("insert into public.artifacts(id,state) values($1,'GENERATING')",[first]), /permission denied for table course_source_settings/);
    await db.exec('reset role');
    const fix = await readFile('supabase/migrations/20261119010000_course_source_structure_trigger_permissions.sql','utf8');
    await db.exec(fix); await db.exec(fix);
    await db.exec('set role authenticated');
    await db.query("insert into public.artifacts(id,state) values($1,'GENERATING')",[first]);
    await assert.rejects(db.query('select * from public.course_source_settings'), /permission denied/);
    await assert.rejects(db.query("insert into public.artifacts(id,owner_name,state) values(gen_random_uuid(),'otro','GENERATING')"), /row-level security/);
    await db.exec('reset role');
    await db.query('insert into public.course_source_settings values($1,null)',[first]);
    await db.exec('set role authenticated');
    await assert.rejects(db.query("update public.artifacts set state='GENERATING' where id=$1",[first]), /SOURCE_REVIEW_REQUIRED/);
  } finally { await db.close(); }
});
