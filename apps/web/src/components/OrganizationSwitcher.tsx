'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ChevronDown, Loader2, Building2 } from 'lucide-react';
import { useOrganizationStore, type UserOrganization } from '@/core/stores/organizationStore';

const LS_KEY = 'cf_last_org';

interface OrganizationSwitcherProps {
  onSwitch?: () => void;
}

export default function OrganizationSwitcher({ onSwitch }: OrganizationSwitcherProps) {
  const {
    organizations,
    activeOrganizationId,
    isSwitching,
    switchOrganization,
    getActiveOrganization,
    canSwitch,
    isLoaded,
    loadFromCookies,
  } = useOrganizationStore();

  const [isOpen, setIsOpen] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [switchingToName, setSwitchingToName] = useState('');
  const pathname = usePathname();
  const router = useRouter();

  const pathSegments = pathname.split('/').filter(Boolean);
  const routeOrg = pathSegments.length >= 2 && ['admin', 'architect', 'builder'].includes(pathSegments[1])
    ? organizations.find((org) => org.slug === pathSegments[0])
    : null;
  const activeOrg = routeOrg || getActiveOrganization();
  const effectiveActiveOrganizationId = activeOrg?.id ?? activeOrganizationId;
  const hasMultiple = canSwitch() && organizations.length > 1;

  // Autonomous initialization if not already loaded from layout
  useEffect(() => {
    if (!isLoaded) {
      loadFromCookies();
    }
  }, [isLoaded, loadFromCookies]);

  // Persist last active org to localStorage
  useEffect(() => {
    if (effectiveActiveOrganizationId) {
      try { localStorage.setItem(LS_KEY, effectiveActiveOrganizationId); } catch {}
    }
  }, [effectiveActiveOrganizationId]);

  if (!activeOrg && organizations.length === 0) return null;

  const currentOrg = activeOrg || organizations[0];

  const handleSwitch = async (org: UserOrganization) => {
    if (org.id === effectiveActiveOrganizationId || isSwitching) return;
    setIsOpen(false);
    setSwitchingToName(org.name);
    setShowOverlay(true);

    const success = await switchOrganization(org.id);
    if (success) {
      onSwitch?.();
      const segments = pathname.split('/').filter(Boolean);
      const isTenantRoute =
        segments.length >= 2 &&
        organizations.some((candidate) => candidate.slug === segments[0]) &&
        ['admin', 'architect', 'builder'].includes(segments[1]);

      if (isTenantRoute) {
        segments[0] = org.slug;
        router.push(`/${segments.join('/')}`);
        router.refresh();
        return;
      }

      window.location.reload();
    } else {
      setShowOverlay(false);
    }
  };

  return (
    <>
      <div className="flex flex-col gap-1 px-1 pt-1">
        <div className="flex items-center justify-between px-1.5 pt-0.5 pb-0.5">
          <p className="m-0 text-[0.55rem] font-semibold tracking-wider text-[var(--engine-text-muted)] uppercase font-[var(--font-system-label)]">
            Empresa
          </p>
        </div>

        {/* Trigger button showing current active organization */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (hasMultiple && !isSwitching) {
              setIsOpen((prev) => !prev);
            }
          }}
          disabled={!hasMultiple || isSwitching}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-left transition-all duration-180 border
            ${isOpen
              ? 'bg-[var(--engine-accent)]/10 border-[var(--engine-accent)]/25 text-[var(--engine-text)]'
              : 'border-transparent text-[var(--engine-text)] hover:bg-[var(--engine-accent)]/6'
            }
            ${hasMultiple ? 'cursor-pointer' : 'cursor-default'}
            ${isSwitching ? 'opacity-60 cursor-wait' : ''}
          `}
          aria-expanded={isOpen}
          aria-label={hasMultiple ? 'Expandir selector de empresas' : 'Empresa actual'}
        >
          <OrgAvatar org={currentOrg} size="sm" />

          <div className="flex-1 min-w-0 overflow-hidden">
            <p className="text-[0.74rem] font-semibold text-[var(--engine-text)] truncate leading-tight">
              {currentOrg.name}
            </p>
            <p className="text-[0.58rem] text-[var(--engine-text-muted)] capitalize leading-tight mt-0.5">
              {currentOrg.role}
            </p>
          </div>

          {hasMultiple && (
            <ChevronDown
              size={14}
              className={`text-[var(--engine-text-muted)] shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-[var(--engine-accent)]' : ''}`}
            />
          )}
        </button>

        {/* Collapsible dropdown list */}
        <AnimatePresence initial={false}>
          {isOpen && hasMultiple && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="mt-1 flex flex-col gap-1 p-1 rounded-xl bg-black/4 dark:bg-white/4 border border-black/5 dark:border-white/5">
                <p className="px-2 pt-1 pb-0.5 text-[0.5rem] font-semibold tracking-wider text-[var(--engine-text-muted)] uppercase font-[var(--font-system-label)]">
                  Cambiar empresa
                </p>

                <div className="flex flex-col gap-0.5 max-h-[150px] overflow-y-auto pr-0.5 scrollbar-thin">
                  {organizations.map((org) => {
                    const isActive = org.id === effectiveActiveOrganizationId;
                    return (
                      <button
                        key={org.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSwitch(org);
                        }}
                        disabled={isActive || isSwitching}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors
                          ${isActive
                            ? 'bg-[var(--engine-accent)]/12 text-[var(--engine-accent)] cursor-default font-medium'
                            : 'text-[var(--engine-text-muted)] hover:text-[var(--engine-text)] hover:bg-[var(--engine-accent)]/6 cursor-pointer'
                          }
                          ${isSwitching && !isActive ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                      >
                        <OrgAvatar org={org} size="sm" />

                        <div className="flex-1 min-w-0 overflow-hidden">
                          <p className={`text-[0.7rem] truncate leading-tight ${isActive ? 'font-semibold text-[var(--engine-accent)]' : 'text-[var(--engine-text)]'}`}>
                            {org.name}
                          </p>
                          <p className="text-[0.55rem] text-[var(--engine-text-muted)] capitalize leading-tight mt-0.5">
                            {org.role}
                          </p>
                        </div>

                        {isActive && (
                          <Check size={13} className="text-[var(--engine-accent)] shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Fullscreen transition overlay */}
      {showOverlay && typeof document !== 'undefined' && createPortal(
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-[9999] bg-white/80 dark:bg-[var(--engine-canvas)]/90 backdrop-blur-sm flex flex-col items-center justify-center gap-4"
        >
          <Loader2 size={32} className="text-[var(--engine-accent)] animate-spin" />
          <p className="text-sm font-medium text-gray-600 dark:text-slate-300">
            Cambiando a <span className="text-[var(--engine-accent)] font-semibold">{switchingToName}</span>...
          </p>
        </motion.div>,
        document.body
      )}
    </>
  );
}

function OrgAvatar({ org, size = 'sm' }: { org: UserOrganization; size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'sm' ? 'w-6 h-6 text-[10px]' : size === 'md' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';

  if (org.logo_url) {
    return (
      <div className={`${px} rounded-md overflow-hidden shrink-0 ring-1 ring-gray-200/50 dark:ring-white/10 shadow-xs`}>
        <img src={org.logo_url} alt={org.name} className="w-full h-full object-cover" />
      </div>
    );
  }

  return (
    <div className={`${px} rounded-md bg-linear-to-br from-[var(--engine-primary)] to-[#1a3a5c] flex items-center justify-center text-[var(--engine-accent)] shadow-xs shrink-0 ring-1 ring-white/10`}>
      <Building2 size={size === 'sm' ? 12 : size === 'md' ? 15 : 18} />
    </div>
  );
}
