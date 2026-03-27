"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import type { Artifact } from "../artifacts-list.types";

type SetArtifacts = React.Dispatch<React.SetStateAction<Artifact[]>>;

interface ArtifactRealtimePayload {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Partial<Artifact> & { id: string };
  old: Partial<Artifact> & { id: string };
}

interface ArtifactPollingRow {
  id: string;
  production_complete?: boolean | null;
  state: string;
}

export function useArtifactsSync(
  artifacts: Artifact[],
  setArtifacts: SetArtifacts,
) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("artifacts_list_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "artifacts" },
        (payload: ArtifactRealtimePayload) => {
          console.log("Realtime Event received:", payload);

          if (payload.eventType === "INSERT") {
            setArtifacts((prev) => [payload.new as Artifact, ...prev]);
            router.refresh();
            return;
          }

          if (payload.eventType === "UPDATE") {
            setArtifacts((prev) =>
              prev.map((artifact) =>
                artifact.id === payload.new.id
                  ? { ...artifact, ...payload.new, profiles: artifact.profiles }
                  : artifact,
              ),
            );

            if (
              payload.new.state === "READY_FOR_QA" ||
              payload.new.state === "ESCALATED"
            ) {
              router.refresh();
            }
            return;
          }

          if (payload.eventType === "DELETE") {
            setArtifacts((prev) =>
              prev.filter((artifact) => artifact.id !== payload.old.id),
            );
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router, setArtifacts]);

  useEffect(() => {
    const generatingItems = artifacts.filter(
      (artifact) =>
        artifact.state === "GENERATING" || artifact.state === "VALIDATING",
    );

    if (generatingItems.length === 0) {
      return;
    }

    const supabase = createClient();
    const interval = setInterval(async () => {
      console.log("Polling for updates on", generatingItems.length, "items");

      const { data } = await supabase
        .from("artifacts")
        .select("id,state,production_complete")
        .in(
          "id",
          generatingItems.map((artifact) => artifact.id),
        );

      if (!data || data.length === 0) {
        return;
      }

      const freshArtifactsById = new Map(
        ((data || []) as ArtifactPollingRow[]).map((row) => [row.id, row]),
      );

      let changed = false;
      setArtifacts((prev) =>
        prev.map((artifact) => {
          const freshArtifact = freshArtifactsById.get(artifact.id);

          if (
            freshArtifact &&
            (freshArtifact.state !== artifact.state ||
              Boolean(freshArtifact.production_complete) !==
                Boolean(artifact.production_complete))
          ) {
            changed = true;
            return {
              ...artifact,
              ...freshArtifact,
              production_complete: freshArtifact.production_complete ?? undefined,
            };
          }

          return artifact;
        }),
      );

      if (changed) {
        router.refresh();
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [artifacts, router, setArtifacts]);
}
