import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { canonicalHtmlEditingJson } from "./html-editing/html-editing-canonical-json.server";
import { createHtmlPrivateHandoffFiles } from "./composition-html-private-handoff-files.server";
import { HTML_LEGACY_OPERATOR_POLICY as policy, htmlLegacyPreparationSchema, htmlLegacyPreparationLocatorSchema,
  htmlLegacyRegistrationIntentSchema, type HtmlLegacyPreparation, type HtmlLegacyPreparationLocator,
  type HtmlLegacyRegistrationIntent } from "./composition-html-editing-legacy-operator.contract";

const artifactEnvelope = z.object({version: z.literal(1), body: htmlLegacyPreparationSchema, seal: z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const intentEnvelope = z.object({version: z.literal(1), body: htmlLegacyRegistrationIntentSchema, seal: z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export function legacyPreparationLocator(input: HtmlLegacyPreparation) {
  const body = htmlLegacyPreparationSchema.parse(input);
  const metadata = htmlLegacyPreparationSchema.omit({encodedPilot: true}).strip().parse(body);
  return htmlLegacyPreparationLocatorSchema.parse({...metadata,
    preparationSha256: createHash("sha256").update(canonicalHtmlEditingJson(body)).digest("hex")});
}
/** Separate private roots/domains; immutable create-only files with readback.
 * No recovery by overwrite/resume of a partial directory, and no source in the
 * registration intent. OS ACL is an installation prerequisite, not chmod proof. */
export function createHtmlLegacyOperatorHandoff(configuration: {handoffRoot: string; intentRoot: string; integrityKey: Uint8Array}) {
  const key = Buffer.from(configuration.integrityKey); if (key.length !== 32) throw new Error("HTML_LEGACY_HANDOFF_CONFIGURATION_INVALID");
  const artifacts = createHtmlPrivateHandoffFiles(configuration.handoffRoot), intents = createHtmlPrivateHandoffFiles(configuration.intentRoot);
  const seal = (domain: string, body: HtmlLegacyPreparation | HtmlLegacyRegistrationIntent) => createHmac("sha256", key).update(domain).update(canonicalHtmlEditingJson(body)).digest("hex");
  const artifactDomain = "COURSEFORGE_PRIVATE_LEGACY_PREPARATION_V1\n", intentDomain = "COURSEFORGE_PRIVATE_LEGACY_REGISTRATION_INTENT_V1\n";
  const sameSeal = (actual: string, expected: string) => timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  async function readArtifact(candidateId: string, signal?: AbortSignal) {
    const decoded = artifactEnvelope.parse(JSON.parse((await artifacts.read(candidateId, "artifact.json", policy.artifactBytes, signal)).toString("utf8")));
    if (decoded.body.candidateId !== candidateId || !sameSeal(decoded.seal, seal(artifactDomain, decoded.body))) throw new Error();
    return decoded.body;
  }
  async function readIntent(candidateId: string, signal?: AbortSignal) {
    const decoded = intentEnvelope.parse(JSON.parse((await intents.read(candidateId, "review-intent.json", policy.intentBytes, signal)).toString("utf8")));
    if (decoded.body.locator.candidateId !== candidateId || !sameSeal(decoded.seal, seal(intentDomain, decoded.body))) throw new Error();
    return decoded.body;
  }
  return {
    async save(input: HtmlLegacyPreparation, signal?: AbortSignal) {
      try {
        const body = htmlLegacyPreparationSchema.parse(input), bytes = Buffer.from(JSON.stringify({version: 1, body, seal: seal(artifactDomain, body)}));
        if (bytes.length > policy.artifactBytes) throw new Error();
        await artifacts.create(body.candidateId, signal); await artifacts.write(body.candidateId, "artifact.json", bytes, signal);
        const checked = await readArtifact(body.candidateId, signal); if (!isDeepStrictEqual(body, checked)) throw new Error();
        return legacyPreparationLocator(checked);
      } catch {signal?.throwIfAborted(); throw new Error("HTML_LEGACY_PREPARATION_UNCONFIRMED");}
    },
    async read(locatorInput: HtmlLegacyPreparationLocator, signal?: AbortSignal) {
      try {
        const locator = htmlLegacyPreparationLocatorSchema.parse(locatorInput), body = await readArtifact(locator.candidateId, signal);
        if (!isDeepStrictEqual(locator, legacyPreparationLocator(body))) throw new Error();
        return body;
      } catch {signal?.throwIfAborted(); throw new Error("HTML_LEGACY_PREPARATION_UNAVAILABLE");}
    },
    async readCandidate(candidateId: string, signal?: AbortSignal) {
      try {return await readArtifact(z.string().uuid().parse(candidateId), signal);}
      catch {signal?.throwIfAborted(); throw new Error("HTML_LEGACY_PREPARATION_UNAVAILABLE");}
    },
    async preserveRegistration(input: HtmlLegacyRegistrationIntent, signal?: AbortSignal) {
      try {
        const body = htmlLegacyRegistrationIntentSchema.parse(input), bytes = Buffer.from(JSON.stringify({version: 1, body, seal: seal(intentDomain, body)}));
        if (bytes.length > policy.intentBytes) throw new Error();
        await intents.create(body.locator.candidateId, signal); await intents.write(body.locator.candidateId, "review-intent.json", bytes, signal);
        const checked = await readIntent(body.locator.candidateId, signal); if (!isDeepStrictEqual(body, checked)) throw new Error();
        return checked;
      } catch {signal?.throwIfAborted(); throw new Error("HTML_LEGACY_REGISTRATION_INTENT_UNCONFIRMED");}
    },
    async readRegistrationIntent(candidateId: string, signal?: AbortSignal) {
      try {return await readIntent(z.string().uuid().parse(candidateId), signal);}
      catch {signal?.throwIfAborted(); throw new Error("HTML_LEGACY_REGISTRATION_INTENT_UNAVAILABLE");}
    },
  };
}
