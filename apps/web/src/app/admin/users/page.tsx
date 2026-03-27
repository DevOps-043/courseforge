
import { createClient } from '@/utils/supabase/server';
import UsersTable from './UsersTable';

export default async function UsersPage() {
  const supabase = await createClient();

  const { data: users } = await supabase
    .from('profiles')
    .select('id, first_name, last_name_father, last_name_mother, username, email, platform_role, status, created_at')
    .order('created_at', { ascending: false });

  // Pass users to the client component
  // Handle potential null users data by passing empty array
  return <UsersTable initialUsers={users || []} />;
}
