import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ScormTransformationService } from '@/domains/scorm/services/scorm-transformation.service';

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const body = await req.json();
        const { importId } = body;

        if (!importId) {
            return NextResponse.json({ error: 'Import ID required' }, { status: 400 });
        }

        // Start processing (async or sync? Doing sync for now for MVP feedback loop)
        const service = new ScormTransformationService();
        const result = await service.processImport(importId, user.id);

        return NextResponse.json({ success: true, artifactId: result.artifactId });

    } catch (error: any) {
        console.error('Process Error:', error);
        return NextResponse.json({ error: error.message || 'Processing failed' }, { status: 500 });
    }
}
