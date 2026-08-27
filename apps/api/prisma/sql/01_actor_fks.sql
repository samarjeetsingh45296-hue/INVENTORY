-- ---------------------------------------------------------------------------
-- Referential integrity for the actor columns that are deliberately not
-- modelled as Prisma relations (see the note at the top of schema.prisma).
--
-- ON DELETE SET NULL is wrong here and ON DELETE CASCADE is dangerous, so we
-- use RESTRICT: a user row can never be hard-deleted while it is still
-- referenced by history. Users are soft-deleted anyway.
--
-- Run after every `prisma migrate deploy`:
--   psql "$DATABASE_URL" -f prisma/sql/01_actor_fks.sql
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t   text;
  col text;
  tables text[] := ARRAY[
    'organizations','branches','locations','departments','designations',
    'employees','users','roles','asset_categories','vendors','purchase_orders',
    'assets','asset_allocations','repair_tickets','damage_reports',
    'workstations','workstation_allocations','lockers','locker_allocations',
    'cug_connections','cug_allocations','stock_items','asset_requests',
    'physical_audits','sync_sources','sync_runs','backup_runs','vouchers'
  ];
  cols text[] := ARRAY['createdById','updatedById','deletedById'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    FOREACH col IN ARRAY cols LOOP
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = t AND column_name = col
      ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = format('fk_%s_%s', t, lower(col))
      ) THEN
        EXECUTE format(
          'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES users(id) ON DELETE RESTRICT',
          t, format('fk_%s_%s', t, lower(col)), col
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;
