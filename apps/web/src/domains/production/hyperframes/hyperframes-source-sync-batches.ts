const SOURCE_ASSET_CHECK_CONCURRENCY = 4;

/** Solapa consultas pequeñas, conservando una sola descarga/escritura a la vez. */
export async function synchronizeHyperframesSourceBatches<Reference, Checked>(
  references: Reference[],
  inspect: (reference: Reference) => Promise<Checked>,
  synchronize: (checked: Checked) => Promise<void>,
): Promise<void> {
  for (let offset = 0; offset < references.length; offset += SOURCE_ASSET_CHECK_CONCURRENCY) {
    const checks = await Promise.allSettled(
      references.slice(offset, offset + SOURCE_ASSET_CHECK_CONCURRENCY).map(inspect),
    );
    // Resolver todas las consultas antes de propagar errores evita trabajo
    // pendiente tras el cierre de la solicitud y no permite escrituras parciales
    // dentro de un lote que no pudo comprobarse.
    for (const check of checks) {
      if (check.status === "rejected") throw check.reason;
    }
    for (const check of checks) {
      if (check.status === "fulfilled") await synchronize(check.value);
    }
  }
}
