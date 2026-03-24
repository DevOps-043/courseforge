'use client';
import { create } from 'zustand';

/**
 * Organization Context Store
 * 
 * Gestiona el contexto de la organización activa del usuario.
 * Las organizaciones se cargan desde la cookie `cf_user_orgs` 
 * que se establece al iniciar sesión (proveniente de SofLIA).
 * 
 * La organización activa se almacena en la cookie `cf_active_org`
 * y se usa para filtrar todo el contenido en CourseForge.
 * 
 * PREPARADO PARA FUTURO: Cuando se agregue un dropdown de "Cambiar empresa",
 * simplemente llamar a `switchOrganization(newOrgId)`.
 */

export interface UserOrganization {
  id: string;
  name: string;
  slug: string;
  role: string;
  logo_url?: string;
}

interface OrganizationStore {
  organizations: UserOrganization[];
  activeOrganizationId: string | null;
  isLoaded: boolean;
  isSwitching: boolean;

  /** Cargar organizaciones desde la cookie cf_user_orgs */
  loadFromCookies: () => void;

  /** Cambiar la organización activa — regenera JWT en el servidor */
  switchOrganization: (organizationId: string) => Promise<boolean>;

  /** Obtener la organización activa completa */
  getActiveOrganization: () => UserOrganization | null;

  /** Retorna true si el usuario tiene más de una organización */
  canSwitch: () => boolean;

  /** Limpiar el store (logout) */
  clear: () => void;
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

function setCookie(name: string, value: string, days: number = 365) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
}

export const useOrganizationStore = create<OrganizationStore>((set, get) => ({
  organizations: [],
  activeOrganizationId: null,
  isLoaded: false,
  isSwitching: false,

  loadFromCookies: () => {
    try {
      const orgsRaw = getCookie('cf_user_orgs');
      const activeOrgId = getCookie('cf_active_org');

      let organizations: UserOrganization[] = [];
      if (orgsRaw) {
        organizations = JSON.parse(orgsRaw);
      }

      set({
        organizations,
        activeOrganizationId: activeOrgId || (organizations[0]?.id ?? null),
        isLoaded: true,
      });
    } catch (error) {
      console.error('Error loading organizations from cookies:', error);
      set({ organizations: [], activeOrganizationId: null, isLoaded: true });
    }
  },

  switchOrganization: async (organizationId: string) => {
    const { organizations, activeOrganizationId } = get();

    if (organizationId === activeOrganizationId) return true;

    const exists = organizations.find(o => o.id === organizationId);
    if (!exists) {
      console.error('Organization not found:', organizationId);
      return false;
    }

    set({ isSwitching: true });

    try {
      const res = await fetch('/api/auth/switch-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error('Switch org failed:', data.error || res.statusText);
        set({ isSwitching: false });
        return false;
      }

      // Actualizar cookie cliente (cf_active_org es httpOnly, pero
      // actualizamos el store que es lo que usan los componentes)
      set({ activeOrganizationId: organizationId, isSwitching: false });
      return true;
    } catch (error) {
      console.error('Error switching organization:', error);
      set({ isSwitching: false });
      return false;
    }
  },

  getActiveOrganization: () => {
    const { organizations, activeOrganizationId } = get();
    return organizations.find(o => o.id === activeOrganizationId) || null;
  },

  canSwitch: () => {
    return get().organizations.length > 1;
  },

  clear: () => {
    set({ organizations: [], activeOrganizationId: null, isLoaded: false, isSwitching: false });
  },
}));
