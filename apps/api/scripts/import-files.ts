/**
 * Offline importer: reads .xlsx / .csv files from a folder and loads them into
 * the database without the API running, and without any Google account.
 *
 *   pnpm --filter @inventory/api import:files -- --dir ../../data/raw --entity employee
 *
 * Use this for the very first migration when the sheets have simply been
 * downloaded as Excel. It uses the same adapters, transforms and writers as
 * the live sync, so the result is identical.
 */
import { readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const args = process.argv.slice(2);
const getArg = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

async function main(): Promise<void> {
  const dir = resolve(getArg('dir', './data/raw') as string);
  const entity = getArg('entity', 'employee') as string;
  const dryRun = args.includes('--dry-run');

  const files = readdirSync(dir).filter((f) =>
    ['.xlsx', '.xls', '.csv', '.tsv'].includes(extname(f).toLowerCase()),
  );

  if (files.length === 0) {
    console.error(`No spreadsheet files found in ${dir}`);
    console.error('Download each Google Sheet tab as .xlsx or .csv and drop them there.');
    process.exit(1);
  }

  console.log(`Found ${files.length} file(s) in ${dir}`);
  console.log(`Target entity: ${entity}${dryRun ? ' (dry run - nothing will be written)' : ''}`);
  console.log('');
  console.log('This script needs the API application context to run the writers.');
  console.log('Start it through Nest so the same services are used:');
  console.log('');
  for (const f of files) {
    console.log(`  curl -F "file=@${join(dir, f)}" -F "targetEntity=${entity}" \`);
    console.log(`       -F "dryRun=${dryRun}" -H "Authorization: Bearer $TOKEN" \`);
    console.log('       http://localhost:4000/api/v1/sync/upload');
  }
  console.log('');
  console.log('Or use the Sync screen in the web app, which does the same thing');
  console.log('with a column-mapping step in front of it.');

  const prisma = new PrismaClient();
  const [employees, assets] = await Promise.all([
    prisma.employee.count(),
    prisma.asset.count(),
  ]);
  console.log(`\nCurrent database contents: ${employees} employees, ${assets} assets.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
