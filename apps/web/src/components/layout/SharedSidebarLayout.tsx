'use client';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Sun,
  User,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import OrganizationSwitcher from '@/components/OrganizationSwitcher';
import { useAuth } from '@/features/auth/hooks/useAuth';
import type { SidebarProfile } from './layout.types';
import styles from './SharedSidebarLayout.module.css';

export interface NavItemConfig {
  href: string;
  icon: React.ReactNode;
  label: string;
}

interface SharedSidebarLayoutProps {
  children: React.ReactNode;
  userEmail?: string;
  logoutAction: () => void;
  profile?: SidebarProfile | null;
  navItems: NavItemConfig[];
  basePath: string;
  title: React.ReactNode;
}

interface SidebarNavItemProps extends NavItemConfig {
  isActive: boolean;
  isCollapsed: boolean;
  onNavigate: () => void;
}

function SidebarNavItem({ href, icon, label, isActive, isCollapsed, onNavigate }: SidebarNavItemProps) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      className={`${styles.navItem} ${isActive ? styles.navItemActive : ''}`}
    >
      <span className={styles.navIcon} aria-hidden="true">{icon}</span>
      {!isCollapsed && <span className={styles.navLabel}>{label}</span>}
      {isCollapsed && <span className={styles.tooltip}>{label}</span>}
    </Link>
  );
}

function ThemeIcon({ theme }: { theme?: string }) {
  if (theme === 'light') return <Sun aria-hidden="true" />;
  if (theme === 'dark') return <Moon aria-hidden="true" />;
  return <Monitor aria-hidden="true" />;
}

export default function SharedSidebarLayout({
  children,
  userEmail,
  logoutAction,
  profile,
  navItems,
  basePath,
  title,
}: SharedSidebarLayoutProps) {
  const [isPinned, setIsPinned] = useState(true);
  const [isHovered, setIsHovered] = useState(false);
  const [isFocusModeRequested, setIsFocusModeRequested] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();
  const pathname = usePathname();

  useAuth();

  useEffect(() => {
    setMounted(true);
    const mediaQuery = window.matchMedia('(max-width: 48rem)');
    const syncViewport = () => setIsMobile(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);

  useEffect(() => {
    const handleFocusModeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ enabled?: boolean }>).detail;
      setIsFocusModeRequested(Boolean(detail?.enabled));
      setIsHovered(false);
    };

    window.addEventListener('courseforge:admin-focus-mode', handleFocusModeChange);
    return () => window.removeEventListener('courseforge:admin-focus-mode', handleFocusModeChange);
  }, []);

  useEffect(() => {
    if (!isMobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileMenuOpen]);

  const isActive = (href: string) =>
    href === basePath ? pathname === basePath : pathname.startsWith(href);

  const isExpanded = isMobile
    ? true
    : isFocusModeRequested
      ? false
      : isPinned || isHovered || isUserMenuOpen;
  const sidebarWidth = isMobile ? 280 : isExpanded ? 264 : 72;

  const cycleTheme = () => {
    if (theme === 'system') setTheme('dark');
    else if (theme === 'dark') setTheme('light');
    else setTheme('system');
  };

  const accountName = profile?.first_name
    ? `${profile.first_name} ${profile.last_name_father || ''}`.trim()
    : userEmail?.split('@')[0].split('.')[0] || 'Usuario';
  const accountInitial = profile?.first_name?.[0] || userEmail?.[0]?.toUpperCase() || 'U';

  if (!mounted) return null;

  return (
    <div className={`soflia-engine-shell ${styles.shell}`}>
      <AnimatePresence>
        {isMobile && isMobileMenuOpen && (
          <motion.button
            type="button"
            aria-label="Cerrar navegación"
            className={styles.mobileBackdrop}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMobileMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      <motion.aside
        initial={false}
        animate={{ width: sidebarWidth, x: isMobile && !isMobileMenuOpen ? -296 : 0 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        onMouseEnter={() => !isPinned && !isMobile && !isFocusModeRequested && setIsHovered(true)}
        onMouseLeave={() => !isPinned && !isMobile && !isFocusModeRequested && setIsHovered(false)}
        className={`${styles.sidebar} ${!isExpanded ? styles.sidebarCollapsed : ''} ${isFocusModeRequested ? styles.sidebarFocus : ''}`}
        aria-label="Navegación principal"
      >
        <div className={styles.brandHeader}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>
              <Image src="/Logo.png" alt="SofLIA" fill sizes="42px" className="object-contain p-1.5" />
            </span>
            {isExpanded && (
              <div>
                <p className={styles.brandName}>SofLIA <span>Engine</span></p>
                <p className={styles.brandRole}>{title}</p>
              </div>
            )}
          </div>

          {isMobile ? (
            <button type="button" aria-label="Cerrar menú" className={styles.mobileClose} onClick={() => setIsMobileMenuOpen(false)}>
              <X size={17} />
            </button>
          ) : !isFocusModeRequested ? (
            <button
              type="button"
              aria-label={isPinned ? 'Contraer menú lateral' : 'Expandir menú lateral'}
              title={isPinned ? 'Contraer menú lateral' : 'Expandir menú lateral'}
              className={styles.collapseButton}
              onClick={() => {
                setIsPinned((current) => !current);
                setIsHovered(false);
              }}
            >
              {isPinned ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>
          ) : null}
        </div>

        <nav className={styles.navigation}>
          {navItems.map((item) => (
            <SidebarNavItem
              key={item.href}
              {...item}
              isActive={isActive(item.href)}
              isCollapsed={!isExpanded}
              onNavigate={() => setIsMobileMenuOpen(false)}
            />
          ))}
        </nav>

        <div className={styles.accountArea}>
          <AnimatePresence>
            {isUserMenuOpen && (
              <motion.div
                id="sidebar-account-menu"
                className={styles.accountMenu}
                role="dialog"
                aria-label="Menú de cuenta"
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <OrganizationSwitcher onSwitch={() => setIsUserMenuOpen(false)} />
                <div className={styles.menuDivider} />
                <p className={styles.menuLabel}>Cuenta</p>
                <Link className={styles.menuItem} href={`${basePath}/profile`} onClick={() => setIsUserMenuOpen(false)}>
                  <User size={16} aria-hidden="true" />
                  Editar perfil
                </Link>
                <button type="button" className={styles.menuItem} onClick={cycleTheme}>
                  <ThemeIcon theme={theme} />
                  {theme === 'light' ? 'Modo claro' : theme === 'dark' ? 'Modo oscuro' : 'Tema del sistema'}
                </button>
                <div className={styles.menuDivider} />
                <form action={logoutAction}>
                  <button type="submit" className={styles.menuItemDanger}>
                    <LogOut size={16} aria-hidden="true" />
                    Cerrar sesión
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            type="button"
            className={`${styles.accountButton} ${isUserMenuOpen ? styles.accountButtonOpen : ''}`}
            aria-expanded={isUserMenuOpen}
            aria-controls="sidebar-account-menu"
            aria-haspopup="dialog"
            onClick={() => setIsUserMenuOpen((current) => !current)}
          >
            <span className={styles.avatar}>
              <span className={styles.avatarMedia}>
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className={styles.avatarImg} />
                ) : (
                  accountInitial
                )}
              </span>
              <span className={styles.presence} aria-label="En línea" />
            </span>
            {isExpanded && (
              <>
                <span className={styles.accountText}>
                  <span className={styles.accountName}>{accountName}</span>
                  <span className={styles.accountMeta}>{userEmail || 'Cuenta SofLIA'}</span>
                </span>
                <ChevronUp size={15} className={isUserMenuOpen ? 'rotate-180' : ''} aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </motion.aside>

      <motion.main
        id="application-content"
        className={`${styles.main} ${isFocusModeRequested ? styles.focusMain : ''}`}
        animate={{
          marginLeft: isMobile ? 0 : sidebarWidth + (isFocusModeRequested ? 0 : 12),
          padding: isFocusModeRequested ? 0 : isMobile ? '16px 12px 24px' : '20px 24px 32px 24px',
        }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        onClick={() => setIsUserMenuOpen(false)}
      >
        {isMobile && !isMobileMenuOpen && (
          <button
            type="button"
            aria-label="Abrir menú"
            className="fixed top-3 left-3 z-40 flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--engine-surface-solid)] border border-[var(--engine-border)] shadow-md text-[var(--engine-text)]"
            onClick={(event) => {
              event.stopPropagation();
              setIsMobileMenuOpen(true);
            }}
          >
            <Menu size={18} />
          </button>
        )}

        <div className={`${styles.content} engine-content ${isFocusModeRequested ? styles.focusContent : ''}`}>
          {children}
        </div>
      </motion.main>
    </div>
  );
}
