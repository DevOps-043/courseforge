import assert from "node:assert/strict";
import test from "node:test";
import { CompositionAgentPolicyError } from "../composition-agent-policy.service";
import { CompositionAgentProviderError } from "../composition-agent-provider.service";
import { CompositionAgentValidationError } from "../composition-agent-validation.service";
import {
  COMPOSITION_AGENT_MAX_ATTEMPTS,
  recoverCompositionAgentProposal,
  type CompositionAgentAttemptContext,
  type CompositionAgentModelRuntime,
} from "../composition-agent-recovery.service";

const PRIMARY: CompositionAgentModelRuntime = {
  apiKey: "primary-secret",
  model: "gpt-5.6-terra",
  provider: "openai",
};
const FALLBACK: CompositionAgentModelRuntime = {
  apiKey: "fallback-secret",
  model: "gemini-3.5-flash",
  provider: "gemini",
};

test("returns a valid primary proposal without recovery", async () => {
  const attempts: CompositionAgentAttemptContext[] = [];
  const result = await recoverCompositionAgentProposal({
    attempt: async (context) => {
      attempts.push(context);
      return "primary-result";
    },
    fallback: FALLBACK,
    primary: PRIMARY,
    prompt: "Mueve el clip.",
    temperature: 0.3,
  });

  assert.equal(result.value, "primary-result");
  assert.equal(result.model, PRIMARY.model);
  assert.deepEqual(result.recovery, { attemptCount: 1, repaired: false, usedFallback: false });
  assert.equal(attempts[0]?.mode, "PRIMARY");
});

test("repairs one invalid provider contract with the same model and temperature zero", async () => {
  const attempts: CompositionAgentAttemptContext[] = [];
  const result = await recoverCompositionAgentProposal({
    attempt: async (context) => {
      attempts.push(context);
      if (context.mode === "PRIMARY") {
        throw new CompositionAgentProviderError("invalid", "PROVIDER_INVALID_OUTPUT", "openai");
      }
      return "repaired-result";
    },
    fallback: FALLBACK,
    primary: PRIMARY,
    prompt: "Mueve el clip.",
    temperature: 0.7,
  });

  assert.equal(result.value, "repaired-result");
  assert.deepEqual(result.recovery, { attemptCount: 2, repaired: true, usedFallback: false });
  assert.equal(attempts[1]?.model, PRIMARY.model);
  assert.equal(attempts[1]?.mode, "REPAIR");
  assert.equal(attempts[1]?.temperature, 0);
  assert.match(attempts[1]?.prompt || "", /RECOVERY_INSTRUCTION/);
});

test("uses the configured fallback only after the primary repair also fails", async () => {
  const attempts: CompositionAgentAttemptContext[] = [];
  const result = await recoverCompositionAgentProposal({
    attempt: async (context) => {
      attempts.push(context);
      if (context.mode !== "FALLBACK") {
        throw new CompositionAgentProviderError("invalid", "PROVIDER_INVALID_OUTPUT", "openai");
      }
      return "fallback-result";
    },
    fallback: FALLBACK,
    primary: PRIMARY,
    prompt: "Mueve el clip.",
    temperature: 0.3,
  });

  assert.equal(result.value, "fallback-result");
  assert.equal(result.model, FALLBACK.model);
  assert.deepEqual(result.recovery, { attemptCount: 3, repaired: false, usedFallback: true });
  assert.equal(attempts.length, COMPOSITION_AGENT_MAX_ATTEMPTS);
  assert.equal(attempts[2]?.mode, "FALLBACK");
  assert.equal(attempts[2]?.temperature, 0);
  assert.match(attempts[2]?.prompt || "", /FALLBACK_INSTRUCTION/);
});

test("retries one transient provider failure with bounded backoff", async () => {
  const attempts: CompositionAgentAttemptContext[] = [];
  const delays: number[] = [];
  const result = await recoverCompositionAgentProposal({
    attempt: async (context) => {
      attempts.push(context);
      if (context.mode === "PRIMARY") {
        throw new CompositionAgentProviderError("unavailable", "PROVIDER_REQUEST_FAILED", "openai", 503);
      }
      return "retry-result";
    },
    fallback: null,
    primary: PRIMARY,
    prompt: "Mueve el clip.",
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    temperature: 0.3,
  });

  assert.equal(result.value, "retry-result");
  assert.deepEqual(delays, [250]);
  assert.equal(attempts[1]?.mode, "RETRY");
  assert.deepEqual(result.recovery, { attemptCount: 2, repaired: false, usedFallback: false });
});

test("repairs a semantic validation failure using only normalized issues", async () => {
  const attempts: CompositionAgentAttemptContext[] = [];
  const result = await recoverCompositionAgentProposal({
    attempt: async (context) => {
      attempts.push(context);
      if (context.mode === "PRIMARY") {
        throw new CompositionAgentValidationError("overlap", [{
          code: "AGENT_TIMELINE_OVERLAP_INTRODUCED",
          entityId: "visual-track",
          message: "La propuesta introduce un solapamiento.",
          severity: "ERROR",
        }]);
      }
      return "semantic-repair";
    },
    fallback: null,
    primary: PRIMARY,
    prompt: "Mueve el clip.",
    temperature: 0.3,
  });

  assert.equal(result.value, "semantic-repair");
  assert.match(attempts[1]?.prompt || "", /AGENT_TIMELINE_OVERLAP_INTRODUCED \(visual-track\)/);
});

test("does not retry or fall back on an authentication rejection", async () => {
  let attemptCount = 0;
  await assert.rejects(
    recoverCompositionAgentProposal({
      attempt: async () => {
        attemptCount += 1;
        throw new CompositionAgentProviderError("unauthorized", "PROVIDER_REQUEST_FAILED", "openai", 401);
      },
      fallback: FALLBACK,
      primary: PRIMARY,
      prompt: "Mueve el clip.",
      temperature: 0.3,
    }),
    (error: unknown) => error instanceof CompositionAgentProviderError && error.providerStatus === 401,
  );
  assert.equal(attemptCount, 1);
});

test("does not retry a forbidden operation", async () => {
  let attemptCount = 0;
  await assert.rejects(
    recoverCompositionAgentProposal({
      attempt: async () => {
        attemptCount += 1;
        throw new CompositionAgentPolicyError("forbidden", "AGENT_OPERATION_FORBIDDEN");
      },
      fallback: FALLBACK,
      primary: PRIMARY,
      prompt: "Elimina el asset.",
      temperature: 0.3,
    }),
    (error: unknown) => error instanceof CompositionAgentPolicyError,
  );
  assert.equal(attemptCount, 1);
});
