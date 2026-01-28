'use server';

import { createClient } from '@/utils/supabase/server';

export type SearchFilters = {
    type?: string;
    status?: string | 'ALL';
};

export type MaterialSearchResult = {
    id: string; // component id
    type: string;
    gamma_deck_id?: string;
    production_status: string;
    updated_at: string;
    lesson_title: string;
    lesson_id: string; // real lesson id e.g. "1.1"
    course_name: string;
    course_code: string;
    assets: any;
};

export async function searchMaterialsAction(query: string, filters: SearchFilters = {}) {
    const supabase = await createClient();

    // Auth Check
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    try {
        let searchTerm = query?.trim() || '';

        // --- FETCH DEFAULT (Si no hay query) ---
        if (searchTerm.length === 0) {
            const defaultQuery = supabase
                .from('material_components')
                .select(`
                    id, type, assets, generated_at,
                    material_lessons!inner (
                        lesson_id, lesson_title,
                        materials!inner ( artifacts!inner ( course_id, idea_central ) )
                    )
                `)
                .limit(100)
                .order('generated_at', { ascending: false });

            if (filters.type && filters.type !== 'ALL') defaultQuery.eq('type', filters.type);
            if (filters.status && filters.status !== 'ALL') defaultQuery.eq('assets->>production_status', filters.status);

            const { data, error } = await defaultQuery;
            if (error) return { success: false, error: error.message };

            return { success: true, results: transformResults(data) };
        }

        const likeTerm = `%${searchTerm}%`;

        // --- ESTRATEGIA WATERFALL (Paso a Paso) ---
        // 1. Encontrar IDs de Artefactos relevantes (por Nombre o Curso)
        const { data: artifacts } = await supabase
            .from('artifacts')
            .select('id')
            .or(`idea_central.ilike.${likeTerm},course_id.ilike.${likeTerm}`)
            .limit(50);

        const artifactIds = artifacts?.map(a => a.id) || [];

        // 2. Encontrar IDs de Lecciones relevantes
        //    a) Que coincidan por Título
        //    b) O que pertenezcan a los Artefactos encontrados

        // Query A: Por título
        const { data: lessonsByTitle } = await supabase
            .from('material_lessons')
            .select('id')
            .ilike('lesson_title', likeTerm)
            .limit(50);

        let relevantLessonIds = new Set<string>(lessonsByTitle?.map(l => l.id) || []);

        // Query B: Por asociación de artefacto (Si encontramos artefactos)
        if (artifactIds.length > 0) {
            // Primero obtener Materials de esos Artifacts
            const { data: mats } = await supabase
                .from('materials')
                .select('id')
                .in('artifact_id', artifactIds);

            const materialIds = mats?.map(m => m.id) || [];

            if (materialIds.length > 0) {
                const { data: lessonsByArtifact } = await supabase
                    .from('material_lessons')
                    .select('id')
                    .in('materials_id', materialIds);

                lessonsByArtifact?.forEach(l => relevantLessonIds.add(l.id));
            }
        }

        const allRelevantLessonIds = Array.from(relevantLessonIds);

        // 3. Encontrar Componentes
        //    a) Que pertenezcan a las Lecciones identificadas
        //    b) O que coincidan directamente por ID (Gamma Deck ID)

        // Construir p1: Filter por ID directo en JSON
        const p1 = supabase
            .from('material_components')
            .select(`
                id, type, assets, generated_at,
                material_lessons!inner (
                    lesson_id, lesson_title,
                    materials!inner ( artifacts!inner ( course_id, idea_central ) )
                )
            `)
            .ilike('assets->>gamma_deck_id', likeTerm)
            .limit(50);

        // Solo ejecutamos p2 si tenemos lecciones relevantes encontradas previamente
        let p2Result: any[] = [];
        if (allRelevantLessonIds.length > 0) {
            // Chunking por si son muchos IDs (Supabase limita URL length)
            const safeLessonIds = allRelevantLessonIds.slice(0, 100);

            const { data } = await supabase
                .from('material_components')
                .select(`
                    id, type, assets, generated_at,
                    material_lessons!inner (
                        lesson_id, lesson_title,
                        materials!inner ( artifacts!inner ( course_id, idea_central ) )
                    )
                `)
                .in('material_lesson_id', safeLessonIds)
                .limit(100);

            if (data) p2Result = data;
        }

        const { data: p1Result, error: p1Error } = await p1;
        if (p1Error) console.error(p1Error);

        const allRows = [...(p1Result || []), ...p2Result];

        // Deduplicar y Aplicar Filtros (Type / Status)
        const uniqueMap = new Map();
        allRows.forEach((item: any) => {
            if (!uniqueMap.has(item.id)) {
                let pass = true;
                if (filters.type && filters.type !== 'ALL' && item.type !== filters.type) pass = false;
                if (filters.status && filters.status !== 'ALL' && item.assets?.production_status !== filters.status) pass = false;

                if (pass) uniqueMap.set(item.id, item);
            }
        });

        // Ordenar y Retornar
        const data = Array.from(uniqueMap.values());
        // Fix: Use generated_at for sorting
        data.sort((a: any, b: any) => new Date(b.generated_at).getTime() - new Date(a.generated_at).getTime());

        return { success: true, results: transformResults(data) };

    } catch (e: any) {
        console.error('Search Exception:', e);
        return { success: false, error: e.message };
    }
}

function transformResults(data: any[]): MaterialSearchResult[] {
    if (!data) return [];
    return data.map((item: any) => {
        const lesson = item.material_lessons;
        const artifact = lesson?.materials?.artifacts;

        return {
            id: item.id,
            type: item.type,
            gamma_deck_id: item.assets?.gamma_deck_id,
            production_status: item.assets?.production_status || 'PENDING',
            updated_at: item.generated_at, // Map generated_at to updated_at for UI interface compatibility
            lesson_title: lesson?.lesson_title || 'Untitled',
            lesson_id: lesson?.lesson_id || '?',
            course_name: artifact?.idea_central || 'Untitled Course',
            course_code: artifact?.course_id || 'UNK',
            assets: item.assets
        };
    });
}
