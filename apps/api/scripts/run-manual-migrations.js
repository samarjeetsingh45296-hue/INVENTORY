#!/usr/bin/env node
/**
 * Applies the hand-written SQL in prisma/sql after Prisma's own
 * migrations have run. These add the guarantees Prisma cannot express:
 * actor foreign keys, append-only triggers on the history tables, and the
 * partial unique indexes that enforce one active allocation per asset.
 *
 * Every file is idempotent, so this is safe to run on every deploy.
 */
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = join(__dirname, '..', 'prisma', 'sql');
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

/**
 * Prisma's DATABASE_URL carries parameters psql does not understand -
 * `schema`, `connection_limit`, `pgbouncer` and friends - and psql fails with
 * "invalid URI query parameter" rather than ignoring them. Strip anything psql
 * cannot read, and translate a non-public `schema` into a search_path instead
 * of silently dropping it.
 */
function toPsqlUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const PSQL_SAFE = new Set([
    'sslmode', 'sslcert', 'sslkey', 'sslrootcert',
    'connect_timeout', 'application_name', 'options',
  ]);

  let schema = null;
  for (const key of [...parsed.searchParams.keys()]) {
    if (key === 'schema') schema = parsed.searchParams.get(key);
    if (!PSQL_SAFE.has(key)) parsed.searchParams.delete(key);
  }
  return { url: parsed.toString(), schema };
}

const { url: psqlUrl, schema } = toPsqlUrl(url);
const childEnv = { ...process.env };
if (schema && schema !== 'public') {
  childEnv.PGOPTIONS = `${childEnv.PGOPTIONS || ''} -c search_path=${schema}`.trim();
}

for (const file of files) {
  process.stdout.write(`Applying ${file} ... `);
  try {
    execFileSync(
      psql,
      ['--quiet', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-f', join(dir, file), psqlUrl],
      { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv },
    );
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
