'use client';

import React from 'react';
import { LayoutDashboard, Users, FileCode, Settings, Video } from 'lucide-react';
import SharedSidebarLayout, { NavItemConfig } from '@/components/layout/SharedSidebarLayout';
import type { SidebarProfile } from '@/components/layout/layout.types';

export default function AdminLayoutClient({
    children,
    userEmail,
    logoutAction,
    profile,
    basePath = '/admin'
}: {
    children: React.ReactNode;
    userEmail?: string;
    logoutAction: () => void;
    profile?: SidebarProfile | null;
    basePath?: string;
}) {
    const navItems: NavItemConfig[] = [
        { href: basePath, icon: <LayoutDashboard size={22} />, label: 'Dashboard' },
        { href: `${basePath}/users`, icon: <Users size={22} />, label: 'Usuarios' },
        { href: `${basePath}/artifacts`, icon: <FileCode size={22} />, label: 'Artefactos' },
        { href: `${basePath}/library`, icon: <FileCode size={22} />, label: 'Librería' },
        { href: `${basePath}/templates`, icon: <Video size={22} />, label: 'Plantillas' },
        { href: `${basePath}/settings`, icon: <Settings size={22} />, label: 'Configuración' },
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
                    Admin<span className="text-[#00D4B3]">Panel</span>
                </>
            }
        >
            {children}
        </SharedSidebarLayout>
    );
}
