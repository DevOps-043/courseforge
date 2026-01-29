
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env from .../apps/web/.env.local
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase URL or Key');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);


async function checkData() {
    console.log('Checking ALL publication request data...');

    const { data: requests, error } = await supabase
        .from('publication_requests')
        .select('id, artifact_id, updated_at, lesson_videos')
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (!requests || requests.length === 0) {
        console.log('No publication requests found in the table.');
        return;
    }

    console.log(`Found ${requests.length} requests.`);

    requests.forEach((req, idx) => {
        console.log(`\n[${idx}] Request ID: ${req.id}`);
        console.log(`    Artifact ID: ${req.artifact_id}`);
        console.log(`    Updated At: ${req.updated_at}`);
        const videos = req.lesson_videos;
        if (videos) {
            const count = Object.keys(videos).length;
            console.log(`    Video Mapping Count: ${count}`);
            if (count > 0) {
                const first = Object.values(videos)[0] as any;
                console.log(`    Sample Duration: ${first.duration} (${first.video_id})`);
            }
        } else {
            console.log('    No lesson_videos data.');
        }
    });
}


checkData();
