/** El borrador depende de medios actuales; la biblioteca no depende del borrador. */
export async function prepareHyperframesEditor<Composition, Draft>(steps: {
  synchronize: () => Promise<void>;
  prepareComposition: () => Promise<Composition>;
  loadAssets: () => Promise<void>;
  openDraft: (composition: Composition) => Promise<Draft>;
}): Promise<Draft> {
  // Capturar el rechazo desde el inicio evita promesas rechazadas sin observar
  // mientras la sincronización sigue trabajando.
  const composition = Promise.resolve().then(steps.prepareComposition).then(
    (value) => ({ success: true as const, value }),
    (error: unknown) => ({ success: false as const, error }),
  );
  await steps.synchronize();
  const [assets, draft] = await Promise.allSettled([
    Promise.resolve().then(steps.loadAssets),
    (async () => {
      const result = await composition;
      if (!result.success) throw result.error;
      return steps.openDraft(result.value);
    })(),
  ]);
  if (assets.status === "rejected") throw assets.reason;
  if (draft.status === "rejected") throw draft.reason;
  return draft.value;
}
