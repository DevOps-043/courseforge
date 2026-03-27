'use client';

import React from 'react';
import { LayoutDashboard, ShieldCheck } from 'lucide-react';
import SharedSidebarLayout, { NavItemConfig } from '@/components/layout/SharedSidebarLayout';
import type { SidebarProfile } from '@/components/layout/layout.types';

export default function ArchitectLayoutClient({
    children,
    userEmail,
    logoutAction,
    profile
}: {
    children: React.ReactNode;
    userEmail?: string;
    logoutAction: () => void;
    profile?: SidebarProfile | null;
}) {
    const navItems: NavItemConfig[] = [
        { href: '/architect', icon: <LayoutDashboard size={22} />, label: 'Dashboard' },
        { href: '/architect/artifacts', icon: <ShieldCheck size={22} />, label: 'Control de Calidad' },
    ];

    return (
        <SharedSidebarLayout
            userEmail={userEmail}
            logoutAction={logoutAction}
            profile={profile}
            navItems={navItems}
            basePath="/architect"
            title={
                <>
                    Arqui<span className="text-[#00D4B3]">tecto</span>
                </>
            }
        >
            {children}
        </SharedSidebarLayout>
    );
}
