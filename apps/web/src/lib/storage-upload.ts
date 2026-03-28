import { createClient } from '@/utils/supabase/client';

interface SignedUploadResult {
    publicUrl: string;
}

/**
 * Uploads a file to Supabase Storage using a server-generated signed URL.
 * Works for both GoTrue and Auth Bridge users — avoids RLS violations
 * that occur when the browser client has no active GoTrue session.
 */
export async function uploadWithSignedUrl(
    bucket: string,
    filePath: string,
    file: File,
): Promise<SignedUploadResult> {
    // 1. Request a signed upload URL from the server (auth handled server-side)
    const response = await fetch('/api/storage/signed-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket, filePath }),
    });

    if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error || 'No se pudo obtener URL de subida');
    }

    const { token, path } = (await response.json()) as {
        signedUrl: string;
        token: string;
        path: string;
    };

    // 2. Upload directly to Supabase Storage using the signed URL (no auth needed)
    const supabase = createClient();
    const { error: uploadError } = await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(path, token, file);

    if (uploadError) {
        throw uploadError;
    }

    // 3. Get the public URL (no auth needed — public buckets)
    const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(path);

    return { publicUrl };
}
