'use client';

import React from 'react';
import { LayoutDashboard, FileArchive } from 'lucide-react';
import SharedSidebarLayout, { NavItemConfig } from '@/components/layout/SharedSidebarLayout';
import type { SidebarProfile } from '@/components/layout/layout.types';

export default function BuilderLayoutClient({
    children,
    userEmail,
    logoutAction,
    profile,
    basePath = '/builder'
}: {
    children: React.ReactNode;
    userEmail?: string;
    logoutAction: () => void;
    profile?: SidebarProfile | null;
    basePath?: string;
}) {
    const navItems: NavItemConfig[] = [
        { href: basePath, icon: <LayoutDashboard size={22} />, label: 'Mi Espacio' },
        { href: `${basePath}/artifacts`, icon: <FileArchive size={22} />, label: 'Mis Asignaciones' },
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
                    Buil<span className="text-[#00D4B3]">der</span>
                </>
            }
        >
            {children}
        </SharedSidebarLayout>
    );
}
