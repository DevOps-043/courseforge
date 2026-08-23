'use client';

import React from 'react';
import { Cable, Clapperboard, Gauge, LibraryBig, Presentation, Settings2, Shapes, UserRoundCheck, UsersRound } from 'lucide-react';
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
        { href: basePath, icon: <Gauge size={22} />, label: 'Dashboard' },
        { href: `${basePath}/users`, icon: <UsersRound size={22} />, label: 'Usuarios' },
        { href: `${basePath}/artifacts`, icon: <Shapes size={22} />, label: 'Artefactos' },
        { href: `${basePath}/heygen`, icon: <UserRoundCheck size={22} />, label: 'Avatares' },
        { href: `${basePath}/library`, icon: <LibraryBig size={22} />, label: 'Biblioteca' },
        { href: `${basePath}/slides`, icon: <Presentation size={22} />, label: 'Slides' },
        { href: `${basePath}/assembly`, icon: <Clapperboard size={22} />, label: 'Ensamble' },
        { href: `${basePath}/integrations`, icon: <Cable size={22} />, label: 'Integraciones' },
        { href: `${basePath}/settings`, icon: <Settings2 size={22} />, label: 'Configuración' },
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
                    Admin
                </>
            }
        >
            {children}
        </SharedSidebarLayout>
    );
}
