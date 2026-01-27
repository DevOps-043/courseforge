'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { LogOut, Sun, Moon, User, ChevronUp, Monitor, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';

interface UserMenuProps {
    userEmail?: string;
    profile?: any;
    logoutAction: () => void;
    align?: 'bottom' | 'top'; // Dirección de apertura del menú
}

export default function UserMenu({ userEmail, profile, logoutAction, align = 'bottom' }: UserMenuProps) {
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const { theme, setTheme } = useTheme();

    return (
        <div className="relative z-50">
            {/* User Menu Dropdown/Dropup */}
            <AnimatePresence>
                {isUserMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: align === 'bottom' ? 10 : -10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: align === 'bottom' ? 10 : -10, scale: 0.95 }}
                        className={`absolute ${align === 'bottom' ? 'bottom-full mb-2' : 'top-full mt-2'} right-0 w-64 bg-white dark:bg-[#1E2329] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl p-1`}
                    >
                        <div className="p-2 border-b border-gray-100 dark:border-white/5 mb-1">
                            <p className="text-xs text-gray-500 dark:text-slate-500 font-semibold uppercase tracking-wider">Mi Cuenta</p>
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate mt-1">
                                {profile?.first_name ? `${profile.first_name} ${profile.last_name_father || ''}` : userEmail}
                            </p>
                        </div>

                        <Link
                            href="/profile"
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

            {/* Profile Trigger Button */}
            <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={(e) => { e.stopPropagation(); setIsUserMenuOpen(!isUserMenuOpen); }}
                className={`flex items-center gap-3 p-1.5 pr-3 rounded-full transition-all cursor-pointer border border-transparent
                ${isUserMenuOpen ? 'bg-gray-100 dark:bg-white/10' : 'hover:bg-gray-100 dark:hover:bg-white/5'}
            `}
            >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#00D4B3] to-[#009688] flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-[#00D4B3]/20 relative">
                    {profile?.avatar_url ? (
                        <div className="w-full h-full overflow-hidden rounded-full">
                            <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                        </div>
                    ) : (
                        (profile?.first_name?.[0] || userEmail?.[0]?.toUpperCase())
                    )}
                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white dark:border-[#151A21] rounded-full z-10"></div>
                </div>

                <ChevronDown
                    size={16}
                    className={`text-gray-400 dark:text-slate-500 transition-transform duration-300 ${isUserMenuOpen ? 'rotate-180' : ''}`}
                />
            </motion.button>
        </div>
    );
}
