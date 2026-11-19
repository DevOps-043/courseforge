"use server";

import { z } from "zod";
import { requireDeliveryAccess } from "../services/delivery-access";
import { initializeArtifactDelivery } from "../services/delivery-initialization";

export async function configureCreatedArtifactDeliveryAction(artifactId: string, value: unknown) {
  z.uuid().parse(artifactId);
  const { tenant, admin } = await requireDeliveryAccess(artifactId);
  await initializeArtifactDelivery(admin, artifactId, tenant.organizationId, value);
}
