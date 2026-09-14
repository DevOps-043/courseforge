import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createOperationalLogger, resolveCorrelationId } from '@/lib/server/operational-logger'

export async function GET(request: Request) {
  const requestId = resolveCorrelationId(request.headers.get('x-request-id'))
  const logger = createOperationalLogger('auth.callback', { correlationId: requestId })
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const requestedNext = searchParams.get('next')
  const next = requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
    ? requestedNext
    : '/admin'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      const response = NextResponse.redirect(new URL(next, origin))
      response.headers.set('x-request-id', requestId)
      return response
    }
    logger.warn('auth.callback.exchange_failed', { code: error.code })
  }

  const response = NextResponse.redirect(new URL('/login?error=auth_callback_failed', origin))
  response.headers.set('x-request-id', requestId)
  return response
}
