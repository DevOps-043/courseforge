import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { createClient } from '@/utils/supabase/server';
import { getSofliaInboxEnv, getSupabaseServiceRoleKey, getSupabaseUrl } from '@/lib/server/env';
import { getAuthenticatedUser } from '@/lib/server/artifact-action-auth';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return NextResponse.json({ error: 'Empresa no valida o no autorizada.' }, { status: 403 });
    }

    if (tenant.platformRole !== 'ADMIN' && tenant.platformRole !== 'SUPERADMIN') {
        return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 });
    }

    const body = await req.json();
    const { id, firstName, lastNameFather, lastNameMother, email, role, username } = body;
    if (!id) {
      return NextResponse.json({ error: 'User id is required.' }, { status: 400 });
    }

    const sofliaEnv = getSofliaInboxEnv();
    const sofliaAdmin = createAdminClient(sofliaEnv.url, sofliaEnv.key);
    const { data: membership, error: membershipError } = await sofliaAdmin
      .from('organization_users')
      .select('id')
      .eq('organization_id', tenant.organizationId)
      .eq('user_id', id)
      .in('status', ['active', 'invited'])
      .maybeSingle();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: 'El usuario no pertenece a la empresa activa.' },
        { status: 403 },
      );
    }

    // Use Service Role only after tenant membership has been verified.
    const cfAdmin = createAdminClient(
      getSupabaseUrl(),
      getSupabaseServiceRoleKey(),
    );

    const { data: profile, error } = await cfAdmin
      .from('profiles')
      .upsert({
        id: id,
        first_name: firstName,
        last_name_father: lastNameFather,
        last_name_mother: lastNameMother,
        email: email,
        username: username,
        organization_id: tenant.organizationId,
      }, { onConflict: 'id' })
      .select()
      .single();

    if (error) {
      console.error('Error upserting profile:', error);
      return NextResponse.json({ error: 'Failed to update user profile' }, { status: 500 });
    }

    const { error: roleError } = await cfAdmin
      .from('organization_user_roles')
      .upsert(
        {
          organization_id: tenant.organizationId,
          user_id: id,
          platform_role: role,
          source: 'courseforge',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,user_id' },
      );

    if (roleError) {
      console.error('Error upserting organization user role:', roleError);
      return NextResponse.json({ error: 'Failed to update organization role' }, { status: 500 });
    }

    return NextResponse.json({ success: true, user: { ...profile, platform_role: role } });

  } catch (error) {
    console.error('API Error /api/admin/users:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
