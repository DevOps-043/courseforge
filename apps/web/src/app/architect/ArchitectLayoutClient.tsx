'use client';

import React from 'react';
import { LayoutDashboard, ShieldCheck } from 'lucide-react';
import SharedSidebarLayout, { NavItemConfig } from '@/components/layout/SharedSidebarLayout';
import type { SidebarProfile } from '@/components/layout/layout.types';

export default function ArchitectLayoutClient({
    children,
    userEmail,
    logoutAction,
    profile,
    basePath = '/architect'
}: {
    children: React.ReactNode;
    userEmail?: string;
    logoutAction: () => void;
    profile?: SidebarProfile | null;
    basePath?: string;
}) {
    const navItems: NavItemConfig[] = [
        { href: basePath, icon: <LayoutDashboard size={22} />, label: 'Dashboard' },
        { href: `${basePath}/artifacts`, icon: <ShieldCheck size={22} />, label: 'Control de Calidad' },
    ];

    return (
        <SharedSidebarLayout
            userEmail={userEmail}
            logoutAction={logoutAction}
            profile={profile}
            navItems={navItems}
            basePath={basePath}
            title={
                <>
                    Arquitecto
                </>
            }
        >
            {children}
        </SharedSidebarLayout>
    );
}
