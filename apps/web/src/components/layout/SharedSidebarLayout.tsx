'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { LogOut, Sun, Moon, User, ChevronUp, Monitor } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import OrganizationSwitcher from '@/components/OrganizationSwitcher';
import { useAuth } from '@/features/auth/hooks/useAuth';

export interface NavItemConfig {
    href: string;
    icon: React.ReactNode;
    label: string;
}

interface SharedSidebarLayoutProps {
    children: React.ReactNode;
    userEmail?: string;
    logoutAction: () => void;
    profile?: any;
    navItems: NavItemConfig[];
    basePath: string; // The root path to match exactly, e.g. '/admin', '/architect'
    title: React.ReactNode; // e.g., Admin<span className="text-[#00D4B3]">Panel</span>
}

const NavItem = ({ href, icon, label, isActive, isCollapsed }: any) => {
    return (
        <Link
            href={href}
            className={`relative group flex items-center px-3 py-3 rounded-xl transition-all duration-300 overflow-hidden ${isActive
                ? 'bg-[#0A2540] text-white shadow-lg shadow-[#0A2540]/20'
                : 'text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5'
                }`}
            title={isCollapsed ? label : ''}
        >
            {isActive && (
                <motion.div
                    layoutId="activeTab"
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-[#00D4B3] rounded-r-full"
                />
            )}

            <div className={`flex items-center gap-4 ${isCollapsed ? 'justify-center w-full px-0' : 'pl-2 min-w-[200px]'}`}>
                <div className={`${isActive ? 'text-[#00D4B3]' : ''}`}>
                    {icon}
                </div>

                <motion.span
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: isCollapsed ? 0 : 1, x: isCollapsed ? -10 : 0 }}
                    transition={{ duration: 0.2 }}
                    className={`font-medium text-sm whitespace-nowrap ${isCollapsed ? 'hidden' : 'block'}`}
                >
                    {label}
                </motion.span>
            </div>

            {isCollapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-slate-700 shadow-xl">
                    {label}
                </div>
            )}
        </Link>
    );
};

export default function SharedSidebarLayout({
    children,
    userEmail,
    logoutAction,
    profile,
    navItems,
    basePath,
    title
}: SharedSidebarLayoutProps) {
    const [isPinned, setIsPinned] = useState(true);
    const [isHovered, setIsHovered] = useState(false);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    useAuth(); // Inicializa stores de auth y organización

    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const pathname = usePathname();
    const isOpen = isPinned || isHovered;

    const isActive = (href: string) => {
        if (href === basePath) return pathname === basePath;
        return pathname.startsWith(href);
    };

    if (!mounted) {
        return null;
    }

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-[#0F1419] flex text-slate-800 dark:text-slate-200 overflow-x-hidden selection:bg-[#00D4B3]/30 transition-colors duration-300">
            <motion.aside
                initial={false}
                animate={{ width: isOpen ? 280 : 64 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                onMouseEnter={() => !isPinned && setIsHovered(true)}
                onMouseLeave={() => !isPinned && setIsHovered(false)}
                onClick={(e) => {
                    e.stopPropagation();
                    if (!isPinned) setIsPinned(true);
                }}
                onDoubleClick={() => setIsPinned(false)}
                className={`fixed left-0 top-0 h-full z-40 border-r border-gray-200 dark:border-white/5 backdrop-blur-3xl flex flex-col ${!isPinned ? 'cursor-pointer hover:shadow-[0_0_40px_rgba(0,0,0,0.5)]' : ''} bg-white dark:bg-[#151A21]/80 transition-colors duration-300`}
            >
                <div className="absolute inset-0 bg-gradient-to-b from-white/[0.05] to-transparent pointer-events-none" />

                <div className={`h-20 flex items-center ${isOpen ? 'px-6' : 'justify-center px-0'} overflow-hidden transition-all duration-300 border-b border-gray-100 dark:border-white/5 relative`}>
                    <AnimatePresence mode='wait'>
                        {isOpen ? (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="flex items-center gap-3 w-full"
                            >
                                <div className="w-8 h-8 relative shrink-0">
                                    <Image src="/Logo.png" alt="Logo" fill className="object-contain" />
                                </div>
                                <span className="font-bold text-xl tracking-wide text-gray-900 dark:text-white">
                                    {title}
                                </span>

                                {!isPinned && (
                                    <div className="absolute right-4 text-xs text-[#00D4B3] animate-pulse">
                                        Click to Pin
                                    </div>
                                )}
                            </motion.div>
                        ) : (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="w-full h-full flex items-center justify-center p-4"
                            >
                                <div className="w-8 h-8 relative shrink-0">
                                    <Image src="/Logo.png" alt="Logo" fill className="object-contain" />
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>

                <div className={`py-2 ${isOpen ? 'border-b border-gray-100 dark:border-white/5' : ''}`}>
                    <OrganizationSwitcher collapsed={!isOpen} />
                </div>

                <div className="flex-1 py-6 px-3 flex flex-col gap-2 overflow-y-auto overflow-x-hidden scrollbar-hide">
                    {navItems.map((item) => (
                        <NavItem
                            key={item.href}
                            {...item}
                            isActive={isActive(item.href)}
                            isCollapsed={!isOpen}
                        />
                    ))}
                </div>

                <div className={`border-t border-gray-100 dark:border-white/5 p-4 relative z-50`}>
                    <AnimatePresence>
                        {isUserMenuOpen && (
                            <motion.div
                                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                className="absolute bottom-full left-4 right-4 mb-2 bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl p-1"
                            >
                                <div className="p-2 border-b border-gray-100 dark:border-white/5 mb-1">
                                    <p className="text-xs text-gray-500 dark:text-slate-500 font-semibold uppercase tracking-wider">Mi Cuenta</p>
                                </div>

                                <Link
                                    href={`${basePath}/profile`}
                                    onClick={(e) => { e.stopPropagation(); setIsUserMenuOpen(false); }}
                                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white rounded-lg transition-colors text-left"
                                >
                                    <User size={16} className="text-[#00D4B3]" />
                                    Editar Perfil
                                </Link>

                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (theme === 'system') setTheme('dark');
                                        else if (theme === 'dark') setTheme('light');
                                        else setTheme('system');
                                    }}
                                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-white rounded-lg transition-colors text-left"
                                >
                                    {theme === 'light' ? (
                                        <Sun size={16} className="text-yellow-500" />
                                    ) : theme === 'dark' ? (
                                        <Moon size={16} className="text-blue-500" />
                                    ) : (
                                        <Monitor size={16} className="text-[#00D4B3]" />
                                    )}
                                    {theme === 'light' ? 'Modo Claro' : theme === 'dark' ? 'Modo Oscuro' : 'Sistema'}
                                </button>

                                <div className="h-px bg-gray-100 dark:bg-white/5 my-1" />

                                <form action={logoutAction} className="w-full" onClick={(e) => e.stopPropagation()}>
                                    <button type="submit" className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg transition-colors text-left">
                                        <LogOut size={16} />
                                        Cerrar Sesión
                                    </button>
                                </form>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 }}
                        onClick={(e) => { e.stopPropagation(); setIsUserMenuOpen(!isUserMenuOpen); }}
                        className={`flex items-center gap-3 p-2 rounded-xl transition-all cursor-pointer border border-transparent ${isUserMenuOpen ? 'bg-gray-100 dark:bg-white/10' : 'hover:bg-gray-100 dark:hover:bg-white/10'} ${!isOpen ? 'justify-center' : ''}`}
                    >
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#00D4B3] to-[#009688] flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-[#00D4B3]/20 relative shrink-0">
                            {profile?.avatar_url ? (
                                <div className="w-full h-full overflow-hidden rounded-full">
                                    <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                                </div>
                            ) : (
                                (profile?.first_name?.[0] || userEmail?.[0]?.toUpperCase())
                            )}
                            <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white dark:border-[#151A21] rounded-full z-10"></div>
                        </div>
                        {isOpen && (
                            <>
                                <div className="flex-1 overflow-hidden">
                                    <p className="text-sm text-gray-900 dark:text-white font-medium truncate capitalize">
                                        {profile?.first_name ? `${profile.first_name} ${profile.last_name_father || ''}` : (userEmail?.split('@')[0].split('.')[0] || 'Usuario')}
                                    </p>
                                </div>

                                <ChevronUp
                                    size={16}
                                    className={`text-gray-400 dark:text-slate-500 transition-transform duration-300 ${isUserMenuOpen ? 'rotate-180' : ''}`}
                                />
                            </>
                        )}
                    </motion.div>

                    {isPinned && !isUserMenuOpen && (
                        <p className="text-[9px] text-center text-gray-400 dark:text-slate-600 mt-3 select-none">
                            Double click to unpin sidebar
                        </p>
                    )}
                </div>
            </motion.aside>

            <motion.main
                animate={{ marginLeft: isOpen ? 280 : 0, paddingLeft: isOpen ? 32 : 96 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="flex-1 py-8 pr-8 min-h-screen"
                onClick={() => setIsUserMenuOpen(false)}
            >
                <div className="max-w-7xl mx-auto">
                    {children}
                </div>
            </motion.main>
        </div>
    );
}
