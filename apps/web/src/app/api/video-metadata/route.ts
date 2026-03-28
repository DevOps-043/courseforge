import { NextResponse } from 'next/server';
import { fetchVideoMetadata } from '@/lib/video-platform';

// Only YouTube and Vimeo are supported — prevents SSRF via open proxy
const ALLOWED_HOSTNAMES = new Set(['youtube.com', 'www.youtube.com', 'youtu.be', 'vimeo.com']);

function isAllowedUrl(raw: string): boolean {
    try {
        const { hostname } = new URL(raw);
        return ALLOWED_HOSTNAMES.has(hostname);
    } catch {
        return false;
    }
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');

    if (!url) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    if (!isAllowedUrl(url)) {
        return NextResponse.json(
            { error: 'URL not supported. Only YouTube and Vimeo are allowed.' },
            { status: 400 },
        );
    }

    const metadata = await fetchVideoMetadata(url);
    return NextResponse.json(metadata);
}
