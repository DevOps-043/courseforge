
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function listRequests() {
    console.log('Listing all publication requests...');

    const { data: requests } = await supabase
        .from('publication_requests')
        .select(`
        id, 
        status, 
        created_at, 
        artifact_id,
        artifacts ( idea_central )
    `)
        .order('created_at', { ascending: false });

    if (!requests?.length) {
        console.log('No requests found.');
        return;
    }

    console.log(`Found ${requests.length} requests:`);
    requests.forEach(r => {
        console.log(`- ${r.created_at} | Status: ${r.status}`);
        console.log(`  Artifact: ${r.artifacts?.idea_central} (${r.artifact_id})`);
    });
}

listRequests();
