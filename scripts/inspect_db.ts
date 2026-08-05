
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function resetAndInspect() {
  const curationId = 'fdef0c20-d57c-4180-b807-3130b97fa41a';
  const artifactId = '0d5bde6c-b9b1-479b-8887-422fa69bcd89';

  // Delete old curation_rows for this curation
  console.log(`--- Deleting old curation_rows for ${curationId} ---`);
  const { error: delErr } = await supabase.from('curation_rows').delete().eq('curation_id', curationId);
  if (delErr) console.error('Delete error:', delErr);
  else console.log('Deleted old rows successfully');

  // Reset curation state to PHASE2_GENERATED (to allow re-curation)
  console.log(`\n--- Resetting curation state ---`);
  const { error: updateErr } = await supabase.from('curation').update({
    state: 'PHASE2_GENERATED',
    updated_at: new Date().toISOString()
  }).eq('id', curationId);
  if (updateErr) console.error('Update error:', updateErr);
  else console.log('Curation state reset to PHASE2_GENERATED');

  // Show instructional plan structure
  console.log(`\n--- Instructional plan for artifact ${artifactId} ---`);
  const { data: plan, error: planErr } = await supabase.from('instructional_plans').select('lesson_plans').eq('artifact_id', artifactId).single();
  if (planErr) console.error('Plan error:', planErr);
  else {
    const lessons = plan?.lesson_plans || [];
    console.log(`Found ${lessons.length} lessons`);

    // Count total components
    let totalComponents = 0;
    lessons.forEach((lesson: any) => {
      if (lesson.components) totalComponents += lesson.components.length;
    });
    console.log(`Total components: ${totalComponents}`);

    // Show first lesson structure
    if (lessons.length > 0) {
      console.log('\nFirst lesson structure:');
      console.log('- lesson_id:', lessons[0].lesson_id);
      console.log('- lesson_title:', lessons[0].lesson_title || lessons[0].title);
      console.log('- components:', lessons[0].components?.length);
      if (lessons[0].components?.length > 0) {
        console.log('- First component:', JSON.stringify(lessons[0].components[0], null, 2));
      }
    }
  }

  // Show current curation state
  console.log(`\n--- Current curation state ---`);
  const { data: curation } = await supabase.from('curation').select('*').eq('id', curationId).single();
  console.log(JSON.stringify(curation, null, 2));
}

resetAndInspect();
