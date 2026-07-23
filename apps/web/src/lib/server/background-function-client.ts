"use server";

import { getBackgroundFunctionsBaseUrl } from "@/lib/server/artifact-action-auth";
import { isProductionEnvironment } from "@/lib/server/env";

type BackgroundFunctionPayload = Record<string, unknown>;

type LocalFunctionEvent = {
  body: string;
  headers: Record<string, string>;
  httpMethod: string;
  multiValueHeaders?: Record<string, string[]>;
  multiValueQueryStringParameters?: Record<string, string[]>;
  path?: string;
  queryStringParameters?: Record<string, string>;
  rawQuery?: string;
  rawUrl?: string;
};

type LocalFunctionResponse = {
  body?: string;
  headers?: Record<string, string | number | boolean>;
  statusCode?: number;
};

type LocalFunctionModule = Record<string, unknown>;

interface BackgroundFunctionOptions {
  fallbackError: string;
  localHandlerLoader?: () => Promise<LocalFunctionModule>;
}

const LOCAL_REMOTE_TRIGGER_TIMEOUT_MS = 10_000;

function parseJsonOrText<TData>(rawBody: string): TData | { error?: string; message?: string } {
  if (!rawBody) {
    return {} as TData;
  }

  try {
    return JSON.parse(rawBody) as TData;
  } catch {
    return { message: rawBody };
  }
}

function getResponseErrorMessage(
  data: unknown,
  fallbackError: string,
  statusCode: number,
) {
  if (typeof data === "object" && data !== null) {
    if ("error" in data && typeof data.error === "string" && data.error) {
      return data.error;
    }

    if ("message" in data && typeof data.message === "string" && data.message) {
      return data.message;
    }
  }

  return `${fallbackError} (${statusCode})`;
}

async function parseRemoteResponse<TData>(
  response: Response,
  fallbackError: string,
) {
  const rawBody = await response.text();
  const data = parseJsonOrText<TData>(rawBody);

  if (!response.ok) {
    throw new Error(
      getResponseErrorMessage(data, fallbackError, response.status),
    );
  }

  return data as TData;
}

async function parseLocalResponse<TData>(
  response: LocalFunctionResponse | Response | unknown,
  fallbackError: string,
) {
  if (response instanceof Response) {
    return parseRemoteResponse<TData>(response, fallbackError);
  }

  if (typeof response !== "object" || response === null) {
    throw new Error(fallbackError);
  }

  const normalizedResponse = response as LocalFunctionResponse;
  const statusCode = normalizedResponse.statusCode ?? 200;
  const rawBody = normalizedResponse.body ?? "";
  const data = parseJsonOrText<TData>(rawBody);

  if (statusCode >= 400) {
    throw new Error(getResponseErrorMessage(data, fallbackError, statusCode));
  }

  return data as TData;
}

async function tryLocalHandler<TData>(
  functionName: string,
  payload: BackgroundFunctionPayload,
  options: BackgroundFunctionOptions,
) {
  if (isProductionEnvironment() || !options.localHandlerLoader) {
    return null;
  }

  console.log(`[BackgroundFunctionClient] Running local handler: ${functionName}`);
  const module = await options.localHandlerLoader();
  const localHandler = (module.handler || module.default) as
    | ((
        event: LocalFunctionEvent,
        context: Record<string, unknown>,
      ) => Promise<LocalFunctionResponse | Response | unknown> | LocalFunctionResponse | Response | unknown)
    | undefined;

  if (!localHandler) {
    console.warn(
      `[BackgroundFunctionClient] Local handler not found for ${functionName}; falling back to HTTP.`,
    );
    return null;
  }

  const localResponse = await localHandler(
    {
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
      httpMethod: "POST",
      multiValueHeaders: {},
      multiValueQueryStringParameters: {},
      path: `/.netlify/functions/${functionName}`,
      queryStringParameters: {},
      rawQuery: "",
      rawUrl: `${getBackgroundFunctionsBaseUrl()}/.netlify/functions/${functionName}`,
    },
    {},
  );

  const parsedResponse = await parseLocalResponse<TData>(
    localResponse,
    options.fallbackError,
  );
  console.log(`[BackgroundFunctionClient] Local handler completed: ${functionName}`);
  return parsedResponse;
}

async function fetchRemoteFunction(
  functionName: string,
  payload: BackgroundFunctionPayload,
) {
  const url = `${getBackgroundFunctionsBaseUrl()}/.netlify/functions/${functionName}`;
  const controller = new AbortController();
  const timeout =
    !isProductionEnvironment() && url.includes("localhost")
      ? setTimeout(() => controller.abort(), LOCAL_REMOTE_TRIGGER_TIMEOUT_MS)
      : null;

  try {
    console.log(`[BackgroundFunctionClient] Calling HTTP function: ${url}`);
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function callBackgroundFunctionJson<
  TData extends Record<string, unknown> = Record<string, unknown>,
>(
  functionName: string,
  payload: BackgroundFunctionPayload,
  options: BackgroundFunctionOptions,
) {
  const localResult = await tryLocalHandler<TData>(functionName, payload, options);
  if (localResult) {
    return localResult;
  }

  const response = await fetchRemoteFunction(functionName, payload);

  return parseRemoteResponse<TData>(response, options.fallbackError);
}
