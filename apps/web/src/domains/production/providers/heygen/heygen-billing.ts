import { createHash } from "node:crypto";
import type { AvatarClip, VoiceClip } from "@/domains/materials/types/materials.types";
import type { HeygenAccountSummary, HeygenAvatarVideoEngine } from "./heygen.types";

const NARRATION_WORDS_PER_MINUTE = 145;
const AVATAR_USD_PER_SECOND = 0.0667;
const AVATAR_CREDITS_PER_SECOND = 0.1;
const TTS_USD_PER_SECOND = 0.000667;
const TTS_CREDITS_PER_SECOND = 0.000333;
const ESTIMATE_SAFETY_FACTOR = 1.1;

export interface HeygenAvatarGenerationBudget {
  available: number | null;
  estimatedCost: number;
  estimatedDurationSeconds: number;
  unit: "credits" | "usd";
}

/** Builds a conservative preflight from the official /v3/users/me billing shapes. */
export function estimateHeygenAvatarGenerationBudget(params: {
  account: HeygenAccountSummary;
  clips: AvatarClip[];
  engine: HeygenAvatarVideoEngine;
  speed: number;
  voiceClips?: VoiceClip[];
}): HeygenAvatarGenerationBudget {
  const balance = readHeygenAvailableBalance(params.account);
  const voiceByClipId = new Map((params.voiceClips || []).map((clip) => [clip.clip_id, clip]));
  const estimatedDurationSeconds = params.clips.reduce((total, clip) => {
    const currentVoice = voiceByClipId.get(clip.id);
    const hasCurrentVoice = currentVoice?.status === "COMPLETED"
      && currentVoice.script_hash === hashHint(clip)
      && typeof currentVoice.duration === "number";
    return total + (hasCurrentVoice
      ? currentVoice.duration!
      : estimateSpokenDurationSeconds(clip.script_text, params.speed));
  }, 0);
  const avatarRate = balance.unit === "credits"
    ? AVATAR_CREDITS_PER_SECOND
    : AVATAR_USD_PER_SECOND;
  const ttsRate = balance.unit === "credits"
    ? TTS_CREDITS_PER_SECOND
    : TTS_USD_PER_SECOND;
  // Avatar IV and V currently share the same conservative enterprise rate;
  // keep engine in the contract so a future rate split is explicit.
  void params.engine;

  return {
    available: balance.available,
    estimatedCost: roundMoney(
      estimatedDurationSeconds * (avatarRate + ttsRate) * ESTIMATE_SAFETY_FACTOR,
    ),
    estimatedDurationSeconds: Math.ceil(estimatedDurationSeconds),
    unit: balance.unit,
  };
}

export function readHeygenAvailableBalance(account: HeygenAccountSummary) {
  if (account.billingType === "subscription") {
    const premium = readNestedNumber(account.subscription, ["credits", "premium_credits", "remaining"]);
    const addOn = readNestedNumber(account.subscription, ["credits", "add_on_credits", "remaining"]);
    return {
      available: premium === null && addOn === null ? null : (premium || 0) + (addOn || 0),
      unit: "credits" as const,
    };
  }

  if (account.billingType === "usage_based") {
    const current = readNestedNumber(account.usageBased, ["spending_current_usd"]);
    const cap = readNestedNumber(account.usageBased, ["spending_cap_usd"]);
    return {
      available: cap === null ? null : Math.max(0, cap - (current || 0)),
      unit: "usd" as const,
    };
  }

  const currency = readNestedString(account.wallet, ["currency"]).toLowerCase();
  return {
    available: readNestedNumber(account.wallet, ["remaining_balance"]),
    unit: currency === "credits" ? "credits" as const : "usd" as const,
  };
}

function estimateSpokenDurationSeconds(text: string, speed: number) {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, (wordCount / NARRATION_WORDS_PER_MINUTE) * 60) / Math.max(0.5, speed);
}

function hashHint(clip: AvatarClip) {
  return clip.script_hash || createHash("sha256").update(clip.script_text).digest("hex");
}

function readNestedNumber(root: Record<string, unknown> | null, path: string[]) {
  let current: unknown = root;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null;
}

function readNestedString(root: Record<string, unknown> | null, path: string[]) {
  let current: unknown = root;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return "";
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : "";
}

function roundMoney(value: number) {
  return Math.ceil(value * 100) / 100;
}
