import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ScormParserService } from '@/domains/scorm/services/scorm-parser.service';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();

        // 1. Auth Check
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 2. Parse FormData
        const formData = await req.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
        }

        if (!file.name.endsWith('.zip')) {
            return NextResponse.json({ error: 'Invalid file type. Only .zip allowed.' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());

        // 3. Upload to Storage
        const storagePath = `uploads/${user.id}/${randomUUID()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
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
        const { data: importRecord, error: dbError } = await supabase
            .from('scorm_imports')
            .insert({
                original_filename: file.name,
                storage_path: storagePath,
                status: 'SCORM_UPLOADED',
                created_by: user.id
            })
            .select()
            .single();

        if (dbError) {
            console.error('DB Insert Error:', dbError);
            return NextResponse.json({ error: 'Failed to create import record' }, { status: 500 });
        }

        // 5. Trigger Async Parsing (Sync for now for MVP simplicity, can be moved to queue)
        // In a real production env with large files, this should be a background job.
        // We will do a quick parse here to validate manifest and update structure.

        try {
            const parser = new ScormParserService();
            const manifest = await parser.parsePackage(buffer);

            await supabase
                .from('scorm_imports')
                .update({
                    status: 'SCORM_ANALYZED',
                    scorm_version: manifest.version,
                    manifest_raw: manifest as any, // jsonb
                    organizations: manifest.organizations as any,
                    resources: manifest.resources as any,
                    sco_count: manifest.resources.filter(r => r.type === 'sco').length
                })
                .eq('id', importRecord.id);

            return NextResponse.json({
                success: true,
                importId: importRecord.id,
                manifest
            });

        } catch (parseError: any) {
            console.error('Parse Error:', parseError);
            await supabase
                .from('scorm_imports')
                .update({
                    status: 'FAILED',
                    error_message: parseError.message
                })
                .eq('id', importRecord.id);

            return NextResponse.json({ error: 'Failed to parse SCORM package: ' + parseError.message }, { status: 400 });
        }

    } catch (error: any) {
        console.error('API Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
