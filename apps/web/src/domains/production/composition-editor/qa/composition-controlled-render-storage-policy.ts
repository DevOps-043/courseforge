import type {RenderSupervisorBinding} from "../composition-render-supervisor-receipt";

export const CONTROLLED_RENDER_STORAGE = {bucket: "production-videos", chunkBytes: 6 * 1024 ** 2,
  maximumVideoBytes: 2 * 1024 ** 3, requestTimeoutMilliseconds: 60_000} as const;

export function controlledRenderObjectPath(binding: Pick<RenderSupervisorBinding,
  "organizationId" | "requestId" | "executionId" | "videoSha256">) {
  return `organizations/${binding.organizationId}/controlled-renders/${binding.requestId}/${binding.executionId}/${binding.videoSha256}.mp4`;
}

/** No credentials, query strings, custom paths or cross-project redirect targets. */
export function controlledRenderTusUrl(raw: string, projectUrl: string, session: boolean) {
  try {
    const project = new URL(projectUrl), upload = new URL(raw, project);
    const match = /^([a-z0-9-]+)\.supabase\.co$/i.exec(project.hostname);
    const storageOrigin = match ? `https://${match[1]}.storage.supabase.co` : project.origin;
    const root = "/storage/v1/upload/resumable";
    if (project.protocol !== "https:" || project.username || project.password
      || ![project.origin, storageOrigin].includes(upload.origin) || upload.username || upload.password
      || upload.search || upload.hash || (session ? !new RegExp(`^${root}/[a-zA-Z0-9_-]+$`).test(upload.pathname)
        : upload.pathname !== root)) throw new Error();
    return upload.href;
  } catch {throw new Error("CONTROLLED_RENDER_UPLOAD_URL_INVALID");}
}
