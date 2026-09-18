interface BackgroundRequestEnvironment {
  netlify?: string;
  nodeEnv?: string;
  rawUrl?: string;
}

interface LocalBackgroundDispatchEnvironment {
  hasLocalHandler: boolean;
  netlify?: string;
  nodeEnv?: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOCAL_BACKGROUND_HANDLER_ORIGIN = "http://localhost";

export function buildLocalBackgroundHandlerUrl(functionName: string) {
  return `${LOCAL_BACKGROUND_HANDLER_ORIGIN}/.netlify/functions/${encodeURIComponent(functionName)}`;
}

/**
 * Next development runs background handlers inside the web process. In that
 * environment there is no Netlify Functions listener on port 8888 to receive
 * chained jobs, so the next invocation must stay in-process as well.
 * Missing build flags in a deployed function are not evidence of development:
 * a timer scheduled after its response may never execute.
 */
export function shouldDispatchBackgroundInProcess(
  environment: LocalBackgroundDispatchEnvironment,
) {
  return (
    environment.hasLocalHandler &&
    environment.nodeEnv === "development" &&
    environment.netlify !== "true"
  );
}

/**
 * Local handlers run in-process and still verify the signed, expiring envelope.
 * Persistent nonce consumption remains mandatory for every deployed request.
 */
export function isLocalBackgroundInvocation(
  environment: BackgroundRequestEnvironment,
) {
  if (
    environment.nodeEnv !== "development" ||
    environment.netlify === "true" ||
    !environment.rawUrl
  ) {
    return false;
  }

  try {
    const url = new URL(environment.rawUrl);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}
