#!/usr/bin/env node
/**
 * Applies the hand-written SQL in prisma/migrations/manual after Prisma's own
 * migrations have run. These add the guarantees Prisma cannot express:
 * actor foreign keys, append-only triggers on the history tables, and the
 * partial unique indexes that enforce one active allocation per asset.
 *
 * Every file is idempotent, so this is safe to run on every deploy.
 */
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = join(__dirname, '..', 'prisma', 'migrations', 'manual');
const url = process.env.DATABASE_URL;

if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
if (files.length === 0) {
  console.log('No manual migrations found.');
  process.exit(0);
}

const psql = process.env.PSQL_PATH || 'psql';

for (const file of files) {
  process.stdout.write(`Applying ${file} ... `);
  try {
    execFileSync(psql, ['--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-f', join(dir, file), url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    console.log('ok');
  } catch (err) {
    console.log('FAILED');
    console.error(err.stderr ? err.stderr.toString() : err.message);
    console.error(
      `\nCould not run "${psql}". Install the PostgreSQL client tools, or set ` +
        'PSQL_PATH. You can also apply the file by hand:\n' +
        `  psql "$DATABASE_URL" -f ${join(dir, file)}`,
    );
    process.exit(1);
  }
}

console.log(`\n${files.length} manual migration(s) applied.`);
