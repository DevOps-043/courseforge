'use server';

import { createClient } from '@/utils/supabase/server';
import { revalidatePath } from 'next/cache';

export async function updateProfile(formData: {
  firstName: string;
  lastNameFather: string;
  lastNameMother: string;
  username: string;
}) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: 'Usuario no autenticado' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      first_name: formData.firstName,
      last_name_father: formData.lastNameFather,
      last_name_mother: formData.lastNameMother,
      username: formData.username,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id);

  if (error) {
    console.error('Error updating profile:', error);
    return { error: 'Error al actualizar el perfil' };
  }

  revalidatePath('/admin/profile');
  return { success: true };
}

export async function updatePassword(data: {
  currentPassword?: string;
  newPassword: string;
  confirmPassword: string;
}) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  if (userError || !user) {
    return { error: 'Usuario no autenticado' };
  }

  if (data.newPassword !== data.confirmPassword) {
    return { error: 'Las contraseñas no coinciden' };
  }

  if (data.newPassword.length < 6) {
      return { error: 'La contraseña debe tener al menos 6 caracteres' };
  }

  // Optional: Verify current password if provided (Recommended for security)
  // Converting this to a server-side sign-in check is tricky without the email being trustworthy 
  // from the client, but we have the user from getUser().
  // However, signInWithPassword signs in the *client* usually. On server, it gets a session.
  // For simplicity and standard flow, we will trust the active session and just update.
  // If strict "current password" check is needed, we'd need to re-auth.
  
  // Note: Supabase GoTrue client doesn't explicitly require old password to update to a new one if you have a valid session.
  // But standard UI asks for it. We can try to sign in with it to verify.
  if (data.currentPassword) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
          email: user.email!,
          password: data.currentPassword
      });
      
      if (signInError) {
          return { error: 'La contraseña actual es incorrecta' };
      }
  }

  const { error } = await supabase.auth.updateUser({
    password: data.newPassword
  });

  if (error) {
    console.error('Error updating password:', error);
    return { error: error.message };
  }

  revalidatePath('/admin/profile');
  return { success: true };
}
