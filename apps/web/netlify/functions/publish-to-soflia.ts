import type { Config, Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

export default async (req: Request, context: Context) => {
    // Enable CORS for frontend
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            }
        });
    }

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
    }

    try {
        const payload = await req.json();
        const { artifactId } = payload;

        if (!artifactId) {
            return new Response(JSON.stringify({ error: "Falta artifactId" }), { status: 400 });
        }

        console.log(`[NetlifyFn /publish] Starting publication for artifact: ${artifactId}`);

        // 1. Validate Config
        const API_URL = process.env.SOFLIA_API_URL;
        const API_KEY = process.env.SOFLIA_API_KEY;
        const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
        const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ROLE_KEY;

        if (!API_URL || !API_KEY) {
            console.error(`[NetlifyFn /publish] Faltan variables de entorno SOFLIA`);
            return new Response(JSON.stringify({ error: "Falta configuración de SOFLIA (URL/KEY)" }), { status: 500 });
        }

        if (!SUPABASE_URL || !SUPABASE_KEY) {
            console.error(`[NetlifyFn /publish] Faltan variables de entorno SUPABASE`);
            return new Response(JSON.stringify({ error: "Falta configuración de Base de Datos" }), { status: 500 });
        }

        // Initialize Supabase Client manually for Netlify Functions (cannot use /utils/supabase/server)
        const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

        // 2. Data Gathering (Duplicado de actions.ts ya que no podemos importarlo directo fácilmente sin transpilar en algunas config de Netlify)
        
        // 2.1 Get Artifact
        const { data: artifact, error: artError } = await supabase
            .from('artifacts')
            .select('id, idea_central, generation_metadata, descripcion')
            .eq('id', artifactId)
            .single();

        if (artError || !artifact) throw new Error('Artifact not found');

        // 2.2 Get Request
        const { data: pubRequest } = await supabase
            .from('publication_requests')
            .select('*')
            .eq('artifact_id', artifactId)
            .single();

        if (!pubRequest || pubRequest.status !== 'READY') {
            return new Response(JSON.stringify({ error: "El curso no está 'READY'. Guarde el borrador primero." }), { status: 400 });
        }

        // 2.3 Get Materials & Lessons
        const { data: materials } = await supabase
            .from('materials')
            .select('id, package')
            .eq('artifact_id', artifactId)
            .single();

        let lessons: any[] = [];
        if (materials) {
            const { data: rawLessons } = await supabase
                .from('material_lessons')
                .select(`lesson_id, lesson_title, module_title, oa_text, material_components(type, assets, content)`)
                .eq('materials_id', materials.id)
                .order('lesson_id');

            if (rawLessons) {
                lessons = rawLessons.map((l: any) => {
                    let videoUrl = '';
                    if (l.material_components && Array.isArray(l.material_components)) {
                        const videoComp = l.material_components.find((c: any) =>
                            c.assets?.final_video_url || c.assets?.video_url
                        );
                        if (videoComp) videoUrl = videoComp.assets.final_video_url || videoComp.assets.video_url;
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
            }
        }

        const materialsPackage = materials?.package;

        // 3. Payload Construction
        const outPayload = {
            source: { platform: 'courseforge', version: '1.0', artifact_id: artifactId },
            course: {
                title: artifact.idea_central || '',
                description: getArtifactDescription(artifact),
                slug: pubRequest.slug,
                category: pubRequest.category,
                level: pubRequest.level,
                instructor_email: pubRequest.instructor_email,
                price: pubRequest.price || 0,
                thumbnail_url: pubRequest.thumbnail_url,
                is_published: false
            },
            modules: [] as any[]
        };

        const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        const moduleMap = new Map<string, any[]>();
        lessons.forEach(l => {
            const modTitle = l.module_title || 'Módulo General';
            if (!moduleMap.has(modTitle)) moduleMap.set(modTitle, []);
            moduleMap.get(modTitle)?.push(l);
        });

        const sortedModuleTitles = Array.from(moduleMap.keys()).sort(naturalSort);
        let moduleOrder = 1;

        for (const modTitle of sortedModuleTitles) {
            const modLessons = moduleMap.get(modTitle) || [];
            modLessons.sort((a: any, b: any) => naturalSort(a.title || '', b.title || ''));

            const moduleObj = {
                title: modTitle,
                order_index: moduleOrder++,
                lessons: [] as any[]
            };

            let lessonOrder = 1;
            for (const l of modLessons) {
                const mapping = pubRequest.lesson_videos?.[l.id];

                let videoUrl = '';
                let videoId = '';
                let provider = 'youtube';

                if (mapping?.video_id) {
                    videoId = mapping.video_id;
                    provider = mapping.video_provider || 'youtube';
                    if (provider === 'youtube') videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
                    else if (provider === 'vimeo') videoUrl = `https://vimeo.com/${videoId}`;
                    else videoUrl = videoId;
                } else if (l.auto_video_url) {
                    videoUrl = l.auto_video_url;
                }

                const components = l.components || [];

                let transcription = '';
                components.filter((c: any) => ['VIDEO_THEORETICAL', 'VIDEO_DEMO', 'VIDEO_GUIDE'].includes(c.type))
                  .forEach((vc: any) => {
                    if (vc.content?.script?.sections) {
                        transcription += vc.content.script.sections
                            .map((s: any) => `[${s.timecode_start}] ${s.narration_text}`)
                            .join('\n\n');
                    }
                });

                const activities = [] as any[];
                components.forEach((c: any) => {
                    if (c.type === 'DIALOGUE' && c.content) {
                        activities.push({
                            title: c.content.title || 'Simulación con LIA',
                            type: 'lia_script',
                            data: {
                                introduction: c.content.introduction || '',
                                scenes: Array.isArray(c.content.scenes) ? c.content.scenes.map((s: any) => ({
                                    character: s.character, message: s.message, emotion: s.emotion || 'neutral'
                                })) : [],
                                conclusion: c.content.conclusion || ''
                            }
                        });
                    }
                });

                const contentBlocks = [] as any[];
                let blockOrder = 1;
                components.forEach((c: any) => {
                    if (['READING', 'EXERCISE', 'DEMO_GUIDE'].includes(c.type) && c.content) {
                        let contentHtml = c.content.body_html || '';
                        if (c.type === 'DEMO_GUIDE' && !contentHtml && c.content.steps) {
                            contentHtml = `<h3>${c.content.title}</h3><ul>` +
                                c.content.steps.map((s: any) => `<li><strong>Paso ${s.step_number}:</strong> ${s.instruction}</li>`).join('') + '</ul>';
                        }
                        if (contentHtml) {
                            contentBlocks.push({
                                title: c.content.title || (c.type === 'READING' ? 'Lectura' : 'Ejercicio'),
                                content: contentHtml,
                                type: 'html', order: blockOrder++
                            });
                        }
                    }
                });

                const materials = [] as any[];
                components.forEach((c: any) => {
                    if (c.assets?.slides_url) materials.push({ title: 'Presentación', url: c.assets.slides_url, type: 'link' });
                    if (c.type === 'QUIZ' && c.content) {
                        materials.push({
                            title: c.content.title || 'Evaluación',
                            type: 'quiz',
                            data: transformQuizContent(c.content),
                            description: c.content.instructions || ''
                        });
                    }
                });

                if (materialsPackage?.files) {
                    materialsPackage.files.filter((f: any) => f.lesson_id === l.id).forEach((f: any) => {
                        materials.push({ title: `Recurso: ${f.component}`, url: f.path, type: 'download' });
                    });
                }

                const finalDuration = Math.round(Math.max(Number(mapping?.duration) || 0, 60));

                moduleObj.lessons.push({
                    title: l.title,
                    order_index: lessonOrder++,
                    duration_seconds: finalDuration,
                    duration: finalDuration,
                    summary: l.summary || '',
                    description: l.summary || '',
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
            outPayload.modules.push(moduleObj);
        }

        // 4. Send to Soflia
        const targetUrl = `${API_URL.replace(/\/$/, '')}/api/courses/import`;
        console.log(`[NetlifyFn /publish] Sending to Soflia: ${targetUrl}`);

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
            body: JSON.stringify(outPayload),
            signal: AbortSignal.timeout(50000) // Lower than Netlify max limit
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[NetlifyFn /publish] Soflia Error (${response.status}):`, errorText);
            return new Response(JSON.stringify({ error: `Error remoto: ${errorText.substring(0, 200)}` }), { status: response.status });
        }

        const result = await response.json();

        // 5. Update Status locally
        await supabase
            .from('publication_requests')
            .update({ status: 'SENT', updated_at: new Date().toISOString() })
            .eq('id', pubRequest.id);

        return new Response(JSON.stringify({ success: true, data: result }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });

    } catch (error: any) {
        console.error('[NetlifyFn /publish] Route Error:', error);
        return new Response(JSON.stringify({ error: error.message }), { 
            status: 500,
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
    }
};

// Utils 
function getArtifactDescription(artifact: any): string {
    if (!artifact.descripcion) return artifact.idea_central || '';
    if (typeof artifact.descripcion === 'string') return artifact.descripcion;
    const desc = artifact.descripcion;
    return desc.texto || desc.resumen || desc.overview || desc.description || JSON.stringify(desc);
}

function transformQuizContent(content: any) {
    if (!content) return {};
    const rawItems = Array.isArray(content.questions) ? content.questions : (Array.isArray(content.items) ? content.items : []);
    let calculatedTotalPoints = 0;
    const questions = rawItems.map((q: any) => {
        const options = Array.isArray(q.options) ? q.options.map((o: any) => String(o)) : [];
        const points = Number(q.points) || 10;
        calculatedTotalPoints += points;
        let correctAnswer = '';
        const rawCorrect = q.correctAnswer !== undefined ? q.correctAnswer : q.correct_answer;
        if (typeof rawCorrect === 'number' && rawCorrect >= 0 && rawCorrect < options.length) correctAnswer = options[rawCorrect];
        else correctAnswer = String(rawCorrect || '');
        return {
            id: q.id || Math.random().toString(36),
            question: q.question || q.questionText || '',
            questionType: (q.questionType || q.question_type || q.type || 'multiple_choice').toLowerCase(),
            options, correctAnswer, explanation: q.explanation || '', points
        };
    });
    return {
        passing_score: Number(content.passing_score) || 80,
        totalPoints: calculatedTotalPoints > 0 ? calculatedTotalPoints : 100,
        questions
    };
}

export const config: Config = {
    path: "/api/trigger-publish"
};
