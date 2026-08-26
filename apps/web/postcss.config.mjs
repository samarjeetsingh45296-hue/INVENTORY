import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The tailwind config is referenced by absolute path on purpose.
 *
 * Next resolves this PostCSS file relative to the project directory, but the
 * tailwindcss plugin resolves *its* config relative to process.cwd(). Launch
 * the dev server from the repo root - which `next dev apps/web` does - and
 * Tailwind finds no config at the root, silently falls back to its defaults
 * with `content: []`, and emits a stylesheet containing the preflight reset
 * and not one utility class. Nothing errors; the page just renders unstyled.
 */
export default {
  plugins: {
    tailwindcss: { config: join(here, 'tailwind.config.ts') },
    autoprefixer: {},
  },
};
