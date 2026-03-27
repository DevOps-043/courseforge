"use client";

import { useEffect, useRef } from "react";

interface UsePollingOptions {
  intervalMs: number;
  runImmediately?: boolean;
}

export function usePolling(
  callback: () => void | Promise<void>,
  enabled: boolean,
  options: UsePollingOptions,
) {
  const { intervalMs, runImmediately = false } = options;
  const latestCallbackRef = useRef(callback);

  useEffect(() => {
    latestCallbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (runImmediately) {
      void latestCallbackRef.current();
    }

    const intervalId = window.setInterval(() => {
      void latestCallbackRef.current();
    }, intervalMs);

    return () => window.clearInterval(intervalId);
  }, [enabled, intervalMs, runImmediately]);
}
