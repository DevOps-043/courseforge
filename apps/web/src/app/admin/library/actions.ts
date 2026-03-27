'use server';

import type { MaterialAssets } from '@/domains/materials/types/materials.types';
import { createClient } from '@/utils/supabase/server';
import { getActiveOrganizationId, getAuthBridgeUser } from '@/utils/auth/session';

export type SearchFilters = {
    type?: string;
    status?: string | 'ALL';
};

export type MaterialSearchResult = {
    id: string;
    type: string;
    gamma_deck_id?: string;
    production_status: string;
    updated_at: string;
    lesson_title: string;
    lesson_id: string;
    course_name: string;
    course_code: string;
    assets: MaterialAssets | null;
};

interface ArtifactIdRow {
    id: string;
}

interface MaterialIdRow {
    id: string;
}

interface MaterialLessonIdRow {
    id: string;
}

interface LibraryArtifactRelation {
    course_id?: string | null;
    idea_central?: string | null;
}

interface LibraryMaterialsRelation {
    artifacts?: LibraryArtifactRelation | LibraryArtifactRelation[] | null;
}

interface LibraryLessonRelation {
    lesson_id?: string | null;
    lesson_title?: string | null;
    materials?: LibraryMaterialsRelation | LibraryMaterialsRelation[] | null;
}

interface LibraryMaterialComponentRow {
    assets?: MaterialAssets | null;
    generated_at: string;
    id: string;
    material_lessons?: LibraryLessonRelation | LibraryLessonRelation[] | null;
    type: string;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }

    return value ?? null;
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown error';
}

function buildMaterialComponentsQuery(
    supabase: Awaited<ReturnType<typeof createClient>>,
) {
    return supabase
        .from('material_components')
        .select(`
            id, type, assets, generated_at,
            material_lessons!inner (
                lesson_id, lesson_title,
                materials!inner ( artifacts!inner ( course_id, idea_central ) )
            )
        `);
}

async function ensureAuthorizedLibraryAccess(
    supabase: Awaited<ReturnType<typeof createClient>>,
) {
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (user) {
        return true;
    }

    const bridgeUser = await getAuthBridgeUser();
    return Boolean(bridgeUser);
}

async function fetchArtifactIdsForOrganization(
    supabase: Awaited<ReturnType<typeof createClient>>,
    organizationId?: string | null,
) {
    if (!organizationId) {
        return null;
    }

    const { data } = await supabase
        .from('artifacts')
        .select('id')
        .eq('organization_id', organizationId);

    return (data || []) as ArtifactIdRow[];
}

async function fetchMaterialIdsForArtifacts(
    supabase: Awaited<ReturnType<typeof createClient>>,
    artifactIds: string[],
) {
    if (artifactIds.length === 0) {
        return [];
    }

    const { data } = await supabase
        .from('materials')
        .select('id')
        .in('artifact_id', artifactIds);

    return (data || []) as MaterialIdRow[];
}

async function fetchLessonIdsForMaterials(
    supabase: Awaited<ReturnType<typeof createClient>>,
    materialIds: string[],
) {
    if (materialIds.length === 0) {
        return [];
    }

    const { data } = await supabase
        .from('material_lessons')
        .select('id')
        .in('materials_id', materialIds);

    return (data || []) as MaterialLessonIdRow[];
}

async function fetchLibraryRowsByLessonIds(
    supabase: Awaited<ReturnType<typeof createClient>>,
    lessonIds: string[],
) {
    if (lessonIds.length === 0) {
        return [];
    }

    const { data } = await buildMaterialComponentsQuery(supabase)
        .in('material_lesson_id', lessonIds.slice(0, 100))
        .limit(100);

    return (data || []) as LibraryMaterialComponentRow[];
}

function applyClientFilters(
    rows: LibraryMaterialComponentRow[],
    filters: SearchFilters,
) {
    return rows.filter((row) => {
        if (filters.type && filters.type !== 'ALL' && row.type !== filters.type) {
            return false;
        }

        if (
            filters.status &&
            filters.status !== 'ALL' &&
            row.assets?.production_status !== filters.status
        ) {
            return false;
        }

        return true;
    });
}

function transformResults(data: LibraryMaterialComponentRow[]): MaterialSearchResult[] {
    return data.map((item) => {
        const lesson = firstRelation(item.material_lessons);
        const materials = firstRelation(lesson?.materials);
        const artifact = firstRelation(materials?.artifacts);

        return {
            id: item.id,
            type: item.type,
            gamma_deck_id: item.assets?.gamma_deck_id,
            production_status: item.assets?.production_status || 'PENDING',
            updated_at: item.generated_at,
            lesson_title: lesson?.lesson_title || 'Untitled',
            lesson_id: lesson?.lesson_id || '?',
            course_name: artifact?.idea_central || 'Untitled Course',
            course_code: artifact?.course_id || 'UNK',
            assets: item.assets || null,
        };
    });
}

export async function searchMaterialsAction(query: string, filters: SearchFilters = {}) {
    const supabase = await createClient();
    const hasAccess = await ensureAuthorizedLibraryAccess(supabase);
    if (!hasAccess) {
        return { success: false, error: 'Unauthorized' };
    }

    const activeOrgId = await getActiveOrganizationId();

    try {
        const searchTerm = query?.trim() || '';
        const orgArtifacts = await fetchArtifactIdsForOrganization(supabase, activeOrgId);

        if (orgArtifacts && orgArtifacts.length === 0) {
            return { success: true, results: [] as MaterialSearchResult[] };
        }

        if (searchTerm.length === 0) {
            const artifactIds = orgArtifacts?.map((artifact) => artifact.id) || [];
            const materialIds = await fetchMaterialIdsForArtifacts(supabase, artifactIds);
            const lessonIds = await fetchLessonIdsForMaterials(
                supabase,
                materialIds.map((material) => material.id),
            );

            if (activeOrgId && lessonIds.length === 0) {
                return { success: true, results: [] as MaterialSearchResult[] };
            }

            let queryBuilder = buildMaterialComponentsQuery(supabase)
                .limit(100)
                .order('generated_at', { ascending: false });

            if (lessonIds.length > 0) {
                queryBuilder = queryBuilder.in(
                    'material_lesson_id',
                    lessonIds.map((lesson) => lesson.id).slice(0, 100),
                );
            }

            if (filters.type && filters.type !== 'ALL') {
                queryBuilder = queryBuilder.eq('type', filters.type);
            }

            if (filters.status && filters.status !== 'ALL') {
                queryBuilder = queryBuilder.eq('assets->>production_status', filters.status);
            }

            const { data, error } = await queryBuilder;
            if (error) {
                return { success: false, error: error.message };
            }

            return {
                success: true,
                results: transformResults((data || []) as LibraryMaterialComponentRow[]),
            };
        }

        const likeTerm = `%${searchTerm}%`;
        const [artifactsResult, lessonsByTitleResult] = await Promise.all([
            (async () => {
                let artifactQuery = supabase
                    .from('artifacts')
                    .select('id')
                    .or(`idea_central.ilike.${likeTerm},course_id.ilike.${likeTerm}`)
                    .limit(50);

                if (activeOrgId) {
                    artifactQuery = artifactQuery.eq('organization_id', activeOrgId);
                }

                const { data } = await artifactQuery;
                return (data || []) as ArtifactIdRow[];
            })(),
            (async () => {
                const { data } = await supabase
                    .from('material_lessons')
                    .select('id')
                    .ilike('lesson_title', likeTerm)
                    .limit(50);

                return (data || []) as MaterialLessonIdRow[];
            })(),
        ]);

        const relevantLessonIds = new Set(
            lessonsByTitleResult.map((lesson) => lesson.id),
        );

        const artifactIds = artifactsResult.map((artifact) => artifact.id);
        if (artifactIds.length > 0) {
            const materialIds = await fetchMaterialIdsForArtifacts(supabase, artifactIds);
            const lessonsByArtifact = await fetchLessonIdsForMaterials(
                supabase,
                materialIds.map((material) => material.id),
            );

            lessonsByArtifact.forEach((lesson) => relevantLessonIds.add(lesson.id));
        }

        const [directMatchesResult, lessonMatches] = await Promise.all([
            buildMaterialComponentsQuery(supabase)
                .ilike('assets->>gamma_deck_id', likeTerm)
                .limit(50),
            fetchLibraryRowsByLessonIds(supabase, Array.from(relevantLessonIds)),
        ]);

        const directMatches = ((directMatchesResult.data || []) as LibraryMaterialComponentRow[]);
        const uniqueRows = new Map<string, LibraryMaterialComponentRow>();

        for (const row of [...directMatches, ...lessonMatches]) {
            if (!uniqueRows.has(row.id)) {
                uniqueRows.set(row.id, row);
            }
        }

        const sortedRows = applyClientFilters(
            Array.from(uniqueRows.values()),
            filters,
        ).sort(
            (left, right) =>
                new Date(right.generated_at).getTime() -
                new Date(left.generated_at).getTime(),
        );

        return { success: true, results: transformResults(sortedRows) };
    } catch (error: unknown) {
        console.error('Search Exception:', error);
        return { success: false, error: getErrorMessage(error) };
    }
}
