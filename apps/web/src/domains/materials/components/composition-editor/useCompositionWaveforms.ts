"use client";

import { useEffect, useMemo, useState } from "react";
import { waveformJobStatus, waveformReadFailure, waveformStatusNotices, type WaveformReadStatus } from "@/domains/production/audio-processing/audio-waveform-status.client";
import type { AudioWaveformPreview } from "@/domains/production/audio-processing/audio-processing.types";
import type { CompositionStudioAsset } from "./composition-studio.types";
import type { CompositionEditorDocument } from "@/domains/production/composition-editor/composition-document.types";

const MAX_SIMULTANEOUS_READS = 3;
const POLL_INTERVAL_MS = 3000;
const ANALYSIS_WAIT_MS = 10 * 60 * 1000;
interface WaveformReadSnapshot {
  scopeKey: string;
  waveforms: Record<string, AudioWaveformPreview>;
  statuses: Record<string, WaveformReadStatus>;
}
function initialSnapshot(
  scopeKey: string,
  ids: string[],
): WaveformReadSnapshot {
  return { scopeKey, waveforms: {}, statuses: Object.fromEntries(ids.map((id) => [id, "CHECKING" as const])) };
}

export function useCompositionWaveforms(
  componentId: string | null,
  assets: CompositionStudioAsset[],
  document: CompositionEditorDocument,
) {
  const fingerprint = [
    ...new Set(
      document.clips.flatMap((clip) =>
        (clip.kind === "AUDIO" || clip.kind === "VIDEO") &&
        clip.source.type === "PRODUCTION_ASSET" &&
        clip.source.hasAudio !== false
          ? [clip.source.productionAssetId]
          : [],
      ),
    ),
  ]
    .sort()
    .join("|");
  const assetIds = useMemo(
    () => new Set(fingerprint.split("|")),
    [fingerprint],
  );
  const referenced = useMemo(
    () =>
      assets.filter(
        (asset) =>
          assetIds.has(asset.id) &&
          /^(audio|video)\//.test(asset.mimeType) &&
          asset.hasAudio !== false &&
          asset.valid,
      ),
    [assets, assetIds],
  );
  const [{ version: retryVersion, retryFailed }, setRetryState] = useState({ version: 0, retryFailed: false });
  const scopeKey = JSON.stringify([
    componentId,
    retryVersion,
    referenced.map((asset) => [
      asset.id,
      asset.sourceChecksum,
      asset.waveform?.checksum,
    ]),
  ]);
  const [readState, setReadState] = useState(() =>
    initialSnapshot(
      scopeKey,
      componentId ? referenced.map((asset) => asset.id) : [],
    ),
  );

  useEffect(() => {
    const controller = new AbortController();
    if (componentId === null) return () => controller.abort();
    let nextIndex = 0;
    const update = (
      transform: (snapshot: WaveformReadSnapshot) => WaveformReadSnapshot,
    ) => {
      if (!controller.signal.aborted)
        setReadState((current) =>
          transform(
            current.scopeKey === scopeKey
              ? current
              : initialSnapshot(
                  scopeKey,
                  referenced.map((asset) => asset.id),
                ),
          ),
        );
    };
    const storeStatus = (assetId: string, status: WaveformReadStatus) =>
      update((current) => ({ ...current, statuses: { ...current.statuses, [assetId]: status } }));
    const storeWaveform = (assetId: string, waveform: AudioWaveformPreview) =>
      update((current) => ({
        ...current,
        waveforms: { ...current.waveforms, [assetId]: waveform },
        statuses: { ...current.statuses, [assetId]: "READY" },
      }));
    const readNext = async () => {
      while (!controller.signal.aborted && nextIndex < referenced.length) {
        const asset = referenced[nextIndex++];
        const endpoint = `/api/production/audio-analysis/assets/${encodeURIComponent(asset.id)}/waveform`;
        const query = `componentId=${encodeURIComponent(componentId)}`;
        const fetchForScope = (path: string, options?: RequestInit) =>
          fetch(path, {
            ...options,
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(30_000),
            ]),
          });
        let lastStatus: WaveformReadStatus = "CHECKING";
        try {
          const response = await fetchForScope(`${endpoint}?${query}`);
          if (response.ok) {
            const payload = (await response.json()) as {
              data: AudioWaveformPreview;
            };
            storeWaveform(asset.id, payload.data);
            if (payload.data.contractVersion !== 1) continue;
          } else if (response.status !== 404)
            throw new Error("WAVEFORM_READ_FAILED");
          const queued = await fetchForScope(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              componentId,
              retryFailed,
            }),
          });
          if (!queued.ok) throw new Error("WAVEFORM_QUEUE_FAILED");
          const { data: job } = (await queued.json()) as {
            data: { jobId: string; status: string };
          };
          lastStatus = waveformJobStatus(job.status);
          storeStatus(asset.id, lastStatus);
          const deadline = Date.now() + ANALYSIS_WAIT_MS;
          while (!controller.signal.aborted) {
            if (Date.now() >= deadline)
              throw new Error("WAVEFORM_WAIT_TIMEOUT");
            const result = await fetchForScope(
              `${endpoint}?${query}&jobId=${encodeURIComponent(job.jobId)}`,
            );
            if (!result.ok) throw new Error("WAVEFORM_READ_FAILED");
            const payload = (await result.json()) as {
              data: AudioWaveformPreview | null;
              status?: string;
            };
            if (payload.data) {
              storeWaveform(asset.id, payload.data);
              break;
            }
            lastStatus = waveformJobStatus(payload.status);
            storeStatus(asset.id, lastStatus);
            if (["NO_AUDIO", "ANALYSIS_FAILED", "CANCELLED", "REQUEST_FAILED"].includes(lastStatus)) break;
            await waitForPoll(controller.signal);
          }
        } catch (error) {
          storeStatus(asset.id, waveformReadFailure(error, lastStatus));
        }
      }
    };
    void Promise.all(
      Array.from(
        { length: Math.min(MAX_SIMULTANEOUS_READS, referenced.length) },
        readNext,
      ),
    );
    return () => controller.abort();
  }, [componentId, referenced, retryVersion, retryFailed, scopeKey]);

  const visible =
    readState.scopeKey === scopeKey
      ? readState
      : initialSnapshot(
          scopeKey,
          componentId ? referenced.map((asset) => asset.id) : [],
        );
  return {
    notices: waveformStatusNotices(visible.statuses),
    waveforms: visible.waveforms,
    retry: (retryFailed = false) => setRetryState((current) => ({ version: current.version + 1, retryFailed })),
  };
}

function waitForPoll(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, POLL_INTERVAL_MS);
    signal.addEventListener("abort", finish, { once: true });
  });
}
