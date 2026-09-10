import type { SupabaseClient } from '@supabase/supabase-js';
import { ScormEnrichmentService } from './scorm-enrichment.service';
import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import { randomUUID } from 'crypto';
import { ReadingContent } from '../../materials/types/materials.types';
import type { ScormManifest, ScormResource } from '../types';
import {
    isQueuedScormTransformation,
    SCORM_IMPORT_STATUS,
    SCORM_PROCESSING_STEP,
} from '../scorm-job-contracts';

interface ScormImportRecord {
    artifact_id: string | null;
    created_by: string | null;
    id: string;
    manifest_raw: ScormManifest;
    processing_step: string | null;
    status: string;
    storage_path: string;
}

interface ArtifactRecord {
    id: string;
}

interface MaterialsRecord {
    id: string;
}

interface SyllabusLessonSummary {
    duration_minutes: number;
    id: string;
    title: string;
}

interface SyllabusModuleSummary {
    id: string;
    lessons: SyllabusLessonSummary[];
    title: string;
}

export class ScormTransformationService {
    constructor(private readonly supabase: SupabaseClient) {}

    async processImport(importId: string, organizationId: string) {
        const supabase = this.supabase;

        // 1. Get Import Record
        const { data: importRecord, error } = await supabase
            .from('scorm_imports')
            .select('id, artifact_id, created_by, manifest_raw, processing_step, status, storage_path')
            .eq('id', importId)
            .eq('organization_id', organizationId)
            .single();

        if (error || !importRecord) throw new Error('Import not found');
        const currentImport = importRecord as ScormImportRecord;
        if (currentImport.status === SCORM_IMPORT_STATUS.completed && currentImport.artifact_id) {
            return { artifactId: currentImport.artifact_id, completed: true, alreadyCompleted: true };
        }
        if (!isQueuedScormTransformation(currentImport.status, currentImport.processing_step)) {
            return { artifactId: currentImport.artifact_id, completed: false, alreadyProcessing: true };
        }
        if (!currentImport.created_by) throw new Error('SCORM import creator is missing');

        const { data: claimedImport, error: claimError } = await supabase
            .from('scorm_imports')
            .update({ processing_step: SCORM_PROCESSING_STEP.running })
            .eq('id', importId)
            .eq('organization_id', organizationId)
            .eq('status', SCORM_IMPORT_STATUS.transforming)
            .eq('processing_step', SCORM_PROCESSING_STEP.queued)
            .select('id, artifact_id, created_by, manifest_raw, processing_step, status, storage_path')
            .maybeSingle();

        if (claimError) throw new Error(`Failed to claim SCORM import: ${claimError.message}`);
        if (!claimedImport) {
            return { artifactId: currentImport.artifact_id, completed: false, alreadyProcessing: true };
        }
        const typedImportRecord = claimedImport as ScormImportRecord;
        const userId = typedImportRecord.created_by;
        if (!userId) throw new Error('SCORM import creator is missing');

        try {

        // 2. Download Zip 
        const { data: zipData, error: downloadError } = await supabase
            .storage
            .from('scorm-packages')
            .download(typedImportRecord.storage_path);

        if (downloadError || !zipData) throw new Error('Failed to download SCORM package');

        const zipBuffer = await zipData.arrayBuffer();
        const zip = await JSZip.loadAsync(zipBuffer);

        // 3. Prepare Data for Enrichment
        const rawManifest = typedImportRecord.manifest_raw;
        const courseTitle = rawManifest.title;
        const orgItems = rawManifest.organizations[0]?.items || [];
        const modulesList = orgItems.map((item) => item.title);

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
                created_by: userId,
                organization_id: organizationId
            })
            .select('id')
            .single();

        if (artifactError || !artifact) {
            throw new Error('Failed to create artifact: ' + artifactError?.message);
        }
        const typedArtifact = artifact as ArtifactRecord;

        const { error: artifactLinkError } = await supabase
            .from('scorm_imports')
            .update({ artifact_id: typedArtifact.id, processing_step: 'ARTIFACT_CREATED' })
            .eq('id', importId)
            .eq('organization_id', organizationId)
            .eq('processing_step', SCORM_PROCESSING_STEP.running);
        if (artifactLinkError) {
            throw new Error(`Failed to link SCORM artifact: ${artifactLinkError.message}`);
        }

        // 6. Construct Syllabus Structure & Extract Content
        const syllabusModules: SyllabusModuleSummary[] = [];
        const resourcesMap = new Map<string, ScormResource>();

        // Index resources for quick lookup
        for (const resource of rawManifest.resources || []) {
            resourcesMap.set(resource.identifier, resource);
        }

        // Create Materials Record
        const { data: materials, error: materialsError } = await supabase
            .from('materials')
            .insert({
                artifact_id: typedArtifact.id,
                state: 'PHASE3_DRAFT',
                version: 1,
                prompt_version: 'scorm_import'
            })
            .select('id')
            .single();

        if (materialsError || !materials) {
            throw new Error('Failed to create materials: ' + materialsError?.message);
        }
        const typedMaterials = materials as MaterialsRecord;

        // Iterate structure
        for (const modItem of orgItems) {
            const moduleId = randomUUID();
            const moduleLessons: SyllabusLessonSummary[] = [];

            const children = modItem.children || [];

            for (const lessItem of children) {
                const lessonId = randomUUID();

                // Extract Content for this lesson
                const components: ReadingContent[] = [];
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
                        materials_id: typedMaterials.id,
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

                if (matLessonError || !matLesson) {
                    throw new Error(`Failed to create SCORM material lesson: ${matLessonError?.message || 'Unknown error'}`);
                }

                // Create MaterialComponents
                for (const compContent of components) {
                    const { error: componentError } = await supabase.from('material_components').insert({
                        material_lesson_id: matLesson.id,
                        type: 'READING', // Defaulting to READING for now
                        content: compContent,
                        iteration_number: 1,
                        validation_status: 'PENDING'
                    });
                    if (componentError) {
                        throw new Error(`Failed to create SCORM material component: ${componentError.message}`);
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
        const { error: syllabusError } = await supabase.from('syllabus').insert({
            artifact_id: typedArtifact.id,
            modules: syllabusModules,
            state: 'STEP_DRAFT'
        });
        if (syllabusError) throw new Error(`Failed to create SCORM syllabus: ${syllabusError.message}`);

        // 8. Update Import Status
        const { error: completionError } = await supabase
            .from('scorm_imports')
            .update({
                status: 'COMPLETED',
                artifact_id: typedArtifact.id,
                processing_step: 'COMPLETED',
                completed_at: new Date().toISOString()
            })
            .eq('id', importId)
            .eq('organization_id', organizationId);
        if (completionError) throw new Error(`Failed to complete SCORM import: ${completionError.message}`);

        return { artifactId: typedArtifact.id, completed: true };
        } catch (transformationError) {
            console.error('[SCORM/transformation] Processing failed', {
                importId,
                organizationId,
                error: transformationError instanceof Error ? transformationError.message : String(transformationError),
            });
            await supabase
                .from('scorm_imports')
                .update({
                    error_message: 'La transformación SCORM no pudo completarse.',
                    processing_step: 'FAILED',
                    status: SCORM_IMPORT_STATUS.failed,
                })
                .eq('id', importId)
                .eq('organization_id', organizationId);
            throw new Error('SCORM_TRANSFORMATION_FAILED');
        }
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
