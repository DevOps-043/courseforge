import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import { jwtVerify } from 'jose';
import crypto from 'crypto';
import {
  buildAssemblyInputProps,
  resolveExternalCompositionId,
  resolveInternalCompositionId,
} from './remotion-assembly-props.service';
import { buildResolvedProps } from './resolved-props.service';
import { SandboxBuildService } from './sandbox-build.service';
import { sandboxBundleCacheInternals } from './sandbox-runner/bundle-cache';
import { mergeTemplateRenderConfigs } from './template-render-config.service';
import { rewritePreviewHtmlAssetPaths } from './preview-html.service';
import {
  getExternalPreviewRenderPath,
  getExternalPreviewRenderRoot,
  renderExternalPreviewVideo,
} from './external-preview-render.service';
import { RemotionLambdaProgressService } from './remotion-lambda-progress.service';
import { RemotionRenderOrchestratorService } from './remotion-render-orchestrator.service';
import { getRemotionRenderReadiness } from './remotion-render.config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const renderOrchestrator = new RemotionRenderOrchestratorService();
const lambdaProgressService = new RemotionLambdaProgressService();

type SupabaseAnyClient = any;

function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function isInsideDirectory(rootDir: string, candidatePath: string): boolean {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedCandidate = path.resolve(candidatePath);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(resolvedRoot + path.sep);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

function buildRemotionRenderIdempotencyKey(params: {
  componentId: string;
  templateId: string;
  templateVersionId?: string | null;
  bundleHash?: string | null;
  buildHash?: string | null;
  compositionId?: string | null;
  exportMode?: string | null;
  variables: unknown;
}) {
  const hash = crypto
    .createHash('sha256')
    .update(stableStringify(params))
    .digest('hex')
    .slice(0, 32);
  return `remotion-render-${params.componentId}-${hash}`;
}

export class ProductionController {
  private async authenticateRequest(req: Request): Promise<{
    serviceClient: SupabaseAnyClient;
    user: { id: string; email?: string };
    organizationIds: string[];
  } | null> {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];
    if (!token) {
      return null;
    }

    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    const jwtSecret = process.env.COURSEFORGE_JWT_SECRET;

    if (jwtSecret) {
      try {
        const secretKey = new TextEncoder().encode(jwtSecret);
        const { payload } = await jwtVerify(token, secretKey, { algorithms: ['HS256'] });
        if (payload.sub && payload.email) {
          const appMetadata = payload.app_metadata as Record<string, unknown> | undefined;
          const rawOrganizationIds = appMetadata?.organization_ids;
          const organizationIds = Array.isArray(rawOrganizationIds)
            ? rawOrganizationIds.filter((id): id is string => typeof id === 'string')
            : [];

          return {
            serviceClient,
            user: { id: String(payload.sub), email: String(payload.email) },
            organizationIds,
          };
        }
      } catch {
        // Token is not a valid Auth Bridge JWT, try Supabase next.
      }
    }

    const {
      data: { user: supabaseUser },
      error,
    } = await serviceClient.auth.getUser(token);
    if (error || !supabaseUser) {
      return null;
    }

    const organizationIds = new Set<string>();
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('organization_id')
      .eq('id', supabaseUser.id)
      .maybeSingle();
    if (typeof profile?.organization_id === 'string') {
      organizationIds.add(profile.organization_id);
    }

    const { data: roleRows } = await serviceClient
      .from('organization_user_roles')
      .select('organization_id')
      .eq('user_id', supabaseUser.id);
    for (const row of roleRows || []) {
      if (typeof row.organization_id === 'string') {
        organizationIds.add(row.organization_id);
      }
    }

    return {
      serviceClient,
      user: { id: supabaseUser.id, email: supabaseUser.email },
      organizationIds: Array.from(organizationIds),
    };
  }

  private extractExternalTemplateOverrides(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const variables = value as Record<string, unknown>;
    const candidate = variables.resolvedProps ?? variables.customTemplateProps ?? variables.templateProps;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return null;
    }

    return candidate as Record<string, unknown>;
  }

  private async getOrCreatePreviewBuild(
    serviceClient: SupabaseAnyClient,
    params: {
      sandboxVersion: any;
      compositionId: string;
      organizationId: string | null;
    },
  ): Promise<{
    buildId: string | null;
    serveUrl: string;
    buildHash: string | null;
    compositionId: string;
    exportMode: 'component' | 'root';
  }> {
    const exportMode = params.sandboxVersion.export_mode === 'root' ? 'root' : 'component';
    const bundleHash = params.sandboxVersion.bundle_hash || '';
    if (!bundleHash) {
      throw new Error('La version sandbox aprobada no tiene bundle_hash.');
    }
    if (!params.organizationId) {
      throw new Error('No se pudo resolver organization_id para construir preview.');
    }

    const { data: existingBuild } = await serviceClient
      .from('remotion_template_builds')
      .select('id, serve_url, build_hash, composition_id, export_mode')
      .eq('template_version_id', params.sandboxVersion.id)
      .eq('bundle_hash', bundleHash)
      .eq('composition_id', params.compositionId)
      .eq('export_mode', exportMode)
      .eq('status', 'BUILT')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const reusableBuild = existingBuild as any;
    if (reusableBuild?.serve_url) {
      return {
        buildId: reusableBuild.id,
        serveUrl: reusableBuild.serve_url,
        buildHash: reusableBuild.build_hash || params.sandboxVersion.build_hash || null,
        compositionId: reusableBuild.composition_id || params.compositionId,
        exportMode: reusableBuild.export_mode === 'root' ? 'root' : 'component',
      };
    }

    const buildService = new SandboxBuildService(serviceClient);
    const buildResult = await buildService.buildFromZip({
      templateVersionId: params.sandboxVersion.id,
      bundleZipPath: params.sandboxVersion.storage_path,
      bundleHash,
      organizationId: params.organizationId,
    });

    if (!buildResult.success || !buildResult.serveUrl) {
      throw new Error(`Build de preview fallo: ${buildResult.error || 'error desconocido'}`);
    }

    return {
      buildId: buildResult.buildId || null,
      serveUrl: buildResult.serveUrl,
      buildHash: buildResult.buildHash || null,
      compositionId: buildResult.compositionId || params.compositionId,
      exportMode: buildResult.exportMode || exportMode,
    };
  }

  private buildBrowserPreviewServeUrl(req: Request, build: { buildId: string | null; serveUrl: string }): string {
    if (isHttpUrl(build.serveUrl) || !build.buildId) {
      return build.serveUrl;
    }

    const publicBaseUrl = process.env.EXPRESS_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    return `${publicBaseUrl.replace(/\/+$/, '')}/api/v1/production/remotion/external-preview-bundles/${encodeURIComponent(build.buildId)}/index.html`;
  }

  private buildBrowserPreviewVideoUrl(req: Request, fileName: string): string {
    const publicBaseUrl = process.env.EXPRESS_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    return `${publicBaseUrl.replace(/\/+$/, '')}/api/v1/production/remotion/external-preview-renders/${encodeURIComponent(fileName)}`;
  }

  private async buildPreviewCourseProps(
    serviceClient: SupabaseAnyClient,
    params: {
      componentId: string;
      template: any;
      organizationIds: string[];
      variables: unknown;
      internalCompositionId: string;
    },
  ): Promise<Record<string, unknown>> {
    const { data: component, error } = await serviceClient
      .from('material_components')
      .select(`
        *,
        material_lessons (
          materials (
            artifacts (
              organization_id
            )
          )
        )
      `)
      .eq('id', params.componentId)
      .single();

    const componentRecord = component as any;
    if (error || !componentRecord) {
      throw new Error('Componente no encontrado para preview.');
    }

    const organizationId = componentRecord.material_lessons?.materials?.artifacts?.organization_id || null;
    if (organizationId && !params.organizationIds.includes(organizationId)) {
      throw new Error('Forbidden: You do not have access to this component');
    }

    const variables = params.variables && typeof params.variables === 'object' ? params.variables as Record<string, unknown> : {};
    const templateConfig = mergeTemplateRenderConfigs(
      params.template.default_config,
      variables.templateConfig,
    );

    return buildAssemblyInputProps({
      assets: componentRecord.assets || {},
      compositionId: params.internalCompositionId,
      transitionType: variables.transitionType,
      templateConfig,
    }) as unknown as Record<string, unknown>;
  }

  async getExternalBundlePreview(req: Request, res: Response, next: NextFunction) {
    try {
      const { templateId, componentId, variables = {} } = req.body || {};
      if (typeof templateId !== 'string' || !templateId.trim()) {
        return res.status(400).json({ error: 'templateId is required' });
      }

      const authContext = await this.authenticateRequest(req);
      if (!authContext) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const { serviceClient, organizationIds } = authContext;
      const { data: rawTemplate, error: templateError } = await serviceClient
        .from('remotion_templates')
        .select('*')
        .eq('id', templateId)
        .single();

      const template = rawTemplate as any;
      if (templateError || !template) {
        return res.status(404).json({ error: 'Template not found' });
      }

      if (template.organization_id && !organizationIds.includes(template.organization_id)) {
        return res.status(403).json({ error: 'Forbidden: You do not have access to this template' });
      }

      const { data: rawSandboxVersion, error: versionError } = await serviceClient
        .from('remotion_template_versions')
        .select(
          'id, organization_id, bundle_hash, build_hash, entry_point, storage_path, template_type, export_mode, composition_id, default_props, default_duration_frames, default_fps, default_width, default_height',
        )
        .eq('template_id', templateId)
        .eq('status', 'APPROVED_FOR_SANDBOX')
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (versionError) {
        throw versionError;
      }
      const sandboxVersion = rawSandboxVersion as any;
      if (!sandboxVersion) {
        return res.status(404).json({ error: 'No APPROVED_FOR_SANDBOX template version found' });
      }

      const internalCompositionId = resolveInternalCompositionId(template.composition_id);
      const compositionId = resolveExternalCompositionId(
        sandboxVersion.composition_id || template.composition_id,
        internalCompositionId,
      );
      const build = await this.getOrCreatePreviewBuild(serviceClient, {
        sandboxVersion,
        compositionId,
        organizationId: sandboxVersion.organization_id || template.organization_id,
      });
      const courseProps = typeof componentId === 'string' && componentId.trim()
        ? await this.buildPreviewCourseProps(serviceClient, {
            componentId,
            template,
            organizationIds,
            variables,
            internalCompositionId,
          })
        : {};
      const resolvedProps = buildResolvedProps({
        bundleDefaultProps: sandboxVersion.default_props,
        courseProps,
        userOverrides: this.extractExternalTemplateOverrides(variables),
      });
      const previewRender = build.buildId
        ? await renderExternalPreviewVideo({
            buildId: build.buildId,
            serveUrl: build.serveUrl,
            compositionId: build.compositionId,
            inputProps: resolvedProps.resolvedProps,
            propsHash: resolvedProps.propsHash,
          })
        : null;

      return res.json({
        success: true,
        serveUrl: this.buildBrowserPreviewServeUrl(req, {
          buildId: build.buildId,
          serveUrl: build.serveUrl,
        }),
        compositionId: build.compositionId,
        exportMode: build.exportMode,
        resolvedProps: resolvedProps.resolvedProps,
        propsHash: resolvedProps.propsHash,
        buildHash: build.buildHash,
        buildId: build.buildId,
        templateVersionId: sandboxVersion.id,
        bundleHash: sandboxVersion.bundle_hash,
        previewVideoUrl: previewRender ? this.buildBrowserPreviewVideoUrl(req, previewRender.fileName) : null,
        previewPosterUrl: previewRender ? this.buildBrowserPreviewVideoUrl(req, previewRender.posterFileName) : null,
        previewDurationSeconds: previewRender?.previewDurationSeconds ?? null,
        previewFrames: previewRender?.previewFrames ?? null,
        compositionDurationSeconds: previewRender?.compositionDurationSeconds ?? null,
        compositionFrames: previewRender?.compositionFrames ?? null,
      });
    } catch (err) {
      return next(err);
    }
  }

  async getRemotionReadiness(req: Request, res: Response, next: NextFunction) {
    try {
      const authContext = await this.authenticateRequest(req);
      if (!authContext) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const readiness = getRemotionRenderReadiness();
      return res.status(readiness.ok ? 200 : 503).json(readiness);
    } catch (err) {
      return next(err);
    }
  }

  async serveExternalPreviewBundle(req: Request, res: Response, next: NextFunction) {
    try {
      const buildId = req.params.buildId;
      if (!buildId || !/^[a-zA-Z0-9-]{8,80}$/.test(buildId)) {
        return res.status(400).send('Invalid build id');
      }

      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: rawBuild, error } = await serviceClient
        .from('remotion_template_builds')
        .select('id, status, serve_url, composition_id')
        .eq('id', buildId)
        .single();

      const build = rawBuild as any;
      if (error || !build) {
        return res.status(404).send('Preview build not found');
      }

      if (build.status !== 'BUILT' || !build.serve_url || isHttpUrl(build.serve_url)) {
        return res.status(404).send('Preview bundle is not available as a local build');
      }

      const bundleRoot = path.resolve(build.serve_url);
      if (
        !path.isAbsolute(bundleRoot) ||
        !isInsideDirectory(sandboxBundleCacheInternals.CACHE_ROOT, bundleRoot)
      ) {
        return res.status(403).send('Preview bundle path is not allowed');
      }

      const rawAssetPath = typeof req.params[0] === 'string' && req.params[0].trim()
        ? req.params[0]
        : 'index.html';
      const normalizedAssetPath = rawAssetPath.replace(/\\/g, '/');
      const requestedPath = sandboxBundleCacheInternals.resolveInsideDirectory(bundleRoot, normalizedAssetPath);
      const filePath = fs.existsSync(requestedPath) && fs.statSync(requestedPath).isDirectory()
        ? path.join(requestedPath, 'index.html')
        : requestedPath;

      if (!isInsideDirectory(bundleRoot, filePath) || !fs.existsSync(filePath)) {
        return res.status(404).send('Preview asset not found');
      }

      res.removeHeader('X-Frame-Options');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data:; img-src 'self' data: blob: https: http:; media-src 'self' data: blob: https: http:; connect-src 'self' https: http: blob:; frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000",
      );
      res.setHeader('Cache-Control', 'private, max-age=300');
      if (path.extname(filePath).toLowerCase() === '.html') {
        const html = await fs.promises.readFile(filePath, 'utf8');
        return res.type('html').send(rewritePreviewHtmlAssetPaths(html, buildId, build.composition_id));
      }

      return res.sendFile(filePath);
    } catch (err) {
      return next(err);
    }
  }

  async serveExternalPreviewRender(req: Request, res: Response, next: NextFunction) {
    try {
      const fileName = req.params.fileName;
      if (!fileName || !/^[a-zA-Z0-9._-]{16,220}\.(mp4|png)$/.test(fileName)) {
        return res.status(400).send('Invalid preview render file');
      }

      const filePath = path.resolve(getExternalPreviewRenderPath(fileName));
      if (!isInsideDirectory(getExternalPreviewRenderRoot(), filePath) || !fs.existsSync(filePath)) {
        return res.status(404).send('Preview render not found');
      }

      res.removeHeader('X-Frame-Options');
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Content-Type', fileName.endsWith('.png') ? 'image/png' : 'video/mp4');
      return res.sendFile(filePath);
    } catch (err) {
      return next(err);
    }
  }

  async renderRemotion(req: Request, res: Response, next: NextFunction) {
    try {
      const { componentId, templateId, variables = {} } = req.body;
      if (!componentId || !templateId) {
        return res.status(400).json({ error: 'componentId and templateId are required' });
      }
      console.log('[ProductionController] Remotion render request received.', {
        componentId,
        templateId,
        variablesKeys: Object.keys(variables || {}),
      });

      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Authorization header is missing' });
      }

      const token = authHeader.split(' ')[1];
      if (!token) {
        return res.status(401).json({ error: 'Malformed token' });
      }

      // 1. Authenticate user (Auth Bridge fallback support)
      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
      let isAuthBridge = false;
      let payload: any = null;
      let user: { id: string; email?: string } | null = null;

      const jwtSecret = process.env.COURSEFORGE_JWT_SECRET;
      if (jwtSecret) {
        try {
          const secretKey = new TextEncoder().encode(jwtSecret);
          const { payload: decodedPayload } = await jwtVerify(token, secretKey, {
            algorithms: ['HS256'],
          });
          payload = decodedPayload;
          if (payload.sub && payload.email) {
            isAuthBridge = true;
            user = { id: payload.sub, email: payload.email };
            console.log('[API] Authenticated user via Auth Bridge:', user.email);
          }
        } catch (err) {
          // Token is not a valid Auth Bridge JWT, try Supabase next
        }
      }

      if (!isAuthBridge) {
        const { data: { user: supabaseUser }, error: authError } = await serviceClient.auth.getUser(token);
        if (authError || !supabaseUser) {
          return res.status(401).json({ error: 'Invalid or expired token' });
        }
        user = { id: supabaseUser.id, email: supabaseUser.email };
        console.log('[API] Authenticated user via GoTrue:', user.email);
      }

      if (!user) {
        return res.status(401).json({ error: 'Authentication failed' });
      }

      // 2. Query component and check organization permissions
      let component: any = null;
      let compError: any = null;

      if (isAuthBridge) {
        // Use service client to bypass RLS since the token is not a Supabase token,
        // and manually verify organization access using the token payload.
        const { data, error } = await serviceClient
          .from('material_components')
          .select(`
            id,
            material_lesson_id,
            material_lessons (
              id,
              lesson_id,
              module_id,
              materials (
                id,
                artifact_id,
                artifacts (
                  id,
                  organization_id
                )
              )
            )
          `)
          .eq('id', componentId)
          .single();
        
          component = data;
          compError = error;

        if (component) {
          const ml = component.material_lessons as any;
          const m = ml?.materials as any;
          const art = m?.artifacts as any;
          const organizationId = art?.organization_id || null;

          const userOrgs = payload.app_metadata?.organization_ids || [];
          if (organizationId && !userOrgs.includes(organizationId)) {
            return res.status(403).json({ error: 'Forbidden: You do not have access to this organization' });
          }
        }
      } else {
        const userClient = createClient(supabaseUrl, supabaseServiceKey, {
          global: { headers: { Authorization: `Bearer ${token}` } }
        });

        const { data, error } = await userClient
          .from('material_components')
          .select(`
            id,
            material_lesson_id,
            material_lessons (
              id,
              lesson_id,
              module_id,
              materials (
                id,
                artifact_id,
                artifacts (
                  id,
                  organization_id
                )
              )
            )
          `)
          .eq('id', componentId)
          .single();

        component = data;
        compError = error;
      }

      if (compError || !component) {
        console.error('[ProductionController] Error fetching component or permission denied:', compError);
        return res.status(403).json({ error: 'Forbidden: You do not have access to this component or organization' });
      }

      // Extract hierarchy IDs safely
      const ml = component.material_lessons as any;
      const materialLessonId = ml?.id || null;
      const lessonId = ml?.lesson_id || null;
      const moduleId = ml?.module_id || null;
      
      const m = ml?.materials as any;
      const artifactId = m?.artifact_id || null;
      
      const art = m?.artifacts as any;
      const organizationId = art?.organization_id || null;

      if (!artifactId) {
        return res.status(400).json({ error: 'Component has no associated artifact' });
      }

      const { data: sandboxVersion } = await serviceClient
        .from('remotion_template_versions')
        .select('id, bundle_hash, build_hash, composition_id, export_mode')
        .eq('template_id', templateId)
        .eq('status', 'APPROVED_FOR_SANDBOX')
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      const renderMode = sandboxVersion ? 'EXTERNAL_SANDBOX_CANDIDATE' : 'INTERNAL_COMPOSITION';
      console.log('[ProductionController] Remotion render mode resolved.', {
        componentId,
        templateId,
        organizationId,
        artifactId,
        sandboxVersionId: sandboxVersion?.id || null,
        sandboxBundleHash: sandboxVersion?.bundle_hash || null,
        renderMode,
      });
      const inputSnapshot = {
        templateId,
        templateVersionId: sandboxVersion?.id || null,
        bundleHash: sandboxVersion?.bundle_hash || null,
        buildHash: sandboxVersion?.build_hash || null,
        compositionId: sandboxVersion?.composition_id || null,
        exportMode: sandboxVersion?.export_mode || 'component',
        renderMode,
        renderProvider: renderOrchestrator.providerName,
        propsHash: null,
        resolvedProps: null,
        variables,
      };
      const idempotencyKey = buildRemotionRenderIdempotencyKey({
        componentId,
        templateId,
        templateVersionId: sandboxVersion?.id || null,
        bundleHash: sandboxVersion?.bundle_hash || null,
        buildHash: sandboxVersion?.build_hash || null,
        compositionId: sandboxVersion?.composition_id || null,
        exportMode: sandboxVersion?.export_mode || 'component',
        variables,
      });

      let existingJobQuery = serviceClient
        .from('production_jobs')
        .select('*')
        .eq('idempotency_key', idempotencyKey);

      existingJobQuery = organizationId
        ? existingJobQuery.eq('organization_id', organizationId)
        : existingJobQuery.is('organization_id', null);

      const { data: existingJob, error: existingJobError } = await existingJobQuery.maybeSingle();

      if (existingJobError) {
        console.warn('[ProductionController] Error checking existing production job:', existingJobError);
      }

      if (existingJob) {
        console.log('[ProductionController] Reusing existing Remotion job.', {
          componentId,
          templateId,
          jobId: existingJob.id,
          status: existingJob.status,
          renderMode: existingJob.input_snapshot?.renderMode,
          templateVersionId: existingJob.input_snapshot?.templateVersionId || null,
        });

        if (existingJob.status === 'FAILED' || existingJob.status === 'CANCELLED') {
          const { data: resetJob, error: resetJobError } = await serviceClient
            .from('production_jobs')
            .update({
              status: 'PENDING',
              progress: [{ percent: 0, message: 'Reintentando render tras fallo previo', timestamp: new Date().toISOString() }],
              provider_error: null,
              output_snapshot: {
                completed: false,
                retryOfFailedJob: true,
                resetAt: new Date().toISOString(),
                renderMode,
                templateVersionId: sandboxVersion?.id || null,
                bundleHash: sandboxVersion?.bundle_hash || null,
                buildHash: sandboxVersion?.build_hash || null,
                compositionId: sandboxVersion?.composition_id || null,
                exportMode: sandboxVersion?.export_mode || 'component',
              },
              started_at: null,
              completed_at: null,
              failed_at: null,
              input_snapshot: inputSnapshot,
            })
            .eq('id', existingJob.id)
            .select('*')
            .single();

          if (resetJobError || !resetJob) {
            console.error('[ProductionController] Error resetting failed Remotion job:', resetJobError);
            return res.status(500).json({
              error: 'Failed to reset existing render job: ' + (resetJobError?.message || 'Unknown error'),
            });
          }

          const dispatchResult = await renderOrchestrator.dispatch(resetJob.id);
          console.log('[ProductionController] Failed Remotion job reset and dispatched.', {
            componentId,
            templateId,
            jobId: resetJob.id,
            previousStatus: existingJob.status,
            renderMode,
            renderProvider: dispatchResult.provider,
            templateVersionId: sandboxVersion?.id || null,
            bundleHash: sandboxVersion?.bundle_hash || null,
            buildHash: sandboxVersion?.build_hash || null,
            compositionId: sandboxVersion?.composition_id || null,
            exportMode: sandboxVersion?.export_mode || 'component',
          });

          return res.json({
            success: true,
            jobId: resetJob.id,
            status: dispatchResult.status,
            renderProvider: dispatchResult.provider,
            message: 'Failed rendering job reset and dispatched again',
          });
        }

        if (existingJob.status === 'PENDING' || existingJob.status === 'QUEUED') {
          const dispatchResult = await renderOrchestrator.dispatch(existingJob.id);
          return res.json({
            success: true,
            jobId: existingJob.id,
            status: dispatchResult.status,
            renderProvider: dispatchResult.provider,
            message: 'Rendering job reused and dispatched by idempotency key',
          });
        }

        return res.json({
          success: true,
          jobId: existingJob.id,
          status: existingJob.status,
          message: 'Rendering job reused by idempotency key',
        });
      }

      // 3. Create production job using serviceClient (with system permissions to write to production_jobs)
      const { data: job, error: jobError } = await serviceClient
        .from('production_jobs')
        .insert({
          organization_id: organizationId,
          artifact_id: artifactId,
          material_lesson_id: materialLessonId,
          material_component_id: componentId,
          lesson_id: lessonId,
          module_id: moduleId,
          job_type: 'REMOTION_RENDER',
          provider: 'remotion',
          status: 'PENDING',
          idempotency_key: idempotencyKey,
          input_snapshot: inputSnapshot,
          created_by: user.id,
          progress: [{ percent: 0, message: 'Job de render creado', timestamp: new Date().toISOString() }]
        })
        .select('*')
        .single();

      if (jobError || !job) {
        console.error('[ProductionController] Error creating production job:', jobError);
        return res.status(500).json({ error: 'Failed to create production job: ' + (jobError?.message || 'Unknown error') });
      }

      // 4. Dispatch the job through the configured provider.
      const dispatchResult = await renderOrchestrator.dispatch(job.id);
      console.log('[ProductionController] Remotion job created and dispatched.', {
        componentId,
        templateId,
        jobId: job.id,
        renderMode,
        renderProvider: dispatchResult.provider,
        templateVersionId: sandboxVersion?.id || null,
      });

      return res.json({
        success: true,
        jobId: job.id,
        status: dispatchResult.status,
        renderProvider: dispatchResult.provider,
        message: dispatchResult.message
      });

    } catch (err: any) {
      return next(err);
    }
  }

  async getJobStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { jobId } = req.params;
      if (!jobId) {
        return res.status(400).json({ error: 'jobId parameter is required' });
      }

      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Authorization header is missing' });
      }

      const token = authHeader.split(' ')[1];
      if (!token) {
        return res.status(401).json({ error: 'Malformed token' });
      }

      // Use Auth Bridge fallback strategy to authenticate the request
      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
      let isAuthBridge = false;
      let payload: any = null;
      let user: { id: string; email?: string } | null = null;

      const jwtSecret = process.env.COURSEFORGE_JWT_SECRET;
      if (jwtSecret) {
        try {
          const secretKey = new TextEncoder().encode(jwtSecret);
          const { payload: decodedPayload } = await jwtVerify(token, secretKey, {
            algorithms: ['HS256'],
          });
          payload = decodedPayload;
          if (payload.sub && payload.email) {
            isAuthBridge = true;
            user = { id: payload.sub, email: payload.email };
          }
        } catch (err) {
          // Token is not a valid Auth Bridge JWT, try Supabase next
        }
      }

      if (!isAuthBridge) {
        const { data: { user: supabaseUser }, error: authError } = await serviceClient.auth.getUser(token);
        if (authError || !supabaseUser) {
          return res.status(401).json({ error: 'Invalid or expired token' });
        }
        user = { id: supabaseUser.id, email: supabaseUser.email };
      }

      if (!user) {
        return res.status(401).json({ error: 'Authentication failed' });
      }

      let job: any = null;
      let jobError: any = null;

      if (isAuthBridge) {
        // Use service client to bypass RLS and verify manually against organization ids in the token
        const { data, error } = await serviceClient
          .from('production_jobs')
          .select('*')
          .eq('id', jobId)
          .single();
        
        job = data;
        jobError = error;

        if (job) {
          const userOrgs = payload.app_metadata?.organization_ids || [];
          if (job.organization_id && !userOrgs.includes(job.organization_id)) {
            return res.status(403).json({ error: 'Forbidden: You do not have access to this job' });
          }
        }
      } else {
        const userClient = createClient(supabaseUrl, supabaseServiceKey, {
          global: { headers: { Authorization: `Bearer ${token}` } }
        });

        const { data, error } = await userClient
          .from('production_jobs')
          .select('*')
          .eq('id', jobId)
          .single();

        job = data;
        jobError = error;
      }

      if (jobError || !job) {
        console.error('[ProductionController] Job not found or access denied:', jobError);
        return res.status(404).json({ error: 'Job not found or access denied' });
      }

      if (job.status === 'WAITING_PROVIDER' && job.input_snapshot?.renderProvider === 'lambda') {
        try {
          await lambdaProgressService.syncJobProgress(serviceClient, job);
          const { data: refreshedJob } = await serviceClient
            .from('production_jobs')
            .select('*')
            .eq('id', jobId)
            .single();
          if (refreshedJob) {
            job = refreshedJob;
          }
        } catch (progressError) {
          console.warn('[ProductionController] Could not sync Lambda render progress:', progressError);
        }
      }

      return res.json({
        id: job.id,
        status: job.status,
        progress: job.progress,
        output_snapshot: job.output_snapshot,
        provider_error: job.provider_error,
        started_at: job.started_at,
        completed_at: job.completed_at,
        failed_at: job.failed_at
      });

    } catch (err: any) {
      return next(err);
    }
  }
}
