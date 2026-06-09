import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { RemotionQueueService } from './remotion-queue.service';
import { jwtVerify } from 'jose';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const queueService = RemotionQueueService.getInstance();

export class ProductionController {
  async renderRemotion(req: Request, res: Response, next: NextFunction) {
    try {
      const { componentId, templateId, variables = {} } = req.body;
      if (!componentId || !templateId) {
        return res.status(400).json({ error: 'componentId and templateId are required' });
      }

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

      // Generate idempotency key for this job to prevent duplicate jobs
      const idempotencyKey = `remotion-render-${componentId}-${Date.now()}`;

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
          input_snapshot: { templateId, variables },
          created_by: user.id,
          progress: [{ percent: 0, message: 'Encolado en cola local', timestamp: new Date().toISOString() }]
        })
        .select('*')
        .single();

      if (jobError || !job) {
        console.error('[ProductionController] Error creating production job:', jobError);
        return res.status(500).json({ error: 'Failed to create production job: ' + (jobError?.message || 'Unknown error') });
      }

      // 4. Enqueue the job in our sequential worker
      queueService.enqueue(job.id);

      return res.json({
        success: true,
        jobId: job.id,
        status: job.status,
        message: 'Rendering job queued successfully'
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
