import assert from "node:assert/strict";
import { test } from "node:test";
import { deliveryPublicationBlock } from "../lib/delivery-publication-block";

test("el flujo de publicación v1 queda disponible solo para modalidad asíncrona confirmada", () => {
  assert.equal(deliveryPublicationBlock("NEXUS"), null);
  assert.match(deliveryPublicationBlock("HYBRID") ?? "", /aprobación v2.*emisor compatible/);
  assert.match(deliveryPublicationBlock("SYNCHRONOUS") ?? "", /sesión programada/);
  assert.match(deliveryPublicationBlock(undefined) ?? "", /Confirma la modalidad/);
});
