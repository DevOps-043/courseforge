
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

async function inspect() {
    console.log('Fetching last 10 artifacts to find one with materials...');
    // Get latest 10 artifacts
    const { data: artifacts } = await supabase
        .from('artifacts')
        .select('id, idea_central, created_at')
        .order('created_at', { ascending: false })
        .limit(10);

    if (!artifacts?.length) {
        console.log('No artifacts found');
        return;
    }

    let outputArtifact;
    let materials;

    // Find first artifact with materials
    for (const art of artifacts) {
        const { data: mat } = await supabase.from('materials').select('id, artifact_id').eq('artifact_id', art.id).maybeSingle();
        if (mat) {
            outputArtifact = art;
            materials = mat;
            break;
        }
    }

    if (!outputArtifact || !materials) {
        console.log('No artifacts with materials found in the last 10 entries.');
        return;
    }

    console.log(`Inspecting Artifact: ${outputArtifact.idea_central} (${outputArtifact.id})`);

    const { data: lessons } = await supabase
        .from('material_lessons')
        .select(`
        lesson_id, 
        lesson_title, 
        material_components(
          type,
          assets,
          content
        )
    `)
        .eq('materials_id', materials.id);

    if (!lessons) {
        console.log('No lessons found');
        return;
    }

    console.log(`Found ${lessons.length} lessons.`);
    lessons.forEach((l: any, idx) => {
        console.log(`\nLesson ${l.lesson_id}: ${l.lesson_title}`);
        if (l.material_components) {
            l.material_components.forEach((c: any) => {
                // Inspect all video related components
                if (c.type.includes('VIDEO')) {
                    console.log(`  - Component: ${c.type}`);
                    console.log(`    Assets:`, JSON.stringify(c.assets, null, 2));
                    console.log(`    Content Duration Estimate:`, c.content?.duration_estimate_minutes);

                    if (c.content?.script?.sections) {
                        console.log(`    Script Sections Count:`, c.content.script.sections.length);
                        const totalSec = c.content.script.sections.reduce((acc: number, sec: any) => acc + (sec.duration_seconds || 0), 0);
                        console.log(`    Calculated Script Duration (sec):`, totalSec);
                    } else {
                        console.log(`    Script Sections: NONE`);
                    }
                }
            });
        }
    });
}

inspect();
