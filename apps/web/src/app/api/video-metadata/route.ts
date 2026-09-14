import { fetchVideoMetadata } from '@/lib/server/video-metadata.service';
import { API_ERROR_CODE } from '@/lib/server/api-contract';
import { apiErrorResponse, apiSuccessResponse } from '@/lib/server/api-response';
import { createOperationalLogger, resolveCorrelationId } from '@/lib/server/operational-logger';

// Only YouTube and Vimeo are supported — prevents SSRF via open proxy
const ALLOWED_HOSTNAMES = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'vimeo.com']);

function isAllowedUrl(raw: string): boolean {
    try {
        const parsed = new URL(raw);
        return raw.length <= 2048
            && parsed.protocol === 'https:'
            && !parsed.username
            && !parsed.password
            && !parsed.port
            && ALLOWED_HOSTNAMES.has(parsed.hostname);
    } catch {
        return false;
    }
}

export async function GET(request: Request) {
    const requestId = resolveCorrelationId(request.headers.get('x-request-id'));
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
        return apiErrorResponse({
            code: API_ERROR_CODE.invalidRequest,
            message: 'Missing url parameter',
            requestId,
            status: 400,
        });
    }

    if (!isAllowedUrl(url)) {
        return apiErrorResponse({
            code: API_ERROR_CODE.invalidRequest,
            message: 'URL not supported. Only secure YouTube and Vimeo URLs are allowed.',
            requestId,
            status: 400,
        });
    }

    try {
        const metadata = await fetchVideoMetadata(url);
        return apiSuccessResponse(metadata, { requestId });
    } catch (error: unknown) {
        createOperationalLogger('video-metadata', { correlationId: requestId })
            .error('video_metadata.fetch_failed', error);
        return apiErrorResponse({
            code: API_ERROR_CODE.providerError,
            message: 'No se pudieron obtener los metadatos del video.',
            requestId,
            retryable: true,
            status: 502,
        });
    }
}
