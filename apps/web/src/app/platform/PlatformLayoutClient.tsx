"use client";

import { Activity, ArrowLeft, ShieldCheck } from "lucide-react";
import SharedSidebarLayout, { type NavItemConfig } from "@/components/layout/SharedSidebarLayout";
import type { SidebarProfile } from "@/components/layout/layout.types";

export default function PlatformLayoutClient({
  children,
  logoutAction,
  profile,
  userEmail,
}: {
  children: React.ReactNode;
  logoutAction: () => void;
  profile: SidebarProfile;
  userEmail: string;
}) {
  const navItems: NavItemConfig[] = [
    { href: "/platform/ai-usage", icon: <Activity size={22} />, label: "Consumo de IA" },
    { href: "/admin", icon: <ArrowLeft size={22} />, label: "Volver a Engine" },
  ];

  return (
    <SharedSidebarLayout
      basePath="/platform"
      logoutAction={logoutAction}
      navItems={navItems}
      profile={profile}
      title={<><ShieldCheck className="inline-block mr-1" size={12} /> Plataforma</>}
      userEmail={userEmail}
    >
      {children}
    </SharedSidebarLayout>
  );
}
