import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScormManifest } from "../types";
import {
  SCORM_IMPORT_STATUS,
  SCORM_PROCESSING_STEP,
} from "../scorm-job-contracts";
import {
  claimScormImportJob,
  heartbeatScormImportJob,
} from "./scorm-job.repository";
import { ScormParserService } from "./scorm-parser.service";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";

const MAX_SCORM_PACKAGE_BYTES = 100 * 1024 * 1024;

interface ScormParsingRecord {
  correlation_id: string | null;
  id: string;
  processing_step: string | null;
  status: string;
  storage_path: string;
}

export class ScormParsingService {
  constructor(private readonly supabase: SupabaseClient) {}

  async processImport(importId: string, organizationId: string) {
    const claimed = await claimScormImportJob<ScormParsingRecord>(this.supabase, {
      importId,
      organizationId,
      queuedStep: SCORM_PROCESSING_STEP.parseQueued,
      runningStep: SCORM_PROCESSING_STEP.parseRunning,
      status: SCORM_IMPORT_STATUS.parsing,
    });
    if (!claimed) return { analyzed: false, alreadyProcessing: true };
    const logger = createOperationalLogger("scorm.parsing", {
      correlationId: resolveCorrelationId(claimed.correlation_id),
      importId,
      organizationId,
    });
    const startedAt = Date.now();
    logger.info("scorm.parsing.started");

    try {
      const { data: packageBlob, error: downloadError } = await this.supabase.storage
        .from("scorm-packages")
        .download(claimed.storage_path);
      if (downloadError || !packageBlob) throw new Error("SCORM_PACKAGE_DOWNLOAD_FAILED");
      if (packageBlob.size <= 0 || packageBlob.size > MAX_SCORM_PACKAGE_BYTES) {
        throw new Error("SCORM_PACKAGE_SIZE_INVALID");
      }

      await heartbeatScormImportJob(this.supabase, {
        importId,
        organizationId,
        runningStep: SCORM_PROCESSING_STEP.parseRunning,
        status: SCORM_IMPORT_STATUS.parsing,
      });

      const manifest = await new ScormParserService().parsePackage(
        Buffer.from(await packageBlob.arrayBuffer()),
      );
      await this.persistManifest(importId, organizationId, manifest);
      logger.info("scorm.parsing.completed", {
        durationMs: Date.now() - startedAt,
        resourceCount: manifest.resources.length,
      });
      return { analyzed: true };
    } catch (error) {
      logger.error("scorm.parsing.failed", error, { durationMs: Date.now() - startedAt });
      const { error: failureWriteError } = await this.supabase
        .from("scorm_imports")
        .update({
          error_message: "El paquete SCORM no pudo analizarse.",
          lease_expires_at: null,
          processing_heartbeat_at: null,
          processing_step: "FAILED",
          status: SCORM_IMPORT_STATUS.failed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", importId)
        .eq("organization_id", organizationId)
        .eq("status", SCORM_IMPORT_STATUS.parsing)
        .eq("processing_step", SCORM_PROCESSING_STEP.parseRunning);
      if (failureWriteError) {
        logger.error("scorm.parsing.failure_state.persist_failed", failureWriteError);
      }
      throw new Error("SCORM_PARSING_FAILED");
    }
  }

  private async persistManifest(
    importId: string,
    organizationId: string,
    manifest: ScormManifest,
  ) {
    const { data, error } = await this.supabase
      .from("scorm_imports")
      .update({
        error_message: null,
        lease_expires_at: null,
        manifest_raw: manifest,
        organizations: manifest.organizations,
        processing_heartbeat_at: null,
        processing_step: SCORM_PROCESSING_STEP.parseCompleted,
        resources: manifest.resources,
        sco_count: manifest.resources.filter((resource) => resource.type === "sco").length,
        scorm_version: manifest.version,
        status: SCORM_IMPORT_STATUS.analyzed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", importId)
      .eq("organization_id", organizationId)
      .eq("status", SCORM_IMPORT_STATUS.parsing)
      .eq("processing_step", SCORM_PROCESSING_STEP.parseRunning)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      throw new Error(`SCORM_MANIFEST_PERSIST_FAILED${error ? `: ${error.message}` : ""}`);
    }
  }
}
