import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TemplateCloudBuildService, sanitizeBuildError } from '../template-cloud-build.service';

function createSupabaseMock(options: {
  version?: Record<string, unknown> | null;
  existingBuild?: Record<string, unknown> | null;
} = {}) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const buildRecord = options.existingBuild || null;

  const supabase = {
    from(table: string) {
      const chain: any = {
        select() { return chain; },
        eq() { return chain; },
        in() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        insert(payload: Record<string, unknown>) {
          inserts.push({ table, payload });
          return {
            select() { return this; },
            single() {
              return Promise.resolve({
                data: { id: '11111111-1111-4111-8111-111111111111', ...payload },
                error: null,
              });
            },
          };
        },
        update(payload: Record<string, unknown>) {
          updates.push({ table, payload });
          return {
            eq() { return this; },
            select() { return this; },
            maybeSingle() {
              return Promise.resolve({
                data: { id: '11111111-1111-4111-8111-111111111111', ...payload },
                error: null,
              });
            },
          };
        },
        maybeSingle() {
          if (table === 'remotion_template_versions') {
            return Promise.resolve({ data: options.version || null, error: null });
          }
          if (table === 'remotion_template_builds') {
            return Promise.resolve({ data: buildRecord, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };

      return chain;
    },
  };

  return { supabase, updates, inserts };
}

describe('TemplateCloudBuildService', () => {
  it('reuses an existing render-ready build for an approved template version', async () => {
    const { supabase } = createSupabaseMock({
      version: {
        id: 'version-1',
        template_id: 'template-1',
        organization_id: 'org-1',
        status: 'APPROVED',
        storage_path: 'template-bundles/source.zip',
        bundle_hash: 'abc123',
        composition_id: 'custom-main',
        export_mode: 'component',
      },
      existingBuild: {
        id: 'build-1',
        status: 'BUILT',
        serve_url: 'https://cdn.example.com/build-1/index.html',
        provider_build_id: 'codebuild:build-1',
        build_log: 'Cloud build completed and validated successfully. remotionVersion=4.0.484',
      },
    });

    const result = await new TemplateCloudBuildService(supabase).startBuild('version-1');

    assert.equal(result.success, true);
    assert.equal(result.status, 'BUILT');
    assert.equal(result.serveUrl, 'https://cdn.example.com/build-1/index.html');
  });

  it('does not reuse legacy BUILT builds that were never validated as Remotion bundles', async () => {
    const { supabase, inserts } = createSupabaseMock({
      version: {
        id: 'version-legacy',
        template_id: 'template-legacy',
        organization_id: 'org-legacy',
        status: 'APPROVED',
        storage_path: 'template-bundles/source.zip',
        bundle_hash: 'legacy123',
        composition_id: 'custom-main',
        export_mode: 'component',
      },
      existingBuild: {
        id: 'legacy-build',
        status: 'BUILT',
        serve_url: 'https://cdn.example.com/legacy-build/index.html',
        provider_build_id: 'codebuild:legacy-build',
        build_log: 'Cloud build completed successfully.',
      },
    });
    const previousProject = process.env.REMOTION_TEMPLATE_CODEBUILD_PROJECT;
    delete process.env.REMOTION_TEMPLATE_CODEBUILD_PROJECT;
    delete process.env.AWS_CODEBUILD_PROJECT_NAME;

    const result = await new TemplateCloudBuildService(supabase).startBuild('version-legacy');

    process.env.REMOTION_TEMPLATE_CODEBUILD_PROJECT = previousProject;
    assert.equal(result.success, false);
    assert.equal(result.status, 'BUILD_FAILED');
    assert.equal(inserts.some((entry) => entry.table === 'remotion_template_builds'), true);
  });

  it('fails fast when CodeBuild is not configured for a new cloud build', async () => {
    const { supabase, updates, inserts } = createSupabaseMock({
      version: {
        id: 'version-2',
        template_id: 'template-2',
        organization_id: 'org-2',
        status: 'APPROVED',
        storage_path: 'template-bundles/source.zip',
        bundle_hash: 'def456',
        composition_id: 'custom-main',
        export_mode: 'component',
      },
    });
    const previousProject = process.env.REMOTION_TEMPLATE_CODEBUILD_PROJECT;
    delete process.env.REMOTION_TEMPLATE_CODEBUILD_PROJECT;
    delete process.env.AWS_CODEBUILD_PROJECT_NAME;

    const result = await new TemplateCloudBuildService(supabase).startBuild('version-2');

    process.env.REMOTION_TEMPLATE_CODEBUILD_PROJECT = previousProject;
    assert.equal(result.success, false);
    assert.equal(result.status, 'BUILD_FAILED');
    assert.equal(inserts.some((entry) => entry.table === 'remotion_template_builds'), true);
    assert.equal(updates.some((entry) => entry.table === 'remotion_template_builds' && entry.payload.status === 'BUILD_FAILED'), true);
    assert.match(result.error || '', /REMOTION_TEMPLATE_CODEBUILD_PROJECT/);
  });

  it('sanitizes build errors without leaking secrets', () => {
    const message = sanitizeBuildError('AWS_SECRET_ACCESS_KEY=super-secret failed');
    assert.equal(message.includes('super-secret'), false);
    assert.equal(message.includes('[redacted]'), true);
  });
});
