// Fixtures sintéticos: observado actual y aceptación futura se mantienen separados.
const own = { id: 'org-propia', slug: 'empresa', role: 'member' };
export const tenantFixtures = [
  { id: 'cookie-owner-sin-rol', ids: ['org-propia'], cookie: [{ ...own, role: 'owner' }], storedRole: null, expectedCurrentRole: 'ADMIN', safeRole: null },
  { id: 'claims-vacios-cookie-ajena', ids: [], cookie: [{ id: 'org-ajena', slug: 'otra', role: 'owner' }], storedRole: null, expectedCurrentRole: 'ADMIN', safeRole: null },
  { id: 'rol-ausente-cookie-member', ids: ['org-propia'], cookie: [own], storedRole: null, expectedCurrentRole: 'CONSTRUCTOR', safeRole: null },
  { id: 'rol-desconocido', ids: ['org-propia'], cookie: [{ ...own, role: 'owner' }], storedRole: 'DESCONOCIDO', expectedCurrentRole: 'ADMIN', safeRole: null },
  { id: 'autoridad-rol-caida', ids: ['org-propia'], cookie: [own], storedRole: null, lookupError: true, expectedError: 'TENANT_LOOKUP_UNAVAILABLE' },
  { id: 'usuario-valido-cookie-manipulada', ids: ['org-propia'], cookie: [{ ...own, role: 'owner' }], storedRole: 'CONSTRUCTOR', expectedCurrentRole: 'CONSTRUCTOR', safeRole: 'CONSTRUCTOR' },
  { id: 'sin-identidad', noUser: true, ids: [], cookie: [own], storedRole: 'ADMIN', expectedCurrentRole: null, safeRole: null },
];

// Requieren el adaptador de membresía vigente de F1.2; no se simula su implementación.
export const pendingMembershipFixtures = [
  { id: 'revocada-con-claim-y-rol-local', signedIds: ['org-propia'], authorityMembership: null, localRole: 'ADMIN', safeResult: 'forbidden' },
  { id: 'legacy-sin-claim-con-autoridad', signedIds: [], authorityMembership: { ...own, status: 'active' }, localRole: 'CONSTRUCTOR', safeResult: 'CONSTRUCTOR' },
  { id: 'autoridad-membresia-caida', signedIds: ['org-propia'], authorityError: true, safeResult: 'TENANT_LOOKUP_UNAVAILABLE' },
  { id: 'membresia-invitada', signedIds: ['org-propia'], authorityMembership: { ...own, status: 'invited' }, localRole: 'ADMIN', safeResult: 'forbidden' },
];
