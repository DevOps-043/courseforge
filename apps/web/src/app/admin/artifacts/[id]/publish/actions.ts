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
            .order('module_id', { ascending: true })
            .order('lesson_id', { ascending: true });

        if (rawLessons) {
            lessons = rawLessons.map((l: any) => {
                // Try to find a video URL in components
                let videoUrl = '';
                let videoDuration = 0;
                if (l.material_components && Array.isArray(l.material_components)) {
                    // Prioritize final_video_url, then video_url
                    const videoComp = l.material_components.find((c: any) =>
                        c.assets?.final_video_url || c.assets?.video_url
                    );
                    if (videoComp) {
                        videoUrl = videoComp.assets.final_video_url || videoComp.assets.video_url;
                        videoDuration = videoComp.assets.video_duration || 0;
                    }
                }

                return {
                    id: l.lesson_id,
                    title: l.lesson_title,
                    module_title: l.module_title,
                    auto_video_url: videoUrl,
                    auto_duration: videoDuration,
                    summary: l.oa_text,
                    components: l.material_components || []
                };
            });
            // No sorting needed here, backend provides pre-sorted by module_id and lesson_id.
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

// testSofliaConnection removed

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
