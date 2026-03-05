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

  /** Cargar organizaciones desde la cookie cf_user_orgs */
  loadFromCookies: () => void;

  /** Cambiar la organización activa (para el futuro selector de empresas) */
  switchOrganization: (organizationId: string) => void;

  /** Obtener la organización activa completa */
  getActiveOrganization: () => UserOrganization | null;

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

  loadFromCookies: () => {
    try {
      // Leer organizaciones desde la cookie
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

  switchOrganization: (organizationId: string) => {
    const { organizations } = get();
    const exists = organizations.find(o => o.id === organizationId);

    if (!exists) {
      console.error('Organization not found:', organizationId);
      return;
    }

    // Actualizar la cookie del servidor
    setCookie('cf_active_org', organizationId);

    set({ activeOrganizationId: organizationId });
  },

  getActiveOrganization: () => {
    const { organizations, activeOrganizationId } = get();
    return organizations.find(o => o.id === activeOrganizationId) || null;
  },

  clear: () => {
    set({ organizations: [], activeOrganizationId: null, isLoaded: false });
  },
}));
