# HeyGen catalog source of truth

## Contract

Courseforge separates provider availability from organization-local visibility:

- HeyGen's complete private avatar and voice snapshots determine whether a
  provider resource is `AVAILABLE` or `MISSING`.
- `heygen_catalog_exclusions` records whether an organization intentionally
  hides a resource. This decision survives synchronization and row re-creation.
- `archived_at` is the denormalized read model used by catalog queries. The
  archive RPC updates it atomically with the durable exclusion.
- Public provider catalogs are discovery data and are not authoritative account
  inventory. They must never make a private account resource appear available.

Only rows with `ownership = 'private'`, `provider_state = 'AVAILABLE'`, and a
null `archived_at` may be selected for generation.

## Reconciliation behavior

1. Fetch every page of private avatar looks and private voices.
2. Abort absence reconciliation if either catalog is incomplete.
3. Upsert the observed provider resources.
4. Mark previously known private or legacy (`ownership IS NULL`) resources that
   were not observed as `MISSING`; retain the rows for audit and references.
5. Preserve public discovery rows.
6. Reapply active organization exclusions after the upsert.

A physical deletion of a preset row is not a supported visibility operation.
Use the archive endpoint so the exclusion remains durable.

## Rollout

Apply migrations before deploying application code. Migration
`20260920020000_make_heygen_catalog_visibility_durable.sql` is non-destructive:
it backfills existing archives and changes unobserved legacy rows to `MISSING`.
It does not delete provider presets.

After deployment:

1. Run one manual synchronization for each configured organization.
2. Confirm the provider counts match the private HeyGen snapshot.
3. Review the unavailable catalog for the migrated legacy rows.
4. Archive and restore one non-default test preset, synchronize again, and
   verify that its local visibility decision is preserved.

## Rollback considerations

Application reads remain compatible while the migration is pending. The
repository falls back to the previous `archived_at` update if the new archive
RPC is not installed. That compatibility path is not durable against physical
row deletion, so it is only a deployment safeguard, not the target state.

Do not delete `heygen_catalog_exclusions` during rollback. Keeping the table
preserves user visibility decisions for a subsequent redeployment.
