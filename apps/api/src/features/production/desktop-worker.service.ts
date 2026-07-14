import crypto from 'crypto';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { bundle } from '@remotion/bundler';
import JSZip from 'jszip';
import {
  buildAssemblyInputProps,
  resolveInternalCompositionId,
} from './remotion-assembly-props.service';
import { buildStableHash, resolveLocalRenderTimeoutMs } from './remotion-render.config';
import {
  buildRenderDiagnosticsSnapshot,
  classifyRemotionFailure,
} from './remotion-render-diagnostics.service';
import { mergeTemplateRenderConfigs } from './template-render-config.service';

const WORKER_TOKEN_PREFIX = 'swk_';
const LINK_CODE_PREFIX = 'SLIA-';
const TOKEN_BYTES = 32;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const BUNDLE_BUCKET = process.env.REMOTION_DESKTOP_WORKER_BUNDLE_BUCKET || 'production-videos';
const VIDEO_BUCKET = 'production-videos';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const INTERNAL_COMPOSITION_IDS = ['full-slides', 'split-avatar', 'avatar-focus'];

type SupabaseAnyClient = any;

export interface WorkerAuthContext {
  id: string;
  organizationId: string;
  status: string;
}

export interface RegisterWorkerInput {
  organizationId: string;
  userId: string;
  deviceName?: string;
  platform?: string;
  arch?: string;
  appVersion?: string;
}

export interface CreateWorkerLinkCodeInput {
  organizationId: string;
  userId: string;
  deviceName?: string;
  platform?: string;
  arch?: string;
  appVersion?: string;
}

export interface ConsumeWorkerLinkCodeInput {
  code: string;
  deviceName?: string;
  platform?: string;
  arch?: string;
  appVersion?: string;
}

export interface WorkerJobCompleteInput {
  outputStoragePath: string;
  checksum?: string;
  durationSeconds?: number;
  logsRef?: string;
}

let bundlePromise: Promise<{
  bundleHash: string;
  storagePath: string;
  signedUrl: string;
  bundleType: 'zip';
}> | null = null;

function sanitizeText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/swk_[A-Za-z0-9._~+/=-]+/gi, 'swk_[redacted]')
    .replace(/SLIA-\d{6}/gi, 'SLIA-[redacted]')
    .replace(/SUPABASE_SERVICE_ROLE_KEY=[^\s]+/gi, 'SUPABASE_SERVICE_ROLE_KEY=[redacted]')
    .slice(0, 1000);
}

function hashWorkerToken(token: string): string {
  const pepper = process.env.REMOTION_DESKTOP_WORKER_TOKEN_PEPPER || '';
  return crypto.createHash('sha256').update(`${pepper}:${token}`).digest('hex');
}

function normalizeLinkCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

function hashLinkCode(code: string): string {
  const pepper = process.env.REMOTION_DESKTOP_WORKER_LINK_CODE_PEPPER
    || process.env.REMOTION_DESKTOP_WORKER_TOKEN_PEPPER
    || '';
  return crypto.createHash('sha256').update(`${pepper}:${normalizeLinkCode(code)}`).digest('hex');
}

function generateWorkerToken(): string {
  return `${WORKER_TOKEN_PREFIX}${crypto.randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

function generateLinkCode(): string {
  const number = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  return `${LINK_CODE_PREFIX}${number}`;
}

function getLast4(token: string): string {
  return token.slice(-4);
}

function safeJobProgressEntry(params: {
  percent: number;
  message: string;
  stage: string;
  workerId: string;
}) {
  return {
    percent: Math.max(0, Math.min(100, Math.round(params.percent))),
    message: sanitizeText(params.message, 'Worker progress'),
    stage: sanitizeText(params.stage, 'desktop_worker'),
    provider: 'desktop_worker',
    workerId: params.workerId,
    timestamp: new Date().toISOString(),
  };
}

async function addDirectoryToZip(zip: JSZip, rootDir: string, currentDir = rootDir): Promise<void> {
  const entries = await fsp.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, rootDir, fullPath);
    } else if (entry.isFile()) {
      zip.file(relativePath, await fsp.readFile(fullPath));
    }
  }
}

async function hashDirectory(rootDir: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const files: string[] = [];

  async function collect(currentDir: string) {
    const entries = await fsp.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await collect(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await collect(rootDir);
  files.sort();
  for (const file of files) {
    const relativePath = path.relative(rootDir, file).replace(/\\/g, '/');
    hash.update(relativePath);
    hash.update(await fsp.readFile(file));
  }

  return hash.digest('hex');
}

export class DesktopWorkerService {
  constructor(private readonly supabase: SupabaseAnyClient) {}

  async listWorkers(organizationId: string) {
    const { data, error } = await this.supabase
      .from('render_workers')
      .select('id, organization_id, device_name, platform, arch, app_version, status, last_heartbeat_at, token_last4, created_at, updated_at')
      .eq('organization_id', organizationId)
      .neq('status', 'REVOKED')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`WORKER_LIST_FAILED: ${error.message}`);
    }

    return data || [];
  }

  async createLinkCode(input: CreateWorkerLinkCodeInput) {
    const code = generateLinkCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();

    const { data, error } = await this.supabase
      .from('render_worker_link_codes')
      .insert({
        organization_id: input.organizationId,
        created_by: input.userId,
        code_hash: hashLinkCode(code),
        code_last4: getLast4(code),
        device_name: sanitizeText(input.deviceName, ''),
        platform: sanitizeText(input.platform, ''),
        arch: sanitizeText(input.arch, ''),
        app_version: sanitizeText(input.appVersion, ''),
        expires_at: expiresAt,
      })
      .select('id, organization_id, code_last4, expires_at, created_at')
      .single();

    if (error || !data) {
      throw new Error(`WORKER_LINK_CODE_CREATE_FAILED: ${error?.message || 'Unknown error'}`);
    }

    return { linkCode: data, code };
  }

  async consumeLinkCode(input: ConsumeWorkerLinkCodeInput) {
    const normalizedCode = normalizeLinkCode(String(input.code || ''));
    if (!/^SLIA-\d{6}$/.test(normalizedCode)) {
      throw new Error('INVALID_LINK_CODE');
    }

    const { data: linkCode, error: linkCodeError } = await this.supabase
      .from('render_worker_link_codes')
      .select('*')
      .eq('code_hash', hashLinkCode(normalizedCode))
      .maybeSingle();

    if (linkCodeError || !linkCode) {
      throw new Error('LINK_CODE_NOT_FOUND');
    }
    if (linkCode.consumed_at) {
      throw new Error('LINK_CODE_ALREADY_CONSUMED');
    }
    if (new Date(linkCode.expires_at).getTime() < Date.now()) {
      throw new Error('LINK_CODE_EXPIRED');
    }

    const consumedAt = new Date().toISOString();
    const { data: consumedCode, error: reserveError } = await this.supabase
      .from('render_worker_link_codes')
      .update({ consumed_at: consumedAt })
      .eq('id', linkCode.id)
      .is('consumed_at', null)
      .select('id')
      .single();

    if (reserveError || !consumedCode) {
      throw new Error('LINK_CODE_ALREADY_CONSUMED');
    }

    const workerToken = generateWorkerToken();
    const { data: worker, error: workerError } = await this.supabase
      .from('render_workers')
      .insert({
        organization_id: linkCode.organization_id,
        device_name: sanitizeText(input.deviceName, linkCode.device_name || 'SofLIA Render Worker'),
        platform: sanitizeText(input.platform, linkCode.platform || process.platform),
        arch: sanitizeText(input.arch, linkCode.arch || process.arch),
        app_version: sanitizeText(input.appVersion, linkCode.app_version || 'dev'),
        token_hash: hashWorkerToken(workerToken),
        token_last4: getLast4(workerToken),
        status: 'LINKED',
        created_by: linkCode.created_by,
      })
      .select('id, organization_id, device_name, platform, arch, app_version, status, token_last4, created_at')
      .single();

    if (workerError || !worker) {
      throw new Error(`WORKER_LINK_FAILED: ${workerError?.message || 'Unknown error'}`);
    }

    const { error: consumeError } = await this.supabase
      .from('render_worker_link_codes')
      .update({
        consumed_by_worker_id: worker.id,
      })
      .eq('id', linkCode.id);

    if (consumeError) {
      throw new Error(`WORKER_LINK_CODE_CONSUME_FAILED: ${consumeError.message}`);
    }

    return { worker, workerToken };
  }

  async registerWorker(input: RegisterWorkerInput) {
    const workerToken = generateWorkerToken();
    const tokenHash = hashWorkerToken(workerToken);

    const { data, error } = await this.supabase
      .from('render_workers')
      .insert({
        organization_id: input.organizationId,
        device_name: sanitizeText(input.deviceName, 'SofLIA Render Worker'),
        platform: sanitizeText(input.platform, process.platform),
        arch: sanitizeText(input.arch, process.arch),
        app_version: sanitizeText(input.appVersion, 'dev'),
        token_hash: tokenHash,
        token_last4: getLast4(workerToken),
        status: 'LINKED',
        created_by: input.userId,
      })
      .select('id, organization_id, device_name, platform, arch, app_version, status, token_last4, created_at')
      .single();

    if (error || !data) {
      throw new Error(`WORKER_REGISTER_FAILED: ${error?.message || 'Unknown error'}`);
    }

    return { worker: data, workerToken };
  }

  async authenticateWorkerToken(token: string | undefined): Promise<WorkerAuthContext | null> {
    if (!token?.startsWith(WORKER_TOKEN_PREFIX)) return null;

    const { data, error } = await this.supabase
      .from('render_workers')
      .select('id, organization_id, status')
      .eq('token_hash', hashWorkerToken(token))
      .maybeSingle();

    if (error || !data || data.status === 'REVOKED') {
      return null;
    }

    return {
      id: data.id,
      organizationId: data.organization_id,
      status: data.status,
    };
  }

  async heartbeat(worker: WorkerAuthContext, input: Record<string, unknown>) {
    const status = input.status === 'BUSY' ? 'BUSY' : 'ONLINE';
    const { data, error } = await this.supabase
      .from('render_workers')
      .update({
        status,
        platform: sanitizeText(input.platform, undefined as unknown as string),
        arch: sanitizeText(input.arch, undefined as unknown as string),
        app_version: sanitizeText(input.appVersion, undefined as unknown as string),
        last_heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', worker.id)
      .select('id, organization_id, status, last_heartbeat_at')
      .single();

    if (error || !data) {
      throw new Error(`WORKER_HEARTBEAT_FAILED: ${error?.message || 'Unknown error'}`);
    }

    return data;
  }

  async claimJob(worker: WorkerAuthContext, jobId: string) {
    const { data: job, error: jobError } = await this.supabase
      .from('production_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (jobError || !job) {
      throw new Error('JOB_NOT_FOUND');
    }
    this.assertWorkerCanAccessJob(worker, job);

    const snapshot = job.input_snapshot || {};
    const resolved = await this.resolveWorkerRenderInput(job, snapshot);
    const outputStoragePath = `completed/${job.material_component_id || job.id}/${job.id}-${Date.now()}.mp4`;
    const { data: signedUpload, error: signedUploadError } = await this.supabase.storage
      .from(VIDEO_BUCKET)
      .createSignedUploadUrl(outputStoragePath);
    if (signedUploadError || !signedUpload?.signedUrl) {
      throw new Error(`OUTPUT_UPLOAD_URL_FAILED: ${signedUploadError?.message || 'Unknown error'}`);
    }

    const { data: updatedJob, error: updateError } = await this.supabase
      .from('production_jobs')
      .update({
        status: 'RUNNING',
        worker_id: worker.id,
        claimed_at: new Date().toISOString(),
        worker_heartbeat_at: new Date().toISOString(),
        started_at: job.started_at || new Date().toISOString(),
        input_snapshot: {
          ...snapshot,
          renderProvider: 'desktop_worker',
          renderMode: resolved.renderMode,
          compositionId: resolved.compositionId,
          propsHash: resolved.propsHash,
          resolvedProps: resolved.resolvedProps,
          desktopBundleHash: resolved.bundle.bundleHash,
          desktopBundleStoragePath: resolved.bundle.storagePath,
          desktopBundleType: resolved.bundle.bundleType,
          externalServeUrl: resolved.bundle.bundleType === 'serve_url' ? resolved.bundle.signedUrl : snapshot.externalServeUrl || null,
          renderDiagnostics: resolved.renderDiagnostics,
        },
        progress: [safeJobProgressEntry({
          percent: 5,
          message: 'Worker local tomo el job',
          stage: 'desktop_worker_claimed',
          workerId: worker.id,
        })],
      })
      .eq('id', jobId)
      .select('*')
      .single();

    if (updateError || !updatedJob) {
      throw new Error(`JOB_CLAIM_FAILED: ${updateError?.message || 'Unknown error'}`);
    }

    await this.supabase
      .from('render_workers')
      .update({
        status: 'BUSY',
        last_heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', worker.id);

    return {
      jobId,
      compositionId: resolved.compositionId,
      resolvedProps: resolved.resolvedProps,
      propsHash: resolved.propsHash,
      bundleUrl: resolved.bundle.signedUrl,
      bundleHash: resolved.bundle.bundleHash,
      bundleType: resolved.bundle.bundleType,
      outputUploadUrl: signedUpload.signedUrl,
      outputStoragePath,
      timeoutInMilliseconds: resolveLocalRenderTimeoutMs(),
    };
  }

  async claimNextJob(worker: WorkerAuthContext) {
    const { data: jobs, error } = await this.supabase
      .from('production_jobs')
      .select('*')
      .eq('organization_id', worker.organizationId)
      .eq('job_type', 'REMOTION_RENDER')
      .in('status', ['PENDING', 'QUEUED', 'WAITING_PROVIDER'])
      .order('created_at', { ascending: true })
      .limit(20);

    if (error) {
      throw new Error(`JOB_NEXT_LOOKUP_FAILED: ${error.message}`);
    }

    const nextJob = (jobs || []).find((job: any) =>
      job.input_snapshot?.renderProvider === 'desktop_worker' &&
      (!job.worker_id || job.worker_id === worker.id),
    );

    if (!nextJob) {
      await this.heartbeat(worker, { status: 'ONLINE' });
      return null;
    }

    return this.claimJob(worker, nextJob.id);
  }

  async reportProgress(worker: WorkerAuthContext, jobId: string, input: Record<string, unknown>) {
    const job = await this.getAuthorizedWorkerJob(worker, jobId);
    const currentProgress = Array.isArray(job.progress) ? job.progress : [];
    const progress = [
      ...currentProgress.slice(-19),
      safeJobProgressEntry({
        percent: Number(input.percent),
        message: sanitizeText(input.message, 'Renderizando en worker local'),
        stage: sanitizeText(input.stage, 'desktop_worker_progress'),
        workerId: worker.id,
      }),
    ];

    const { error } = await this.supabase
      .from('production_jobs')
      .update({
        progress,
        worker_heartbeat_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    if (error) {
      throw new Error(`JOB_PROGRESS_FAILED: ${error.message}`);
    }

    await this.heartbeat(worker, { status: 'BUSY' });
    return { ok: true };
  }

  async completeJob(worker: WorkerAuthContext, jobId: string, input: WorkerJobCompleteInput) {
    const job = await this.getAuthorizedWorkerJob(worker, jobId);
    if (!input.outputStoragePath || !input.outputStoragePath.startsWith('completed/')) {
      throw new Error('INVALID_OUTPUT_STORAGE_PATH');
    }

    const {
      data: { publicUrl },
    } = this.supabase.storage.from(VIDEO_BUCKET).getPublicUrl(input.outputStoragePath);

    const duration = Number.isFinite(input.durationSeconds)
      ? Math.max(1, Math.round(input.durationSeconds || 0))
      : this.deriveDurationFromJob(job);

    const { data: component } = await this.supabase
      .from('material_components')
      .select('assets')
      .eq('id', job.material_component_id)
      .maybeSingle();
    const assets = component?.assets || {};
    await this.supabase
      .from('material_components')
      .update({
        assets: {
          ...assets,
          final_video_url: publicUrl,
          final_video_source: 'desktop_worker',
          final_video_storage_provider: 'supabase',
          final_video_storage_path: input.outputStoragePath,
          video_duration: duration,
          production_status: 'COMPLETED',
          updated_at: new Date().toISOString(),
        },
      })
      .eq('id', job.material_component_id);

    await this.syncFinalVideoToPublicationRequest({
      artifactId: job.artifact_id || null,
      materialLessonId: job.material_lesson_id || null,
      lessonId: job.lesson_id || null,
      finalVideoUrl: publicUrl,
      duration,
    });

    const outputSnapshot = {
      ...(job.output_snapshot || {}),
      final_video_url: publicUrl,
      completed: true,
      renderProvider: 'desktop_worker',
      renderMode: job.input_snapshot?.renderMode || 'INTERNAL_COMPOSITION',
      propsHash: job.input_snapshot?.propsHash || null,
      bundleHash: job.input_snapshot?.desktopBundleHash || job.input_snapshot?.bundleHash || null,
      outputStoragePath: input.outputStoragePath,
      outputChecksum: sanitizeText(input.checksum, ''),
      logsRef: sanitizeText(input.logsRef, ''),
    };

    const { error } = await this.supabase
      .from('production_jobs')
      .update({
        status: 'SUCCEEDED',
        progress: [safeJobProgressEntry({
          percent: 100,
          message: 'Ensamblado completado exitosamente en worker local',
          stage: 'desktop_worker_completed',
          workerId: worker.id,
        })],
        completed_at: new Date().toISOString(),
        worker_heartbeat_at: new Date().toISOString(),
        output_checksum: outputSnapshot.outputChecksum || null,
        logs_ref: outputSnapshot.logsRef || null,
        output_snapshot: outputSnapshot,
      })
      .eq('id', jobId);

    if (error) {
      throw new Error(`JOB_COMPLETE_FAILED: ${error.message}`);
    }

    await this.heartbeat(worker, { status: 'ONLINE' });
    return { finalVideoUrl: publicUrl, durationSeconds: duration };
  }

  async failJob(worker: WorkerAuthContext, jobId: string, input: Record<string, unknown>) {
    const job = await this.getAuthorizedWorkerJob(worker, jobId);
    const message = sanitizeText(input.message, 'El worker local no pudo completar el render');
    const code = sanitizeText(input.errorCode, '') || classifyRemotionFailure(message, {
      provider: 'desktop_worker',
      stage: sanitizeText(input.stage, 'desktop_worker'),
    });

    await this.supabase
      .from('production_jobs')
      .update({
        status: 'FAILED',
        failed_at: new Date().toISOString(),
        worker_heartbeat_at: new Date().toISOString(),
        provider_error: {
          code,
          message,
          renderProvider: 'desktop_worker',
          stage: sanitizeText(input.stage, 'desktop_worker'),
          workerId: worker.id,
        },
      })
      .eq('id', jobId);

    if (job.material_component_id) {
      const { data: component } = await this.supabase
        .from('material_components')
        .select('assets')
        .eq('id', job.material_component_id)
        .maybeSingle();
      await this.supabase
        .from('material_components')
        .update({
          assets: {
            ...(component?.assets || {}),
            production_status: 'FAILED',
            updated_at: new Date().toISOString(),
          },
        })
        .eq('id', job.material_component_id);
    }

    await this.heartbeat(worker, { status: 'ONLINE' });
    return { ok: true };
  }

  private assertWorkerCanAccessJob(worker: WorkerAuthContext, job: any) {
    if (job.organization_id !== worker.organizationId) {
      throw new Error('JOB_FORBIDDEN_FOR_WORKER');
    }
    if (job.job_type !== 'REMOTION_RENDER') {
      throw new Error('JOB_TYPE_NOT_SUPPORTED');
    }
    if (job.input_snapshot?.renderProvider !== 'desktop_worker') {
      throw new Error('JOB_PROVIDER_NOT_DESKTOP_WORKER');
    }
    if (!['PENDING', 'QUEUED', 'WAITING_PROVIDER', 'RUNNING'].includes(job.status)) {
      throw new Error('JOB_NOT_CLAIMABLE');
    }
    if (job.worker_id && job.worker_id !== worker.id) {
      throw new Error('JOB_ALREADY_CLAIMED_BY_ANOTHER_WORKER');
    }
  }

  private async getAuthorizedWorkerJob(worker: WorkerAuthContext, jobId: string) {
    const { data: job, error } = await this.supabase
      .from('production_jobs')
      .select('*')
      .eq('id', jobId)
      .single();

    if (error || !job) {
      throw new Error('JOB_NOT_FOUND');
    }
    this.assertWorkerCanAccessJob(worker, job);
    return job;
  }

  private async resolveWorkerRenderInput(job: any, snapshot: Record<string, any>) {
    const componentId = job.material_component_id;
    const templateId = snapshot.templateId;
    const externalServeUrl = typeof snapshot.externalServeUrl === 'string' ? snapshot.externalServeUrl.trim() : '';
    const isExternalDesktopRender =
      snapshot.renderMode === 'EXTERNAL_DESKTOP_SITE_READY' ||
      (externalServeUrl && /^https:\/\//i.test(externalServeUrl));

    if (isExternalDesktopRender) {
      if (!/^https:\/\//i.test(externalServeUrl)) {
        throw new Error('EXTERNAL_DESKTOP_SERVE_URL_INVALID');
      }
      if (typeof snapshot.compositionId !== 'string' || !snapshot.compositionId.trim()) {
        throw new Error('EXTERNAL_DESKTOP_COMPOSITION_ID_MISSING');
      }
      if (!snapshot.resolvedProps || typeof snapshot.resolvedProps !== 'object' || Array.isArray(snapshot.resolvedProps)) {
        throw new Error('EXTERNAL_DESKTOP_PROPS_MISSING');
      }

      const propsHash = typeof snapshot.propsHash === 'string' && snapshot.propsHash
        ? snapshot.propsHash
        : buildStableHash(snapshot.resolvedProps);
      return {
        renderMode: 'EXTERNAL_DESKTOP_SITE_READY',
        compositionId: snapshot.compositionId,
        resolvedProps: snapshot.resolvedProps,
        propsHash,
        bundle: {
          signedUrl: externalServeUrl,
          bundleHash: snapshot.bundleHash || snapshot.buildHash || snapshot.buildId || 'external-desktop-site',
          storagePath: snapshot.externalServeUrl || '',
          bundleType: 'serve_url' as const,
        },
        renderDiagnostics: snapshot.renderDiagnostics || buildRenderDiagnosticsSnapshot({
          renderProvider: 'desktop_worker',
          renderMode: 'EXTERNAL_DESKTOP_SITE_READY',
          inputProps: snapshot.resolvedProps,
          rawAssets: {},
          templateId,
          templateVersionId: snapshot.templateVersionId || null,
          buildId: snapshot.buildId || null,
          bundleHash: snapshot.bundleHash || null,
          buildHash: snapshot.buildHash || null,
          compositionId: snapshot.compositionId,
          propsHash,
          timeoutInMilliseconds: resolveLocalRenderTimeoutMs(),
        }),
      };
    }

    const { data: component, error: compError } = await this.supabase
      .from('material_components')
      .select('*')
      .eq('id', componentId)
      .single();
    if (compError || !component) {
      throw new Error(`COMPONENT_NOT_FOUND: ${compError?.message || 'Unknown error'}`);
    }

    const { data: template, error: tplError } = await this.supabase
      .from('remotion_templates')
      .select('*')
      .eq('id', templateId)
      .single();
    if (tplError || !template) {
      throw new Error(`TEMPLATE_NOT_FOUND: ${tplError?.message || 'Unknown error'}`);
    }

    const compositionId = resolveInternalCompositionId(template.composition_id);
    const templateConfig = mergeTemplateRenderConfigs(
      template.default_config,
      snapshot.variables?.templateConfig,
    );
    const resolvedProps = buildAssemblyInputProps({
      assets: component.assets || {},
      compositionId,
      transitionType: snapshot.variables?.transitionType,
      templateConfig,
    });
    const propsHash = buildStableHash(resolvedProps);
    const bundleInfo = await this.publishInternalBundle();
    const renderDiagnostics = buildRenderDiagnosticsSnapshot({
      renderProvider: 'desktop_worker',
      renderMode: 'INTERNAL_COMPOSITION',
      inputProps: resolvedProps,
      rawAssets: component.assets || {},
      templateId,
      templateVersionId: snapshot.templateVersionId || null,
      bundleHash: snapshot.bundleHash || null,
      buildHash: snapshot.buildHash || null,
      compositionId,
      propsHash,
      timeoutInMilliseconds: resolveLocalRenderTimeoutMs(),
    });

    return {
      renderMode: 'INTERNAL_COMPOSITION',
      compositionId,
      resolvedProps,
      propsHash,
      bundle: bundleInfo,
      renderDiagnostics,
    };
  }

  private async publishInternalBundle() {
    if (!bundlePromise) {
      bundlePromise = this.createAndUploadBundle().catch((error) => {
        bundlePromise = null;
        throw error;
      });
    }
    const current = await bundlePromise;
    const { data: signed, error } = await this.supabase.storage
      .from(BUNDLE_BUCKET)
      .createSignedUrl(current.storagePath, SIGNED_URL_TTL_SECONDS);
    if (error || !signed?.signedUrl) {
      throw new Error(`BUNDLE_SIGNED_URL_FAILED: ${error?.message || 'Unknown error'}`);
    }
    return { ...current, signedUrl: signed.signedUrl, bundleType: 'zip' as const };
  }

  private async createAndUploadBundle() {
    const outDir = path.join(os.tmpdir(), `soflia-desktop-worker-bundle-${process.pid}`);
    const entryPoint = this.resolveEntryPoint();
    await fsp.rm(outDir, { recursive: true, force: true });
    await bundle({ entryPoint, outDir });
    const bundleHash = await hashDirectory(outDir);
    const storagePath = `remotion-bundles/internal/${bundleHash}.zip`;
    const zip = new JSZip();
    zip.file('soflia-worker-bundle.json', JSON.stringify({
      bundleHash,
      compositionIds: INTERNAL_COMPOSITION_IDS,
      createdAt: new Date().toISOString(),
    }, null, 2));
    await addDirectoryToZip(zip, outDir);
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    const { error } = await this.supabase.storage
      .from(BUNDLE_BUCKET)
      .upload(storagePath, zipBuffer, {
        contentType: 'application/zip',
        upsert: true,
      });
    if (error) {
      throw new Error(`BUNDLE_UPLOAD_FAILED: ${error.message}`);
    }

    await fsp.rm(outDir, { recursive: true, force: true });
    return { bundleHash, storagePath, signedUrl: '', bundleType: 'zip' as const };
  }

  private resolveEntryPoint(): string {
    const fromEnv = process.env.REMOTION_ENTRY_POINT;
    const entryPoint = fromEnv
      ? path.resolve(fromEnv)
      : path.resolve(process.cwd(), '../web/src/remotion/index.ts');

    if (!fs.existsSync(entryPoint)) {
      throw new Error(
        `REMOTION_ENTRY_POINT_NOT_FOUND: configure REMOTION_ENTRY_POINT with apps/web/src/remotion/index.ts. Tried "${entryPoint}".`,
      );
    }
    return entryPoint;
  }

  private deriveDurationFromJob(job: any): number {
    const props = job.input_snapshot?.resolvedProps;
    const frames = Number(props?.totalDurationInFrames);
    const fps = Number(props?.fps);
    if (Number.isFinite(frames) && Number.isFinite(fps) && frames > 0 && fps > 0) {
      return Math.round(frames / fps);
    }
    return 0;
  }

  private async syncFinalVideoToPublicationRequest(params: {
    artifactId: string | null;
    materialLessonId: string | null;
    lessonId: string | null;
    finalVideoUrl: string;
    duration: number;
  }): Promise<void> {
    if (!params.artifactId || !params.lessonId || !params.finalVideoUrl) return;

    let lessonTitle = params.lessonId;
    let moduleTitle = '';

    if (params.materialLessonId) {
      const { data: lesson } = await this.supabase
        .from('material_lessons')
        .select('lesson_id, lesson_title, module_title')
        .eq('id', params.materialLessonId)
        .maybeSingle();

      lessonTitle = lesson?.lesson_title || lessonTitle;
      moduleTitle = lesson?.module_title || '';
    }

    const { data: existingRequest } = await this.supabase
      .from('publication_requests')
      .select('id, lesson_videos')
      .eq('artifact_id', params.artifactId)
      .maybeSingle();

    const currentLessonVideos =
      (existingRequest?.lesson_videos as Record<string, unknown> | null) || {};
    const nextLessonVideos = {
      ...currentLessonVideos,
      [params.lessonId]: {
        lesson_id: params.lessonId,
        lesson_title: lessonTitle,
        module_title: moduleTitle,
        video_provider: 'direct',
        video_id: params.finalVideoUrl,
        duration: params.duration,
      },
    };

    if (existingRequest?.id) {
      await this.supabase
        .from('publication_requests')
        .update({
          lesson_videos: nextLessonVideos,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingRequest.id);
      return;
    }

    await this.supabase
      .from('publication_requests')
      .insert({
        artifact_id: params.artifactId,
        lesson_videos: nextLessonVideos,
        status: 'DRAFT',
        updated_at: new Date().toISOString(),
      });
  }
}
