/** Versioned semantics of the derived fragment, separate from immutable source
 * and editorial revisions. Changes to admission/output require a new profile.
 * Frozen snapshots additionally pin output bytes, detecting accidental drift
 * even if a future implementation forgets to update these version labels. */
export const HTML_EDITING_COMPILATION_PROFILE = Object.freeze({
  compilerVersion: "courseforge-html-static-fragment-v3-contextual-css",
  geometryVersion: "courseforge-html-static-geometry-v11-computed-paint",
  isolationVersion: "courseforge-html-isolation-v2-contained-box",
});
