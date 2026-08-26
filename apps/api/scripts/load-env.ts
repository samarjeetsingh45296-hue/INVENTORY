/**
 * Minimal .env loader for the standalone scripts.
 *
 * The API itself gets its configuration through Nest's ConfigModule, but the
 * CLI scripts run outside Nest and still need DATABASE_URL. dotenv is not a
 * dependency of this package under pnpm's strict node_modules layout, and one
 * small parser is preferable to adding a dependency for three scripts.
 *
 * Import it for the side effect, before anything that reads process.env:
 *   import './load-env';
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Nearest first: the package's own .env wins over the workspace root, which is
// what a container deployment expects.
const CANDIDATES = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../.env'),
  resolve(process.cwd(), '../../.env'),
  resolve(__dirname, '../.env'),
  resolve(__dirname, '../../../.env'),
];

function parse(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Strip one matching pair of surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let loadedFrom: string | null = null;

for (const path of CANDIDATES) {
  if (!existsSync(path)) continue;
  const vars = parse(readFileSync(path, 'utf8'));
  for (const [k, v] of Object.entries(vars)) {
    // A real environment variable always beats the file.
    if (process.env[k] === undefined) process.env[k] = v;
  }
  loadedFrom = path;
  break;
}

if (!loadedFrom && !process.env.DATABASE_URL) {
  console.error(
    'No .env found and DATABASE_URL is not set.\n' +
      'Copy .env.example to .env at the repository root and fill it in.',
  );
  process.exit(1);
}

export { loadedFrom };
