import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_PORTS = new Set(["", "443"]);

export type PublicAddressResolver = (hostname: string) => Promise<readonly string[]>;

async function resolveAddresses(hostname: string) {
  return (await lookup(hostname, { all: true, verbatim: true }))
    .map(({ address }) => address);
}

function isBlockedIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function isBlockedIp(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return isBlockedIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (
    normalized === "::"
    || normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^(?:fe8|fe9|fea|feb)/.test(normalized)
    || normalized.startsWith("2001:db8")
  ) {
    return true;
  }
  const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mappedIpv4 ? isBlockedIpv4(mappedIpv4) : false;
}

export async function assertPublicHttpsUrl(
  rawUrl: string | URL,
  addressResolver: PublicAddressResolver = resolveAddresses,
) {
  let url: URL;
  try {
    url = rawUrl instanceof URL ? new URL(rawUrl) : new URL(rawUrl);
  } catch {
    throw new Error("La URL externa no es valida.");
  }
  if (
    url.protocol !== "https:"
    || !ALLOWED_PORTS.has(url.port)
    || url.username
    || url.password
    || !url.hostname
  ) {
    throw new Error("La URL externa debe usar HTTPS publico sin credenciales ni puertos personalizados.");
  }

  const addresses = await addressResolver(url.hostname);
  if (addresses.length === 0 || addresses.some(isBlockedIp)) {
    throw new Error("La URL externa resuelve a una red no permitida.");
  }
  return url;
}

export async function fetchPublicUrlWithRedirects(
  rawUrl: string | URL,
  options: {
    addressResolver?: PublicAddressResolver;
    fetchImpl?: typeof fetch;
    headers?: HeadersInit;
    maximumRedirects?: number;
    method?: "GET" | "HEAD";
    signal?: AbortSignal;
    timeoutMilliseconds: number;
  },
) {
  const maximumRedirects = options.maximumRedirects ?? 5;
  if (!Number.isInteger(maximumRedirects) || maximumRedirects < 0 || maximumRedirects > 10) {
    throw new Error("El limite de redirects debe ser un entero entre 0 y 10.");
  }
  if (!Number.isFinite(options.timeoutMilliseconds) || options.timeoutMilliseconds <= 0) {
    throw new Error("El timeout publico debe ser positivo.");
  }

  const deadlineSignal = AbortSignal.timeout(options.timeoutMilliseconds);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadlineSignal])
    : deadlineSignal;
  const fetchImpl = options.fetchImpl || fetch;
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const safeUrl = await assertPublicHttpsUrl(
      currentUrl,
      options.addressResolver || resolveAddresses,
    );
    const response = await fetchImpl(safeUrl, {
      headers: options.headers,
      method: options.method || "GET",
      redirect: "manual",
      signal,
    });

    if (!REDIRECT_STATUS_CODES.has(response.status)) {
      return { response, url: safeUrl };
    }

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error("El redirect externo no incluye destino.");
    if (redirectCount === maximumRedirects) {
      throw new Error("La URL externa excede el limite de redirects.");
    }
    currentUrl = new URL(location, safeUrl);
  }

  throw new Error("La URL externa excede el limite de redirects.");
}
