-- The Repair tab's BDE Name and Department, kept on the ticket as written.
ALTER TABLE "repair_tickets" ADD COLUMN "reporterName" TEXT;
ALTER TABLE "repair_tickets" ADD COLUMN "department" TEXT;
