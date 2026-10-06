import type { SupabaseClient } from "@supabase/supabase-js";
import { publishCompositionHtmlEditingSnapshot } from "./composition-html-editing-snapshot-publication.server";
import { createHtmlEditingSnapshotArchiveStore } from "./composition-html-editing-snapshot-storage.server";
import { createHtmlEditingSnapshotRepository } from "./composition-html-editing-snapshot-repository.server";
import { createHtmlSnapshotIntentRepository } from "./composition-html-editing-snapshot-intent.server";
import { createHtmlSnapshotRecoveryService } from "./composition-html-editing-snapshot-recovery.server";
import { readCompositionHtmlEditingSnapshot } from "./composition-html-editing-reader.service";
import { readHtmlSnapshotNativeMedia } from "./composition-html-editing-snapshot-media.server";
import { createHtmlSnapshotFontAcquirer } from "./composition-html-editing-snapshot-fonts.server";

type Publication = Omit<Parameters<typeof publishCompositionHtmlEditingSnapshot>[0],"supabase" | "ports">;

/** Explicit server composition, NOT an enabled route. Authentication must
 * supply actor/org. publish accepts independently authorized resources;
 * publishAuthorized acquires native media/fonts from the exact saved document.
 * Recovery is read-only and never rebuilds a ZIP or supplies execution rights. */
export function createHtmlEditingSnapshotHost(configuration:{supabase:SupabaseClient;
  supabaseUrl:string;serviceRoleKey:string;fetchImpl?:typeof fetch}) {
  const intents = createHtmlSnapshotIntentRepository(configuration.supabase);
  const ports = {recordPublicationIntent:intents.recordPublicationIntent,
    storeImmutableArchive:createHtmlEditingSnapshotArchiveStore(configuration),
    commitSnapshotAtomically:createHtmlEditingSnapshotRepository(configuration.supabase)};
  const publish = (input:Publication) => publishCompositionHtmlEditingSnapshot({...input,supabase:configuration.supabase,ports});
  const recover = createHtmlSnapshotRecoveryService(configuration.supabase);
  const acquireFonts = createHtmlSnapshotFontAcquirer(configuration);
  // Server-derived resources only. No request-supplied manifest/font bytes/URLs.
  // Trusted caller authenticates actor/org and supplies pinned runtime settings;
  // intent/commit revalidate latest native state, CAS and current permissions.
  const publishAuthorized = async (input:Omit<Publication,"otherAssets" | "packagedFonts" | "deckPublicUrls">) => {
    const snapshot = await readCompositionHtmlEditingSnapshot({...input,supabase:configuration.supabase});
    const media = await readHtmlSnapshotNativeMedia({supabase:configuration.supabase,organizationId:input.organizationId,
      draftId:input.documentId,document:snapshot.document,signal:input.signal});
    const packagedFonts = await acquireFonts({document:snapshot.document,organizationId:input.organizationId,signal:input.signal});
    return publish({...input,otherAssets:media.assets,deckPublicUrls:media.deckPublicUrls,packagedFonts});
  };
  return {publish,publishAuthorized,recover};
}
