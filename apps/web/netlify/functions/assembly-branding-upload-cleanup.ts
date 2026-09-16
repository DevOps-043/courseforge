import type { Config, Handler } from "@netlify/functions";
import {
  isAbandonedAssemblyUpload,
  parseAssemblyBrandingStoragePath,
  resolveAssemblyCleanupPage,
} from "../../src/domains/production/assembly-branding/assembly-branding-upload";
import {
  createOperationalLogger,
  resolveCorrelationId,
} from "../../src/lib/server/operational-logger";
import { createServiceRoleClient } from "./shared/bootstrap";
import { jsonResponse, methodNotAllowedResponse } from "./shared/http";

export const config: Config = { schedule: "17 * * * *" };

const STORAGE_BUCKET = "production-assets";
const ORGANIZATIONS_PER_RUN = 25;
const STORAGE_PAGE_SIZE = 100;
const MAX_STORAGE_PAGES_PER_KIND = 5;
const MAX_DELETIONS_PER_RUN = 100;

interface OrganizationRow {
  id: string;
}

interface RegisteredAssetRow {
  storage_path: string;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  if (event.headers["x-nf-event"] !== "schedule") {
    return jsonResponse({ error: "scheduled_invocation_required" }, 401);
  }

  const logger = createOperationalLogger("assembly_branding.upload_cleanup", {
    correlationId: resolveCorrelationId(),
  });
  const admin = createServiceRoleClient();
  const nowMs = Date.now();

  try {
    const { count, error: countError } = await admin
      .from("organizations")
      .select("id", { count: "exact", head: true });
    if (countError) throw countError;

    const page = resolveAssemblyCleanupPage({
      nowMs,
      pageSize: ORGANIZATIONS_PER_RUN,
      totalOrganizations: count || 0,
    });
    if (!page) {
      return jsonResponse({ candidates: 0, deleted: 0, scanned: 0, success: true });
    }

    const { data: organizationData, error: organizationError } = await admin
      .from("organizations")
      .select("id")
      .order("id", { ascending: true })
      .range(page.from, page.to);
    if (organizationError) throw organizationError;

    const organizations = (organizationData || []) as OrganizationRow[];
    let candidates = 0;
    let deleted = 0;
    let failedFolders = 0;
    let scanned = 0;

    for (const organization of organizations) {
      for (const kind of ["INTRO", "OUTRO"] as const) {
        if (deleted >= MAX_DELETIONS_PER_RUN) break;
        const folder = `assembly-branding/${organization.id}/${kind.toLowerCase()}`;

        for (let pageIndex = 0; pageIndex < MAX_STORAGE_PAGES_PER_KIND; pageIndex += 1) {
          const { data: objects, error: listError } = await admin.storage
            .from(STORAGE_BUCKET)
            .list(folder, {
              limit: STORAGE_PAGE_SIZE,
              offset: pageIndex * STORAGE_PAGE_SIZE,
              sortBy: { column: "created_at", order: "asc" },
            });
          if (listError) {
            failedFolders += 1;
            logger.error("assembly_branding.upload_cleanup.list_failed", listError, { folder });
            break;
          }

          const listedObjects = objects || [];
          scanned += listedObjects.length;
          const expiredPaths = listedObjects.flatMap((object) => {
            const path = `${folder}/${object.name}`;
            const pathInfo = parseAssemblyBrandingStoragePath(path, organization.id, kind);
            if (
              !object.id
              || !pathInfo
              || !isAbandonedAssemblyUpload({
                createdAt: object.created_at,
                isRegistered: false,
                nowMs,
              })
            ) {
              return [];
            }
            return [path];
          });
          candidates += expiredPaths.length;

          if (expiredPaths.length > 0) {
            const { data: registeredData, error: registeredError } = await admin
              .from("organization_assembly_assets")
              .select("storage_path")
              .eq("organization_id", organization.id)
              .in("storage_path", expiredPaths);
            if (registeredError) {
              logger.error(
                "assembly_branding.upload_cleanup.registry_lookup_failed",
                registeredError,
                { organizationId: organization.id },
              );
            } else {
              const registeredPaths = new Set(
                ((registeredData || []) as RegisteredAssetRow[]).map((row) => row.storage_path),
              );
              const remainingCapacity = MAX_DELETIONS_PER_RUN - deleted;
              const orphanPaths = expiredPaths
                .filter((path) => !registeredPaths.has(path))
                .slice(0, remainingCapacity);
              if (orphanPaths.length > 0) {
                const { error: removeError } = await admin.storage
                  .from(STORAGE_BUCKET)
                  .remove(orphanPaths);
                if (removeError) {
                  logger.error("assembly_branding.upload_cleanup.remove_failed", removeError, {
                    count: orphanPaths.length,
                    organizationId: organization.id,
                  });
                } else {
                  deleted += orphanPaths.length;
                }
              }
            }
          }

          if (listedObjects.length < STORAGE_PAGE_SIZE || deleted >= MAX_DELETIONS_PER_RUN) {
            break;
          }
        }
      }
      if (deleted >= MAX_DELETIONS_PER_RUN) break;
    }

    logger.info("assembly_branding.upload_cleanup.completed", {
      candidates,
      deleted,
      failedFolders,
      organizations: organizations.length,
      pageFrom: page.from,
      pageTo: page.to,
      scanned,
    });
    return jsonResponse({
      candidates,
      deleted,
      failedFolders,
      organizations: organizations.length,
      scanned,
      success: true,
    });
  } catch (error) {
    logger.error("assembly_branding.upload_cleanup.failed", error);
    return jsonResponse({ error: "Assembly branding cleanup failed" }, 500);
  }
};
