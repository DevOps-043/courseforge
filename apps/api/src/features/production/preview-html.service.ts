function escapeInlineScriptValue(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function rewritePreviewHtmlAssetPaths(
  html: string,
  buildId: string,
  compositionId?: string | null,
): string {
  const previewBasePath = `/api/v1/production/remotion/external-preview-bundles/${encodeURIComponent(buildId)}/`;
  const rewrittenHtml = html.replace(
    /\b(src|href)=(["'])\/(?!\/)([^"']*)\2/g,
    (_match, attribute: string, quote: string, assetPath: string) =>
      `${attribute}=${quote}${previewBasePath}${assetPath}${quote}`,
  );

  if (!compositionId) {
    return rewrittenHtml;
  }

  const studioPathScript = [
    '<script>',
    '(function(){',
    `var compositionPath="/"+${escapeInlineScriptValue(encodeURIComponent(compositionId))};`,
    'if(window.location.pathname!==compositionPath){',
    'window.history.replaceState(null,"",compositionPath+window.location.search+window.location.hash);',
    '}',
    '})();',
    '</script>',
  ].join('');

  return rewrittenHtml.replace('</head>', `${studioPathScript}</head>`);
}
