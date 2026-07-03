import { createHash, randomUUID } from 'crypto';

type SupabaseClientLike = any;

type BuildStatus = 'BUILDING' | 'BUILT' | 'BUILD_FAILED';

export interface TemplateCloudBuildStartResult {
  success: boolean;
  buildId?: string;
  status?: BuildStatus;
  providerBuildId?: string | null;
  serveUrl?: string | null;
  message?: string;
  error?: string;
}

export interface TemplateCloudBuildStatusResult {
  success: boolean;
  buildId?: string;
  status?: BuildStatus;
  providerStatus?: string | null;
  providerStatusDetail?: string | null;
  providerBuildId?: string | null;
  serveUrl?: string | null;
  buildOutputStoragePath?: string | null;
  buildLogStoragePath?: string | null;
  error?: string;
}

interface CodeBuildModule {
  CodeBuildClient: new (params: Record<string, unknown>) => { send(command: unknown): Promise<any> };
  StartBuildCommand: new (params: Record<string, unknown>) => unknown;
  BatchGetBuildsCommand: new (params: Record<string, unknown>) => unknown;
}

interface S3ClientModule {
  S3Client: new (params: Record<string, unknown>) => { send(command: unknown): Promise<any> };
  PutObjectCommand: new (params: Record<string, unknown>) => unknown;
}

interface TemplateVersionRecord {
  id: string;
  template_id: string;
  organization_id: string;
  status: string;
  storage_path: string;
  bundle_hash: string | null;
  entry_point: string | null;
  composition_id: string | null;
  composition_ids?: string[] | null;
  export_mode?: 'component' | 'root' | null;
  manifest?: Record<string, unknown> | null;
}

const CLOUD_PROVIDER = 'aws-codebuild';
const COURSEFORGE_REMOTION_VERSION = '4.0.484';
const SECURITY_PROFILE = {
  isolation: 'codebuild-ephemeral',
  secrets: 'none-from-courseforge',
  network: 'restricted-by-codebuild-project',
  artifactContract: 'lambda-site-url',
};

export class TemplateCloudBuildService {
  constructor(private readonly supabase: SupabaseClientLike) {}

  async startBuild(templateVersionId: string): Promise<TemplateCloudBuildStartResult> {
    const version = await this.getVersion(templateVersionId);
    if (!version) {
      return { success: false, error: 'Template version not found.' };
    }

    if (version.status !== 'APPROVED' && version.status !== 'APPROVED_FOR_SANDBOX') {
      return {
        success: false,
        error: `Template version must be APPROVED before cloud build. Current status: ${version.status}.`,
      };
    }

    const bundleHash = version.bundle_hash;
    const compositionId = version.composition_id || this.readManifestString(version.manifest, 'compositionId');
    if (!bundleHash || !compositionId) {
      return { success: false, error: 'Template version is missing bundle_hash or composition_id.' };
    }

    const reusableBuild = await this.findReusableBuild({
      templateVersionId,
      bundleHash,
      compositionId,
      exportMode: version.export_mode === 'root' ? 'root' : 'component',
    });

    if (this.isValidatedReusableBuild(reusableBuild)) {
      return {
        success: true,
        buildId: reusableBuild.id,
        status: 'BUILT',
        providerBuildId: reusableBuild.provider_build_id || null,
        serveUrl: reusableBuild.serve_url,
        message: 'Cloud build already available.',
      };
    }

    const buildRecord = reusableBuild?.status === 'BUILDING'
      ? reusableBuild
      : await this.createBuildRecord(version, { bundleHash, compositionId });

    if (!buildRecord?.id) {
      return { success: false, error: 'Could not create cloud build record.' };
    }

    if (buildRecord.provider_build_id) {
      return {
        success: true,
        buildId: buildRecord.id,
        status: 'BUILDING',
        providerBuildId: buildRecord.provider_build_id,
        serveUrl: buildRecord.serve_url || null,
        message: 'Cloud build already running.',
      };
    }

    try {
      this.requireCodeBuildProjectName();
      const sourceStoragePath = await this.prepareSourceZip(version, buildRecord.id, bundleHash);
      await this.updateBuildSourceStoragePath(buildRecord.id, sourceStoragePath);
      const providerBuildId = await this.startCodeBuild(version, buildRecord.id, {
        bundleHash,
        compositionId,
        sourceStoragePath,
      });
      await this.markBuildStarted(buildRecord.id, providerBuildId);

      return {
        success: true,
        buildId: buildRecord.id,
        status: 'BUILDING',
        providerBuildId,
        message: 'Cloud build started.',
      };
    } catch (error) {
      const message = sanitizeBuildError(error);
      await this.markBuildFailed(buildRecord.id, message, 'START_FAILED');
      return { success: false, buildId: buildRecord.id, status: 'BUILD_FAILED', error: message };
    }
  }

  async getBuildStatus(buildId: string): Promise<TemplateCloudBuildStatusResult> {
    const build = await this.getBuild(buildId);
    if (!build) {
      return { success: false, error: 'Cloud build not found.' };
    }

    if (build.status !== 'BUILDING' || !build.provider_build_id) {
      return this.toStatusResult(build);
    }

    try {
      const providerBuild = await this.getCodeBuildStatus(build.provider_build_id);
      if (!providerBuild) {
        return this.toStatusResult(build);
      }

      const providerStatus = typeof providerBuild.buildStatus === 'string' ? providerBuild.buildStatus : null;
      if (providerStatus === 'SUCCEEDED') {
        const completedBuild = await this.markBuildSucceeded(build, providerStatus);
        return this.toStatusResult(completedBuild || build);
      }

      if (providerStatus && ['FAILED', 'FAULT', 'STOPPED', 'TIMED_OUT'].includes(providerStatus)) {
        const detail = this.extractProviderStatusDetail(providerBuild);
        const failedBuild = await this.markBuildFailed(build.id, detail, providerStatus);
        return this.toStatusResult(failedBuild || build);
      }

      const updated = await this.updateBuildProviderStatus(build.id, providerStatus || 'IN_PROGRESS', null);
      return this.toStatusResult(updated || build);
    } catch (error) {
      const message = sanitizeBuildError(error);
      const updated = await this.updateBuildProviderStatus(build.id, 'SYNC_ERROR', message);
      return this.toStatusResult(updated || build);
    }
  }

  private async getVersion(templateVersionId: string): Promise<TemplateVersionRecord | null> {
    const { data, error } = await this.supabase
      .from('remotion_template_versions')
      .select('*')
      .eq('id', templateVersionId)
      .maybeSingle();

    if (error || !data) return null;
    return data as TemplateVersionRecord;
  }

  private async getBuild(buildId: string): Promise<any | null> {
    const { data, error } = await this.supabase
      .from('remotion_template_builds')
      .select('*')
      .eq('id', buildId)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  }

  private async findReusableBuild(params: {
    templateVersionId: string;
    bundleHash: string;
    compositionId: string;
    exportMode: 'component' | 'root';
  }): Promise<any | null> {
    const { data } = await this.supabase
      .from('remotion_template_builds')
      .select('*')
      .eq('template_version_id', params.templateVersionId)
      .eq('bundle_hash', params.bundleHash)
      .eq('composition_id', params.compositionId)
      .eq('export_mode', params.exportMode)
      .in('status', ['BUILDING', 'BUILT'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return data || null;
  }

  private async createBuildRecord(
    version: TemplateVersionRecord,
    params: { bundleHash: string; compositionId: string },
  ): Promise<any | null> {
    const buildId = randomUUID();
    const exportMode = version.export_mode === 'root' ? 'root' : 'component';
    const compositionIds = Array.from(new Set([params.compositionId, ...(version.composition_ids || [])]));
    const sourceStoragePath = this.buildSourceStoragePath(version.id, params.bundleHash);
    const buildOutputStoragePath = this.buildOutputStoragePath(buildId);
    const buildLogStoragePath = this.buildLogStoragePath(buildId);

    const { data, error } = await this.supabase
      .from('remotion_template_builds')
      .insert({
        id: buildId,
        template_version_id: version.id,
        organization_id: version.organization_id,
        status: 'BUILDING',
        bundle_hash: params.bundleHash,
        entrypoint_path: version.entry_point || this.readManifestString(version.manifest, 'entryPoint'),
        source_storage_path: sourceStoragePath,
        build_output_storage_path: buildOutputStoragePath,
        composition_id: params.compositionId,
        composition_ids: compositionIds,
        export_mode: exportMode,
        cloud_provider: CLOUD_PROVIDER,
        site_name: this.buildSiteName(buildId, params.bundleHash),
        region: this.getCodeBuildRegion(),
        build_log_storage_path: buildLogStoragePath,
        security_profile: SECURITY_PROFILE,
        build_log: 'Cloud build queued.',
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error || !data) return null;

    await this.supabase
      .from('remotion_template_versions')
      .update({ build_status: 'BUILDING' })
      .eq('id', version.id);

    return data;
  }

  private async startCodeBuild(
    version: TemplateVersionRecord,
    buildId: string,
    params: { bundleHash: string; compositionId: string; sourceStoragePath: string },
  ): Promise<string> {
    const projectName = process.env.REMOTION_TEMPLATE_CODEBUILD_PROJECT || process.env.AWS_CODEBUILD_PROJECT_NAME;
    if (!projectName?.trim()) {
      throw new Error('REMOTION_TEMPLATE_CODEBUILD_PROJECT is required to start cloud template builds.');
    }

    const module = this.loadCodeBuildModule();
    const client = new module.CodeBuildClient({ region: this.getCodeBuildRegion() });
    const buildOutputStoragePath = this.buildOutputStoragePath(buildId);
    const buildLogStoragePath = this.buildLogStoragePath(buildId);
    const publicBaseUrl = process.env.REMOTION_TEMPLATE_BUILD_PUBLIC_BASE_URL || '';

    const command = new module.StartBuildCommand({
      projectName,
      environmentVariablesOverride: [
        { name: 'COURSEFORGE_TEMPLATE_VERSION_ID', value: version.id, type: 'PLAINTEXT' },
        { name: 'COURSEFORGE_TEMPLATE_BUILD_ID', value: buildId, type: 'PLAINTEXT' },
        { name: 'COURSEFORGE_SOURCE_STORAGE_PATH', value: params.sourceStoragePath, type: 'PLAINTEXT' },
        { name: 'COURSEFORGE_BUNDLE_HASH', value: params.bundleHash, type: 'PLAINTEXT' },
        { name: 'COURSEFORGE_COMPOSITION_ID', value: params.compositionId, type: 'PLAINTEXT' },
        { name: 'COURSEFORGE_BUILD_OUTPUT_STORAGE_PATH', value: buildOutputStoragePath, type: 'PLAINTEXT' },
        { name: 'COURSEFORGE_BUILD_LOG_STORAGE_PATH', value: buildLogStoragePath, type: 'PLAINTEXT' },
        { name: 'COURSEFORGE_BUILD_PUBLIC_BASE_URL', value: publicBaseUrl, type: 'PLAINTEXT' },
        { name: 'COURSEFORGE_REMOTION_VERSION', value: COURSEFORGE_REMOTION_VERSION, type: 'PLAINTEXT' },
      ],
    });

    const response = await client.send(command);
    const providerBuildId = response?.build?.id;
    if (!providerBuildId || typeof providerBuildId !== 'string') {
      throw new Error('CodeBuild did not return a build id.');
    }

    return providerBuildId;
  }

  private async getCodeBuildStatus(providerBuildId: string): Promise<any | null> {
    const module = this.loadCodeBuildModule();
    const client = new module.CodeBuildClient({ region: this.getCodeBuildRegion() });
    const command = new module.BatchGetBuildsCommand({ ids: [providerBuildId] });
    const response = await client.send(command);
    return Array.isArray(response?.builds) ? response.builds[0] || null : null;
  }

  private loadCodeBuildModule(): CodeBuildModule {
    try {
      // Optional dependency. Production cloud build runtimes should install
      // @aws-sdk/client-codebuild; local render/dev can still run without it.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('@aws-sdk/client-codebuild') as CodeBuildModule;
    } catch {
      throw new Error('Missing @aws-sdk/client-codebuild in apps/api runtime.');
    }
  }

  private requireCodeBuildProjectName(): string {
    const projectName = process.env.REMOTION_TEMPLATE_CODEBUILD_PROJECT || process.env.AWS_CODEBUILD_PROJECT_NAME;
    if (!projectName?.trim()) {
      throw new Error('REMOTION_TEMPLATE_CODEBUILD_PROJECT is required to start cloud template builds.');
    }
    return projectName.trim();
  }

  private loadS3ClientModule(): S3ClientModule {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return require('@aws-sdk/client-s3') as S3ClientModule;
    } catch {
      throw new Error('Missing @aws-sdk/client-s3 in apps/api runtime.');
    }
  }

  private async prepareSourceZip(
    version: TemplateVersionRecord,
    buildId: string,
    bundleHash: string,
  ): Promise<string> {
    const zipBuffer = await this.downloadTemplateZip(version.storage_path);
    const actualHash = createHash('sha256').update(zipBuffer).digest('hex');
    if (actualHash !== bundleHash) {
      throw new Error('Template bundle hash mismatch before cloud build.');
    }

    const sourcePath = this.buildSourceStoragePath(version.id, bundleHash);
    const parsed = this.parseS3Uri(sourcePath);
    const { S3Client, PutObjectCommand } = this.loadS3ClientModule();
    const client = new S3Client({ region: this.getCodeBuildRegion() });
    await client.send(new PutObjectCommand({
      Bucket: parsed.bucket,
      Key: parsed.key,
      Body: zipBuffer,
      ContentType: 'application/zip',
      Metadata: {
        templateVersionId: version.id,
        templateBuildId: buildId,
        bundleHash,
      },
    }));

    return sourcePath;
  }

  private async downloadTemplateZip(storagePath: string): Promise<Buffer> {
    const { bucket, path } = this.resolveSupabaseStorageLocation(storagePath);
    const { data, error } = await this.supabase.storage.from(bucket).download(path);
    if (error || !data) {
      throw new Error(`Could not download template bundle from storage: ${error?.message || 'file not found'}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  private resolveSupabaseStorageLocation(storagePath: string): { bucket: string; path: string } {
    const normalized = storagePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const separatorIndex = normalized.indexOf('/');
    if (separatorIndex === -1) {
      return { bucket: 'template-bundles', path: normalized };
    }
    return {
      bucket: normalized.slice(0, separatorIndex),
      path: normalized.slice(separatorIndex + 1),
    };
  }

  private async updateBuildSourceStoragePath(buildId: string, sourceStoragePath: string): Promise<void> {
    await this.supabase
      .from('remotion_template_builds')
      .update({
        source_storage_path: sourceStoragePath,
        updated_at: new Date().toISOString(),
      })
      .eq('id', buildId);
  }

  private async markBuildStarted(buildId: string, providerBuildId: string): Promise<void> {
    await this.supabase
      .from('remotion_template_builds')
      .update({
        provider_build_id: providerBuildId,
        provider_status: 'STARTED',
        build_log: 'Cloud build started by AWS CodeBuild.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', buildId);
  }

  private async markBuildSucceeded(build: any, providerStatus: string): Promise<any | null> {
    const serveUrl = this.resolveServeUrl(build);
    const buildHash = this.buildDeterministicBuildHash(build);
    const builtAt = new Date().toISOString();
    const { data } = await this.supabase
      .from('remotion_template_builds')
      .update({
        status: 'BUILT',
        provider_status: providerStatus,
        provider_status_detail: null,
        serve_url: serveUrl,
        build_hash: buildHash,
        built_at: builtAt,
        build_log: this.buildValidatedLog(),
        updated_at: builtAt,
      })
      .eq('id', build.id)
      .select('*')
      .maybeSingle();

    await this.supabase
      .from('remotion_template_versions')
      .update({
        build_status: 'BUILT',
        build_hash: buildHash,
        build_output_path: build.build_output_storage_path,
        built_at: builtAt,
      })
      .eq('id', build.template_version_id);

    return data || null;
  }

  private async markBuildFailed(
    buildId: string,
    detail: string,
    providerStatus: string,
  ): Promise<any | null> {
    const failedAt = new Date().toISOString();
    const { data } = await this.supabase
      .from('remotion_template_builds')
      .update({
        status: 'BUILD_FAILED',
        provider_status: providerStatus,
        provider_status_detail: detail,
        build_error: detail,
        build_failed_at: failedAt,
        updated_at: failedAt,
      })
      .eq('id', buildId)
      .select('*')
      .maybeSingle();

    if (data?.template_version_id) {
      await this.supabase
        .from('remotion_template_versions')
        .update({ build_status: 'BUILD_FAILED' })
        .eq('id', data.template_version_id);
    }

    return data || null;
  }

  private async updateBuildProviderStatus(
    buildId: string,
    providerStatus: string,
    detail: string | null,
  ): Promise<any | null> {
    const { data } = await this.supabase
      .from('remotion_template_builds')
      .update({
        provider_status: providerStatus,
        provider_status_detail: detail,
        updated_at: new Date().toISOString(),
      })
      .eq('id', buildId)
      .select('*')
      .maybeSingle();

    return data || null;
  }

  private resolveServeUrl(build: any): string {
    const existing = typeof build.serve_url === 'string' ? build.serve_url : '';
    if (existing.startsWith('https://')) {
      return existing;
    }

    const baseUrl = process.env.REMOTION_TEMPLATE_BUILD_PUBLIC_BASE_URL;
    if (!baseUrl?.trim()) {
      throw new Error('REMOTION_TEMPLATE_BUILD_PUBLIC_BASE_URL is required to mark cloud build as Lambda-ready.');
    }

    return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(build.id)}/index.html`;
  }

  private isValidatedReusableBuild(build: any | null | undefined): boolean {
    if (!build || build.status !== 'BUILT' || typeof build.serve_url !== 'string' || !build.serve_url.startsWith('https://')) {
      return false;
    }

    return this.isValidatedLog(build.build_log);
  }

  private buildValidatedLog(): string {
    return `Cloud build completed and validated successfully. remotionVersion=${COURSEFORGE_REMOTION_VERSION}`;
  }

  private isValidatedLog(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    const normalized = value.toLowerCase();
    return normalized.includes('validated') &&
      normalized.includes(`remotionversion=${COURSEFORGE_REMOTION_VERSION.toLowerCase()}`);
  }

  private buildSourceStoragePath(templateVersionId: string, bundleHash: string): string {
    const bucket = process.env.REMOTION_TEMPLATE_SOURCE_BUCKET || process.env.REMOTION_TEMPLATE_BUILD_BUCKET || process.env.REMOTION_LAMBDA_BUCKET || 'remotion-template-builds';
    return `s3://${bucket}/template-sources/${templateVersionId}/${bundleHash}.zip`;
  }

  private buildOutputStoragePath(buildId: string): string {
    const bucket = process.env.REMOTION_TEMPLATE_BUILD_BUCKET || process.env.REMOTION_LAMBDA_BUCKET || 'remotion-template-builds';
    return `s3://${bucket}/template-sites/${buildId}`;
  }

  private buildLogStoragePath(buildId: string): string {
    const bucket = process.env.REMOTION_TEMPLATE_BUILD_LOG_BUCKET || process.env.REMOTION_TEMPLATE_BUILD_BUCKET || process.env.REMOTION_LAMBDA_BUCKET || 'remotion-template-builds';
    return `s3://${bucket}/template-build-logs/${buildId}.log`;
  }

  private buildSiteName(buildId: string, bundleHash: string): string {
    return `courseforge-template-${buildId.slice(0, 8)}-${bundleHash.slice(0, 8)}`;
  }

  private parseS3Uri(value: string): { bucket: string; key: string } {
    if (!value.startsWith('s3://')) {
      throw new Error(`Expected S3 URI, received: ${value}`);
    }
    const withoutScheme = value.slice('s3://'.length);
    const slashIndex = withoutScheme.indexOf('/');
    if (slashIndex <= 0 || slashIndex === withoutScheme.length - 1) {
      throw new Error(`Invalid S3 URI: ${value}`);
    }
    return {
      bucket: withoutScheme.slice(0, slashIndex),
      key: withoutScheme.slice(slashIndex + 1),
    };
  }

  private buildDeterministicBuildHash(build: any): string {
    return createHash('sha256')
      .update([
        build.id,
        build.bundle_hash,
        build.build_output_storage_path,
        build.provider_build_id,
      ].filter(Boolean).join(':'))
      .digest('hex');
  }

  private getCodeBuildRegion(): string {
    return (
      process.env.REMOTION_TEMPLATE_CODEBUILD_REGION ||
      process.env.AWS_REGION ||
      process.env.REMOTION_LAMBDA_REGION ||
      'us-east-2'
    );
  }

  private extractProviderStatusDetail(providerBuild: any): string {
    const phases = Array.isArray(providerBuild?.phases) ? providerBuild.phases : [];
    const failedPhase = phases.find((phase: any) => typeof phase?.phaseStatus === 'string' && phase.phaseStatus !== 'SUCCEEDED');
    const message = failedPhase?.contexts?.[0]?.message || providerBuild?.buildStatus || 'CodeBuild failed.';
    return sanitizeBuildError(message);
  }

  private readManifestString(manifest: Record<string, unknown> | null | undefined, key: string): string | null {
    const value = manifest?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private toStatusResult(build: any): TemplateCloudBuildStatusResult {
    return {
      success: true,
      buildId: build.id,
      status: build.status,
      providerStatus: build.provider_status || null,
      providerStatusDetail: build.provider_status_detail || build.build_error || null,
      providerBuildId: build.provider_build_id || null,
      serveUrl: build.serve_url || null,
      buildOutputStoragePath: build.build_output_storage_path || null,
      buildLogStoragePath: build.build_log_storage_path || null,
    };
  }
}

export function sanitizeBuildError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || 'Cloud build failed');
  return message
    .replace(/AWS_ACCESS_KEY_ID=[^\s]+/gi, 'AWS_ACCESS_KEY_ID=[redacted]')
    .replace(/AWS_SECRET_ACCESS_KEY=[^\s]+/gi, 'AWS_SECRET_ACCESS_KEY=[redacted]')
    .replace(/AWS_SESSION_TOKEN=[^\s]+/gi, 'AWS_SESSION_TOKEN=[redacted]')
    .replace(/SUPABASE_SERVICE_ROLE_KEY=[^\s]+/gi, 'SUPABASE_SERVICE_ROLE_KEY=[redacted]')
    .replace(/OPENAI_API_KEY=[^\s]+/gi, 'OPENAI_API_KEY=[redacted]')
    .replace(/GOOGLE_GENERATIVE_AI_API_KEY=[^\s]+/gi, 'GOOGLE_GENERATIVE_AI_API_KEY=[redacted]')
    .slice(0, 2000);
}
