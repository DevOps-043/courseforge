'use client';
import { create } from 'zustand';
import { createClient } from '@/utils/supabase/client';

/**
 * AuthStore - Gestión de estado de autenticación
 * 
 * Utiliza el cliente Supabase del navegador para verificar
 * la sesión actual. La sesión fue establecida por el server action
 * loginAction que autentica contra SofLIA (Master).
 * 
 * El user.id aquí corresponde al UUID de SofLIA, ya que el JWT
 * fue generado por el auth de SofLIA y aceptado por CourseForge
 * gracias al JWT_SECRET compartido.
 */

interface User {
  id: string;
  email: string;
  username?: string;
  first_name?: string;
  last_name_father?: string;
  last_name_mother?: string;
  avatar_url?: string;
  platform_role?: string;
}

interface AuthStore {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  /** Inicializar el store verificando la sesión actual */
  initialize: () => Promise<void>;

  /** Cerrar sesión */
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  initialize: async () => {
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        // Intentar obtener el perfil del usuario con datos adicionales
        const { data: profile } = await supabase
          .from('profiles')
          .select('username, first_name, last_name_father, last_name_mother, avatar_url, platform_role')
          .eq('id', user.id)
          .single();

        set({
          user: {
            id: user.id,
            email: user.email || '',
            username: profile?.username,
            first_name: profile?.first_name,
            last_name_father: profile?.last_name_father,
            last_name_mother: profile?.last_name_mother,
            avatar_url: profile?.avatar_url,
            platform_role: profile?.platform_role,
          },
          isAuthenticated: true,
          isLoading: false,
        });
      } else {
        set({ user: null, isAuthenticated: false, isLoading: false });
      }
    } catch (error) {
      console.error('Auth initialization error:', error);
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },

  logout: async () => {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Logout error:', error);
    }
    set({ user: null, isAuthenticated: false });
  },
}));
