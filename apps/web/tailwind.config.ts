import type { Config } from 'tailwindcss';
import { join } from 'node:path';

/**
 * Content globs are absolute, anchored to this file.
 *
 * Tailwind resolves relative globs against process.cwd(), not against the
 * config file. Starting the dev server from the repo root - which is what
 * `next dev apps/web` does - therefore made './src/**' resolve to
 * <repo>/src/**, matched nothing, and silently emitted a stylesheet with the
 * preflight reset but not one utility class. Anchoring to __dirname makes the
 * build independent of where it was launched from.
 */
const fromHere = (glob: string): string => join(__dirname, glob);

export default {
  content: [
    fromHere('src/**/*.{ts,tsx}'),
    fromHere('src/app/**/*.{ts,tsx}'),
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff', 100: '#d9e5ff', 200: '#bcd0ff', 300: '#8eb1ff',
          400: '#5987ff', 500: '#345eff', 600: '#1d3df5', 700: '#172ee1',
          800: '#1929b6', 900: '#1c298f',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
