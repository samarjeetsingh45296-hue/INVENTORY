'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';

/** Small square toggle that flips between the light and dark palettes. */
export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      className="btn-icon btn-ghost"
      title={`Switch to ${next} theme`}
      aria-label={`Switch to ${next} theme`}
    >
      {resolved === 'dark' ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
    </button>
  );
}
