export type NarrativeExtractionHttpAuthorization = { status: "AUTHORIZED"; organizationId: string; userId: string }
  | { status: "AUTH_REQUIRED" | "TENANT_FORBIDDEN" | "ROLE_FORBIDDEN" };
