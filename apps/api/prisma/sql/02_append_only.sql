-- ---------------------------------------------------------------------------
-- Append-only enforcement.
--
-- These tables are the historical record. The application is not trusted to
-- leave them alone - the database refuses UPDATE and DELETE outright, so a
-- bug, a stray script, or a compromised app credential still cannot rewrite
-- history. Only a superuser session that explicitly sets
-- `app.allow_history_rewrite = 'on'` can bypass this (used solely by the
-- documented restore procedure).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deny_history_mutation() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_history_rewrite', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION
    'Table % is append-only: % is not permitted (this is the audit/history trail)',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
  append_only text[] := ARRAY[
    'audit_logs',
    'asset_events',
    'repair_logs',
    'stock_transactions',
    'login_history',
    'sync_rows'
  ];
BEGIN
  FOREACH t IN ARRAY append_only LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_append_only ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_%s_append_only
         BEFORE UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION deny_history_mutation()',
      t, t
    );
  END LOOP;
END $$;
