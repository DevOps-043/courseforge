import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { PLAYBACK_CAPTURE_POLICY, PLAYBACK_CAPTURE_WORKLET } from "./composition-playback-capture-runtime";

export function isAllowedConformanceCaptureUrl(rawUrl: string, origin: string, paths: Set<string>): boolean {
  try {
    const url = new URL(rawUrl);
    return url.origin === origin && !url.username && !url.password && !url.search && !url.hash
      && paths.has(url.pathname.slice(1));
  } catch { return false; }
}

export function readCaptureByteRange(header: string | undefined, size: number) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  const start = Number(match?.[1]); const requestedEnd = match?.[2] ? Number(match[2]) : size - 1;
  if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    throw new Error("CONFORMANCE_CAPTURE_RANGE_INVALID");
  }
  return { start, end: Math.min(requestedEnd, size - 1), partial: true };
}

/** Serves only generated HTML and pinned media/fonts. Never a general directory server. */
export async function startConformanceCaptureServer(directory: string, files: Map<string, string>, options: { playbackAudio?: boolean } = {}) {
  for (const path of files.keys()) {
    if (!/^(conformance-preview\.html|conformance-media\/[a-f0-9-]{36}|assets\/fonts\/[a-f0-9]{64}\.(woff2?|ttf|otf))$/i.test(path)) {
      throw new Error("CONFORMANCE_CAPTURE_SERVER_PATH_INVALID");
    }
    if (!(await lstat(join(directory, path))).isFile()) throw new Error("CONFORMANCE_CAPTURE_SERVER_FILE_INVALID");
  }
  let origin = "";
  const paths = new Set([...files.keys(), "favicon.ico"]);
  if (options.playbackAudio) paths.add(PLAYBACK_CAPTURE_POLICY.workletPath);
  const server = createServer((request, response) => {
    void (async () => {
      if (!origin || request.headers.host !== new URL(origin).host || !["GET", "HEAD"].includes(request.method ?? "")
        || !isAllowedConformanceCaptureUrl(`${origin}${request.url}`, origin, paths)) {
        response.writeHead(403).end(); return;
      }
      const path = new URL(`${origin}${request.url}`).pathname.slice(1); const filePath = join(directory, path);
      if (path === "favicon.ico") { response.writeHead(204, { "Cache-Control": "no-store" }).end(); return; }
      if (options.playbackAudio && path === PLAYBACK_CAPTURE_POLICY.workletPath) {
        response.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff", "Content-Length": Buffer.byteLength(PLAYBACK_CAPTURE_WORKLET) });
        response.end(request.method === "HEAD" ? undefined : PLAYBACK_CAPTURE_WORKLET); return;
      }
      const file = await lstat(filePath);
      if (!file.isFile() || file.size <= 0) { response.writeHead(404).end(); return; }
      let range: ReturnType<typeof readCaptureByteRange>;
      try { range = readCaptureByteRange(request.headers.range, file.size); }
      catch { response.writeHead(416, { "Content-Range": `bytes */${file.size}` }).end(); return; }
      const workletUrl = `${origin}/${PLAYBACK_CAPTURE_POLICY.workletPath}`;
      // Only this disposable loopback origin grants same-origin for Web Audio. Normal captures remain opaque.
      // No CSP bypass, arbitrary modules, same-origin app cookies, credentials or outbound network are enabled.
      const policy = `default-src 'none'; script-src 'unsafe-inline'${options.playbackAudio ? ` ${workletUrl}` : ""}; style-src 'unsafe-inline'; img-src ${origin} data: blob:; media-src ${origin}; font-src ${origin}; connect-src ${options.playbackAudio ? workletUrl : "'none'"}; frame-src 'none'; worker-src ${options.playbackAudio ? workletUrl : "'none'"}; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts${options.playbackAudio ? " allow-same-origin" : ""}`;
      response.writeHead(range.partial ? 206 : 200, {
        "Content-Type": files.get(path)!, "Content-Length": range.end - range.start + 1,
        "Accept-Ranges": "bytes", ...(range.partial ? { "Content-Range": `bytes ${range.start}-${range.end}/${file.size}` } : {}),
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": policy,
        "Access-Control-Allow-Origin": options.playbackAudio ? origin : "null",
      });
      if (request.method === "HEAD") { response.end(); return; }
      const stream = createReadStream(filePath, { start: range.start, end: range.end });
      stream.on("error", () => response.destroy()); response.on("close", () => stream.destroy()); stream.pipe(response);
    })().catch(() => { if (!response.headersSent) response.writeHead(500); response.end(); });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("CONFORMANCE_CAPTURE_SERVER_START_FAILED");
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, paths, close: async () => {
    server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}
