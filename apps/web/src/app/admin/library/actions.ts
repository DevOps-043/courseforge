'use server';

import { createClient } from '@/utils/supabase/server';
import { getAuthBridgeUser } from '@/utils/auth/session';
import { getErrorMessage } from '@/lib/errors';
import { resolveActiveTenantContext } from '@/lib/server/tenant-context';
import { searchLibrary } from '@/domains/library/library-search.service';
import type {
    LibraryAssetType,
    LibraryContentCategory,
    LibrarySearchFilters,
    LibrarySearchResult,
} from '@/domains/library/types';
import type { ComponentType, ProductionStatus } from '@/domains/materials/types/materials.types';

export type MaterialSearchResult = LibrarySearchResult;
export type SearchFilters = LibrarySearchFilters & {
    assetPresence?: never;
    type?: ComponentType | 'ALL';
};

const VALID_CATEGORIES = new Set<LibraryContentCategory>(['ALL', 'MATERIALS', 'ASSETS']);
const VALID_ASSET_TYPES = new Set<LibraryAssetType>([
    'ALL',
    'voice',
    'music',
    'broll',
    'avatar',
    'slides',
    'video_final',
    'screencast',
]);
const VALID_COMPONENT_TYPES = new Set<ComponentType | 'ALL'>([
    'ALL',
    'DIALOGUE',
    'READING',
    'QUIZ',
    'DEMO_GUIDE',
    'EXERCISE',
    'VIDEO_THEORETICAL',
    'VIDEO_DEMO',
    'VIDEO_GUIDE',
]);
const VALID_STATUSES = new Set<ProductionStatus | 'ALL'>([
    'ALL',
    'PENDING',
    'IN_PROGRESS',
    'DECK_READY',
    'EXPORTED',
    'COMPLETED',
]);

async function ensureAuthorizedLibraryAccess(
    supabase: Awaited<ReturnType<typeof createClient>>,
) {
    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (user) {
        return true;
    }

    const bridgeUser = await getAuthBridgeUser();
    return Boolean(bridgeUser);
}

function sanitizeFilters(filters: SearchFilters): LibrarySearchFilters {
    const category = VALID_CATEGORIES.has(filters.category || 'ALL') ? filters.category : 'ALL';
    const assetType = VALID_ASSET_TYPES.has(filters.assetType || 'ALL') ? filters.assetType : 'ALL';
    const componentTypeCandidate = filters.componentType || filters.type || 'ALL';
    const componentType = VALID_COMPONENT_TYPES.has(componentTypeCandidate)
        ? componentTypeCandidate
        : 'ALL';
    const status = VALID_STATUSES.has(filters.status || 'ALL') ? filters.status : 'ALL';

    return {
        assetType,
        category,
        componentType,
        page: filters.page,
        pageSize: filters.pageSize,
        status,
    };
}

export async function searchMaterialsAction(query: string, filters: SearchFilters = {}) {
    const supabase = await createClient();
    const hasAccess = await ensureAuthorizedLibraryAccess(supabase);
    if (!hasAccess) {
        return { success: false, error: 'Unauthorized' };
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant?.organizationId) {
        return { success: false, error: 'Empresa no valida o no autorizada.' };
    }

    try {
        const response = await searchLibrary({
            filters: sanitizeFilters(filters),
            organizationId: tenant.organizationId,
            organizationName: tenant.organizationSlug || 'Empresa activa',
            query: query?.trim() || '',
            supabase,
        });

        return { success: true, ...response };
    } catch (error: unknown) {
        console.error('[Library] Search exception:', error);
        return { success: false, error: getErrorMessage(error) };
    }
}
