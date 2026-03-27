'use server';

import { revalidatePath } from 'next/cache';
import { getErrorMessage } from '@/lib/errors';
import type { PublicationComponent } from '@/domains/publication/types/publication.types';
import type {
    PublicationDataResult,
    PublicationDraftData,
    PublicationLesson,
    PublicationRequestRecord,
    PublicationVideoLesson,
} from '@/domains/publication/types/publication.types';
import { getActiveOrganizationId } from '@/utils/auth/session';
import { createClient } from '@/utils/supabase/server';

interface RawMaterialLessonRow {
    lesson_id: string;
    lesson_title: string;
    module_title: string;
    oa_text?: string | null;
    material_components?: PublicationComponent[] | null;
}

interface RawArtifactRow {
    id: string;
    idea_central: string;
    descripcion: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function extractVideoMetadata(
    components: PublicationComponent[] | null | undefined,
) {
    let videoUrl = '';
    let videoDuration = 0;

    if (!Array.isArray(components)) {
        return { videoUrl, videoDuration };
    }

    const videoComponent = components.find(
        (component) =>
            component.assets?.final_video_url ||
            component.assets?.video_url ||
            component.type.includes('VIDEO'),
    );

    if (!videoComponent) {
        return { videoUrl, videoDuration };
    }

    videoUrl =
        videoComponent.assets?.final_video_url ||
        videoComponent.assets?.video_url ||
        '';

    const content = isRecord(videoComponent.content)
        ? videoComponent.content
        : null;
    const script = content && isRecord(content.script) ? content.script : null;
    const sections = script && Array.isArray(script.sections) ? script.sections : [];

    if (videoDuration === 0 && sections.length > 0) {
        videoDuration = sections.reduce((total, section) => {
            if (!isRecord(section)) {
                return total;
            }
            return total + (Number(section.duration_seconds) || 0);
        }, 0);
    }

    if (videoDuration === 0 && typeof content?.duration_estimate_minutes === 'number') {
        videoDuration = Math.round(content.duration_estimate_minutes * 60);
    }

    return { videoUrl, videoDuration };
}

function mapLessonToPublicationLesson(
    lesson: RawMaterialLessonRow,
): PublicationLesson {
    const components = lesson.material_components || [];
    const { videoUrl, videoDuration } = extractVideoMetadata(components);

    return {
        id: lesson.lesson_id,
        title: lesson.lesson_title,
        module_title: lesson.module_title,
        auto_video_url: videoUrl,
        auto_duration: videoDuration,
        summary: lesson.oa_text || '',
        components,
    };
}

function mapLessonToVideoLesson(
    lesson: RawMaterialLessonRow,
): PublicationVideoLesson {
    const { videoUrl, videoDuration } = extractVideoMetadata(
        lesson.material_components,
    );

    return {
        id: lesson.lesson_id,
        title: lesson.lesson_title,
        module_title: lesson.module_title,
        auto_video_url: videoUrl,
        auto_duration: videoDuration,
    };
}

export async function getPublicationData(
    artifactId: string,
): Promise<PublicationDataResult> {
    const supabase = await createClient();
    const activeOrgId = await getActiveOrganizationId();

    let artifactQuery = supabase
        .from('artifacts')
        .select('id, idea_central, generation_metadata, descripcion')
        .eq('id', artifactId);

    if (activeOrgId) {
        artifactQuery = artifactQuery.eq('organization_id', activeOrgId);
    }

    const { data: artifact, error: artifactError } = await artifactQuery.single<RawArtifactRow>();

    if (artifactError || !artifact) {
        throw new Error('Artifact not found');
    }

    const { data: materials } = await supabase
        .from('materials')
        .select('id, package')
        .eq('artifact_id', artifactId)
        .maybeSingle();

    let lessons: PublicationLesson[] = [];

    if (materials?.id) {
        const { data: rawLessons } = await supabase
            .from('material_lessons')
            .select(`
                lesson_id,
                lesson_title,
                module_title,
                oa_text,
                material_components(
                    type,
                    assets,
                    content
                )
            `)
            .eq('materials_id', materials.id)
            .order('module_id', { ascending: true })
            .order('lesson_id', { ascending: true });

        lessons = (rawLessons || []).map((lesson) =>
            mapLessonToPublicationLesson(lesson as RawMaterialLessonRow),
        );
    }

    const { data: request } = await supabase
        .from('publication_requests')
        .select('id, category, level, instructor_email, slug, price, thumbnail_url, lesson_videos, selected_lessons, upstream_dirty, upstream_dirty_source, status')
        .eq('artifact_id', artifactId)
        .maybeSingle();

    return {
        artifact: {
            id: artifact.id,
            title: artifact.idea_central,
            description: artifact.descripcion,
        },
        lessons,
        request: (request as PublicationRequestRecord | null) || null,
        materialsPackage: materials?.package || null,
    };
}

export async function savePublicationDraft(
    artifactId: string,
    data: PublicationDraftData,
) {
    const supabase = await createClient();

    try {
        const { data: existing } = await supabase
            .from('publication_requests')
            .select('id')
            .eq('artifact_id', artifactId)
            .maybeSingle();

        const payload = {
            category: data.category,
            level: data.level,
            instructor_email: data.instructor_email,
            slug: data.slug,
            price: data.price,
            thumbnail_url: data.thumbnail_url,
            lesson_videos: data.lesson_videos,
            selected_lessons: data.selected_lessons || null,
            status: data.status,
            updated_at: new Date().toISOString(),
        };

        if (existing?.id) {
            const { error } = await supabase
                .from('publication_requests')
                .update(payload)
                .eq('id', existing.id);

            if (error) {
                throw error;
            }
        } else {
            const { error } = await supabase
                .from('publication_requests')
                .insert({
                    artifact_id: artifactId,
                    ...payload,
                });

            if (error) {
                throw error;
            }
        }

        revalidatePath(`/admin/artifacts/${artifactId}/publish`);
        return { success: true as const };
    } catch (error: unknown) {
        console.error('Save Draft Error:', error);
        return {
            success: false as const,
            error: getErrorMessage(error, 'Error desconocido'),
        };
    }
}

export async function refreshProductionVideos(artifactId: string) {
    const supabase = await createClient();

    const { data: materials } = await supabase
        .from('materials')
        .select('id')
        .eq('artifact_id', artifactId)
        .maybeSingle();

    if (!materials?.id) {
        return {
            success: false as const,
            error: 'No materials found',
            lessons: [] as PublicationVideoLesson[],
        };
    }

    const { data: rawLessons, error } = await supabase
        .from('material_lessons')
        .select(`
            lesson_id,
            lesson_title,
            module_title,
            material_components(
                type,
                assets,
                content
            )
        `)
        .eq('materials_id', materials.id)
        .order('module_id', { ascending: true })
        .order('lesson_id', { ascending: true });

    if (error) {
        return {
            success: false as const,
            error: error.message,
            lessons: [] as PublicationVideoLesson[],
        };
    }

    return {
        success: true as const,
        lessons: (rawLessons || []).map((lesson) =>
            mapLessonToVideoLesson(lesson as RawMaterialLessonRow),
        ),
    };
}
