'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { LayoutDashboard, Users, FileCode, Settings, LogOut, Sun, Moon, User, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Separate NavItem component for cleaner code
const NavItem = ({ href, icon, label, isActive, isCollapsed }: any) => {
  return (
    <Link
      href={href}
      className={`relative group flex items-center px-3 py-3 rounded-xl transition-all duration-300 overflow-hidden ${
        isActive
          ? 'bg-gradient-to-r from-[#00D4B3]/20 to-[#00D4B3]/5 text-[#00D4B3] border border-[#ff0000]/0' // Custom active state
          : 'text-slate-400 hover:text-white hover:bg-white/5'
      }`}
      title={isCollapsed ? label : ''}
    >
        {/* Active Indicator Line */}
        {isActive && (
            <motion.div
                layoutId="activeTab"
                className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-[#00D4B3] rounded-r-full shadow-[0_0_10px_#00D4B3]"
            />
        )}

      <div className={`flex items-center gap-4 min-w-[200px] ${isCollapsed ? 'justify-center w-full px-0' : 'pl-2'}`}>
        <div className={`${isActive ? 'text-[#00D4B3] drop-shadow-[0_0_5px_rgba(0,212,179,0.5)]' : ''}`}>
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
      
      {/* Tooltip for collapsed state */}
      {isCollapsed && (
          <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-slate-700 shadow-xl">
              {label}
          </div>
      )}
    </Link>
  );
};

export default function AdminLayoutClient({
  children,
  userEmail,
  logoutAction
}: {
  children: React.ReactNode;
  userEmail?: string;
  logoutAction: () => void;
}) {
  const [isPinned, setIsPinned] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true); // Mock state for now
  const pathname = usePathname();
  
  // Sidebar state logic
  const isOpen = isPinned || isHovered;
  
  // Navigation Items
  const navItems = [
    { href: '/admin', icon: <LayoutDashboard size={22} />, label: 'Dashboard' },
    { href: '/admin/users', icon: <Users size={22} />, label: 'Usuarios' },
    { href: '/admin/artifacts', icon: <FileCode size={22} />, label: 'Artefactos' },
    { href: '/admin/settings', icon: <Settings size={22} />, label: 'Configuración' },
  ];

  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin';
    return pathname.startsWith(href);
  };

  return (
    <div className="min-h-screen bg-[#0F1419] flex text-slate-200 overflow-x-hidden selection:bg-[#00D4B3]/30">
      
      {/* Sidebar Area */}
      <motion.aside
        initial={false}
        animate={{ 
            width: isOpen ? 280 : 20, // 20px strip when collapsed
        }}
        transition={{ 
            type: 'spring', 
            stiffness: 300, 
            damping: 30 
        }}
        onMouseEnter={() => !isPinned && setIsHovered(true)}
        onMouseLeave={() => !isPinned && setIsHovered(false)}
        onClick={(e) => {
            // Prevent sidebar expansion click from triggering when clicking menu items
            e.stopPropagation(); 
            if(!isPinned) setIsPinned(true);
        }}
        onDoubleClick={() => setIsPinned(false)}
        className={`fixed left-0 top-0 h-full z-40 border-r border-white/5 backdrop-blur-3xl flex flex-col
            ${!isPinned ? 'cursor-pointer hover:shadow-[0_0_40px_rgba(0,0,0,0.5)]' : ''}
            ${isOpen ? 'bg-[#151A21]/80' : 'bg-transparent hover:bg-[#151A21]/90'}
        `}
      >
        {/* Glass Background Layer */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />

        {/* Branding & Logo */}
        <div className={`h-20 flex items-center ${isOpen ? 'px-6' : 'justify-center px-0'} overflow-hidden transition-all duration-300 border-b border-white/5 relative`}>
             <AnimatePresence mode='wait'>
                 {isOpen ? (
                     <motion.div 
                        initial={{ opacity: 0 }} 
                        animate={{ opacity: 1 }} 
                        exit={{ opacity: 0 }}
                        className="flex items-center gap-3 w-full"
                     >
                        <div className="w-8 h-8 relative shrink-0">
                           <Image src="/Logo.png" alt="Admin" fill className="object-contain" />
                        </div>
                        <span className="font-bold text-xl tracking-wide bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
                            Admin<span className="text-[#00D4B3]">Panel</span>
                        </span>
                        
                        {/* Pin Indicator/Hint */}
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
                        className="w-full h-full flex items-center justify-center"
                    >
                         {/* Visual cue for collapsed state */}
                         <div className="h-2/3 w-[2px] bg-gradient-to-b from-transparent via-[#00D4B3]/50 to-transparent rounded-full" />
                    </motion.div>
                 )}
            </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="flex-1 py-6 px-3 flex flex-col gap-2 overflow-y-auto overflow-x-hidden scrollbar-hide">
            <AnimatePresence>
                {isOpen ? (
                     navItems.map((item) => (
                        <NavItem
                            key={item.href}
                            {...item}
                            isActive={isActive(item.href)}
                            isCollapsed={false}
                        />
                     ))
                ) : null}
            </AnimatePresence>
        </div>

        {/* User Profile Footer */}
        <div className={`border-t border-white/5 p-4 ${isOpen ? '' : 'hidden'} relative z-50`}>
             {/* User Menu Dropup */}
             <AnimatePresence>
                {isUserMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute bottom-full left-4 right-4 mb-2 bg-[#1A1F26] border border-white/10 rounded-xl shadow-2xl overflow-hidden backdrop-blur-xl p-1"
                    >
                        <div className="p-2 border-b border-white/5 mb-1">
                             <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Mi Cuenta</p>
                        </div>
                        
                        <Link 
                            href="/admin/profile"
                            onClick={(e) => { e.stopPropagation(); setIsUserMenuOpen(false); }}
                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white rounded-lg transition-colors text-left"
                        >
                            <User size={16} className="text-[#00D4B3]" />
                            Editar Perfil
                        </Link>

                        <button 
                            onClick={(e) => { e.stopPropagation(); setIsDarkMode(!isDarkMode); }}
                            className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white rounded-lg transition-colors text-left"
                        >
                            {isDarkMode ? <Sun size={16} className="text-yellow-400" /> : <Moon size={16} className="text-blue-400" />}
                            {isDarkMode ? 'Modo Claro' : 'Modo Oscuro'}
                        </button>

                        <div className="h-px bg-white/5 my-1" />

                        <form action={logoutAction} className="w-full" onClick={(e) => e.stopPropagation()}>
                            <button type="submit" className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition-colors text-left">
                                <LogOut size={16} />
                                Cerrar Sesión
                            </button>
                        </form>
                    </motion.div>
                )}
             </AnimatePresence>

             {/* Profile Card Trigger */}
             <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                onClick={(e) => { e.stopPropagation(); setIsUserMenuOpen(!isUserMenuOpen); }}
                className={`flex items-center gap-3 p-2 rounded-xl transition-all cursor-pointer border border-transparent
                    ${isUserMenuOpen ? 'bg-white/10 border-white/10' : 'bg-white/5 hover:bg-white/10'}
                `}
             >
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#00D4B3] to-[#009688] flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-[#00D4B3]/20 relative">
                    AD
                    <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-[#151A21] rounded-full"></div>
                </div>
                <div className="flex-1 overflow-hidden">
                    <p className="text-sm text-white font-medium truncate capitalize">
                        {userEmail?.split('@')[0].split('.')[0] || 'Usuario'}
                    </p>
                </div>
                
                <ChevronUp 
                    size={16} 
                    className={`text-slate-500 transition-transform duration-300 ${isUserMenuOpen ? 'rotate-180' : ''}`}
                />
             </motion.div>
             
             {/* Gesture Hint */}
             {isPinned && !isUserMenuOpen && (
                 <p className="text-[9px] text-center text-slate-600 mt-3 select-none">
                     Double click to unpin sidebar
                 </p>
             )}
        </div>
      </motion.aside>

      {/* Main Content Wrapper */}
      <motion.main 
        animate={{ 
            marginLeft: isOpen ? 280 : 0, 
            paddingLeft: isOpen ? 32 : 52 // Add padding when collapsed to avoid content hiding behind the 20px strip
        }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="flex-1 py-8 pr-8 min-h-screen"
        onClick={() => setIsUserMenuOpen(false)} // Close menu when clicking outside
      >
        <div className="max-w-7xl mx-auto">
            {children}
        </div>
      </motion.main>
    </div>
  );
}
