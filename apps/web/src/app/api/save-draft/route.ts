import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';
import { savePublicationDraftRequestSchema } from '@/domains/publication/publication.schemas';
import {
    getAuthenticatedUser,
    getAuthorizedArtifactAdminForTenant,
    getServiceRoleClient,
} from '@/lib/server/artifact-action-auth';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';

export async function POST(request: Request) {
    try {
        const parsedRequest = savePublicationDraftRequestSchema.safeParse(await request.json());
        if (!parsedRequest.success) {
            return NextResponse.json({ error: 'Borrador de publicación inválido.' }, { status: 400 });
        }
        const { artifactId, data } = parsedRequest.data;

        const supabase = await createClient();
        const authenticatedUser = await getAuthenticatedUser(supabase);
        if (!authenticatedUser) {
            return NextResponse.json({ error: 'No autorizado.' }, { status: 401 });
        }

        const admin = getServiceRoleClient();
        const tenant = await resolveActiveTenantContext();
        if (!tenant) {
            return NextResponse.json({ error: 'Empresa no valida o no autorizada.' }, { status: 403 });
        }

        const authorized = await getAuthorizedArtifactAdminForTenant(artifactId, tenant);
        if (!authorized) {
            return NextResponse.json({ error: 'Artefacto no encontrado para esta empresa.' }, { status: 404 });
        }

        if (tenant.platformRole === 'CONSTRUCTOR') {
            return NextResponse.json({ error: 'Falta de permisos. Solo Arquitectos y Admins pueden guardar para publicación.' }, { status: 403 });
        }

        const { error } = await admin
            .from('publication_requests')
            .upsert({
                artifact_id: artifactId,
                category: data.category,
                level: data.level,
                instructor_email: data.instructor_email,
                slug: data.slug,
                price: data.price,
                thumbnail_url: data.thumbnail_url || null,
                lesson_videos: data.lesson_videos,
                selected_lessons: data.selected_lessons || null,
                status: data.status,
                updated_at: new Date().toISOString()
            }, { onConflict: 'artifact_id' });
        if (error) throw error;

        revalidatePath(`/admin/artifacts/${artifactId}/publish`);
        revalidatePath(`/${tenant.organizationSlug}/admin/artifacts/${artifactId}/publish`);
        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        console.error('[API /save-draft] Error:', error);
        return NextResponse.json({ success: false, error: 'No se pudo guardar el borrador.' }, { status: 500 });
    }
}
