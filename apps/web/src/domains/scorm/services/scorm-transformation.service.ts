import type { SupabaseClient } from '@supabase/supabase-js';
import { ScormEnrichmentService } from './scorm-enrichment.service';
import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import sanitizeHtml from 'sanitize-html';
import { randomUUID } from 'crypto';
import { ReadingContent } from '../../materials/types/materials.types';
import type { ScormManifest, ScormResource } from '../types';
import {
    SCORM_IMPORT_STATUS,
    SCORM_PROCESSING_STEP,
} from '../scorm-job-contracts';
import { claimScormImportJob, heartbeatScormImportJob } from './scorm-job.repository';
import { createOperationalLogger, resolveCorrelationId } from '@/lib/server/operational-logger';

interface ScormImportRecord {
    artifact_id: string | null;
    correlation_id: string | null;
    created_by: string | null;
    id: string;
    manifest_raw: ScormManifest;
    processing_step: string | null;
    status: string;
    storage_path: string;
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
            .select('id, artifact_id, correlation_id, created_by, manifest_raw, processing_step, status, storage_path')
            .eq('id', importId)
            .eq('organization_id', organizationId)
            .single();

        if (error || !importRecord) throw new Error('Import not found');
        const currentImport = importRecord as ScormImportRecord;
        if (currentImport.status === SCORM_IMPORT_STATUS.completed && currentImport.artifact_id) {
            return { artifactId: currentImport.artifact_id, completed: true, alreadyCompleted: true };
        }
        if (!currentImport.created_by) throw new Error('SCORM import creator is missing');

        const claimedImport = await claimScormImportJob<ScormImportRecord>(supabase, {
            importId,
            organizationId,
            queuedStep: SCORM_PROCESSING_STEP.transformQueued,
            runningStep: SCORM_PROCESSING_STEP.transformRunning,
            status: SCORM_IMPORT_STATUS.transforming,
        });
        if (!claimedImport) {
            return { artifactId: currentImport.artifact_id, completed: false, alreadyProcessing: true };
        }
        const typedImportRecord = claimedImport;
        const logger = createOperationalLogger('scorm.transformation', {
            correlationId: resolveCorrelationId(typedImportRecord.correlation_id),
            importId,
            organizationId,
        });
        const startedAt = Date.now();
        logger.info('scorm.transformation.started');
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
            logger.warn('scorm.enrichment.fallback_used', { error: e });
            enrichment = {
                objectives: [],
                targetAudience: 'General',
                level: 'beginner',
                description: 'Imported Course',
                suggestedTitle: courseTitle
            };
        }

        await heartbeatScormImportJob(supabase, {
            importId,
            organizationId,
            runningStep: SCORM_PROCESSING_STEP.transformRunning,
            status: SCORM_IMPORT_STATUS.transforming,
        });

        // 5. Create Artifact
        const { data: artifactId, error: artifactError } = await supabase.rpc(
            'create_scorm_import_artifact',
            {
                p_description: enrichment.description,
                p_import_id: importId,
                p_objectives: enrichment.objectives,
                p_organization_id: organizationId,
                p_target_audience: enrichment.targetAudience,
                p_title: enrichment.suggestedTitle || courseTitle,
            },
        );

        if (artifactError || typeof artifactId !== 'string') {
            throw new Error('Failed to create artifact: ' + artifactError?.message);
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
            .upsert({
                artifact_id: artifactId,
                state: 'PHASE3_DRAFT',
                version: 1,
                prompt_version: 'scorm_import'
            }, { onConflict: 'artifact_id' })
            .select('id')
            .single();

        if (materialsError || !materials) {
            throw new Error('Failed to create materials: ' + materialsError?.message);
        }
        const typedMaterials = materials as MaterialsRecord;
        const { data: projectionReset, error: resetError } = await supabase.rpc(
            'reset_scorm_material_projection',
            {
                p_import_id: importId,
                p_materials_id: typedMaterials.id,
                p_organization_id: organizationId,
            },
        );
        if (resetError || projectionReset !== true) {
            throw new Error(`Failed to reset SCORM material projection: ${resetError?.message || 'ownership lost'}`);
        }

        // Iterate structure
        for (const modItem of orgItems) {
            await heartbeatScormImportJob(supabase, {
                importId,
                organizationId,
                runningStep: SCORM_PROCESSING_STEP.transformRunning,
                status: SCORM_IMPORT_STATUS.transforming,
            });
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
                        const content = await this.extractResourceContent(zip, resource.href, logger);
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
        const { error: syllabusError } = await supabase.from('syllabus').upsert({
            artifact_id: artifactId,
            modules: syllabusModules,
            state: 'STEP_DRAFT'
        }, { onConflict: 'artifact_id' });
        if (syllabusError) throw new Error(`Failed to create SCORM syllabus: ${syllabusError.message}`);

        // 8. Update Import Status
        const { data: completedImport, error: completionError } = await supabase
            .from('scorm_imports')
            .update({
                status: 'COMPLETED',
                artifact_id: artifactId,
                processing_step: 'COMPLETED',
                completed_at: new Date().toISOString(),
                lease_expires_at: null,
                processing_heartbeat_at: null,
                updated_at: new Date().toISOString(),
            })
            .eq('id', importId)
            .eq('organization_id', organizationId)
            .eq('status', SCORM_IMPORT_STATUS.transforming)
            .eq('processing_step', SCORM_PROCESSING_STEP.transformRunning)
            .select('id')
            .maybeSingle();
        if (completionError || !completedImport) {
            throw new Error(`Failed to complete SCORM import: ${completionError?.message || 'ownership lost'}`);
        }

        logger.info('scorm.transformation.completed', {
            artifactId,
            durationMs: Date.now() - startedAt,
            moduleCount: syllabusModules.length,
        });
        return { artifactId, completed: true };
        } catch (transformationError) {
            logger.error('scorm.transformation.failed', transformationError, {
                durationMs: Date.now() - startedAt,
            });
            const { error: failureWriteError } = await supabase
                .from('scorm_imports')
                .update({
                    error_message: 'La transformación SCORM no pudo completarse.',
                    lease_expires_at: null,
                    processing_heartbeat_at: null,
                    processing_step: 'FAILED',
                    status: SCORM_IMPORT_STATUS.failed,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', importId)
                .eq('organization_id', organizationId)
                .eq('status', SCORM_IMPORT_STATUS.transforming)
                .eq('processing_step', SCORM_PROCESSING_STEP.transformRunning);
            if (failureWriteError) {
                logger.error('scorm.transformation.failure_state.persist_failed', failureWriteError);
            }
            throw new Error('SCORM_TRANSFORMATION_FAILED');
        }
    }

    private async extractResourceContent(
        zip: JSZip,
        href: string,
        logger: ReturnType<typeof createOperationalLogger>,
    ): Promise<ReadingContent | null> {
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
            logger.warn('scorm.resource.extract_skipped', { error: e, resourcePath: href });
            return null;
        }
    }
}
