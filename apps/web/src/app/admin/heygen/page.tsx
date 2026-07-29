import { redirect } from "next/navigation";
import { resolveDefaultTenantPath } from "@/lib/server/tenant-context";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LegacyHeygenPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((entry) => query.append(key, entry));
    } else if (value) {
      query.set(key, value);
    }
  }

  const queryString = query.toString();
  const targetPath = `/admin/heygen${queryString ? `?${queryString}` : ""}`;
  const fallbackPath = await resolveDefaultTenantPath(targetPath);

  redirect(fallbackPath || targetPath);
}
