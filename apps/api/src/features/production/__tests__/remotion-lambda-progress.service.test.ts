import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RemotionLambdaProgressService } from '../remotion-lambda-progress.service';

function createSupabaseMock(options: { componentAssets?: Record<string, unknown> } = {}) {
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const uploads: Array<{ path: string; body: Buffer; options: Record<string, unknown> }> = [];

  const supabase = {
    storage: {
      from(bucket: string) {
        return {
          upload(path: string, body: Buffer, uploadOptions: Record<string, unknown>) {
            uploads.push({ path, body, options: { ...uploadOptions, bucket } });
            return Promise.resolve({ error: null });
          },
          getPublicUrl(path: string) {
            return {
              data: {
                publicUrl: `https://storage.example.com/${bucket}/${path}`,
              },
            };
          },
        };
      },
    },
    from(table: string) {
      const chain = {
        select() {
          return chain;
        },
        update(payload: Record<string, unknown>) {
          updates.push({ table, payload });
          return chain;
        },
        insert(payload: Record<string, unknown>) {
          updates.push({ table, payload });
          return chain;
        },
        eq() {
          return chain;
        },
        maybeSingle() {
          if (table === 'material_components') {
            return Promise.resolve({ data: { assets: options.componentAssets || {} } });
          }
          return Promise.resolve({ data: null });
        },
      };

      return chain;
    },
  };

  return { supabase, updates, uploads };
}

describe('RemotionLambdaProgressService', () => {
  it('completes Lambda jobs with a browser-playable URL and preserved progress history', async () => {
    const service = new RemotionLambdaProgressService();
    const { supabase, updates } = createSupabaseMock({ componentAssets: { existing: true } });
    const job = {
      id: 'job-1',
      material_component_id: 'component-1',
      progress: [{ percent: 20, message: 'Render aceptado', timestamp: '2026-06-30T00:00:00.000Z' }],
      input_snapshot: { renderProvider: 'lambda' },
      output_snapshot: { renderProvider: 'lambda', bucketName: 'bucket-a' },
    };

    await service.completeLambdaJob(supabase, job, {
      renderId: 'render-1',
      providerJobId: 'render-1',
      outputUrl: 'https://cdn.example.com/render.mp4',
      outputStoragePath: 's3://bucket-a/render.mp4',
    });

    const componentUpdate = updates.find((entry) => entry.table === 'material_components')?.payload;
    const jobUpdate = updates.find((entry) => entry.table === 'production_jobs')?.payload;

    assert.equal((componentUpdate?.assets as any).final_video_url, 'https://cdn.example.com/render.mp4');
    assert.equal((jobUpdate?.output_snapshot as any).outputUrl, 'https://cdn.example.com/render.mp4');
    assert.equal(Array.isArray(jobUpdate?.progress), true);
    assert.equal((jobUpdate?.progress as any[]).length, 2);
    assert.equal((jobUpdate?.progress as any[])[1].stage, 'completed');
  });

  it('fails Lambda jobs as OUTPUT_NOT_ACCESSIBLE when completion has no playable output', async () => {
    const service = new RemotionLambdaProgressService();
    const { supabase, updates } = createSupabaseMock();
    const job = {
      id: 'job-2',
      material_component_id: 'component-2',
      progress: [{ percent: 95, message: 'Render casi listo', timestamp: '2026-06-30T00:00:00.000Z' }],
      input_snapshot: { renderProvider: 'lambda' },
      output_snapshot: { renderProvider: 'lambda' },
    };

    await service.completeLambdaJob(supabase, job, {
      renderId: 'render-2',
      providerJobId: 'render-2',
      outputUrl: null,
      outputStoragePath: null,
    });

    const jobUpdate = updates.find((entry) => entry.table === 'production_jobs')?.payload;

    assert.equal(jobUpdate?.status, 'FAILED');
    assert.equal((jobUpdate?.provider_error as any).code, 'OUTPUT_NOT_ACCESSIBLE');
    assert.equal((jobUpdate?.progress as any[]).length, 2);
  });

  it('copies private S3 Lambda outputs into production-videos before saving final_video_url', async () => {
    const service = new RemotionLambdaProgressService();
    (service as any).loadS3Client = () => ({
      S3Client: class {
        send() {
          return Promise.resolve({ Body: Buffer.from('fake-video') });
        }
      },
      GetObjectCommand: class {
        constructor(readonly params: Record<string, unknown>) {}
      },
    });

    const { supabase, updates, uploads } = createSupabaseMock();
    const job = {
      id: 'job-3',
      material_component_id: 'component-3',
      progress: [{ percent: 20, message: 'Render aceptado', timestamp: '2026-06-30T00:00:00.000Z' }],
      input_snapshot: { renderProvider: 'lambda', bucketName: 'lambda-bucket' },
      output_snapshot: { renderProvider: 'lambda', bucketName: 'lambda-bucket' },
    };

    await service.completeLambdaJob(supabase, job, {
      renderId: 'render-3',
      providerJobId: 'render-3',
      outputUrl: 'https://s3.us-east-2.amazonaws.com/lambda-bucket/remotion-renders/job-3.mp4',
      outputStoragePath: null,
    });

    const componentUpdate = updates.find((entry) => entry.table === 'material_components')?.payload;
    const jobUpdate = updates.find((entry) => entry.table === 'production_jobs')?.payload;

    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].path, 'completed/component-3.mp4');
    assert.equal((componentUpdate?.assets as any).final_video_url, 'https://storage.example.com/production-videos/completed/component-3.mp4');
    assert.equal((componentUpdate?.assets as any).final_video_storage_provider, 'supabase');
    assert.equal((jobUpdate?.output_snapshot as any).sourceStoragePath, 's3://lambda-bucket/remotion-renders/job-3.mp4');
  });
});
