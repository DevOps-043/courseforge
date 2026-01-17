
import { createClient } from '@/utils/supabase/server';
import UsersTable from './UsersTable';

export default async function UsersPage() {
  const supabase = await createClient();

  const { data: users, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });

  // Pass users to the client component
  // Handle potential null users data by passing empty array
  return <UsersTable initialUsers={users || []} />;
}
