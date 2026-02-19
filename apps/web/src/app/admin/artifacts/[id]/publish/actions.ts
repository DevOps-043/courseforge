'use server';

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

declare const process: any;

export async function getPublicationData(artifactId: string) {
    const supabase = await createClient();

    // 1. Get Artifact basic info
    const { data: artifact, error: artError } = await supabase
        .from('artifacts')
        .select('id, idea_central, generation_metadata, descripcion')
        .eq('id', artifactId)
        .single();

    if (artError || !artifact) {
        throw new Error('Artifact not found');
    }

    // 2. Get Lessons for this artifact (from material_lessons)
    // We need to join with materials -> material_lessons
    const { data: materials, error: matError } = await supabase
        .from('materials')
        .select('id, package')
        .eq('artifact_id', artifactId)
        .single();

    let lessons: any[] = [];
    if (materials) {
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
            .order('lesson_id');

        if (rawLessons) {
            lessons = rawLessons.map((l: any) => {
                // Try to find a video URL in components
                let videoUrl = '';
                if (l.material_components && Array.isArray(l.material_components)) {
                    // Prioritize final_video_url, then video_url
                    const videoComp = l.material_components.find((c: any) =>
                        c.assets?.final_video_url || c.assets?.video_url
                    );
                    if (videoComp) {
                        videoUrl = videoComp.assets.final_video_url || videoComp.assets.video_url;
                    }
                }

                return {
                    id: l.lesson_id,
                    title: l.lesson_title,
                    module_title: l.module_title,
                    auto_video_url: videoUrl,
                    summary: l.oa_text,
                    components: l.material_components || []
                };
            });

            // --- SORTING LOGIC (UI & Export) ---
            const naturalSort = (a: string, b: string) => {
                return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            };

            const moduleMap = new Map<string, any[]>();
            lessons.forEach(l => {
                // Determine module title
                const modTitle = l.module_title || '';
                // Note: If module_title is missing, it might be empty string or null. 
                // We group by it anyway.
                if (!moduleMap.has(modTitle)) {
                    moduleMap.set(modTitle, []);
                }
                moduleMap.get(modTitle)?.push(l);
            });

            // Sort keys (Modules)
            const sortedKeys = Array.from(moduleMap.keys()).sort(naturalSort);

            const sortedLessons: any[] = [];
            for (const key of sortedKeys) {
                const modLessons = moduleMap.get(key) || [];
                // Sort lessons within module
                modLessons.sort((a, b) => naturalSort(a.title || '', b.title || ''));
                sortedLessons.push(...modLessons);
            }
            lessons = sortedLessons;
            // -----------------------------------
        }
    }


    // 3. Get existing publication request if any
    const { data: request } = await supabase
        .from('publication_requests')
        .select('*')
        .eq('artifact_id', artifactId)
        .single();

    console.log(`[getPublicationData] Artifact: ${artifactId}`);
    console.log(`[getPublicationData] Request found: ${!!request}`);
    if (request?.lesson_videos) {
        const keys = Object.keys(request.lesson_videos);
        console.log(`[getPublicationData] Video Mappings: ${keys.length}`);
        if (keys.length > 0) {
            console.log(`[getPublicationData] Sample Duration: ${request.lesson_videos[keys[0]].duration}`);
        }
    }

    return {
        artifact: {
            id: artifact.id,
            title: artifact.idea_central,
            description: artifact.descripcion
        },
        lessons,
        request,
        materialsPackage: materials?.package
    };
}

export async function savePublicationDraft(artifactId: string, data: any) {
    const supabase = await createClient();
    try {
        console.log('--- SAVE DRAFT START ---');

        const { data: existing } = await supabase
            .from('publication_requests')
            .select('id')
            .eq('artifact_id', artifactId)
            .single();

        if (existing) {
            console.log('Updating existing request:', existing.id);
            const { error } = await supabase
                .from('publication_requests')
                .update({
                    category: data.category,
                    level: data.level,
                    instructor_email: data.instructor_email,
                    slug: data.slug,
                    price: data.price,
                    thumbnail_url: data.thumbnail_url,
                    lesson_videos: data.lesson_videos, // JSONB
                    status: data.status, // DRAFT or READY
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id);

            if (error) {
                console.error('Update Error:', error);
                throw error;
            }
        } else {
            console.log('Inserting new request');
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
                    status: data.status
                });

            if (error) {
                console.error('Insert Error:', error);
                throw error;
            }
        }

        console.log('Save successful, revalidating path...');
        revalidatePath(`/admin/artifacts/${artifactId}/publish`);
        return { success: true };
    } catch (error: any) {
        console.error('Save Draft Error:', error);
        return { success: false, error: error.message };
    }
}

export async function testSofliaConnection() {
    console.log('[testConnection] Starting connectivity test...');

    try {
        const MOCK_MODE = process.env.SOFLIA_MOCK_MODE === 'true';
        const API_URL = process.env.SOFLIA_API_URL;
        const API_KEY = process.env.SOFLIA_API_KEY;

        console.log(`[testConnection] Env Check - URL: ${API_URL ? 'Defined' : 'Missing'}, Key: ${API_KEY ? 'Defined' : 'Missing'}, Mock: ${MOCK_MODE}`);

        if (!MOCK_MODE && (!API_URL || !API_KEY)) {
             console.error('[testConnection] Missing Configuration');
             return { success: false, error: 'Config Error: Missing API_URL or API_KEY env vars' };
        }
        
        if (MOCK_MODE) {
             return { success: true, message: 'Mock Mode Active - Connection Simulated' };
        }

        const targetUrl = `${API_URL}/api/courses/import`;
        console.log(`[testConnection] Pinging: ${targetUrl}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // Increased to 10s

        try {
            const start = Date.now();
            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY || ''
                },
                body: JSON.stringify({ type: 'ping' }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const duration = Date.now() - start;

            console.log(`[testConnection] Response: ${response.status} ${response.statusText} (${duration}ms)`);

            if (response.ok) {
                const text = await response.text();
                let data = {};
                try { data = JSON.parse(text); } catch (e) { data = { text }; }
                return { success: true, data };
            } else {
                const errorText = await response.text();
                console.error(`[testConnection] HTTP Status: ${response.status}`, errorText);
                
                // If we get a 400 Validation Error, it means we DID reach the server and it validated our payload.
                // This counts as a successful CONNECTION test (which is the point of this button).
                if (response.status === 400) {
                     return { 
                        success: true, 
                        data: { message: "Conexión Establecida (API Activa)" },
                        warning: "Payload de prueba rechazado por validación (Normal)"
                     };
                }

                return { success: false, error: `HTTP Error: ${response.status} ${response.statusText}` };
            }
        } catch (fetchError: any) {
            clearTimeout(timeoutId);
            console.error('[testConnection] Network Error:', fetchError);
            const isAbort = fetchError.name === 'AbortError';
            return { 
                success: false, 
                error: isAbort ? 'Connection Timeout (10s)' : `Network Error: ${fetchError.message}` 
            };
        }

    } catch (e: any) {
        console.error('[testConnection] Unexpected Error:', e);
        return { success: false, error: `Unexpected Error: ${e.message}` };
    }
}

export async function publishToSoflia(artifactId: string) {
    const supabase = await createClient();
    console.log(`[publishToSoflia] Starting publication for artifact: ${artifactId}`);

    try {
        // 1. Validate Config
        const MOCK_MODE = process.env.SOFLIA_MOCK_MODE === 'true';
        const API_URL = process.env.SOFLIA_API_URL;
        const API_KEY = process.env.SOFLIA_API_KEY;

        if (!MOCK_MODE && (!API_URL || !API_KEY)) {
            throw new Error("Configuración incompleta: Faltan variables de entorno SOFLIA_API_URL o SOFLIA_API_KEY");
        }

        // DEBUG: Log Env Vars (Obfuscated)
        if (!MOCK_MODE) {
            console.log(`[publishToSoflia] CONFIG CHECK:`);
            console.log(`[publishToSoflia] URL: ${API_URL ? 'DEFINED' : 'MISSING'} (${API_URL})`);
            console.log(`[publishToSoflia] Key: ${API_KEY ? 'DEFINED' : 'MISSING'}`);
        }

        // 2. Data Gathering
        const { request, lessons, artifact, materialsPackage } = await getPublicationData(artifactId);

        if (!request || request.status !== 'READY') {
            throw new Error("El curso no está en estado 'READY' para publicar. Guarde el borrador primero.");
        }

        // 3. Payload Construction
        const payload = {
            source: {
                platform: 'courseforge',
                version: '1.0',
                artifact_id: artifactId
            },
            course: {
                title: artifact.title,
                description: getArtifactDescription(artifact), // Helper to extract text
                slug: request.slug,
                category: request.category,
                level: request.level,
                instructor_email: request.instructor_email,
                price: request.price || 0,
                thumbnail_url: request.thumbnail_url,
                is_published: false
            },
            modules: [] as any[]
        };

        // Helper for Natural Sort (e.g. handles "1, 2, 10" correctly instead of "1, 10, 2")
        const naturalSort = (a: string, b: string) => {
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        };

        // Group lessons by module
        const moduleMap = new Map<string, any[]>();
        lessons.forEach(l => {
            const modTitle = l.module_title || 'Módulo General'; // Fallback
            if (!moduleMap.has(modTitle)) {
                moduleMap.set(modTitle, []);
            }
            moduleMap.get(modTitle)?.push(l);
        });

        // Sort Modules by Title
        const sortedModuleTitles = Array.from(moduleMap.keys()).sort(naturalSort);

        // Build Modules Array in Order
        let moduleOrder = 1;
        for (const modTitle of sortedModuleTitles) {
            const modLessons = moduleMap.get(modTitle) || [];

            // Sort Lessons by Title (assuming index prefixes like "1.1", "1.2" etc)
            modLessons.sort((a: any, b: any) => naturalSort(a.title || '', b.title || ''));

            const moduleObj = {
                title: modTitle,
                order_index: moduleOrder++,
                lessons: [] as any[]
            };

            let lessonOrder = 1;
            for (const l of modLessons) {

                // Get video data from request mapping
                const mapping = request.lesson_videos?.[l.id];

                // Determine video URL and ID
                let videoUrl = '';
                let videoId = '';
                let provider = 'youtube';

                if (mapping?.video_id) {
                    videoId = mapping.video_id;
                    provider = mapping.video_provider || 'youtube';

                    if (provider === 'youtube') videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
                    else if (provider === 'vimeo') videoUrl = `https://vimeo.com/${videoId}`;
                    else videoUrl = videoId; // Direct or other
                } else if (l.auto_video_url) {
                    videoUrl = l.auto_video_url;
                    // Try to extract ID from auto URL if missing in mapping
                    // (Though mapping should have covered it via Client defaults, but safe fallback)
                    // ... (Simplification: rely on mapping predominantly or use full URL as ID if direct)
                }

                // 3.1 Extract Content
                const components = l.components || [];

                // Transcription (from Video Scripts)
                let transcription = '';
                const videoComps = components.filter((c: any) => ['VIDEO_THEORETICAL', 'VIDEO_DEMO', 'VIDEO_GUIDE'].includes(c.type));
                videoComps.forEach((vc: any) => {
                    if (vc.content?.script?.sections) {
                        transcription += vc.content.script.sections
                            .map((s: any) => `[${s.timecode_start}] ${s.narration_text}`)
                            .join('\n\n');
                    }
                });

                // Activities (Dialogue)
                const activities = [] as any[];
                components.forEach((c: any) => {
                    if (c.type === 'DIALOGUE' && c.content) {
                        activities.push({
                            title: c.content.title || 'Simulación con LIA',
                            type: 'lia_script',
                            data: transformLiaContent(c.content)
                        });
                    }
                });

                // Content Blocks (Reading, Exercise, Demo Guide)
                const contentBlocks = [] as any[];
                let blockOrder = 1;
                components.forEach((c: any) => {
                    if (['READING', 'EXERCISE', 'DEMO_GUIDE'].includes(c.type) && c.content) {
                        let contentHtml = c.content.body_html || '';

                        // Handler for Demo Guide which might not have body_html but steps
                        if (c.type === 'DEMO_GUIDE' && !contentHtml && c.content.steps) {
                            contentHtml = `<h3>${c.content.title}</h3><ul>` +
                                c.content.steps.map((s: any) => `<li><strong>Paso ${s.step_number}:</strong> ${s.instruction}</li>`).join('') +
                                '</ul>';
                        }

                        if (contentHtml) {
                            contentBlocks.push({
                                title: c.content.title || (c.type === 'READING' ? 'Lectura' : 'Ejercicio'),
                                content: contentHtml,
                                type: 'html', // Soflia likely expects type
                                order: blockOrder++
                            });
                        }
                    }
                });

                // Materials (Slides & Package & Quiz)
                const materials = [] as any[];
                // Slides from assets & Quizzes
                components.forEach((c: any) => {
                    if (c.assets?.slides_url) {
                        materials.push({
                            title: 'Presentación (Diapositivas)',
                            url: c.assets.slides_url,
                            type: 'link'
                        });
                    }

                    // Quiz (Moved from Activities - Requires Backend Update)
                    if (c.type === 'QUIZ' && c.content) {
                        materials.push({
                            title: c.content.title || 'Evaluación',
                            type: 'quiz',
                            data: transformQuizContent(c.content),
                            description: c.content.instructions || ''
                        });
                    }
                });

                // Package files matching logic (Optional, basic implementation)
                if (materialsPackage?.files) {
                    const lessonFiles = materialsPackage.files.filter((f: any) => f.lesson_id === l.id);
                    lessonFiles.forEach((f: any) => {
                        materials.push({
                            title: `Recurso: ${f.component}`,
                            url: f.path, // Assuming accessible path/url
                            type: 'download'
                        });
                    });
                }

                const durationRaw = mapping?.duration;
                const durationNum = Number(durationRaw);
                const finalDuration = Math.round(Math.max(durationNum || 0, 60));

                console.log(`[DEBUG_FIX_V2] Lesson: ${l.title}`);
                console.log(`[DEBUG_FIX_V2] Raw: ${durationRaw} (${typeof durationRaw})`);
                console.log(`[DEBUG_FIX_V2] Final Duration: ${finalDuration}`);

                moduleObj.lessons.push({
                    title: l.title,
                    order_index: lessonOrder++,
                    duration_seconds: finalDuration,
                    duration: finalDuration, // Redundancy for API compatibility
                    summary: l.summary || '',
                    description: l.summary || '', // Fallback
                    transcription: transcription,
                    video_url: videoUrl,
                    video_provider: provider,
                    video_provider_id: videoId || videoUrl,
                    is_free: false,
                    content_blocks: contentBlocks,
                    activities: activities,
                    materials: materials
                });
            }
            payload.modules.push(moduleObj);
        }

        // FULL PAYLOAD DEBUG
        console.log('[DEBUG_FULL_PAYLOAD] JSON START');
        console.log(JSON.stringify(payload, null, 2));
        console.log('[DEBUG_FULL_PAYLOAD] JSON END');

        console.log(`[publishToSoflia] Payload constructed. Slug: ${payload.course.slug}, Modules: ${payload.modules.length}`);

        let result;
        if (MOCK_MODE) {
            console.log('--- MOCK MODE ENABLED ---');
            console.log('Skipping actual API call. Payload that would be sent:', JSON.stringify(payload, null, 2));
            // Simulate delay
            await new Promise(resolve => setTimeout(resolve, 1500));
            result = { message: "Mock success", mock: true };
        } else {
            // 4. Send to Soflia
            const targetUrl = `${API_URL}/api/courses/import`;
            console.log(`[publishToSoflia] Sending to: ${targetUrl}`);

            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY || ''
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(30000)  // 30s timeout para payloads grandes
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[publishToSoflia] API Error (${response.status}):`, errorText);
                throw new Error(`Error remoto (${response.status}): ${errorText.substring(0, 500)}`);
            }

            result = await response.json();
        }

        console.log('[publishToSoflia] Success:', result);

        // 5. Update Status locally
        await supabase
            .from('publication_requests')
            .update({
                status: 'SENT',
                updated_at: new Date().toISOString()
            })
            .eq('id', request.id);

        revalidatePath(`/admin/artifacts/${artifactId}/publish`);

        return { success: true, data: result };

    } catch (error: any) {
        console.error('[publishToSoflia] Validation/Exec Error:', error);
        return { success: false, error: error.message };
    }
}

// Helper to normalize Quiz Content to Spec (camelCase)
function transformQuizContent(content: any) {
    if (!content) return {};

    // 1. Detect source array (support 'items' or 'questions')
    const rawItems = Array.isArray(content.questions) ? content.questions : (Array.isArray(content.items) ? content.items : []);

    let calculatedTotalPoints = 0;

    // 2. Normalize questions
    const questions = rawItems.map((q: any) => {
        // Ensure options are strings
        const options = Array.isArray(q.options)
            ? q.options.map((o: any) => typeof o === 'string' ? o : JSON.stringify(o))
            : [];

        const points = Number(q.points) || 10;
        calculatedTotalPoints += points;

        // Handle correct_answer (index vs string)
        let correctAnswer = '';
        if (typeof q.correct_answer === 'number' || typeof q.correctAnswer === 'number') {
            const idx = typeof q.correct_answer === 'number' ? q.correct_answer : q.correctAnswer;
            if (idx >= 0 && idx < options.length) {
                correctAnswer = options[idx];
            }
        } else {
            correctAnswer = q.correctAnswer || q.correct_answer || '';
        }

        // Normalize Question Type
        let qType = q.questionType || q.question_type || q.type || 'multiple_choice';
        if (typeof qType === 'string') qType = qType.toLowerCase();

        return {
            id: q.id || `q-${Math.random().toString(36).substr(2, 9)}`,
            question: q.question,
            questionType: qType,
            options: options,
            correctAnswer: correctAnswer,
            explanation: q.explanation || '',
            points: points,
            difficulty: q.difficulty,
            bloom_level: q.bloom_level
        };
    });

    return {
        passing_score: content.passing_score || 80,
        totalPoints: calculatedTotalPoints > 0 ? calculatedTotalPoints : (content.totalPoints || content.total_points || 100),
        questions: questions
    };
}

// Helper to normalize LIA Content to Spec
function transformLiaContent(content: any) {
    if (!content) return {};

    // Ensure scenes have correct property casing if needed (spec uses lower case standard keys, usually fine)
    // But let's be safe
    const scenes = Array.isArray(content.scenes)
        ? content.scenes.map((s: any) => ({
            character: s.character,
            message: s.message,
            emotion: s.emotion || 'neutral'
        }))
        : [];

    return {
        introduction: content.introduction || '',
        scenes: scenes,
        conclusion: content.conclusion || ''
    };
}

// Helper to parse ISO 8601 duration (PT1H2M3S)
function parseISODuration(duration: string): number {
    const matches = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!matches) return 0;

    const hours = parseInt(matches[1] || '0', 10);
    const minutes = parseInt(matches[2] || '0', 10);
    const seconds = parseInt(matches[3] || '0', 10);

    return (hours * 3600) + (minutes * 60) + seconds;
}

export async function fetchVideoMetadata(url: string) {
    if (!url) return { duration: 0, title: '' };

    try {
        // VIMEO
        if (url.includes('vimeo.com')) {
            const res = await fetch(`https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`);
            if (res.ok) {
                const data = await res.json();
                return {
                    duration: data.duration, // Vimeo gives seconds
                    title: data.title
                };
            }
        }

        // YOUTUBE
        if (url.includes('youtube.com') || url.includes('youtu.be')) {
            // We fetch the page body to find the meta tag
            const res = await fetch(url, {
                headers: {
                    // Masquerade as a browser to avoid some bot detection, though Youtube is strict
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            const text = await res.text();

            // Look for <meta itemprop="duration" content="PT1M33S">
            const metaMatch = text.match(/itemprop="duration" content="([^"]+)"/);
            if (metaMatch && metaMatch[1]) {
                const seconds = parseISODuration(metaMatch[1]);
                // Title
                const titleMatch = text.match(/<title>([^<]*)<\/title>/);
                const title = titleMatch ? titleMatch[1].replace(' - YouTube', '') : '';
                return { duration: seconds, title };
            }

            // Fallback: videoDurationSeconds in JSON
            const jsonMatch = text.match(/"videoDurationSeconds":"(\d+)"/);
            if (jsonMatch && jsonMatch[1]) {
                const titleMatch = text.match(/<title>([^<]*)<\/title>/);
                const title = titleMatch ? titleMatch[1].replace(' - YouTube', '') : '';
                return { duration: parseInt(jsonMatch[1], 10), title };
            }
        }
    } catch (e) {
        console.error('Error fetching video metadata:', e);
    }

    return { duration: 0, title: '' };
}

function getArtifactDescription(artifact: any): string {
    if (!artifact.description) return artifact.title || '';

    if (typeof artifact.description === 'string') return artifact.description;

    // Handle JSON object structure
    const desc = artifact.description;
    return desc.texto || desc.resumen || desc.overview || desc.description || JSON.stringify(desc);
}
