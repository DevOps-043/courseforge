import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ScormParserService } from '@/domains/scorm/services/scorm-parser.service';
import type { ScormManifest } from '@/domains/scorm/types';
import { randomUUID } from 'crypto';
import { getErrorMessage } from '@/lib/errors';
import { canReviewContent, getAuthenticatedUser, getServiceRoleClient } from '@/lib/server/artifact-action-auth';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';

const MAX_SCORM_UPLOAD_BYTES = 100 * 1024 * 1024;

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();

        // 1. Auth + tenant check
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const tenant = await resolveActiveTenantContext();
        if (!tenant) {
            return NextResponse.json({ error: 'Empresa no valida o no autorizada.' }, { status: 403 });
        }
        if (!await canReviewContent(authenticatedUser.userId, tenant)) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
        const admin = getServiceRoleClient();

        // 2. Parse FormData
        const formData = await req.formData();
        const file = formData.get('file');

        if (!(file instanceof File)) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        if (!file.name.endsWith('.zip')) {
            return NextResponse.json({ error: 'Invalid file type. Only .zip allowed.' }, { status: 400 });
        }
        if (file.size <= 0 || file.size > MAX_SCORM_UPLOAD_BYTES) {
            return NextResponse.json({ error: 'El paquete SCORM debe pesar menos de 100 MB.' }, { status: 413 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // 3. Upload to Storage
        const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-160);
        const storagePath = `organizations/${tenant.organizationId}/uploads/${authenticatedUser.userId}/${randomUUID()}-${safeFileName}`;
        const { error: uploadError } = await admin.storage
            .from('scorm-packages')
            .upload(storagePath, file, {
                contentType: 'application/zip',
                upsert: false
            });

        if (uploadError) {
            console.error('Upload Error:', uploadError);
            return NextResponse.json({ error: 'Failed to upload file to storage' }, { status: 500 });
        }

        // 4. Create DB Record (Initial)
        const { data: importRecord, error: dbError } = await admin
            .from('scorm_imports')
            .insert({
                original_filename: file.name,
                storage_path: storagePath,
                status: 'SCORM_UPLOADED',
                created_by: authenticatedUser.userId,
                organization_id: tenant.organizationId
            })
            .select()
            .single();

        if (dbError) {
            console.error('DB Insert Error:', dbError);
            const { error: cleanupError } = await admin.storage
                .from('scorm-packages')
                .remove([storagePath]);
            if (cleanupError) {
                console.error('SCORM orphan cleanup failed:', cleanupError);
            }
            return NextResponse.json({ error: 'Failed to create import record' }, { status: 500 });
        }

        // 5. Trigger Async Parsing (Sync for now for MVP simplicity, can be moved to queue)
        // In a real production env with large files, this should be a background job.
        // We will do a quick parse here to validate manifest and update structure.

        try {
            const parser = new ScormParserService();
            const manifest = await parser.parsePackage(buffer);
            const typedManifest = manifest as ScormManifest;

            await admin
                .from('scorm_imports')
                .update({
                    status: 'SCORM_ANALYZED',
                    scorm_version: typedManifest.version,
                    manifest_raw: typedManifest,
                    organizations: typedManifest.organizations,
                    resources: typedManifest.resources,
                    sco_count: typedManifest.resources.filter((resource) => resource.type === 'sco').length
                })
                .eq('id', importRecord.id);

            return NextResponse.json({
                success: true,
                importId: importRecord.id,
                manifest
            });

        } catch (parseError: unknown) {
            console.error('Parse Error:', parseError);
            await admin
                .from('scorm_imports')
                .update({
                    status: 'FAILED',
                    error_message: getErrorMessage(parseError)
                })
                .eq('id', importRecord.id);

            return NextResponse.json({ error: 'Failed to parse SCORM package: ' + getErrorMessage(parseError) }, { status: 400 });
        }

    } catch (error: unknown) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
