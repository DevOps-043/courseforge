import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSofliaInboxEnv, getSupabaseUrl } from '@/lib/server/env'

const signUpRequestSchema = z.object({
  email: z.string().email().max(320),
  firstName: z.string().trim().max(100).optional(),
  lastNameFather: z.string().trim().max(100).optional(),
  lastNameMother: z.string().trim().max(100).optional(),
  password: z.string().min(10).max(128),
  username: z.string().trim().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/).optional(),
}).strict()

export async function POST(request: Request) {
  try {
    const requestUrl = new URL(request.url)
    const parsed = signUpRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos de registro invalidos.' }, { status: 400 })
    }
    const { email, password, firstName, lastNameFather, lastNameMother, username } = parsed.data

    // Login is authoritative in Learning/SofLIA. Never create an identity in a
    // different Supabase project because that account could not log in here.
    const courseforgeHost = new URL(getSupabaseUrl()).host.toLowerCase()
    const sofliaHost = new URL(getSofliaInboxEnv().url).host.toLowerCase()
    if (courseforgeHost !== sofliaHost) {
      return NextResponse.json(
        { error: 'El registro directo no esta disponible. Solicita una invitacion a tu administrador.' },
        { status: 503 },
      )
    }

    const supabase = await createClient()

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${requestUrl.origin}/api/auth/callback`,
        data: {
          first_name: firstName,
          last_name_father: lastNameFather,
          last_name_mother: lastNameMother,
          username: username,
        },
      },
    })

    if (error) {
      console.warn('[auth/sign-up] Identity provider rejected sign-up', { code: error.code })
      return NextResponse.json({ error: 'No se pudo completar el registro.' }, { status: 400 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
