import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getAuthBridgeUser } from '@/utils/auth/session';
import { createClient } from '@/utils/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    let { data: { user } } = await supabase.auth.getUser();
    
    let bridgeUser = null;
    if (!user) {
      bridgeUser = await getAuthBridgeUser();
      if (!bridgeUser) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const userId = user?.id || bridgeUser?.id;

    // Verify if the requester is an ADMIN locally
    const { data: requesterProfile } = await supabase
      .from('profiles')
      .select('platform_role')
      .eq('id', userId)
      .single();

    if (requesterProfile?.platform_role !== 'ADMIN') {
        return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const body = await req.json();
    const { id, firstName, lastNameFather, lastNameMother, email, role, username } = body;

    // Use Service Role to update user profiles across the board
    const cfAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await cfAdmin
      .from('profiles')
      .upsert({
        id: id,
        first_name: firstName,
        last_name_father: lastNameFather,
        last_name_mother: lastNameMother,
        email: email,
        platform_role: role,
        username: username,
      }, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.error('Error upserting profile:', error);
      return NextResponse.json({ error: 'Failed to update user profile' }, { status: 500 });
    }

    return NextResponse.json({ success: true, user: data });

  } catch (error) {
    console.error('API Error /api/admin/users:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
