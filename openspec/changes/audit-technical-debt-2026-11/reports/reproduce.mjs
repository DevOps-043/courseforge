// Ejecuta fuentes reales con dependencias locales simuladas; no inicia Next ni accede a red/BD.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';

const root = process.cwd();
function load(relative, imports = {}) {
  const filename = path.join(root, relative);
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
let signedOrganizations = ['org-propia'];
let cookieOrganizations = [{ id: 'org-propia', slug: 'empresa', role: 'owner' }];
const tenant = load('apps/web/src/lib/server/tenant-context.ts', {
  '@supabase/supabase-js': { createClient: () => ({ from: () => ({ select() { return this; }, eq() { return this; }, abortSignal() { return this; }, async maybeSingle() { return { data: null, error: null }; } }) }) },
  react: { cache: fn => fn },
  'next/headers': { cookies: async () => ({ get: () => undefined }), headers: async () => new Map() },
  '@/utils/auth/session': {
    getAuthBridgeUser: async () => ({ id: 'usuario-prueba', platform_role: 'CONSTRUCTOR', organization_ids: signedOrganizations }),
    getUserOrganizations: async () => cookieOrganizations,
  },
  '@/lib/server/env': { getSupabaseUrl: () => 'https://example.invalid', getSupabaseServiceRoleKey: () => 'valor-simulado' },
  '@/utils/auth/platform-role': roles,
  '@/lib/server/tenant-lookup-retry': { isTransientTenantLookupError: () => false, runTenantLookupWithRetry: fn => fn(undefined) },
});
const roleFromCookie = await tenant.resolveTenantContext('empresa');
assert.equal(roleFromCookie.platformRole, 'ADMIN');
console.log('TD-26: sin fila de rol, cookie owner produce ADMIN pese a claim CONSTRUCTOR (dependencias simuladas).');
signedOrganizations = [];
cookieOrganizations = [{ id: 'org-ajena', slug: 'otra', role: 'owner' }];
const foreignOrganization = await tenant.resolveTenantContext('otra');
assert.equal(foreignOrganization.organizationId, 'org-ajena');
console.log('TD-26: claim organization_ids vacío admite organización de cookie sin filtro (precondición explícita).');

let queriedOrganizationIds;
const artifactAuth = load('apps/web/src/lib/server/artifact-action-auth.ts', {
  '@supabase/supabase-js': { createClient: () => ({ from: () => ({
    select() { return this; }, eq() { return this; },
    in(field, ids) { queriedOrganizationIds = ids; return this; },
    async maybeSingle() { return { data: { id: 'artefacto-simulado', organization_id: 'org-ajena' }, error: null }; },
  }) }) },
  'next/headers': { cookies: async () => ({ get: () => undefined }) },
  '@/utils/auth/session': {
    getAuthBridgeUser: async () => ({ id: 'usuario-prueba', organization_ids: ['org-propia'] }),
    getActiveOrganizationId: async () => 'org-ajena',
  },
  '@/lib/server/tenant-context': { resolveActiveTenantContext: async () => null, getOrganizationPlatformRole: async () => null },
  '@/lib/pipeline-constants': { REVIEWER_ROLE_SET: new Set(['ADMIN']) },
  '@/lib/server/env': { getSupabaseUrl: () => 'https://example.invalid', getSupabaseServiceRoleKey: () => 'valor-simulado' },
  './background-function-origin': { resolveBackgroundFunctionOrigin: () => 'https://example.invalid' },
});
assert.ok(await artifactAuth.getAuthorizedArtifactAdmin('artefacto-simulado'));
assert.ok(queriedOrganizationIds.includes('org-ajena'));
console.log('TD-26: sin TenantContext, cf_active_org ajena se agrega al filtro service-role pese a membresías firmadas solo propias; BD simulada.');

const { parseJsonRequest, parseJsonRequestOptional } = load('apps/web/src/lib/server/api-contract.ts');
for (const parser of [parseJsonRequest, parseJsonRequestOptional]) {
  let bytesRead = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (bytesRead >= 64 * 1024) return controller.close();
      bytesRead += 1024;
      controller.enqueue(new Uint8Array(1024).fill(32));
    },
  });
  const request = new Request('https://example.invalid', { method: 'POST', body, duplex: 'half' });
  assert.equal(request.headers.get('content-length'), null);
  const result = await parser(request, { safeParse: () => ({ success: false }) }, 1024);
  assert.equal(result.reason, 'too_large');
  assert.equal(bytesRead, 64 * 1024);
  console.log(`TD-27: ${parser.name} consume ${bytesRead} bytes antes de rechazar límite de 1024.`);
}
