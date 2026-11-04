// Ejecuta fuentes actuales con dependencias simuladas. No llama servicios externos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { tenantFixtures, pendingMembershipFixtures } from './authority-fixtures.mjs';

function load(relative, imports = {}) {
  const filename = path.resolve(relative);
  const source = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = createRequire(filename);
  vm.runInNewContext('(function(require,module,exports){' + source + '\n})', { TextEncoder, console })(
    name => Object.hasOwn(imports, name) ? imports[name] : require(name), module, module.exports,
  );
  return module.exports;
}
const roles = load('apps/web/src/utils/auth/platform-role.ts');
const env = { getSupabaseUrl: () => 'https://example.invalid', getSupabaseServiceRoleKey: () => 'sintetico' };
const acceptance = process.argv.includes('--acceptance');
let unsafeResults = 0;
for (const fixture of tenantFixtures) {
  const tenant = load('apps/web/src/lib/server/tenant-context.ts', {
    '@supabase/supabase-js': { createClient: () => ({ from: table => ({
      select() { return this; }, eq() { return this; }, abortSignal() { return this; },
      async maybeSingle() { return { data: table === 'organization_user_roles' && fixture.storedRole ? { platform_role: fixture.storedRole } : null,
        error: fixture.lookupError ? { message: 'Fallo sintético' } : null }; },
    }) }) },
    react: { cache: fn => fn },
    'next/headers': { cookies: async () => ({ get: () => undefined }), headers: async () => new Map() },
    '@/utils/auth/session': { getAuthBridgeUser: async () => fixture.noUser ? null : ({ id: 'usuario-prueba', platform_role: 'CONSTRUCTOR', organization_ids: fixture.ids }), getUserOrganizations: async () => fixture.cookie },
    '@/lib/server/env': env,
    '@/utils/auth/platform-role': roles,
    '@/lib/server/tenant-lookup-retry': { isTransientTenantLookupError: () => false, runTenantLookupWithRetry: fn => fn(undefined) },
  });
  if (fixture.expectedError) {
    await assert.rejects(() => tenant.resolveTenantContext(fixture.cookie[0].slug), error => error.code === fixture.expectedError);
  } else {
    const actual = await tenant.resolveTenantContext(fixture.cookie[0].slug);
    assert.equal(actual?.platformRole ?? null, fixture.expectedCurrentRole, fixture.id);
    if ((actual?.platformRole ?? null) !== fixture.safeRole) unsafeResults++;
  }
  console.log('Caracterización confirmada:', fixture.id);
}
const queried = [];
const artifactAuth = load('apps/web/src/lib/server/artifact-action-auth.ts', {
  '@supabase/supabase-js': { createClient: () => ({ from: () => ({
    select() { return this; }, eq() { return this; },
    in(field, ids) { queried.push(...ids); return this; },
    async maybeSingle() { return { data: { id: 'artefacto-prueba', organization_id: 'org-ajena' }, error: null }; },
  }) }) },
  'next/headers': { cookies: async () => ({ get: () => undefined }) },
  '@/utils/auth/session': { getAuthBridgeUser: async () => ({ id: 'usuario-prueba', organization_ids: ['org-propia'] }), getActiveOrganizationId: async () => 'org-ajena' },
  '@/lib/server/tenant-context': { resolveActiveTenantContext: async () => null, getOrganizationPlatformRole: async () => null },
  '@/lib/pipeline-constants': { REVIEWER_ROLE_SET: new Set(['ADMIN']) },
  '@/lib/server/env': env,
  './background-function-origin': { resolveBackgroundFunctionOrigin: () => 'https://example.invalid' },
});
assert.ok(await artifactAuth.getAuthorizedArtifactAdmin('artefacto-prueba'));
assert.ok(queried.includes('org-ajena'));
unsafeResults++;
console.log('Caracterización confirmada: fallback service-role incluye org-ajena.');
console.log(`Aceptación incumplida: ${unsafeResults} escenarios; pendientes de adaptador: ${pendingMembershipFixtures.length}.`);
if (acceptance) assert.equal(unsafeResults, 0, 'La caracterización verde NO acredita seguridad: fuente actual incumple aceptación.');
