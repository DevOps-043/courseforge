'use server';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface Source {
    title: string;
    url: string;
    type: 'article' | 'book' | 'video' | 'website' | 'documentation' | 'tutorial';
    lesson_id: string;
    lesson_title: string;
    summary?: string;
    validated?: boolean;
}

interface SourcesPayload {
    course_id: string; // Changed from artifact_id
    sources: Source[];
    metadata?: {
        total_lessons?: number;
        search_timestamp?: string;
    };
}

export async function POST(request: NextRequest) {
    // 1. Validate API Key
    const apiKey = request.headers.get('x-api-key');
    const expectedKey = process.env.GPT_SOURCES_API_KEY;

    if (!apiKey || apiKey !== expectedKey) {
        console.error('[GPT Sources API] Invalid API key attempt');
        return NextResponse.json(
            { success: false, error: 'Invalid or missing API key' },
            { status: 401 }
        );
    }

    try {
        // 2. Parse and validate payload
        const payload: SourcesPayload = await request.json();

        if (!payload.course_id || !payload.sources || !Array.isArray(payload.sources)) {
            return NextResponse.json(
                { success: false, error: 'Invalid payload: course_id and sources are required' },
                { status: 400 }
            );
        }

        if (payload.sources.length === 0) {
            return NextResponse.json(
                { success: false, error: 'At least one source is required' },
                { status: 400 }
            );
        }

        console.log(`[GPT Sources API] Received ${payload.sources.length} sources for course ${payload.course_id}`);

        // 3. Initialize Supabase with service role (server-side)
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // 4. Verify artifact exists using course_id OR id (fallback)
        const { data: artifact, error: artifactError } = await supabase
            .from('artifacts')
            .select('id, idea_central')
            .or(`course_id.eq.${payload.course_id},id.eq.${payload.course_id}`) // Try both for robustness
            .single();

        if (artifactError || !artifact) {
            console.error('[GPT Sources API] Artifact not found for course_id:', payload.course_id);
            return NextResponse.json(
                { success: false, error: 'Course/Artifact not found' },
                { status: 404 }
            );
        }

        const artifactId = artifact.id; // Resolve internal UUID

        // 5. Get or create curation record
        let curationId: string;
        const { data: existingCuration } = await supabase
            .from('curation')
            .select('id')
            .eq('artifact_id', artifactId) // Use resolved UUID
            .single();

        if (existingCuration) {
            curationId = existingCuration.id;

            // Clear existing GPT-generated rows (keep manual ones)
            const { error: deleteError } = await supabase
                .from('curation_rows')
                .delete()
                .eq('curation_id', curationId)
                .eq('source_rationale', 'GPT_GENERATED');

            if (deleteError) {
                console.warn('[GPT Sources API] Could not clear old GPT rows:', deleteError);
            }
        } else {
            const { data: newCuration, error: createError } = await supabase
                .from('curation')
                .insert({
                    artifact_id: artifactId, // Use resolved UUID
                    state: 'PHASE2_GENERATED',
                    attempt_number: 1
                })
                .select('id')
                .single();

            if (createError || !newCuration) {
                console.error('[GPT Sources API] Failed to create curation:', createError);
                throw new Error('Failed to create curation record');
            }
            curationId = newCuration.id;
        }

        // 6. Insert sources as curation_rows
        const rowsToInsert = payload.sources.map((source) => ({
            curation_id: curationId,
            lesson_id: source.lesson_id,
            lesson_title: source.lesson_title,
            component: source.type.toUpperCase(),
            is_critical: false,
            source_ref: source.url,
            source_title: source.title,
            source_rationale: 'GPT_GENERATED', // Tag to identify GPT sources
            url_status: 'VALID',
            apta: source.validated ?? true,
            auto_evaluated: true,
            auto_reason: source.summary || 'Validated by GPT Assistant'
        }));

        const { error: insertError } = await supabase
            .from('curation_rows')
            .insert(rowsToInsert);

        if (insertError) {
            console.error('[GPT Sources API] Insert error:', insertError);
            throw new Error(`Failed to insert sources: ${insertError.message}`);
        }

        // 7. Update curation state
        await supabase
            .from('curation')
            .update({
                state: 'PHASE2_GENERATED',
                updated_at: new Date().toISOString()
            })
            .eq('id', curationId);

        console.log(`[GPT Sources API] Successfully saved ${payload.sources.length} sources for artifact ${artifactId}`);

        return NextResponse.json({
            success: true,
            message: 'Sources received and saved successfully',
            sources_saved: payload.sources.length,
            artifact_title: artifact.idea_central
        });

    } catch (error: any) {
        console.error('[GPT Sources API] Error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}

// Handle OPTIONS for CORS (GPT Actions might need this)
export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
        },
    });
}
