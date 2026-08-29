"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ARTIFACT_WORKFLOW_FIRST_STEP,
  type ArtifactWorkflowStep,
  type ArtifactWorkspacePreferences,
  createDefaultArtifactWorkspacePreferences,
  isArtifactWorkflowStep,
  loadArtifactWorkspacePreferences,
  resolveRestoredArtifactWorkflowStep,
  saveArtifactWorkspacePreferences,
} from "@/lib/client/artifact-workspace-preferences";

const SCROLL_SAVE_DEBOUNCE_MS = 200;
const SCROLL_RESTORE_RETRY_MS = 100;
const SCROLL_RESTORE_TIMEOUT_MS = 2_000;
const SCROLL_RESTORE_TOLERANCE_PX = 2;

interface UseArtifactWorkspacePreferencesParams {
  artifactId: string;
  canAccessStep: (step: ArtifactWorkflowStep) => boolean;
}

interface UseArtifactWorkspacePreferencesResult {
  currentStep: ArtifactWorkflowStep;
  setCurrentStep: (step: number) => void;
}

export function useArtifactWorkspacePreferences({
  artifactId,
  canAccessStep,
}: UseArtifactWorkspacePreferencesParams): UseArtifactWorkspacePreferencesResult {
  const [currentStep, setCurrentStepState] = useState<ArtifactWorkflowStep>(
    ARTIFACT_WORKFLOW_FIRST_STEP,
  );
  const [isRestored, setIsRestored] = useState(false);
  const preferencesRef = useRef<ArtifactWorkspacePreferences>(
    createDefaultArtifactWorkspacePreferences(),
  );
  const currentStepRef = useRef<ArtifactWorkflowStep>(ARTIFACT_WORKFLOW_FIRST_STEP);
  const isRestoringScrollRef = useRef(false);
  const canAccessStepRef = useRef(canAccessStep);
  canAccessStepRef.current = canAccessStep;

  const persistPreferences = useCallback(() => {
    saveArtifactWorkspacePreferences(window.localStorage, artifactId, preferencesRef.current);
  }, [artifactId]);

  const captureCurrentScroll = useCallback(() => {
    if (!isRestored || isRestoringScrollRef.current) return;
    preferencesRef.current.scrollByStep[currentStepRef.current] = Math.max(0, window.scrollY);
  }, [isRestored]);

  useEffect(() => {
    const preferences = loadArtifactWorkspacePreferences(window.localStorage, artifactId);
    const restoredStep = resolveRestoredArtifactWorkflowStep(
      preferences,
      canAccessStepRef.current,
    );

    preferences.currentStep = restoredStep;
    preferencesRef.current = preferences;
    currentStepRef.current = restoredStep;
    setCurrentStepState(restoredStep);
    setIsRestored(true);
  }, [artifactId]);

  useEffect(() => {
    if (!isRestored) return;

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const saveScroll = () => {
      if (isRestoringScrollRef.current) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        captureCurrentScroll();
        persistPreferences();
      }, SCROLL_SAVE_DEBOUNCE_MS);
    };
    const flushPreferences = () => {
      if (saveTimer) clearTimeout(saveTimer);
      captureCurrentScroll();
      persistPreferences();
    };

    window.addEventListener("scroll", saveScroll, { passive: true });
    window.addEventListener("pagehide", flushPreferences);
    return () => {
      window.removeEventListener("scroll", saveScroll);
      window.removeEventListener("pagehide", flushPreferences);
      flushPreferences();
    };
  }, [captureCurrentScroll, isRestored, persistPreferences]);

  useEffect(() => {
    if (!isRestored) return;

    const targetScroll = preferencesRef.current.scrollByStep[currentStep] ?? 0;
    const restoreDeadline = Date.now() + SCROLL_RESTORE_TIMEOUT_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    isRestoringScrollRef.current = true;

    const stopRestoring = () => {
      isRestoringScrollRef.current = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
    const restoreScroll = () => {
      if (cancelled) return;
      window.scrollTo({ top: targetScroll, left: 0, behavior: "instant" });

      const reachedTarget = Math.abs(window.scrollY - targetScroll) <= SCROLL_RESTORE_TOLERANCE_PX;
      if (reachedTarget || Date.now() >= restoreDeadline) {
        stopRestoring();
        return;
      }

      retryTimer = setTimeout(restoreScroll, SCROLL_RESTORE_RETRY_MS);
    };
    const cancelOnUserInput = () => stopRestoring();

    const animationFrame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(restoreScroll);
    });
    window.addEventListener("wheel", cancelOnUserInput, { passive: true, once: true });
    window.addEventListener("touchstart", cancelOnUserInput, { passive: true, once: true });
    window.addEventListener("keydown", cancelOnUserInput, { once: true });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
      stopRestoring();
      window.removeEventListener("wheel", cancelOnUserInput);
      window.removeEventListener("touchstart", cancelOnUserInput);
      window.removeEventListener("keydown", cancelOnUserInput);
    };
  }, [currentStep, isRestored]);

  const setCurrentStep = useCallback((step: number) => {
    if (!isArtifactWorkflowStep(step)) return;

    captureCurrentScroll();
    preferencesRef.current.currentStep = step;
    currentStepRef.current = step;
    persistPreferences();
    setCurrentStepState(step);
  }, [captureCurrentScroll, persistPreferences]);

  return { currentStep, setCurrentStep };
}
