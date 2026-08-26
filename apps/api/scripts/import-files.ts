/**
 * Lists the spreadsheet files staged for import and prints the exact command
 * to upload each one.
 *
 * This is a helper, not an importer: the actual work is done by the API, so
 * that uploads go through the same adapters, transforms, validation, dedupe
 * and conflict detection as a live Google Sheet sync. Importing here would
 * mean a second code path that could drift from the real one.
 *
 *   pnpm --filter @inventory/api import:files -- --dir ../../data/raw
 */
import { readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const SPREADSHEET_EXTENSIONS = ['.xlsx', '.xls', '.csv', '.tsv'];

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
}

async function main(): Promise<void> {
  const dir = resolve(getArg('dir', './data/raw'));
  const entity = getArg('entity', 'employee');
  const dryRun = args.includes('--dry-run');

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) =>
      SPREADSHEET_EXTENSIONS.includes(extname(f).toLowerCase()),
    );
  } catch {
    console.error(`Cannot read ${dir}. Create it, or pass --dir <path>.`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const [employees, assets] = await Promise.all([
    prisma.employee.count(),
    prisma.asset.count(),
  ]);
  await prisma.$disconnect();

  console.log(`Database currently holds ${employees} employees and ${assets} assets.`);
  console.log('');

  if (files.length === 0) {
    console.log(`No spreadsheet files in ${dir}`);
    console.log('Download each Google Sheet tab as .xlsx or .csv and put them there.');
    return;
  }

  console.log(`${files.length} file(s) found in ${dir}:`);
  for (const f of files) console.log(`  - ${f}`);
  console.log('');
  console.log('Upload each one with the API running and a Super Admin token in $TOKEN.');
  console.log('Nothing is written until the column mapping for that source is saved.');
  console.log('');

  const base = 'http://localhost:4000/api/v1/sync/upload';
  for (const f of files) {
    const parts = [
      'curl -X POST',
      `-H "Authorization: Bearer $TOKEN"`,
      `-F "file=@${join(dir, f)}"`,
      `-F "targetEntity=${entity}"`,
      `-F "dryRun=${dryRun}"`,
      base,
    ];
    console.log(`  ${parts.join(' ')}`);
  }

  console.log('');
  console.log('The Sheet Sync screen in the web app does the same thing, with a');
  console.log('column-mapping step and a preview in front of it.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
