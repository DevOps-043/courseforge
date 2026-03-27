import { NextResponse } from 'next/server';
import { getErrorDetails, getErrorMessage } from '@/lib/errors';
import { getOptionalServerEnvValue } from '@/lib/server/env';
import { API_ABORT_TIMEOUT_MS } from '@/shared/constants/timing';

export const dynamic = 'force-dynamic'; // Ensure this doesn't get statically cached

interface ConnectivityResult {
    details: unknown;
    message: string;
    success: boolean;
}

export async function GET() {
    const API_URL = getOptionalServerEnvValue('SOFLIA_API_URL');
    const API_KEY = getOptionalServerEnvValue('SOFLIA_API_KEY');

    // Masked keys for safety
    const maskedKey = API_KEY 
        ? `${API_KEY.substring(0, 5)}...${API_KEY.substring(API_KEY.length - 5)}` 
        : 'UNDEFINED';

    const envCheck = {
        SOFLIA_API_URL: API_URL ? 'DEFINED' : 'MISSING',
        SOFLIA_API_KEY: API_KEY ? 'DEFINED' : 'MISSING',
        URL_Value: API_URL,
        Key_Snippet: maskedKey
    };

    console.log('[Debug API] Env Check:', envCheck);

    let connectivityResult: ConnectivityResult = { success: false, message: '', details: null };

    // Try Connectivity
    if (API_URL) {
        try {
            const targetUrl = `${API_URL}/api/courses/import`; // Using the import endpoint just to ping
            console.log(`[Debug API] Pinging: ${targetUrl}`);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(
                () => controller.abort(),
                API_ABORT_TIMEOUT_MS,
            );

            const start = Date.now();
            const response = await fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': API_KEY || ''
                },
                body: JSON.stringify({ type: 'ping_diagnostic' }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const duration = Date.now() - start;

            const text = await response.text();
            let json = null;
            try { json = JSON.parse(text); } catch {}

            connectivityResult = {
                success: response.ok,
                message: `Status: ${response.status} ${response.statusText} (${duration}ms)`,
                details: {
                    status: response.status,
                    full_response: json || text
                }
            };

        } catch (error: unknown) {
            connectivityResult = {
                success: false,
                message: `Fetch Error: ${getErrorMessage(error)}`,
                details: getErrorDetails(error),
            };
        }
    } else {
        connectivityResult.message = 'Skipping fetch: API URL missing';
    }

    return NextResponse.json({
        environment: envCheck,
        connectivity: connectivityResult,
        timestamp: new Date().toISOString()
    });
}
