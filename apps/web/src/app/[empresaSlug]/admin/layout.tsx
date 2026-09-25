import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getAuthBridgeUser } from '@/utils/auth/session';
import { logoutAction } from '@/app/login/actions';
import AdminLayoutClient from '@/app/admin/AdminLayoutClient';
import { getSupabaseServiceRoleKey, getSupabaseUrl } from '@/lib/server/env';
import { resolveSidebarProfile } from '@/components/layout/layout.types';
import { resolveTenantContext, TenantContextLookupError } from '@/lib/server/tenant-context';
import { TenantLookupUnavailable } from '@/app/_components/TenantLookupUnavailable';
import { userHasPlatformPermission } from '@/lib/server/platform-authorization';
import { PLATFORM_PERMISSIONS } from '@/utils/auth/platform-permissions';

export default async function TenantAdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<unknown>;
}) {
  const { empresaSlug } = (await params) as { empresaSlug: string };
  let tenant;
  try {
    tenant = await resolveTenantContext(empresaSlug);
  } catch (error) {
    if (error instanceof TenantContextLookupError) return <TenantLookupUnavailable />;
    throw error;
  }
  if (!tenant) {
    notFound();
  }

  const supabase = await createClient();
  let {
    data: { user },
  } = await supabase.auth.getUser();

  let bridgeUser = null;
  if (!user) {
    bridgeUser = await getAuthBridgeUser();
    if (!bridgeUser) {
      redirect('/login');
    }
  }

  const userId = user?.id || bridgeUser?.id;
  const userEmail = user?.email || bridgeUser?.email;

  let { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url, first_name, last_name_father, platform_role')
    .eq('id', userId)
    .single();

  if (!profile) {
    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const cfAdmin = createAdminClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
    const { data: adminProfile } = await cfAdmin
      .from('profiles')
      .select('avatar_url, first_name, last_name_father, platform_role')
      .eq('id', userId)
      .single();
    profile = adminProfile;
  }

  const effectiveRole = tenant.platformRole || profile?.platform_role;
  const hasValidRole = ['ADMIN', 'ARQUITECTO', 'CONSTRUCTOR', 'SUPERADMIN'].includes(
    effectiveRole as string,
  );
  if (!hasValidRole) {
    redirect('/login?error=unauthorized');
  }

  const displayProfile = {
    ...(resolveSidebarProfile(profile, bridgeUser) || {}),
    platform_role: effectiveRole,
  };
  const showPlatformMonitoring = await userHasPlatformPermission(
    PLATFORM_PERMISSIONS.AI_USAGE_READ,
  );

  return (
    <AdminLayoutClient
      userEmail={userEmail}
      logoutAction={logoutAction}
      profile={displayProfile}
      basePath={`/${tenant.organizationSlug}/admin`}
      showPlatformMonitoring={showPlatformMonitoring}
    >
      {children}
    </AdminLayoutClient>
  );
}
