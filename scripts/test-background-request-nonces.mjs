// Isolated PostgreSQL regression test. Install the test runtime once with:
// npm install --prefix .tmp/background-nonce-qa --no-save --package-lock=false @electric-sql/pglite
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const requireQA = createRequire(new URL('../.tmp/background-nonce-qa/runner.cjs', import.meta.url));
const { PGlite } = requireQA('@electric-sql/pglite');
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const db = new PGlite();

try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  await db.exec(read('supabase/migrations/20260908122000_create_background_request_nonces.sql'));
  await assert.rejects(
    db.query("SELECT public.consume_background_request_nonce('regression-nonce-before-fix', clock_timestamp() + interval '5 minutes')"),
    (error) => error.code === '42883',
    'The original migration must reproduce the production timestamp/timetz failure',
  );
  const fix = read('supabase/migrations/20260916030000_fix_background_nonce_timestamp.sql');
  await db.exec(fix);
  await db.exec(fix); // Reapplying the repair must be safe.
  await db.exec(read('supabase/tests/background-request-nonces.sql'));
  const { rows } = await db.query('SELECT count(*)::int AS count FROM public.background_request_nonces');
  assert.equal(rows[0].count, 0, 'Regression tests must roll back their writes');
  console.log('PASS: reproduced 42883; repair, expiry, replay protection, cleanup, timestamps, null inputs, permissions and rollback');
} finally {
  await db.close();
}
