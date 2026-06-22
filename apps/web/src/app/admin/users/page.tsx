import UsersTable from './UsersTable';
import { loadUsersPageData } from './users-page-data';

export default async function UsersPage({
  organizationId,
}: {
  organizationId?: string | null;
}) {
  const users = await loadUsersPageData({ organizationId });
  return <UsersTable initialUsers={users} />;
}
