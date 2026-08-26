-- Trigram indexes powering the "search anything" box. Created concurrently in
-- production so they do not lock the tables.
CREATE INDEX IF NOT EXISTS idx_assets_tag_trgm      ON assets    USING gin ("assetTag" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_serial_trgm   ON assets    USING gin ("serialNumber" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_model_trgm    ON assets    USING gin ("model" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_employees_name_trgm  ON employees USING gin ("fullName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_employees_code_trgm  ON employees USING gin ("employeeCode" gin_trgm_ops);

-- Partial indexes: the hot path is always "rows that are not deleted".
CREATE INDEX IF NOT EXISTS idx_assets_live     ON assets    (status, "categoryId") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS idx_employees_live  ON employees ("branchId")           WHERE "deletedAt" IS NULL;

-- One asset can only have one ACTIVE allocation at a time. Enforced by the
-- database rather than by application discipline alone.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_allocation_per_asset
  ON asset_allocations ("assetId")
  WHERE status = 'ACTIVE' AND "deletedAt" IS NULL;

-- Same rule for lockers and CUG numbers.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_locker_allocation
  ON locker_allocations ("lockerId") WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_cug_allocation
  ON cug_allocations ("connectionId") WHERE status = 'ACTIVE';
