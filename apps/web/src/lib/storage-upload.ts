import { createClient } from '@/utils/supabase/client';
import * as tus from 'tus-js-client';
import { PUBLIC_PRODUCTION_MEDIA_BUCKETS } from '@/domains/production/media-storage.config';

const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 6 * 1024 * 1024;
const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;

interface BrowserDeliveryUploadResult {
    publicUrl: string;
    path: string;
}

interface SignedUploadOptions {
    artifactId?: string;
    componentId?: string;
    purpose?: 'template-bundle' | 'production-asset' | 'thumbnail' | 'production-video' | 'bundle-agent-reference' | 'curation-source-pdf';
    contentType?: string;
    fileSizeBytes?: number;
    upsert?: boolean;
    signal?: AbortSignal;
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
    deliveryMode?: 'server-only';
}

interface ServerOnlySignedUploadOptions extends SignedUploadOptions {
    /**
     * The uploaded object is consumed by a server action immediately after upload.
     * No browser delivery URL is created for private source documents.
     */
    deliveryMode: 'server-only';
}

/**
 * Uploads a file to Supabase Storage using a server-generated signed URL.
 * Works for both GoTrue and Auth Bridge users — avoids RLS violations
 * that occur when the browser client has no active GoTrue session.
 */
export function uploadWithSignedUrl(
    bucket: string,
    filePath: string,
    file: File,
    options: ServerOnlySignedUploadOptions,
): Promise<{ path: string }>;
export function uploadWithSignedUrl(
    bucket: string,
    filePath: string,
    file: File,
    options?: SignedUploadOptions,
): Promise<BrowserDeliveryUploadResult>;
export async function uploadWithSignedUrl(
    bucket: string,
    filePath: string,
    file: File,
    options: SignedUploadOptions = {},
): Promise<BrowserDeliveryUploadResult | { path: string }> {
    // 1. Request a signed upload URL from the server (auth handled server-side)
    const response = await fetch('/api/storage/signed-upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            bucket,
            filePath,
            artifactId: options.artifactId,
            componentId: options.componentId,
            purpose: options.purpose,
            contentType: options.contentType || file.type || undefined,
            fileSizeBytes: options.fileSizeBytes ?? file.size,
            upsert: options.upsert,
        }),
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

    // 2. Large media uses TUS so a refresh/network interruption can resume it.
    const supabase = createClient();
    const contentType = options.contentType || file.type || 'application/octet-stream';
    if (file.size >= RESUMABLE_UPLOAD_THRESHOLD_BYTES) {
        await uploadResumable({
            bucket,
            contentType,
            file,
            onProgress: options.onProgress,
            path,
            signal: options.signal,
            token,
            upsert: options.upsert ?? true,
        });
    } else {
        const { error: uploadError } = await supabase.storage
            .from(bucket)
            .uploadToSignedUrl(path, token, file, {
                contentType,
                upsert: options.upsert ?? true,
            });
        if (uploadError) throw uploadError;
        options.onProgress?.(file.size, file.size);
    }

    if (options.deliveryMode === 'server-only') {
        return { path };
    }

    // 3. Private sources keep a stable authenticated application URL. The
    // endpoint signs each read; no expiring Storage credential is persisted.
    let publicUrl: string;
    if (PUBLIC_PRODUCTION_MEDIA_BUCKETS.has(bucket) || bucket === 'thumbnails') {
        publicUrl = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    } else {
        if (!options.componentId) {
            throw new Error('componentId es requerido para entregar un archivo privado');
        }
        const deliveryUrl = new URL('/api/storage/media', window.location.origin);
        deliveryUrl.searchParams.set('bucket', bucket);
        deliveryUrl.searchParams.set('componentId', options.componentId);
        deliveryUrl.searchParams.set('path', path);
        publicUrl = `${deliveryUrl.pathname}${deliveryUrl.search}`;
    }

    return { publicUrl, path };
}

async function uploadResumable(params: {
    bucket: string;
    contentType: string;
    file: File;
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
    path: string;
    signal?: AbortSignal;
    token: string;
    upsert: boolean;
}) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL no está configurada');
    const projectUrl = new URL(supabaseUrl);
    const projectRef = projectUrl.hostname.split('.')[0];
    if (!projectRef) throw new Error('La URL de Supabase no contiene un project ref válido');
    const endpoint = `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;

    await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            params.signal?.removeEventListener('abort', abort);
            callback();
        };
        const upload = new tus.Upload(params.file, {
            chunkSize: TUS_CHUNK_SIZE_BYTES,
            endpoint,
            headers: {
                'x-signature': params.token,
                'x-upsert': String(params.upsert),
            },
            metadata: {
                bucketName: params.bucket,
                cacheControl: '3600',
                contentType: params.contentType,
                filename: params.file.name,
                objectName: params.path,
            },
            onError: (error) => finish(() => reject(error)),
            onProgress: (uploaded, total) => params.onProgress?.(uploaded, total),
            onSuccess: () => finish(resolve),
            removeFingerprintOnSuccess: true,
            retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
            uploadDataDuringCreation: true,
        });
        const abort = () => {
            void upload.abort(false).finally(() => finish(() => reject(new DOMException('Subida cancelada', 'AbortError'))));
        };
        if (params.signal?.aborted) {
            abort();
            return;
        }
        params.signal?.addEventListener('abort', abort, { once: true });
        void upload.findPreviousUploads()
            .then((previousUploads) => {
                if (previousUploads.length > 0) upload.resumeFromPreviousUpload(previousUploads[0]!);
                upload.start();
            })
            .catch((error) => finish(() => reject(error)));
    });
}
