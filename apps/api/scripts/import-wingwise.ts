/**
 * Importer for the Wing Wise workstation workbook, by hand.
 *
 *   pnpm --filter @inventory/api import:wingwise -- --file "C:\path\file.xlsx" [--dry-run]
 *
 * The reconciliation service runs the same import on its own four times a
 * day (from Google when connected). The logic lives in
 * src/modules/reconcile/importers/wingwise.ts.
 */
import './load-env';
import { PrismaClient } from '@prisma/client';
import { fileSource } from '../src/modules/reconcile/sheet-source';
import { runWingwiseImport } from '../src/modules/reconcile/importers/wingwise';

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const file = arg('file');
if (!file) {
  console.error('Usage: import:wingwise -- --file "C:\\path\\workbook.xlsx" [--dry-run]');
  process.exit(1);
}

const prisma = new PrismaClient();
runWingwiseImport(prisma, fileSource(file), {
  dry: process.argv.includes('--dry-run'),
  triggeredBy: 'Wing Wise importer (CLI)',
  log: (l) => console.log(l),
})
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
