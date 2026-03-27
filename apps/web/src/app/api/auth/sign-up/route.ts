import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

interface SignUpRequestBody {
  email?: string
  firstName?: string
  lastNameFather?: string
  lastNameMother?: string
  password?: string
  username?: string
}

export async function POST(request: Request) {
  try {
    const requestUrl = new URL(request.url)
    const { email, password, firstName, lastNameFather, lastNameMother, username } =
      (await request.json()) as SignUpRequestBody
    const supabase = await createClient()

    if (!email || !password) {
      return NextResponse.json({ error: 'Email y password son requeridos' }, { status: 400 })
    }

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
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
