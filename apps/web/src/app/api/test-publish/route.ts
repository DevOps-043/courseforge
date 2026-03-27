import { NextResponse } from 'next/server';
import { getPublicationData } from '@/app/admin/artifacts/[id]/publish/actions';

interface PublicationPreviewLesson {
    title: string;
    order_index: number;
    video_provider: string;
    video_provider_id: string;
    has_transcription: boolean;
}

interface PublicationPreviewModule {
    title: string;
    order_index: number;
    lessons: PublicationPreviewLesson[];
}

interface PublicationPreviewPayload {
    course: {
        title: string;
        slug: string;
    };
    modules: PublicationPreviewModule[];
}

export async function POST(request: Request) {
    try {
        const payload = await request.json();
        const { artifactId } = payload;

        if (!artifactId) {
            return NextResponse.json({ error: 'Falta artifactId' }, { status: 400 });
        }

        console.log(`\n======================================================`);
        console.log(`[TEST PUBLISH] Iniciando test para artifact: ${artifactId}`);
        console.log(`======================================================\n`);

        const { request: pubRequest, lessons, artifact } =
            await getPublicationData(artifactId);

        if (!pubRequest) {
            return NextResponse.json(
                { error: 'El borrador de publicación no existe.' },
                { status: 400 }
            );
        }

        const outPayload: PublicationPreviewPayload = {
            course: {
                title: artifact.title,
                slug: pubRequest.slug,
            },
            modules: [],
        };

        const moduleMap = new Map<string, any[]>();
        lessons.forEach((lesson: any) => {
            const moduleTitle = lesson.module_title || 'Módulo General';
            if (!moduleMap.has(moduleTitle)) {
                moduleMap.set(moduleTitle, []);
            }
            moduleMap.get(moduleTitle)?.push(lesson);
        });

        const sortedModuleTitles = Array.from(moduleMap.keys());

        let moduleOrder = 1;
        for (const moduleTitle of sortedModuleTitles) {
            const moduleLessons = moduleMap.get(moduleTitle) || [];
            const modulePreview: PublicationPreviewModule = {
                title: moduleTitle,
                order_index: moduleOrder++,
                lessons: [],
            };

            let lessonOrder = 1;
            for (const lesson of moduleLessons) {
                const mapping = pubRequest.lesson_videos?.[lesson.id];
                let videoUrl = '';
                let videoId = '';
                let provider = 'youtube';

                if (mapping?.video_id) {
                    videoId = mapping.video_id;
                    provider = mapping.video_provider || 'youtube';

                    if (provider === 'youtube') {
                        videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
                    } else if (provider === 'vimeo') {
                        videoUrl = `https://vimeo.com/${videoId}`;
                    } else {
                        videoUrl = videoId;
                    }
                } else if (lesson.auto_video_url) {
                    videoUrl = lesson.auto_video_url;
                }

                if (!videoId && !videoUrl) {
                    continue;
                }

                modulePreview.lessons.push({
                    title: lesson.title,
                    order_index: lessonOrder++,
                    video_provider: provider,
                    video_provider_id: videoId || videoUrl,
                    has_transcription: !!lesson.components?.some((component: any) =>
                        ['VIDEO_THEORETICAL', 'VIDEO_DEMO', 'VIDEO_GUIDE'].includes(
                            component.type
                        )
                    ),
                });
            }

            if (modulePreview.lessons.length > 0) {
                outPayload.modules.push(modulePreview);
            }
        }

        console.log(`\n[ESTRUCTURA DEL CURSO GENERADA]`);
        console.log(`Título: ${outPayload.course.title || '----'}`);
        console.log(
            `Total de Módulos Activos (con lecciones enviables): ${outPayload.modules.length}\n`
        );

        outPayload.modules.forEach((modulePreview) => {
            console.log(
                `M${modulePreview.order_index} - ${modulePreview.title} (${modulePreview.lessons.length} lecciones)`
            );
            modulePreview.lessons.forEach((lessonPreview) => {
                console.log(
                    `  -> L${lessonPreview.order_index} - ${lessonPreview.title} [${lessonPreview.video_provider_id ? 'Video OK' : 'No Video'}]`
                );
            });
            console.log('');
        });

        console.log(
            `[TEST PUBLISH COMPLETADO]\n======================================================\n`
        );

        return NextResponse.json({
            success: true,
            message: 'Test de envío completado. Revisa la terminal del servidor.',
            payload_preview: {
                modulesCount: outPayload.modules.length,
                modules: outPayload.modules,
            },
        });
    } catch (error: any) {
        console.error('[TEST PUBLISH] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
