"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import type { Artifact } from "../artifacts-list.types";

type SetArtifacts = React.Dispatch<React.SetStateAction<Artifact[]>>;

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
        (payload: any) => {
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
        .select("*")
        .in(
          "id",
          generatingItems.map((artifact) => artifact.id),
        );

      if (!data || data.length === 0) {
        return;
      }

      let changed = false;
      setArtifacts((prev) =>
        prev.map((artifact) => {
          const freshArtifact = data.find((row: any) => row.id === artifact.id);

          if (freshArtifact && freshArtifact.state !== artifact.state) {
            changed = true;
            return { ...artifact, ...freshArtifact };
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
