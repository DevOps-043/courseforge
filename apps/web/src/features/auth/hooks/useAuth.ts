'use client';
import { useAuthStore } from '@/core/stores/authStore';
import { useOrganizationStore } from '@/core/stores/organizationStore';
import { useEffect } from 'react';

/**
 * Hook unificado de autenticación y contexto de organización.
 * 
 * Inicializa tanto el store de auth como el de organización
 * al montarse el componente. Provee acceso a:
 * - user: Datos del usuario autenticado (UUID de SofLIA)
 * - organizations: Lista de empresas del usuario
 * - activeOrganization: Empresa activa actual
 * - switchOrganization: Función para cambiar de empresa
 */
export const useAuth = () => {
  const {
    user,
    isAuthenticated,
    isLoading: authLoading,
    initialize: initAuth,
    logout,
  } = useAuthStore();

  const {
    organizations,
    activeOrganizationId,
    isLoaded: orgsLoaded,
    loadFromCookies,
    switchOrganization,
    getActiveOrganization,
  } = useOrganizationStore();

  useEffect(() => {
    initAuth();
    loadFromCookies();
  }, [initAuth, loadFromCookies]);

  return {
    user,
    isAuthenticated,
    isLoading: authLoading || !orgsLoaded,
    logout,

    // Contexto de organización
    organizations,
    activeOrganizationId,
    activeOrganization: getActiveOrganization(),
    switchOrganization,
  };
};
