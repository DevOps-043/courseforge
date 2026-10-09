/** Versioned semantics of the derived fragment, separate from immutable source
 * and editorial revisions. Changes to admission/output require a new profile.
 * Frozen snapshots additionally pin output bytes, detecting accidental drift
 * even if a future implementation forgets to update these version labels. */
export const HTML_EDITING_COMPILATION_PROFILE = Object.freeze({
  compilerVersion: "courseforge-html-static-fragment-v2",
  geometryVersion: "courseforge-html-static-geometry-v8",
  isolationVersion: "courseforge-html-isolation-v1",
});
