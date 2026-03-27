
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type ArtifactRelation =
    | { idea_central: string | null }
    | { idea_central: string | null }[]
    | null;

interface PublicationRequestRow {
    id: string;
    status: string;
    created_at: string;
    artifact_id: string;
    artifacts: ArtifactRelation;
}

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
    (requests as PublicationRequestRow[]).forEach((request) => {
        const artifact = Array.isArray(request.artifacts)
            ? request.artifacts[0]
            : request.artifacts;

        console.log(`- ${request.created_at} | Status: ${request.status}`);
        console.log(`  Artifact: ${artifact?.idea_central ?? 'Sin título'} (${request.artifact_id})`);
    });
}

listRequests();
