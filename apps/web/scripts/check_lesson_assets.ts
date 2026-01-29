
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function checkLessonAssets() {
    const lessonTitle = "Evolución de la IA: De los sistemas expertos a los modelos transformadores";

    // Find the lesson first (partial match in title)
    const { data: lessons } = await supabase
        .from('material_lessons')
        .select('id, lesson_title')
        .ilike('lesson_title', `%${lessonTitle}%`)
        .limit(1);

    if (!lessons || lessons.length === 0) {
        console.log('Lesson not found');
        return;
    }

    const lesson = lessons[0];
    console.log('Found lesson:', lesson.lesson_title);

    const { data: components } = await supabase
        .from('material_components')
        .select('*')
        .eq('material_lesson_id', lesson.id);

    if (!components) {
        console.log('No components found for lesson');
        return;
    }

    components.forEach((c: any) => {
        console.log(`Component: ${c.type}`);
        console.log('Assets:', JSON.stringify(c.assets, null, 2));
    });
}

checkLessonAssets();
