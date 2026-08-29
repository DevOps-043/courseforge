interface SlideAssetsLike {
  slides?: {
    html_content_path?: string | null;
    html_public_url?: string | null;
  } | null;
  slides_url?: string | null;
}

/**
 * HTML stored by Supabase is intentionally served through our authenticated
 * proxy. Public Storage URLs may respond as attachments and are therefore not
 * suitable as an iframe or browser preview source.
 */
export function resolveSlideHtmlPreviewUrl(assets: SlideAssetsLike | null | undefined) {
  const storagePath = assets?.slides?.html_content_path?.trim();
  if (storagePath) {
    return `/api/production/slides/html-preview?${new URLSearchParams({ path: storagePath })}`;
  }

  const publicUrl = assets?.slides?.html_public_url?.trim() || assets?.slides_url?.trim();
  return publicUrl || null;
}
