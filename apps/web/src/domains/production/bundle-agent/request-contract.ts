import { z } from "zod";
import {
  bundleAgentArtifactKindSchema,
  bundleAgentMessageMetadataSchema,
  bundleAgentMessageRoleSchema,
} from "./types";

export const BUNDLE_AGENT_SMALL_REQUEST_BYTES = 8 * 1024;
export const BUNDLE_AGENT_MESSAGE_REQUEST_BYTES = 96 * 1024;
export const BUNDLE_AGENT_SPEC_REQUEST_BYTES = 256 * 1024;

export const bundleAgentConversationIdSchema = z.string().uuid();

export const createBundleAgentConversationRequestSchema = z.object({
  artifactKind: bundleAgentArtifactKindSchema.optional(),
  templateId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(120).nullable().optional(),
}).strict();

export const updateBundleAgentConversationRequestSchema = z.object({
  title: z.string().trim().min(1).max(120),
}).strict();

export const addBundleAgentMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(12_000),
  metadata: bundleAgentMessageMetadataSchema.default({}),
  role: bundleAgentMessageRoleSchema.default("USER"),
}).strict();

export const createBundleAgentSpecRequestSchema = z.object({
  artifactKind: bundleAgentArtifactKindSchema.optional(),
  overrides: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const generateBundleAgentVersionRequestSchema = z.object({
  artifactKind: bundleAgentArtifactKindSchema.optional(),
  specId: z.string().uuid().nullable().optional(),
}).strict();
