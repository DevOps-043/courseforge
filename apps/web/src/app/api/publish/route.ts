import { NextResponse } from 'next/server';
import { getPublicationData } from '@/app/admin/artifacts/[id]/publish/actions';
import { createClient } from '@/utils/supabase/server';

export async function POST(request: Request) {
    try {
        const payload = await request.json();
        const { artifactId } = payload;

        if (!artifactId) {
            return NextResponse.json({ error: 'Falta artifactId' }, { status: 400 });
        }

        console.log(`[API /publish] Starting publication for artifact: ${artifactId}`);

        // 1. Validate Config
        const API_URL = process.env.SOFLIA_API_URL;
        const API_KEY = process.env.SOFLIA_API_KEY;

        if (!API_URL || !API_KEY) {
            console.error(`[API /publish] CRITICAL ERR - Faltan variables de entorno.`);
            return NextResponse.json({
                error: "Configuración incompleta: Faltan variables de entorno SOFLIA_API_URL o SOFLIA_API_KEY",
                debug: {
                    hasUrl: !!API_URL,
                    hasKey: !!API_KEY
                }
            }, { status: 500 });
        }

        // 2. Data Gathering
        const { request: pubRequest, lessons, artifact, materialsPackage } = await getPublicationData(artifactId);

        if (!pubRequest || pubRequest.status !== 'READY') {
            return NextResponse.json({ error: "El curso no está en estado 'READY' para publicar. Guarde el borrador primero." }, { status: 400 });
        }

        // 3. Payload Construction
        const outPayload = {
            source: {
                platform: 'courseforge',
                version: '1.0',
                artifact_id: artifactId
            },
            course: {
                title: artifact.title,
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

        const naturalSort = (a: string, b: string) => {
            return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
        };

        const moduleMap = new Map<string, any[]>();
        lessons.forEach(l => {
            const modTitle = l.module_title || 'Módulo General';
            if (!moduleMap.has(modTitle)) {
                moduleMap.set(modTitle, []);
            }
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
                const videoComps = components.filter((c: any) => ['VIDEO_THEORETICAL', 'VIDEO_DEMO', 'VIDEO_GUIDE'].includes(c.type));
                videoComps.forEach((vc: any) => {
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
                            data: transformLiaContent(c.content)
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
                                c.content.steps.map((s: any) => `<li><strong>Paso ${s.step_number}:</strong> ${s.instruction}</li>`).join('') +
                                '</ul>';
                        }

                        if (contentHtml) {
                            contentBlocks.push({
                                title: c.content.title || (c.type === 'READING' ? 'Lectura' : 'Ejercicio'),
                                content: contentHtml,
                                type: 'html',
                                order: blockOrder++
                            });
                        }
                    }
                });

                const materials = [] as any[];
                components.forEach((c: any) => {
                    if (c.assets?.slides_url) {
                        materials.push({
                            title: 'Presentación (Diapositivas)',
                            url: c.assets.slides_url,
                            type: 'link'
                        });
                    }

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
                    const lessonFiles = materialsPackage.files.filter((f: any) => f.lesson_id === l.id);
                    lessonFiles.forEach((f: any) => {
                        materials.push({
                            title: `Recurso: ${f.component}`,
                            url: f.path,
                            type: 'download'
                        });
                    });
                }

                const durationRaw = mapping?.duration;
                const durationNum = Number(durationRaw);
                const finalDuration = Math.round(Math.max(durationNum || 0, 60));

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
        const baseUrl = API_URL.replace(/\/$/, '');
        const targetUrl = `${baseUrl}/api/courses/import`;

        console.log(`[API /publish] Sending to Soflia: ${targetUrl}`);

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY || ''
            },
            body: JSON.stringify(outPayload),
            signal: AbortSignal.timeout(60000)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[API /publish] Soflia Error (${response.status}):`, errorText);
            return NextResponse.json({ error: `Error remoto (${response.status}): ${errorText.substring(0, 500)}` }, { status: response.status });
        }

        const result = await response.json();
        console.log('[API /publish] Success:', result);

        // 5. Update Status locally
        const supabase = await createClient();
        const { error: updateError } = await supabase
            .from('publication_requests')
            .update({
                status: 'SENT',
                updated_at: new Date().toISOString()
            })
            .eq('id', pubRequest.id);

        if (updateError) {
            console.error('[API /publish] Error updating local status:', updateError);
        }

        return NextResponse.json({ success: true, data: result });

    } catch (error: any) {
        console.error('[API /publish] Route Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

// Helpers
function getArtifactDescription(artifact: any): string {
    if (!artifact.description) return artifact.title || '';
    if (typeof artifact.description === 'string') return artifact.description;
    const desc = artifact.description;
    return desc.texto || desc.resumen || desc.overview || desc.description || JSON.stringify(desc);
}

function transformQuizContent(content: any) {
    if (!content) return {};
    const rawItems = Array.isArray(content.questions) ? content.questions : (Array.isArray(content.items) ? content.items : []);
    let calculatedTotalPoints = 0;
    const questions = rawItems.map((q: any) => {
        const options = Array.isArray(q.options) ? q.options.map((o: any) => typeof o === 'string' ? o : String(o)) : [];
        const points = Number(q.points) || 10;
        calculatedTotalPoints += points;
        let correctAnswer = '';
        const rawCorrect = q.correctAnswer !== undefined ? q.correctAnswer : q.correct_answer;
        if (typeof rawCorrect === 'number') {
            if (rawCorrect >= 0 && rawCorrect < options.length) correctAnswer = options[rawCorrect];
        } else {
            correctAnswer = String(rawCorrect || '');
        }
        let qType = (q.questionType || q.question_type || q.type || 'multiple_choice').toLowerCase();
        return {
            id: q.id || `q-${Math.random().toString(36).substr(2, 9)}`,
            question: q.question || q.questionText || '',
            questionType: qType,
            options: options,
            correctAnswer: correctAnswer,
            explanation: q.explanation || '',
            points: points
        };
    });
    return {
        passing_score: Number(content.passing_score) || 80,
        totalPoints: calculatedTotalPoints > 0 ? calculatedTotalPoints : (content.totalPoints || content.total_points || 100),
        questions: questions
    };
}

function transformLiaContent(content: any) {
    if (!content) return {};
    const scenes = Array.isArray(content.scenes) ? content.scenes.map((s: any) => ({
        character: s.character,
        message: s.message,
        emotion: s.emotion || 'neutral'
    })) : [];
    return {
        introduction: content.introduction || '',
        scenes: scenes,
        conclusion: content.conclusion || ''
    };
}
