import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { jwtVerify } from 'jose';
import crypto from 'crypto';
import { createNodeSupabaseClient } from '../../core/supabase-client';
import {
  getExternalPreviewRenderPath,
  getExternalPreviewRenderRoot,
  renderExternalPreviewVideo,
} from './external-preview-render.service';
import { RemotionRenderOrchestratorService } from './remotion-render-orchestrator.service';
import {
  buildAssemblyInputProps,
  resolveInternalCompositionId,
} from './remotion-assembly-props.service';
import {
  getRemotionRenderReadiness,
  resolveLocalRenderTimeoutMs,
  buildStableHash,
} from './remotion-render.config';
import { TemplateCloudBuildService } from './template-cloud-build.service';
import {
  getExternalBuildReadiness,
  isExternalReadyBuild,
  resolveExternalRenderTarget,
} from './external-render-target.service';
import { buildExternalTemplateProps } from './external-template-props.service';
import { DesktopWorkerService } from './desktop-worker.service';
import { buildRenderDiagnosticsSnapshot } from './remotion-render-diagnostics.service';
import { mergeTemplateRenderConfigs } from './template-render-config.service';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const renderOrchestrator = new RemotionRenderOrchestratorService();

type SupabaseAnyClient = any;

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
  buildId?: string | null;
  serveUrl?: string | null;
  propsHash?: string | null;
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

function buildProgressEntry(params: {
  percent: number;
  message: string;
  stage: string;
  provider?: string | null;
}) {
  return {
    percent: params.percent,
    message: params.message,
    stage: params.stage,
    provider: params.provider || null,
    timestamp: new Date().toISOString(),
  };
}

function hasCompletedRenderOutput(job: any, component: any): boolean {
  return Boolean(
    job?.output_snapshot?.final_video_url &&
    component?.assets?.final_video_url
  );
}

function isUuid(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
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

    const serviceClient = createNodeSupabaseClient(supabaseUrl, supabaseServiceKey);
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

  private buildBrowserPreviewVideoUrl(req: Request, fileName: string): string {
    const publicBaseUrl = process.env.EXPRESS_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    return `${publicBaseUrl.replace(/\/+$/, '')}/api/v1/production/remotion/external-preview-renders/${encodeURIComponent(fileName)}`;
  }

  private async getAuthorizedPreviewComponent(
    serviceClient: SupabaseAnyClient,
    params: {
      componentId: string;
      organizationIds: string[];
    },
  ): Promise<any> {
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

    return componentRecord;
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

      const { data: rawVersion, error: versionError } = await serviceClient
        .from('remotion_template_versions')
        .select(
          'id, organization_id, bundle_hash, build_hash, entry_point, storage_path, template_type, export_mode, composition_id, default_props, props_schema, default_duration_frames, default_fps, default_width, default_height, status',
        )
        .eq('template_id', templateId)
        .in('status', ['APPROVED_FOR_SANDBOX', 'APPROVED'])
        .order('version_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (versionError) {
        throw versionError;
      }
      const templateVersion = rawVersion as any;
      if (!templateVersion) {
        return res.status(404).json({ error: 'No approved template version found' });
      }

      const { data: rawCloudBuild } = await serviceClient
        .from('remotion_template_builds')
        .select('*')
        .eq('template_version_id', templateVersion.id)
        .eq('bundle_hash', templateVersion.bundle_hash || '')
        .eq('status', 'BUILT')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const cloudBuild = rawCloudBuild as any;
      if (isExternalReadyBuild(cloudBuild)) {
        const target = resolveExternalRenderTarget({
          jobSnapshot: {
            templateVersionId: templateVersion.id,
            buildId: cloudBuild.id,
            bundleHash: templateVersion.bundle_hash || null,
            externalServeUrl: cloudBuild.serve_url || null,
            cloudProvider: cloudBuild.cloud_provider || null,
          },
          version: templateVersion,
          build: cloudBuild,
        });
        const componentRecord = typeof componentId === 'string' && componentId.trim()
          ? await this.getAuthorizedPreviewComponent(serviceClient, {
              componentId,
              organizationIds,
            })
          : null;
        const propsResult = componentRecord
          ? buildExternalTemplateProps({
              assets: componentRecord.assets || {},
              compositionId: target.compositionId,
              templateDefaultConfig: template.default_config,
              variables: variables && typeof variables === 'object' ? variables as Record<string, unknown> : {},
              bundleDefaultProps: templateVersion.default_props,
              propsSchema: templateVersion.props_schema,
            })
          : {
              resolvedProps: templateVersion.default_props || {},
              propsHash: buildRemotionRenderIdempotencyKey({
                componentId: 'preview-default-props',
                templateId,
                templateVersionId: target.templateVersionId,
                buildId: target.buildId,
                serveUrl: target.serveUrl,
                compositionId: target.compositionId,
                exportMode: target.exportMode,
                variables: templateVersion.default_props || {},
              }),
            };
        const previewRender = componentRecord
          ? await renderExternalPreviewVideo({
              buildId: target.buildId,
              serveUrl: target.serveUrl,
              compositionId: target.compositionId,
              inputProps: propsResult.resolvedProps,
              propsHash: propsResult.propsHash,
            })
          : null;

        return res.json({
          success: true,
          serveUrl: target.serveUrl,
          compositionId: target.compositionId,
          exportMode: target.exportMode,
          resolvedProps: propsResult.resolvedProps,
          propsHash: propsResult.propsHash,
          buildHash: target.buildHash,
          buildId: target.buildId,
          templateVersionId: target.templateVersionId,
          bundleHash: target.bundleHash,
          previewVideoUrl: previewRender ? this.buildBrowserPreviewVideoUrl(req, previewRender.fileName) : null,
          previewPosterUrl: previewRender ? this.buildBrowserPreviewVideoUrl(req, previewRender.posterFileName) : null,
          previewDurationSeconds: previewRender?.previewDurationSeconds ?? null,
          previewFrames: previewRender?.previewFrames ?? null,
          compositionDurationSeconds: previewRender?.compositionDurationSeconds ?? null,
          compositionFrames: previewRender?.compositionFrames ?? null,
        });
      }

      return res.status(409).json({
        error: 'La plantilla aprobada necesita un build cloud listo para preview y render final.',
        code: 'EXTERNAL_BUILD_NOT_READY',
        templateVersionId: templateVersion.id,
        buildStatus: cloudBuild?.status || null,
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

  async startTemplateCloudBuild(req: Request, res: Response, next: NextFunction) {
    try {
      const authContext = await this.authenticateRequest(req);
      if (!authContext) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const templateVersionId = typeof req.body?.templateVersionId === 'string'
        ? req.body.templateVersionId
        : req.params.templateVersionId;
      if (!isUuid(templateVersionId)) {
        return res.status(400).json({ error: 'templateVersionId is required.', code: 'INVALID_TEMPLATE_VERSION_ID' });
      }

      const { data: version, error } = await authContext.serviceClient
        .from('remotion_template_versions')
        .select('id, organization_id, status')
        .eq('id', templateVersionId)
        .maybeSingle();

      if (error || !version) {
        return res.status(404).json({ error: 'Template version not found.', code: 'TEMPLATE_VERSION_NOT_FOUND' });
      }

      if (version.organization_id && !authContext.organizationIds.includes(version.organization_id)) {
        return res.status(403).json({ error: 'Forbidden.', code: 'ORG_FORBIDDEN' });
      }

      const service = new TemplateCloudBuildService(authContext.serviceClient);
      const result = await service.startBuild(templateVersionId);
      return res.status(result.success ? 202 : 400).json(result);
    } catch (err) {
      return next(err);
    }
  }

  async getTemplateCloudBuildStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const authContext = await this.authenticateRequest(req);
      if (!authContext) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      const buildId = req.params.buildId;
      if (!isUuid(buildId)) {
        return res.status(400).json({ error: 'buildId is invalid.', code: 'INVALID_BUILD_ID' });
      }

      const { data: build, error } = await authContext.serviceClient
        .from('remotion_template_builds')
        .select('id, organization_id')
        .eq('id', buildId)
        .maybeSingle();

      if (error || !build) {
        return res.status(404).json({ error: 'Cloud build not found.', code: 'CLOUD_BUILD_NOT_FOUND' });
      }

      if (build.organization_id && !authContext.organizationIds.includes(build.organization_id)) {
        return res.status(403).json({ error: 'Forbidden.', code: 'ORG_FORBIDDEN' });
      }

      const service = new TemplateCloudBuildService(authContext.serviceClient);
      const result = await service.getBuildStatus(buildId);
      return res.status(result.success ? 200 : 404).json(result);
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
      const serviceClient = createNodeSupabaseClient(supabaseUrl, supabaseServiceKey);
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
            assets,
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
        const userClient = createNodeSupabaseClient(supabaseUrl, supabaseServiceKey, {
          global: { headers: { Authorization: `Bearer ${token}` } }
        });

        const { data, error } = await userClient
          .from('material_components')
          .select(`
            id,
            assets,
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

      const { data: templateRecord } = await serviceClient
        .from('remotion_templates')
        .select('id, storage_path, bundle_status, composition_id, default_config')
        .eq('id', templateId)
        .maybeSingle();

      const hasExternalBundle = Boolean(templateRecord?.storage_path);
      const { data: cloudVersion } = hasExternalBundle
        ? await serviceClient
            .from('remotion_template_versions')
            .select('id, bundle_hash, build_hash, composition_id, export_mode, status, default_props, props_schema')
            .eq('template_id', templateId)
            .in('status', ['APPROVED_FOR_SANDBOX', 'APPROVED'])
            .order('version_number', { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null };

      const { data: cloudBuild } = cloudVersion?.id
        ? await serviceClient
            .from('remotion_template_builds')
            .select('id, bundle_hash, build_hash, serve_url, composition_id, export_mode, status, cloud_provider, build_log, build_error, provider_status, provider_status_detail')
            .eq('template_version_id', cloudVersion.id)
            .eq('bundle_hash', cloudVersion.bundle_hash || '')
            .eq('status', 'BUILT')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
        : { data: null };

      const renderProvider = renderOrchestrator.providerName;
      const cloudBuildReadiness = getExternalBuildReadiness(cloudBuild);
      let externalRenderTarget: ReturnType<typeof resolveExternalRenderTarget> | null = null;
      let externalRenderTargetError: Error | null = null;
      if (hasExternalBundle && cloudVersion && cloudBuild && renderProvider === 'desktop_worker') {
        try {
          externalRenderTarget = resolveExternalRenderTarget({
            jobSnapshot: {
              templateVersionId: cloudVersion.id || null,
              buildId: cloudBuild.id || null,
              bundleHash: cloudVersion.bundle_hash || null,
              externalServeUrl: cloudBuild.serve_url || null,
              cloudProvider: cloudBuild.cloud_provider || null,
            },
            version: cloudVersion,
            build: cloudBuild,
          });
        } catch (error) {
          externalRenderTargetError = error instanceof Error ? error : new Error(String(error));
        }
      }
      const externalBuildIsReady = Boolean(externalRenderTarget);
      const renderMode = externalBuildIsReady && renderProvider === 'desktop_worker'
          ? 'EXTERNAL_DESKTOP_SITE_READY'
        : cloudVersion
          ? 'EXTERNAL_CLOUD_BUILD_READY'
          : 'INTERNAL_COMPOSITION';
      console.log('[ProductionController] Remotion render mode resolved.', {
        componentId,
        templateId,
        organizationId,
        artifactId,
        templateHasExternalBundle: hasExternalBundle,
        cloudVersionId: cloudVersion?.id || null,
        cloudBuildId: cloudBuild?.id || null,
        cloudBundleHash: cloudVersion?.bundle_hash || null,
        renderMode,
        renderProvider,
      });

      if (
        hasExternalBundle &&
        renderProvider === 'desktop_worker' &&
        (!cloudVersion || !externalBuildIsReady)
      ) {
        console.warn('[ProductionController] External bundle render blocked; cloud build is not render-ready.', {
          componentId,
          templateId,
          organizationId,
          cloudVersionId: cloudVersion?.id || null,
          cloudBuildId: cloudBuild?.id || null,
          cloudBuildStatus: cloudBuild?.status || null,
          cloudBuildHasServeUrl: Boolean(cloudBuild?.serve_url),
          cloudBuildCompositionId: cloudBuild?.composition_id || null,
          cloudBuildReadinessReason: cloudBuildReadiness.reason,
          externalRenderTargetError: externalRenderTargetError?.message || null,
          cloudBuildProviderStatus: cloudBuild?.provider_status || null,
          renderMode,
          renderProvider,
        });
        return res.status(409).json({
          error:
            'Esta plantilla externa aun no tiene un build cloud validado. Ejecuta "Construir para cloud" y verifica que tenga serve_url HTTPS, composition_id y validacion aprobada.',
          code: cloudVersion ? 'EXTERNAL_BUILD_NOT_READY' : 'EXTERNAL_BUNDLE_NOT_APPROVED',
          reason: externalRenderTargetError?.message || cloudBuildReadiness.reason,
          renderMode,
          renderProvider,
        });
      }

      let externalPropsResult: ReturnType<typeof buildExternalTemplateProps> | null = null;
      if (renderMode === 'EXTERNAL_DESKTOP_SITE_READY') {
        try {
          if (!externalRenderTarget) {
            throw new Error('EXTERNAL_RENDER_TARGET_INCOMPLETE: no se pudo resolver el target externo.');
          }
          externalPropsResult = buildExternalTemplateProps({
            assets: component.assets || {},
            compositionId: externalRenderTarget.compositionId,
            templateDefaultConfig: templateRecord?.default_config,
            variables,
            bundleDefaultProps: cloudVersion?.default_props,
            propsSchema: cloudVersion?.props_schema,
          });
        } catch (contractError) {
          const message = contractError instanceof Error ? contractError.message : String(contractError);
          const code = message.split(':')[0] || 'EXTERNAL_RENDER_TARGET_INCOMPLETE';
          console.warn('[ProductionController] External render contract rejected.', {
            componentId,
            templateId,
            organizationId,
            cloudVersionId: cloudVersion?.id || null,
            cloudBuildId: cloudBuild?.id || null,
            code,
          });
          return res.status(409).json({
            error: message,
            code,
            renderMode,
            renderProvider,
          });
        }
      }

      let desktopWorkerPropsResult: {
        compositionId: string;
        resolvedProps: ReturnType<typeof buildAssemblyInputProps>;
        propsHash: string;
      } | null = null;
      if (renderProvider === 'desktop_worker' && !externalRenderTarget) {
        const internalCompositionId = resolveInternalCompositionId(templateRecord?.composition_id);
        const templateConfig = mergeTemplateRenderConfigs(
          templateRecord?.default_config,
          variables?.templateConfig,
        );
        const resolvedProps = buildAssemblyInputProps({
          assets: component.assets || {},
          compositionId: internalCompositionId,
          transitionType: variables?.transitionType,
          templateConfig,
          layoutOverrides: variables?.layoutOverrides,
        });
        desktopWorkerPropsResult = {
          compositionId: internalCompositionId,
          resolvedProps,
          propsHash: buildStableHash(resolvedProps),
        };
      }

      const renderTimeoutInMilliseconds = resolveLocalRenderTimeoutMs();
      const renderDiagnostics = buildRenderDiagnosticsSnapshot({
        renderProvider,
        renderMode,
        inputProps: desktopWorkerPropsResult?.resolvedProps || externalPropsResult?.resolvedProps || null,
        rawAssets: component.assets || {},
        templateId,
        templateVersionId: externalRenderTarget?.templateVersionId || cloudVersion?.id || null,
        buildId: externalRenderTarget?.buildId || cloudBuild?.id || null,
        bundleHash: cloudVersion?.bundle_hash || null,
        buildHash: externalRenderTarget?.buildHash || cloudBuild?.build_hash || cloudVersion?.build_hash || null,
        compositionId: desktopWorkerPropsResult?.compositionId || externalRenderTarget?.compositionId || cloudBuild?.composition_id || cloudVersion?.composition_id || null,
        propsHash: desktopWorkerPropsResult?.propsHash || externalPropsResult?.propsHash || null,
        timeoutInMilliseconds: renderTimeoutInMilliseconds,
        cloudBuildReadinessReason: cloudBuildReadiness.reason,
      });

      const inputSnapshot = {
        templateId,
        templateVersionId: externalRenderTarget?.templateVersionId || cloudVersion?.id || null,
        bundleHash: cloudVersion?.bundle_hash || null,
        buildId: externalRenderTarget?.buildId || cloudBuild?.id || null,
        buildHash: externalRenderTarget?.buildHash || cloudBuild?.build_hash || cloudVersion?.build_hash || null,
        compositionId: externalRenderTarget?.compositionId || cloudBuild?.composition_id || cloudVersion?.composition_id || null,
        exportMode: externalRenderTarget?.exportMode || cloudBuild?.export_mode || cloudVersion?.export_mode || 'component',
        externalServeUrl: externalRenderTarget?.serveUrl || cloudBuild?.serve_url || null,
        cloudProvider: cloudBuild?.cloud_provider || null,
        renderMode,
        renderProvider,
        propsHash: desktopWorkerPropsResult?.propsHash || externalPropsResult?.propsHash || null,
        propsSource: externalPropsResult?.propsSource || null,
        resolvedProps: desktopWorkerPropsResult?.resolvedProps || externalPropsResult?.resolvedProps || null,
        propKeys: desktopWorkerPropsResult?.resolvedProps
          ? Object.keys(desktopWorkerPropsResult.resolvedProps)
          : externalPropsResult?.propKeys || [],
        renderDiagnostics,
        variables,
      };
      const idempotencyKey = buildRemotionRenderIdempotencyKey({
        componentId,
        templateId,
        templateVersionId: externalRenderTarget?.templateVersionId || cloudVersion?.id || null,
        bundleHash: cloudVersion?.bundle_hash || null,
        buildId: externalRenderTarget?.buildId || cloudBuild?.id || null,
        buildHash: externalRenderTarget?.buildHash || cloudBuild?.build_hash || cloudVersion?.build_hash || null,
        serveUrl: externalRenderTarget?.serveUrl || cloudBuild?.serve_url || null,
        propsHash: desktopWorkerPropsResult?.propsHash || externalPropsResult?.propsHash || null,
        compositionId: desktopWorkerPropsResult?.compositionId || externalRenderTarget?.compositionId || cloudBuild?.composition_id || cloudVersion?.composition_id || null,
        exportMode: externalRenderTarget?.exportMode || cloudBuild?.export_mode || cloudVersion?.export_mode || 'component',
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

        const shouldRedispatchExistingJob =
          existingJob.status === 'FAILED' ||
          existingJob.status === 'CANCELLED' ||
          (existingJob.status === 'SUCCEEDED' && !hasCompletedRenderOutput(existingJob, component));

        if (shouldRedispatchExistingJob) {
          const { data: resetJob, error: resetJobError } = await serviceClient
            .from('production_jobs')
            .update({
              status: 'PENDING',
              progress: [buildProgressEntry({
                percent: 0,
                message: existingJob.status === 'SUCCEEDED'
                  ? 'Reintentando render: el job anterior decia completado pero no tenia video final persistido'
                  : 'Reintentando render tras fallo previo',
                stage: 'job_reset',
                provider: renderProvider,
              })],
              provider_error: null,
              output_snapshot: {
                completed: false,
                retryOfFailedJob: true,
                resetAt: new Date().toISOString(),
                renderMode,
                templateVersionId: cloudVersion?.id || null,
                bundleHash: cloudVersion?.bundle_hash || null,
                buildId: cloudBuild?.id || null,
                buildHash: cloudBuild?.build_hash || cloudVersion?.build_hash || null,
                compositionId: externalRenderTarget?.compositionId || cloudVersion?.composition_id || null,
                exportMode: externalRenderTarget?.exportMode || cloudBuild?.export_mode || cloudVersion?.export_mode || 'component',
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
            redispatchReason: existingJob.status === 'SUCCEEDED' ? 'missing_final_video_url' : 'terminal_failure',
            renderMode,
            renderProvider: dispatchResult.provider,
            templateVersionId: cloudVersion?.id || null,
            bundleHash: cloudVersion?.bundle_hash || null,
            buildId: cloudBuild?.id || null,
            buildHash: cloudBuild?.build_hash || cloudVersion?.build_hash || null,
            compositionId: externalRenderTarget?.compositionId || cloudVersion?.composition_id || null,
            exportMode: externalRenderTarget?.exportMode || cloudBuild?.export_mode || cloudVersion?.export_mode || 'component',
          });

          return res.json({
            success: true,
            jobId: resetJob.id,
            status: dispatchResult.status,
            renderProvider: dispatchResult.provider,
            message: existingJob.status === 'SUCCEEDED'
              ? 'Incomplete succeeded rendering job reset and dispatched again'
              : 'Failed rendering job reset and dispatched again',
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
          progress: [buildProgressEntry({
            percent: 0,
            message: 'Job de render creado',
            stage: 'job_created',
            provider: renderProvider,
          })]
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
        templateVersionId: cloudVersion?.id || null,
        buildId: cloudBuild?.id || null,
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

  private getDesktopWorkerService(serviceClient?: SupabaseAnyClient) {
    return new DesktopWorkerService(serviceClient || createNodeSupabaseClient(supabaseUrl, supabaseServiceKey));
  }

  private async authenticateDesktopWorker(req: Request) {
    const token = req.headers.authorization?.split(' ')[1];
    const service = this.getDesktopWorkerService();
    const worker = await service.authenticateWorkerToken(token);
    return worker ? { service, worker } : null;
  }

  async registerDesktopWorker(req: Request, res: Response, next: NextFunction) {
    try {
      const auth = await this.authenticateRequest(req);
      if (!auth) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const organizationId = String(req.body?.organizationId || '');
      if (!isUuid(organizationId)) {
        return res.status(400).json({ error: 'organizationId must be a valid UUID' });
      }
      if (!auth.organizationIds.includes(organizationId)) {
        return res.status(403).json({ error: 'Forbidden: You do not have access to this organization' });
      }

      const service = this.getDesktopWorkerService(auth.serviceClient);
      const result = await service.registerWorker({
        organizationId,
        userId: auth.user.id,
        deviceName: req.body?.deviceName,
        platform: req.body?.platform,
        arch: req.body?.arch,
        appVersion: req.body?.appVersion,
      });

      return res.status(201).json({
        success: true,
        worker: result.worker,
        workerToken: result.workerToken,
      });
    } catch (err) {
      return next(err);
    }
  }

  async listDesktopWorkers(req: Request, res: Response, next: NextFunction) {
    try {
      const auth = await this.authenticateRequest(req);
      if (!auth) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const organizationId = String(req.query?.organizationId || req.body?.organizationId || '');
      if (!isUuid(organizationId)) {
        return res.status(400).json({ error: 'organizationId must be a valid UUID' });
      }
      if (!auth.organizationIds.includes(organizationId)) {
        return res.status(403).json({ error: 'Forbidden: You do not have access to this organization' });
      }

      const workers = await this.getDesktopWorkerService(auth.serviceClient).listWorkers(organizationId);
      return res.json({ success: true, workers });
    } catch (err) {
      return next(err);
    }
  }

  async createDesktopWorkerLinkCode(req: Request, res: Response, next: NextFunction) {
    try {
      const auth = await this.authenticateRequest(req);
      if (!auth) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const organizationId = String(req.body?.organizationId || '');
      if (!isUuid(organizationId)) {
        return res.status(400).json({ error: 'organizationId must be a valid UUID' });
      }
      if (!auth.organizationIds.includes(organizationId)) {
        return res.status(403).json({ error: 'Forbidden: You do not have access to this organization' });
      }

      const result = await this.getDesktopWorkerService(auth.serviceClient).createLinkCode({
        organizationId,
        userId: auth.user.id,
        deviceName: req.body?.deviceName,
        platform: req.body?.platform,
        arch: req.body?.arch,
        appVersion: req.body?.appVersion,
      });

      return res.status(201).json({
        success: true,
        code: result.code,
        linkCode: result.linkCode,
      });
    } catch (err) {
      return next(err);
    }
  }

  async linkDesktopWorker(req: Request, res: Response, next: NextFunction) {
    try {
      const code = String(req.body?.code || '');
      if (!code.trim()) {
        return res.status(400).json({ error: 'code is required' });
      }

      const result = await this.getDesktopWorkerService().consumeLinkCode({
        code,
        deviceName: req.body?.deviceName,
        platform: req.body?.platform,
        arch: req.body?.arch,
        appVersion: req.body?.appVersion,
      });

      return res.status(201).json({
        success: true,
        worker: result.worker,
        workerToken: result.workerToken,
      });
    } catch (err: any) {
      const message = String(err?.message || '');
      if (message.includes('INVALID_LINK_CODE')) {
        return res.status(400).json({ error: 'Invalid link code' });
      }
      if (message.includes('NOT_FOUND')) {
        return res.status(404).json({ error: 'Link code not found' });
      }
      if (message.includes('EXPIRED') || message.includes('CONSUMED')) {
        return res.status(409).json({ error: message });
      }
      return next(err);
    }
  }

  async desktopWorkerHeartbeat(req: Request, res: Response, next: NextFunction) {
    try {
      const auth = await this.authenticateDesktopWorker(req);
      if (!auth) {
        return res.status(401).json({ error: 'Invalid or revoked worker token' });
      }

      const worker = await auth.service.heartbeat(auth.worker, req.body || {});
      return res.json({ success: true, worker });
    } catch (err) {
      return next(err);
    }
  }

  async claimDesktopWorkerJob(req: Request, res: Response, next: NextFunction) {
    try {
      const auth = await this.authenticateDesktopWorker(req);
      if (!auth) {
        return res.status(401).json({ error: 'Invalid or revoked worker token' });
      }
      const { jobId } = req.params;
      if (!isUuid(jobId)) {
        return res.status(400).json({ error: 'jobId must be a valid UUID' });
      }

      const job = await auth.service.claimJob(auth.worker, jobId);
      return res.json({ success: true, job });
    } catch (err: any) {
      if (String(err?.message || '').includes('FORBIDDEN')) {
        return res.status(403).json({ error: err.message });
      }
      if (String(err?.message || '').includes('NOT_FOUND')) {
        return res.status(404).json({ error: err.message });
      }
      if (String(err?.message || '').includes('NOT_CLAIMABLE') || String(err?.message || '').includes('NOT_DESKTOP_WORKER')) {
        return res.status(409).json({ error: err.message });
      }
      return next(err);
    }
  }

  async claimNextDesktopWorkerJob(req: Request, res: Response, next: NextFunction) {
    try {
      const auth = await this.authenticateDesktopWorker(req);
      if (!auth) {
        return res.status(401).json({ error: 'Invalid or revoked worker token' });
      }

      const job = await auth.service.claimNextJob(auth.worker);
      return res.json({ success: true, job });
    } catch (err: any) {
      if (String(err?.message || '').includes('FORBIDDEN')) {
        return res.status(403).json({ error: err.message });
      }
      if (String(err?.message || '').includes('NOT_FOUND')) {
        return res.status(404).json({ error: err.message });
      }
      if (String(err?.message || '').includes('NOT_CLAIMABLE') || String(err?.message || '').includes('NOT_DESKTOP_WORKER')) {
        return res.status(409).json({ error: err.message });
      }
      return next(err);
    }
  }

  async reportDesktopWorkerProgress(req: Request, res: Response, next: NextFunction) {
    try {
      const auth = await this.authenticateDesktopWorker(req);
      if (!auth) {
        return res.status(401).json({ error: 'Invalid or revoked worker token' });
      }
      const { jobId } = req.params;
      if (!isUuid(jobId)) {
        return res.status(400).json({ error: 'jobId must be a valid UUID' });
      }

      const result = await auth.service.reportProgress(auth.worker, jobId, req.body || {});
      return res.json({ success: true, ...result });
    } catch (err) {
      return next(err);
    }
  }

  async completeDesktopWorkerJob(req: Request, res: Response, next: NextFunction) {
    try {
      const auth = await this.authenticateDesktopWorker(req);
      if (!auth) {
        return res.status(401).json({ error: 'Invalid or revoked worker token' });
      }
      const { jobId } = req.params;
      if (!isUuid(jobId)) {
        return res.status(400).json({ error: 'jobId must be a valid UUID' });
      }

      const result = await auth.service.completeJob(auth.worker, jobId, {
        outputStoragePath: req.body?.outputStoragePath,
        checksum: req.body?.checksum,
        durationSeconds: req.body?.durationSeconds,
        logsRef: req.body?.logsRef,
      });
      return res.json({ success: true, ...result });
    } catch (err) {
      return next(err);
    }
  }

  async failDesktopWorkerJob(req: Request, res: Response, next: NextFunction) {
    try {
      const auth = await this.authenticateDesktopWorker(req);
      if (!auth) {
        return res.status(401).json({ error: 'Invalid or revoked worker token' });
      }
      const { jobId } = req.params;
      if (!isUuid(jobId)) {
        return res.status(400).json({ error: 'jobId must be a valid UUID' });
      }

      const result = await auth.service.failJob(auth.worker, jobId, req.body || {});
      return res.json({ success: true, ...result });
    } catch (err) {
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
      const serviceClient = createNodeSupabaseClient(supabaseUrl, supabaseServiceKey);
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
        const userClient = createNodeSupabaseClient(supabaseUrl, supabaseServiceKey, {
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
