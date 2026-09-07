/**
 * Importer for the Central Contact Center inventory workbook, by hand.
 *
 *   pnpm --filter @inventory/api import:ccc -- --file "C:\path\to\file.xlsx" [--dry-run]
 *
 * The reconciliation service runs the same import on its own four times a
 * day (from Google when connected). The logic lives in
 * src/modules/reconcile/importers/ccc.ts.
 */
import './load-env';
import { PrismaClient } from '@prisma/client';
import { fileSource } from '../src/modules/reconcile/sheet-source';
import { runCccImport } from '../src/modules/reconcile/importers/ccc';

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const file = arg('file');
if (!file) {
  console.error('Usage: import:ccc -- --file "C:\\path\\to\\workbook.xlsx" [--dry-run]');
  process.exit(1);
}

const prisma = new PrismaClient();
runCccImport(prisma, fileSource(file), {
  dry: process.argv.includes('--dry-run'),
  triggeredBy: 'CCC importer (CLI)',
  log: (l) => console.log(l),
})
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
