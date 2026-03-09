import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';

export async function POST(request: Request) {
    try {
        const { artifactId, data } = await request.json();

        if (!artifactId) {
            return NextResponse.json({ error: 'Falta artifactId' }, { status: 400 });
        }

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
        }
        const { data: profile } = await supabase.from('profiles').select('platform_role').eq('id', user.id).single();
        if (profile?.platform_role === 'CONSTRUCTOR') {
            return NextResponse.json({ error: 'Falta de permisos. Solo Arquitectos y Admins pueden guardar para publicación.' }, { status: 403 });
        }

        const { data: existing } = await supabase
            .from('publication_requests')
            .select('id')
            .eq('artifact_id', artifactId)
            .single();

        if (existing) {
            const { error } = await supabase
                .from('publication_requests')
                .update({
                    category: data.category,
                    level: data.level,
                    instructor_email: data.instructor_email,
                    slug: data.slug,
                    price: data.price,
                    thumbnail_url: data.thumbnail_url,
                    lesson_videos: data.lesson_videos,
                    selected_lessons: data.selected_lessons || null,
                    status: data.status,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id);

            if (error) throw error;
        } else {
            const { error } = await supabase
                .from('publication_requests')
                .insert({
                    artifact_id: artifactId,
                    category: data.category,
                    level: data.level,
                    instructor_email: data.instructor_email,
                    slug: data.slug,
                    price: data.price,
                    thumbnail_url: data.thumbnail_url,
                    lesson_videos: data.lesson_videos,
                    selected_lessons: data.selected_lessons || null,
                    status: data.status
                });

            if (error) throw error;
        }

        revalidatePath(`/admin/artifacts/${artifactId}/publish`);
        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('[API /save-draft] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
