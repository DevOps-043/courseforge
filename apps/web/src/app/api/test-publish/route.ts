import { NextResponse } from 'next/server';
import { getPublicationData } from '@/app/admin/artifacts/[id]/publish/actions';

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

        const { request: pubRequest, lessons, artifact, materialsPackage } = await getPublicationData(artifactId);

        if (!pubRequest) {
            return NextResponse.json({ error: "El borrador de publicación no existe." }, { status: 400 });
        }

        // 3. Payload Construction
        const outPayload = {
            course: {
                title: artifact.title,
                slug: pubRequest.slug,
                // Solo campos esenciales para verificar
            },
            modules: [] as any[]
        };

        const moduleMap = new Map<string, any[]>();
        lessons.forEach(l => {
            const modTitle = l.module_title || 'Módulo General';
            if (!moduleMap.has(modTitle)) {
                moduleMap.set(modTitle, []);
            }
            moduleMap.get(modTitle)?.push(l);
        });

        const sortedModuleTitles = Array.from(moduleMap.keys());

        let moduleOrder = 1;
        for (const modTitle of sortedModuleTitles) {
            const modLessons = moduleMap.get(modTitle) || [];

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
                
                // Skip lesson if no video is assigned (enabling progressive publishing)
                if (!videoId && !videoUrl) {
                    continue;
                }

                // Simplified lesson to just show the testing format
                moduleObj.lessons.push({
                    title: l.title,
                    order_index: lessonOrder++,
                    video_provider: provider,
                    video_provider_id: videoId || videoUrl,
                    has_transcription: !!l.components?.some((c: any) => ['VIDEO_THEORETICAL', 'VIDEO_DEMO', 'VIDEO_GUIDE'].includes(c.type)),
                    // Ignore materials/activities for brevity in the tree representation 
                });
            }
            
            // Only add the module if it has valid lessons
            if (moduleObj.lessons.length > 0) {
                outPayload.modules.push(moduleObj);
            }
        }

        // Print Out Payload summary nicely formatting the modules and lessons
        console.log(`\n[ESTRUCTURA DEL CURSO GENERADA]`);
        console.log(`Título: ${outPayload.course.title || '----'}`);
        console.log(`Total de Módulos Activos (con lecciones enviables): ${outPayload.modules.length}\n`);

        outPayload.modules.forEach(mod => {
            console.log(`M${mod.order_index} - ${mod.title} (${mod.lessons.length} lecciones)`);
            mod.lessons.forEach(l => {
                console.log(`  └─ L${l.order_index} - ${l.title} [${l.video_provider_id ? 'Video OK' : 'No Video'}]`);
            });
            console.log('');
        });
        
        console.log(`[TEST PUBLISH COMPLETADO]\n======================================================\n`);

        return NextResponse.json({ success: true, message: 'Test de envío completado. Revisa la terminal del servidor.', payload_preview: { 
            modulesCount: outPayload.modules.length, 
            modules: outPayload.modules 
        }});

    } catch (error: any) {
        console.error('[TEST PUBLISH] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
