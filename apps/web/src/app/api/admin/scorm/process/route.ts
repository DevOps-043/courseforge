import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ScormTransformationService } from '@/domains/scorm/services/scorm-transformation.service';
import { getErrorMessage } from '@/lib/errors';
import { getAuthenticatedUser } from '@/lib/server/artifact-action-auth';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';

interface ScormProcessRequestBody {
    importId?: string;
}

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);

        if (!authenticatedUser) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const tenant = await resolveActiveTenantContext();
        if (!tenant) {
            return NextResponse.json({ error: 'Empresa no valida o no autorizada.' }, { status: 403 });
        }

        const body = (await req.json()) as ScormProcessRequestBody;
        const { importId } = body;

        if (!importId) {
            return NextResponse.json({ error: 'Import ID required' }, { status: 400 });
        }

        // Start processing (async or sync? Doing sync for now for MVP feedback loop)
        const service = new ScormTransformationService();
        const result = await service.processImport(importId, authenticatedUser.userId, tenant.organizationId);

        return NextResponse.json({ success: true, artifactId: result.artifactId });

    } catch (error: unknown) {
        console.error('Process Error:', error);
        return NextResponse.json({ error: getErrorMessage(error, 'Processing failed') }, { status: 500 });
    }
}
