-- One row per reconciliation pass: workbooks read and applied, database checked.
CREATE TABLE "reconciliation_runs" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "status"          TEXT NOT NULL DEFAULT 'RUNNING',
  "trigger"         TEXT NOT NULL,
  "startedAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "finishedAt"      TIMESTAMPTZ(3),
  "durationMs"      INTEGER,
  "sheetConnected"  BOOLEAN NOT NULL DEFAULT false,
  "sourceNote"      TEXT,
  "cccRunId"        UUID,
  "wingwiseRunId"   UUID,
  "summary"         JSONB NOT NULL DEFAULT '{}',
  "exceptions"      JSONB NOT NULL DEFAULT '{}',
  "errorMessage"    TEXT,
  "triggeredById"   UUID,
  "triggeredByName" TEXT
);
CREATE INDEX "reconciliation_runs_startedAt_idx" ON "reconciliation_runs"("startedAt");
CREATE INDEX "reconciliation_runs_status_idx" ON "reconciliation_runs"("status");
