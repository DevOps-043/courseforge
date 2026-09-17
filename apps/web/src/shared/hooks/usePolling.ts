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

    let disposed = false;
    let inFlight = false;
    const run = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        await latestCallbackRef.current();
      } finally {
        inFlight = false;
      }
    };

    if (runImmediately) {
      void run();
    }

    const intervalId = window.setInterval(() => {
      void run();
    }, intervalMs);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [enabled, intervalMs, runImmediately]);
}
