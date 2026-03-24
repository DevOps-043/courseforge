'use client';

import React from 'react';
import { LayoutDashboard, FileArchive } from 'lucide-react';
import SharedSidebarLayout, { NavItemConfig } from '@/components/layout/SharedSidebarLayout';

export default function BuilderLayoutClient({
    children,
    userEmail,
    logoutAction,
    profile
}: {
    children: React.ReactNode;
    userEmail?: string;
    logoutAction: () => void;
    profile?: any;
}) {
    const navItems: NavItemConfig[] = [
        { href: '/builder', icon: <LayoutDashboard size={22} />, label: 'Mi Espacio' },
        { href: '/builder/artifacts', icon: <FileArchive size={22} />, label: 'Mis Asignaciones' },
    ];

    return (
        <SharedSidebarLayout
            userEmail={userEmail}
            logoutAction={logoutAction}
            profile={profile}
            navItems={navItems}
            basePath="/builder"
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
