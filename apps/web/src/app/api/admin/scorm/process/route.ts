import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ScormTransformationService } from '@/domains/scorm/services/scorm-transformation.service';

interface ScormProcessRequestBody {
    importId?: string;
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Processing failed';
}

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = (await req.json()) as ScormProcessRequestBody;
        const { importId } = body;

        if (!importId) {
            return NextResponse.json({ error: 'Import ID required' }, { status: 400 });
        }

        // Start processing (async or sync? Doing sync for now for MVP feedback loop)
        const service = new ScormTransformationService();
        const result = await service.processImport(importId, user.id);

        return NextResponse.json({ success: true, artifactId: result.artifactId });

    } catch (error: unknown) {
        console.error('Process Error:', error);
        return NextResponse.json({ error: getErrorMessage(error) }, { status: 500 });
    }
}
