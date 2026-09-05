-- Team level from the master sheet, shown beside every person's name.
ALTER TABLE "employees" ADD COLUMN "level" TEXT;
CREATE INDEX "employees_level_idx" ON "employees"("level");
