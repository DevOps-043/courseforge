const LIVEAVATAR_API_BASE_URL = "https://api.liveavatar.com";

export class LiveAvatarApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "LiveAvatarApiError";
  }
}

export class LiveAvatarClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  getCredits() { return this.request("GET", "/v1/users/credits"); }
  listAvatars() { return this.request("GET", "/v1/avatars"); }
  listPublicAvatars() { return this.request("GET", "/v1/avatars/public"); }
  listContexts() { return this.request("GET", "/v1/contexts"); }

  createEmbedding(params: {
    avatarId: string;
    contextId: string;
    isSandbox: boolean;
  }) {
    return this.request("POST", "/v2/embeddings", {
      avatar_id: params.avatarId,
      context_id: params.contextId,
      is_sandbox: params.isSandbox,
    });
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown) {
    const response = await this.fetchImpl(`${LIVEAVATAR_API_BASE_URL}${path}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        "X-API-KEY": this.apiKey.trim(),
      },
      method,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: unknown } | null;
      throw new LiveAvatarApiError(
        typeof payload?.message === "string" ? payload.message : `LiveAvatar rechazó la solicitud (${response.status}).`,
        response.status,
      );
    }
    return response.json() as Promise<unknown>;
  }
}
