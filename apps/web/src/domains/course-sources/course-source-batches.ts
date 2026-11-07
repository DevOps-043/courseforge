export type SourceBatchFailure = "TRANSIENT" | "CONTEXT_LIMIT" | "INVALID_OUTPUT" | "PERMANENT" | "STALE";

export function decideSourceBatchRecovery(input: {
  failure: SourceBatchFailure;
  attemptsRemaining: number;
  budgetRemaining: boolean;
  fragmentCount: number;
  correctionUsed: boolean;
}): "INVALIDATE" | "PAUSE" | "RETRY_WITH_BACKOFF" | "SPLIT" | "CORRECT" {
  if (input.failure === "STALE") return "INVALIDATE";
  if (!input.budgetRemaining || input.attemptsRemaining <= 0) return "PAUSE";
  switch (input.failure) {
    case "TRANSIENT": return "RETRY_WITH_BACKOFF";
    case "CONTEXT_LIMIT": return input.fragmentCount > 1 ? "SPLIT" : "PAUSE";
    case "INVALID_OUTPUT": return input.correctionUsed ? "PAUSE" : "CORRECT";
    case "PERMANENT": return "PAUSE";
  }
}

export function planSourceBatches<T>(
  fragments: readonly T[],
  options: { maxInputTokens: number; maxBatches: number; countRequestTokens: (fragments: readonly T[]) => number },
): T[][] {
  const { maxInputTokens, maxBatches, countRequestTokens } = options;
  if (![maxInputTokens, maxBatches].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new RangeError("El presupuesto de lotes debe ser un entero positivo.");
  }
  const batches: T[][] = [];
  let current: T[] = [];
  function fits(candidate: readonly T[]) {
    const tokens = countRequestTokens(candidate);
    if (!Number.isSafeInteger(tokens) || tokens <= 0) throw new RangeError("Conteo de tokens inválido.");
    return tokens <= maxInputTokens;
  }
  function commit(batch: T[]) {
    if (batches.length >= maxBatches) throw new RangeError("La fuente supera el máximo de lotes de la ejecución.");
    batches.push(batch);
  }
  for (const fragment of fragments) {
    const candidate = [...current, fragment];
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (!current.length || !fits([fragment])) throw new RangeError("Un fragmento supera el presupuesto de la solicitud.");
    commit(current);
    current = [fragment];
  }
  if (current.length) commit(current);
  return batches;
}
