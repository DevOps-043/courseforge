'use client';

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Check, Loader2, Building2 } from 'lucide-react';
import { useOrganizationStore, type UserOrganization } from '@/core/stores/organizationStore';

const LS_KEY = 'cf_last_org';

interface OrganizationSwitcherProps {
  collapsed?: boolean;
  onSwitch?: () => void;
}

export default function OrganizationSwitcher({ collapsed = false, onSwitch }: OrganizationSwitcherProps) {
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
  const containerRef = useRef<HTMLDivElement>(null);

  const activeOrg = getActiveOrganization();
  const hasMultiple = canSwitch();

  // Autonomous initialization if not already loaded from layout
  useEffect(() => {
    if (!isLoaded) {
      loadFromCookies();
    }
  }, [isLoaded, loadFromCookies]);

  // Persist last active org to localStorage
  useEffect(() => {
    if (activeOrganizationId) {
      try { localStorage.setItem(LS_KEY, activeOrganizationId); } catch {}
    }
  }, [activeOrganizationId]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  if (!activeOrg) return null;

  const handleSwitch = async (org: UserOrganization) => {
    if (org.id === activeOrganizationId || isSwitching) return;
    setIsOpen(false);
    setSwitchingToName(org.name);
    setShowOverlay(true);

    const success = await switchOrganization(org.id);
    if (success) {
      onSwitch?.();
      window.location.reload();
    } else {
      setShowOverlay(false);
    }
  };

  // Single org — just show label, no dropdown
  if (!hasMultiple) {
    return (
      <div className={`flex items-center gap-2 px-3 py-2 ${collapsed ? 'justify-center' : ''}`}>
        <OrgAvatar org={activeOrg} size="sm" />
        {!collapsed && (
          <span className="text-xs font-medium text-gray-500 dark:text-slate-400 truncate">
            {activeOrg.name}
          </span>
        )}
      </div>
    );
  }

  // Multi-org — dropdown switcher
  return (
    <>
      <div ref={containerRef} className="relative px-3">
        {/* Collapsed: avatar with tooltip */}
        {collapsed ? (
          <div className="relative group flex justify-center">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (!isSwitching) setIsOpen(!isOpen); }}
              disabled={isSwitching}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
            >
              <OrgAvatar org={activeOrg} size="sm" />
            </button>
            <div className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-slate-700 shadow-xl">
              {activeOrg.name}
            </div>
          </div>
        ) : (
          /* Expanded: full button */
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!isSwitching) setIsOpen(!isOpen);
            }}
            disabled={isSwitching}
            className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-200 border border-transparent
              ${isOpen
                ? 'bg-gray-100 dark:bg-white/10 border-gray-200 dark:border-white/10'
                : 'hover:bg-gray-100 dark:hover:bg-white/5'
              }
              ${isSwitching ? 'opacity-60 cursor-wait' : 'cursor-pointer'}
            `}
          >
            <OrgAvatar org={activeOrg} size="sm" />

            <div className="flex-1 text-left overflow-hidden">
              <p className="text-xs font-semibold text-gray-800 dark:text-white truncate">
                {activeOrg.name}
              </p>
              <p className="text-[10px] text-gray-400 dark:text-slate-500 capitalize">
                {activeOrg.role}
              </p>
            </div>

            {isSwitching ? (
              <Loader2 size={14} className="text-[#00D4B3] animate-spin shrink-0" />
            ) : (
              <ChevronDown
                size={14}
                className={`text-gray-400 dark:text-slate-500 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`}
              />
            )}
          </button>
        )}

        <AnimatePresence>
          {isOpen && !collapsed && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute left-3 right-3 top-full mt-1 bg-white dark:bg-[#1A1F26] border border-gray-200 dark:border-white/10 rounded-xl shadow-xl overflow-hidden z-50"
            >
              <div className="p-2 border-b border-gray-100 dark:border-white/5">
                <p className="text-[10px] text-gray-400 dark:text-slate-500 font-semibold uppercase tracking-wider px-1">
                  Cambiar empresa
                </p>
              </div>

              <div className="p-1 max-h-[200px] overflow-y-auto">
                {organizations.map((org) => {
                  const isActive = org.id === activeOrganizationId;
                  return (
                    <button
                      key={org.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSwitch(org);
                      }}
                      disabled={isActive}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors
                        ${isActive
                          ? 'bg-[#00D4B3]/10 dark:bg-[#00D4B3]/10'
                          : 'hover:bg-gray-50 dark:hover:bg-white/5 cursor-pointer'
                        }
                      `}
                    >
                      <OrgAvatar org={org} size="sm" />

                      <div className="flex-1 overflow-hidden">
                        <p className={`text-xs font-medium truncate ${isActive ? 'text-[#00D4B3]' : 'text-gray-700 dark:text-slate-300'}`}>
                          {org.name}
                        </p>
                        <p className="text-[10px] text-gray-400 dark:text-slate-500 capitalize">
                          {org.role}
                        </p>
                      </div>

                      {isActive && (
                        <Check size={14} className="text-[#00D4B3] shrink-0" />
                      )}
                    </button>
                  );
                })}
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
          className="fixed inset-0 z-[9999] bg-white/80 dark:bg-[#0F1419]/90 backdrop-blur-sm flex flex-col items-center justify-center gap-4"
        >
          <Loader2 size={32} className="text-[#00D4B3] animate-spin" />
          <p className="text-sm font-medium text-gray-600 dark:text-slate-300">
            Cambiando a <span className="text-[#00D4B3] font-semibold">{switchingToName}</span>...
          </p>
        </motion.div>,
        document.body
      )}
    </>
  );
}

function OrgAvatar({ org, size = 'sm' }: { org: UserOrganization; size?: 'sm' | 'md' | 'lg' }) {
  const px = size === 'sm' ? 'w-8 h-8 text-[12px]' : size === 'md' ? 'w-10 h-10 text-xs' : 'w-12 h-12 text-sm';

  if (org.logo_url) {
    return (
      <div className={`${px} rounded-xl overflow-hidden shrink-0 ring-1 ring-gray-200/50 dark:ring-white/10 shadow-sm transition-transform duration-300 group-hover:scale-105`}>
        <img src={org.logo_url} alt={org.name} className="w-full h-full object-cover" />
      </div>
    );
  }

  return (
    <div className={`${px} rounded-xl bg-linear-to-br from-[#0A2540] to-[#1a3a5c] flex items-center justify-center text-[#00D4B3] shadow-lg shadow-[#00D4B3]/5 shrink-0 ring-1 ring-white/10 transition-all duration-300 group-hover:scale-105 group-hover:shadow-[#00D4B3]/20`}>
      <Building2 size={size === 'sm' ? 14 : size === 'md' ? 18 : 22} />
    </div>
  );
}
