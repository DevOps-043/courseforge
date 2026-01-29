
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function inspectRequest() {
    const artifactId = '0287274a-d2f7-456a-9470-138f4b009f18';
    console.log(`Inspecting Publication Request for: ${artifactId}`);

    const { data: req } = await supabase
        .from('publication_requests')
        .select('*')
        .eq('artifact_id', artifactId)
        .single();

    if (!req) {
        console.log('No publication request found.');
        return;
    }

    console.log('Status:', req.status);
    console.log('Lesson Videos JSON:', JSON.stringify(req.lesson_videos, null, 2));
}

inspectRequest();
