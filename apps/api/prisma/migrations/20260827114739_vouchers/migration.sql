-- PVR movie cards and anything like them.
--
-- One row is one card. "voucherNo" is NOT unique on purpose: a book of ten
-- cards carries the same printed number on all ten, and the source sheet
-- records them as ten separate lines. Identity is the book number plus the
-- position within it.

CREATE TYPE "VoucherStatus" AS ENUM ('AVAILABLE', 'ISSUED', 'REDEEMED', 'EXPIRED', 'VOID', 'LOST');

CREATE TABLE "vouchers" (
    "id"                 UUID          NOT NULL DEFAULT gen_random_uuid(),
    "branchId"           UUID          NOT NULL,
    "kind"               TEXT          NOT NULL DEFAULT 'PVR_MOVIE',
    "voucherNo"          TEXT          NOT NULL,
    "serialNo"           INTEGER,
    "faceValue"          DECIMAL(10,2),
    "receivedAt"         DATE,
    "status"             "VoucherStatus" NOT NULL DEFAULT 'AVAILABLE',
    "issuedToEmployeeId" UUID,
    "issuedToName"       TEXT,
    "issuedByName"       TEXT,
    "issuedAt"           DATE,
    "purpose"            TEXT,
    "notes"              TEXT,
    "sourceType"         "SourceType"  NOT NULL DEFAULT 'MANUAL',
    "sourceRef"          TEXT,
    "isActive"           BOOLEAN       NOT NULL DEFAULT true,
    "createdAt"          TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMPTZ(3) NOT NULL,
    "deletedAt"          TIMESTAMPTZ(3),
    "createdById"        UUID,
    "updatedById"        UUID,
    "deletedById"        UUID,

    CONSTRAINT "vouchers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vouchers_voucherNo_idx"          ON "vouchers"("voucherNo");
CREATE INDEX "vouchers_status_idx"             ON "vouchers"("status");
CREATE INDEX "vouchers_issuedToEmployeeId_idx" ON "vouchers"("issuedToEmployeeId");
CREATE INDEX "vouchers_deletedAt_idx"          ON "vouchers"("deletedAt");

ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_issuedToEmployeeId_fkey"
    FOREIGN KEY ("issuedToEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
