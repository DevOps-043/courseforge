import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';
import type { PublicationDraftData } from '@/domains/publication/types/publication.types';
import { getErrorMessage } from '@/lib/errors';
import {
    getAuthenticatedUser,
    getServiceRoleClient,
} from '@/lib/server/artifact-action-auth';

interface SaveDraftRequestBody {
    artifactId?: string;
    data?: PublicationDraftData;
}

export async function POST(request: Request) {
    try {
        const { artifactId, data } = (await request.json()) as SaveDraftRequestBody;

        if (!artifactId || !data) {
            return NextResponse.json({ error: 'Falta artifactId' }, { status: 400 });
        }

        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
        }

        const admin = getServiceRoleClient();
        const { data: profile } = await admin
            .from('profiles')
            .select('platform_role')
            .eq('id', authenticatedUser.userId)
            .maybeSingle();
        if (profile?.platform_role === 'CONSTRUCTOR') {
            return NextResponse.json({ error: 'Falta de permisos. Solo Arquitectos y Admins pueden guardar para publicación.' }, { status: 403 });
        }

        const { data: existing } = await admin
            .from('publication_requests')
            .select('id')
            .eq('artifact_id', artifactId)
            .maybeSingle();

        if (existing) {
            const { error } = await admin
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
            const { error } = await admin
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
    } catch (error: unknown) {
        console.error('[API /save-draft] Error:', error);
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}
