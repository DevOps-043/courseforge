'use client';

import React from 'react';
import { LayoutDashboard, Users, FileCode, Settings } from 'lucide-react';
import SharedSidebarLayout, { NavItemConfig } from '@/components/layout/SharedSidebarLayout';
import type { SidebarProfile } from '@/components/layout/layout.types';

export default function AdminLayoutClient({
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
        { href: '/admin', icon: <LayoutDashboard size={22} />, label: 'Dashboard' },
        { href: '/admin/users', icon: <Users size={22} />, label: 'Usuarios' },
        { href: '/admin/artifacts', icon: <FileCode size={22} />, label: 'Artefactos' },
        { href: '/admin/library', icon: <FileCode size={22} />, label: 'Librería' },
        { href: '/admin/settings', icon: <Settings size={22} />, label: 'Configuración' },
    ];

    return (
        <SharedSidebarLayout
            userEmail={userEmail}
            logoutAction={logoutAction}
            profile={profile}
            navItems={navItems}
            basePath="/admin"
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
