import { notFound } from "next/navigation";
import { z } from "zod";
import { getAuthenticatedUser, getServiceRoleClient, canReviewContent } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import { createClient } from "@/utils/supabase/server";
import { htmlReconstructionOpeningEnabled } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-opening.contract";
import { readAuthorizedHtmlReconstructionOpening } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-opening.server";
import { CompositionHtmlReconstructionEditor } from "@/domains/materials/components/composition-editor/CompositionHtmlReconstructionEditor";
import { readAuthorizedHtmlReconstructionLibrary } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-library.server";
import { htmlReconstructionResourceLinkEnabled } from "@/domains/production/composition-editor/composition-html-editing-reconstruction-resource-link.contract";

export const dynamic = "force-dynamic";

/** Explicit opening of the NEW draft, never the component initialization route.
 * No authority inherited from a creation receipt or URL-supplied tenant/actor. */
export default async function ReconstructionEditorPage({params, searchParams}: {
  params: Promise<{draftId: string}>; searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!htmlReconstructionOpeningEnabled(process.env)) notFound();
  const user = await getAuthenticatedUser(await createClient());
  const tenant = user ? await resolveActiveTenantContext() : null;
  if (!user || !tenant || !await canReviewContent(user.userId, tenant)) notFound();
  const route = z.object({draftId: z.string().uuid()}).strict().safeParse(await params);
  const query = z.object({compositionId: z.string().uuid()}).strict().safeParse(await searchParams);
  if (!route.success || !query.success) notFound();
  const opening = await readAuthorizedHtmlReconstructionOpening({supabase: getServiceRoleClient(),
    request: {...route.data, ...query.data, actorId: user.userId, organizationId: tenant.organizationId}}).catch(() => null);
  if (!opening) notFound();
  const library = await readAuthorizedHtmlReconstructionLibrary({supabase: getServiceRoleClient(),
    request: {actorId: user.userId, organizationId: tenant.organizationId, draftId: route.data.draftId,
      query: {compositionId: query.data.compositionId}}}).catch(() => null);
  return <main className="p-4"><h1 className="mb-4 text-xl font-semibold">Reconstrucción HTML independiente</h1>
    <CompositionHtmlReconstructionEditor key={`${user.userId}:${opening.organizationId}:${opening.draftId}`} opening={opening}
      initialLibrary={library} actorId={user.userId} resourceLinkEnabled={htmlReconstructionResourceLinkEnabled(process.env)} /></main>;
}
