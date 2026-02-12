import { createClient } from '@/utils/supabase/server';
import { ScormEnrichmentService } from './scorm-enrichment.service';
import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import { randomUUID } from 'crypto';
import { ComponentType, MaterialComponent, ReadingContent } from '../../materials/types/materials.types';

export class ScormTransformationService {

    async processImport(importId: string, userId: string) {
        const supabase = await createClient();

        // 1. Get Import Record
        const { data: importRecord, error } = await supabase
            .from('scorm_imports')
            .select('*')
            .eq('id', importId)
            .single();

        if (error || !importRecord) throw new Error('Import not found');

        // 2. Download Zip 
        const { data: zipData, error: downloadError } = await supabase
            .storage
            .from('scorm-packages')
            .download(importRecord.storage_path);

        if (downloadError || !zipData) throw new Error('Failed to download SCORM package');

        const zipBuffer = await zipData.arrayBuffer();
        const zip = await JSZip.loadAsync(zipBuffer);

        // 3. Prepare Data for Enrichment
        const rawManifest = importRecord.manifest_raw;
        const courseTitle = rawManifest.title;
        const orgItems = rawManifest.organizations[0]?.items || [];
        const modulesList = orgItems.map((i: any) => i.title);

        // 4. AI Enrichment (Metadata)
        const enrichmentService = new ScormEnrichmentService();
        let enrichment;
        try {
            enrichment = await enrichmentService.enrichCourseMetadata(
                courseTitle,
                modulesList,
                JSON.stringify(rawManifest).slice(0, 2000)
            );
        } catch (e) {
            console.error('Enrichment failed', e);
            enrichment = {
                objectives: [],
                targetAudience: 'General',
                level: 'beginner',
                description: 'Imported Course',
                suggestedTitle: courseTitle
            };
        }

        // 5. Create Artifact
        const { data: artifact, error: artifactError } = await supabase
            .from('artifacts')
            .insert({
                title: enrichment.suggestedTitle || courseTitle,
                idea_central: enrichment.description, // Mapping description to idea_central
                descripcion: { text: enrichment.description },
                target_audience: enrichment.targetAudience,
                objetivos: enrichment.objectives,
                state: 'DRAFT', // Start as DRAFT
                created_by: userId
            })
            .select()
            .single();

        if (artifactError) throw new Error('Failed to create artifact: ' + artifactError.message);

        // 6. Construct Syllabus Structure & Extract Content
        const syllabusModules: any[] = [];
        const resourcesMap = new Map<string, any>();

        // Index resources for quick lookup
        if (rawManifest.resources) {
            const resList = Array.isArray(rawManifest.resources) ? rawManifest.resources : [rawManifest.resources];
            resList.forEach((r: any) => resourcesMap.set(r.identifier, r));
        }

        // Create Materials Record
        const { data: materials, error: materialsError } = await supabase
            .from('materials')
            .insert({
                artifact_id: artifact.id,
                state: 'PHASE3_DRAFT',
                version: 1,
                prompt_version: 'scorm_import'
            })
            .select()
            .single();

        if (materialsError) throw new Error('Failed to create materials: ' + materialsError.message);

        // Iterate structure
        for (const [modIndex, modItem] of orgItems.entries()) {
            const moduleId = randomUUID();
            const moduleLessons: any[] = [];

            const children = modItem.children || [];

            for (const [lessIndex, lessItem] of children.entries()) {
                const lessonId = randomUUID();

                // Extract Content for this lesson
                let components: any[] = [];
                if (lessItem.resourceRef) {
                    const resource = resourcesMap.get(lessItem.resourceRef);
                    if (resource && resource.href) {
                        const content = await this.extractResourceContent(zip, resource.href);
                        if (content) {
                            components.push(content);
                        }
                    }
                }

                // Create MaterialLesson
                const { data: matLesson, error: matLessonError } = await supabase
                    .from('material_lessons')
                    .insert({
                        materials_id: materials.id,
                        lesson_id: lessonId,
                        lesson_title: lessItem.title,
                        module_id: moduleId,
                        module_title: modItem.title,
                        oa_text: 'Completar lección SCORM', // Default
                        state: 'GENERATED', // Mark as generated since we have content
                        iteration_count: 1
                    })
                    .select()
                    .single();

                if (!matLessonError && matLesson) {
                    // Create MaterialComponents
                    for (const compContent of components) {
                        await supabase.from('material_components').insert({
                            material_lesson_id: matLesson.id,
                            type: 'READING', // Defaulting to READING for now
                            content: compContent,
                            iteration_number: 1,
                            validation_status: 'PENDING'
                        });
                    }
                }

                moduleLessons.push({
                    id: lessonId,
                    title: lessItem.title,
                    duration_minutes: 15 // Estimate
                });
            }

            syllabusModules.push({
                id: moduleId,
                title: modItem.title,
                lessons: moduleLessons
            });
        }

        // 7. Create Syllabus
        await supabase.from('syllabus').insert({
            artifact_id: artifact.id,
            modules: syllabusModules as any,
            state: 'STEP_DRAFT'
        });

        // 8. Update Import Status
        await supabase
            .from('scorm_imports')
            .update({
                status: 'COMPLETED',
                artifact_id: artifact.id,
                completed_at: new Date().toISOString()
            })
            .eq('id', importId);

        return { artifactId: artifact.id };
    }

    private async extractResourceContent(zip: JSZip, href: string): Promise<ReadingContent | null> {
        try {
            const file = zip.file(href);
            if (!file) return null;

            const html = await file.async('string');
            const $ = cheerio.load(html);

            // Clean content
            const body = $('body').html() || '';
            const cleanBody = sanitizeHtml(body, {
                allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'div', 'span']),
                allowedAttributes: {
                    '*': ['style', 'class'],
                    'img': ['src', 'alt']
                }
            });

            const title = $('title').text() || 'Reading Section';

            return {
                title,
                body_html: cleanBody,
                sections: [{
                    heading: 'Contenido Importado',
                    content: cleanBody
                }],
                estimated_reading_time_min: Math.ceil(cleanBody.length / 1000), // Raw estimate
                key_points: [],
                reflection_question: '¿Qué aprendiste en esta sección?'
            };
        } catch (e) {
            console.error('Error extracting content', href, e);
            return null;
        }
    }
}
