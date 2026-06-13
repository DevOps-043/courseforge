import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const componentIds = process.argv.slice(2);

if (componentIds.length === 0) {
  throw new Error('Uso: npx tsx apps/web/scripts/inspect_quiz_issues.ts <componentId...>');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en apps/web/.env.local',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase
    .from('material_components')
    .select(
      `
      id,
      content,
      material_lessons(
        id,
        lesson_id,
        lesson_title,
        module_title,
        materials(
          artifact_id,
          artifacts(idea_central)
        )
      )
    `,
    )
    .in('id', componentIds);

  if (error) {
    throw error;
  }

  console.log(JSON.stringify(data, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
