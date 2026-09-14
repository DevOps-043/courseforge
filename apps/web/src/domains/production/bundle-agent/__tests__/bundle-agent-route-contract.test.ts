import assert from "node:assert/strict";
import test from "node:test";
import {
  addBundleAgentMessageRequestSchema,
  createBundleAgentConversationRequestSchema,
  createBundleAgentSpecRequestSchema,
  generateBundleAgentVersionRequestSchema,
} from "../request-contract";

const UUID = "8d15ec09-d2ae-4f24-a565-84c337f6c135";

test("bundle agent conversation creation has a strict bounded contract", () => {
  assert.equal(createBundleAgentConversationRequestSchema.safeParse({}).success, true);
  assert.equal(createBundleAgentConversationRequestSchema.safeParse({
    artifactKind: "slide_template",
    templateId: UUID,
    title: "Plantilla corporativa",
  }).success, true);
  assert.equal(createBundleAgentConversationRequestSchema.safeParse({ organizationId: UUID }).success, false);
  assert.equal(createBundleAgentConversationRequestSchema.safeParse({ title: "x".repeat(121) }).success, false);
});

test("bundle agent messages reject empty, excessive and unknown input", () => {
  assert.equal(addBundleAgentMessageRequestSchema.safeParse({ content: "Ajusta el ritmo visual" }).success, true);
  assert.equal(addBundleAgentMessageRequestSchema.safeParse({ content: "" }).success, false);
  assert.equal(addBundleAgentMessageRequestSchema.safeParse({ content: "x".repeat(12_001) }).success, false);
  assert.equal(addBundleAgentMessageRequestSchema.safeParse({ content: "ok", organizationId: UUID }).success, false);
});

test("bundle agent specs allow nested overrides but reject unknown boundary fields", () => {
  assert.equal(createBundleAgentSpecRequestSchema.safeParse({
    artifactKind: "video_bundle",
    overrides: { defaultProps: { accentColor: "#123456" } },
  }).success, true);
  assert.equal(createBundleAgentSpecRequestSchema.safeParse({ tenantId: UUID }).success, false);
});

test("bundle generation accepts only valid optional spec identifiers", () => {
  assert.equal(generateBundleAgentVersionRequestSchema.safeParse({ specId: UUID }).success, true);
  assert.equal(generateBundleAgentVersionRequestSchema.safeParse({ specId: "latest" }).success, false);
});
