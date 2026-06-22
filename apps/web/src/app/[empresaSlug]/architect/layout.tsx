import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getAuthBridgeUser } from '@/utils/auth/session';
import ArchitectLayoutClient from '@/app/architect/ArchitectLayoutClient';
import { logoutAction } from '@/app/login/actions';
import { resolveSidebarProfile } from '@/components/layout/layout.types';
import { resolveTenantContext } from '@/lib/server/tenant-context';

export default async function TenantArchitectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<unknown>;
}) {
  const { empresaSlug } = (await params) as { empresaSlug: string };
  const tenant = await resolveTenantContext(empresaSlug);
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

  const { data: profile } = await supabase
    .from('profiles')
    .select('avatar_url, first_name, last_name_father, platform_role')
    .eq('id', userId)
    .single();

  const effectiveRole = tenant.platformRole || profile?.platform_role;
  const isArchitectOrAdmin = ['ARQUITECTO', 'ADMIN', 'SUPERADMIN'].includes(
    effectiveRole as string,
  );
  if (!isArchitectOrAdmin) {
    redirect(`/${tenant.organizationSlug}/builder?error=unauthorized_architect`);
  }

  const displayProfile = {
    ...(resolveSidebarProfile(profile, bridgeUser) || {}),
    platform_role: effectiveRole,
  };

  return (
    <ArchitectLayoutClient
      userEmail={userEmail}
      logoutAction={logoutAction}
      profile={displayProfile}
      basePath={`/${tenant.organizationSlug}/architect`}
    >
      {children}
    </ArchitectLayoutClient>
  );
}
