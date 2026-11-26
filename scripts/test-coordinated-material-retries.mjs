import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const { PGlite } = await import(pathToFileURL(resolve('apps/web/.tmp/syllabus-sql-runtime/node_modules/@electric-sql/pglite/dist/index.js')).href);
const sql = await readFile('supabase/migrations/20261121010000_coordinated_material_retries.sql','utf8');
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture(t) {
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table materials(id uuid primary key,version integer,state text,qa_decision jsonb,updated_at timestamptz);
    create table material_lessons(id uuid primary key,materials_id uuid,state text,iteration_count integer default 1,max_iterations integer default 4,created_at timestamptz default now(),updated_at timestamptz,dod jsonb);
    create table course_delivery_workspaces(artifact_id uuid primary key,organization_id uuid,revision integer);
    create table course_delivery_runs(id uuid primary key,artifact_id uuid,organization_id uuid,expected_revision integer,operation text,status text,units jsonb,lease_token uuid,lease_expires_at timestamptz,updated_at timestamptz,last_error text);
    grant select,update on all tables in schema public to service_role;`);
  await db.exec(sql); await db.exec(sql);
  await db.query(`insert into materials values($1,1,'PHASE3_GENERATING',null,now())`,[id(1)]);
  await db.query(`insert into course_delivery_workspaces values($1,$2,1)`,[id(2),id(3)]);
  await db.query(`insert into course_delivery_runs(id,artifact_id,organization_id,expected_revision,operation,status,units,lease_token,lease_expires_at) values($1,$2,$3,1,'MATERIALS','RUNNING',$4::jsonb,$5,now()+interval '12 minutes')`,[id(4),id(2),id(3),JSON.stringify([{id:id(5),ready:false,error:'fallo',attempts:1}]),id(6)]);
  return db;
}
test('reserva Academy sin alterar versión y rechaza duplicados y capacidad',async t=>{
  const db=await fixture(t);
  await db.query(`insert into material_lessons(id,materials_id,state) values($1,$3,'GENERATING'),($2,$3,'NEEDS_FIX')`,[id(10),id(11),id(1)]);
  const retry=()=>db.query(`select reserve_material_lesson_retry($1,1,$2,1) as iteration`,[id(1),id(11)]);
  assert.equal((await retry()).rows[0].iteration,2);
  await assert.rejects(retry(),/MATERIAL_RETRY_CONFLICT/);
  await db.query(`insert into material_lessons(id,materials_id,state) values($1,$3,'NEEDS_FIX'),($2,$3,'PENDING')`,[id(12),id(13),id(1)]);
  await assert.rejects(db.query(`select reserve_material_lesson_retry($1,1,$2,1)`,[id(1),id(12)]),/CAPACITY/);
  assert.equal((await db.query(`select claim_material_generation($1,1) as lesson`,[id(1)])).rows[0].lesson,null);
  assert.equal((await db.query(`select version from materials`)).rows[0].version,1);
});
test('cierre Academy espera pendientes/activos y no cierra una versión nueva',async t=>{
  const db=await fixture(t);
  await db.query(`insert into material_lessons(id,materials_id,state) values($1,$2,'PENDING')`,[id(10),id(1)]);
  const finish=()=>db.query(`select finish_material_generation($1,1) as done`,[id(1)]);
  assert.equal((await finish()).rows[0].done,false);
  await db.query(`update material_lessons set state='GENERATING'`);
  assert.equal((await finish()).rows[0].done,false);
  await db.query(`update material_lessons set state='GENERATED'`);
  assert.equal((await db.query(`select finish_material_generation($1,2) as done`,[id(1)])).rows[0].done,false);
  assert.equal((await finish()).rows[0].done,true);
  await assert.rejects(db.query(`select reserve_material_lesson_retry($1,1,$2,1)`,[id(1),id(10)]),/CONFLICT/);
});
test('cola Hub idempotente, consume bajo lease y sobrevive al cierre',async t=>{
  const db=await fixture(t);
  const request=()=>db.query(`select request_delivery_material_retry($1,$2,$3,$4) as dispatch`,[id(2),id(3),id(4),id(5)]);
  assert.equal((await request()).rows[0].dispatch,false); await request();
  assert.deepEqual((await db.query(`select retry_units from course_delivery_runs`)).rows[0].retry_units,[id(5)]);
  await assert.rejects(db.query(`select take_delivery_material_retry($1,$2)`,[id(4),id(99)]),/STALE/);
  assert.equal((await db.query(`select finish_delivery_material_run($1,$2,'FAILED','fallo') as status`,[id(4),id(6)])).rows[0].status,'QUEUED');
  await db.query(`update course_delivery_runs set status='RUNNING',lease_token=$1`,[id(6)]);
  assert.equal((await db.query(`select take_delivery_material_retry($1,$2) as unit`,[id(4),id(6)])).rows[0].unit,id(5));
  assert.deepEqual((await db.query(`select retry_units from course_delivery_runs`)).rows[0].retry_units,[]);
  await assert.rejects(request(),/CONFLICT/);
});
test('Hub rechaza unidad ajena, tenant ajeno, límite de intentos y cancelación',async t=>{
  const db=await fixture(t);
  await assert.rejects(db.query(`select request_delivery_material_retry($1,$2,$3,$4)`,[id(2),id(99),id(4),id(5)]),/CONFLICT/);
  await assert.rejects(db.query(`select request_delivery_material_retry($1,$2,$3,$4)`,[id(2),id(3),id(4),id(99)]),/CONFLICT/);
  await db.query(`update course_delivery_runs set units=jsonb_set(units,'{0,attempts}','4')`);
  await assert.rejects(db.query(`select request_delivery_material_retry($1,$2,$3,$4)`,[id(2),id(3),id(4),id(5)]),/CONFLICT/);
  await db.query(`update course_delivery_runs set status='CANCELLED'`);
  assert.equal((await db.query(`select finish_delivery_material_run($1,$2,'COMPLETED',null) as status`,[id(4),id(6)])).rows[0].status,'NOT_CLAIMED');
});
test('RPC nuevas niegan ejecución a clientes autenticados y anónimos',async t=>{
  const db=await fixture(t);
  for(const role of ['authenticated','anon']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query(`select finish_material_generation($1,1)`,[id(1)]),/permission denied/);
    await assert.rejects(db.query(`select request_delivery_material_retry($1,$2,$3,$4)`,[id(2),id(3),id(4),id(5)]),/permission denied/);
    await db.exec('reset role');
  }
});
test('un fallo fatal no vuelve a despachar reintentos pendientes de Hub',async t=>{
  const db=await fixture(t);
  await db.query(`select request_delivery_material_retry($1,$2,$3,$4)`,[id(2),id(3),id(4),id(5)]);
  assert.equal((await db.query(`select finish_delivery_material_run($1,$2,'FAILED','entradas cambiaron',true) as status`,[id(4),id(6)])).rows[0].status,'FAILED');
  assert.deepEqual((await db.query(`select retry_units from course_delivery_runs`)).rows[0].retry_units,[]);
});
