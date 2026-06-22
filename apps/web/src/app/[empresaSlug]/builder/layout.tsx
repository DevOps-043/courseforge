import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/utils/supabase/server';
import { getAuthBridgeUser } from '@/utils/auth/session';
import BuilderLayoutClient from '@/app/builder/BuilderLayoutClient';
import { logoutAction } from '@/app/login/actions';
import { resolveSidebarProfile } from '@/components/layout/layout.types';
import { resolveTenantContext } from '@/lib/server/tenant-context';

export default async function TenantBuilderLayout({
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
  const isConstructor = effectiveRole === 'CONSTRUCTOR' || !effectiveRole;
  const isHigherRole = ['ADMIN', 'ARQUITECTO', 'SUPERADMIN'].includes(
    effectiveRole as string,
  );

  if (!isConstructor && !isHigherRole) {
    redirect('/login?error=unknown_role');
  }

  const displayProfile = {
    ...(resolveSidebarProfile(profile, bridgeUser) || {}),
    platform_role: effectiveRole,
  };

  return (
    <BuilderLayoutClient
      userEmail={userEmail}
      logoutAction={logoutAction}
      profile={displayProfile}
      basePath={`/${tenant.organizationSlug}/builder`}
    >
      {children}
    </BuilderLayoutClient>
  );
}
