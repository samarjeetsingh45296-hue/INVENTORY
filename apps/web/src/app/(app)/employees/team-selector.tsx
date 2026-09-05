'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Headset, MessagesSquare } from 'lucide-react';

/** The two teams the Employees screen is split into. */
export type Team = 'ops' | 'counselor';

export const TEAMS: Array<{
  id: Team;
  label: string;
  hint: string;
  Icon: typeof Headset;
}> = [
  { id: 'ops', label: 'Operations Team', hint: 'Ops Team department', Icon: Headset },
  { id: 'counselor', label: 'Counselor', hint: 'Domestic and International', Icon: MessagesSquare },
];

export function teamLabel(team: Team | null) {
  return TEAMS.find((t) => t.id === team)?.label ?? null;
}

interface Props {
  value: Team | null;
  /** Live headcount per team, shown at the right of each option. */
  counts?: Partial<Record<Team, number>>;
  onChange: (team: Team) => void;
}

/**
 * A pill that morphs into a floating dark panel.
 *
 * Arrives from the left of the section (scale 0.95, a few px low, faded)
 * and opens by itself when nothing is chosen yet. A soft pill slides
 * between options as the pointer moves; choosing one folds the panel back
 * into the pill, which then names the team and reopens on click.
 */
export function TeamSelector({ value, counts, onChange }: Props) {
  const [open, setOpen] = useState(value === null);
  const [hover, setHover] = useState<Team | null>(null);
  const [pill, setPill] = useState<{ top: number; height: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Nothing chosen yet (fresh visit, or the URL lost its team) -> open.
  useEffect(() => {
    if (value === null) setOpen(true);
  }, [value]);

  // The pill sits under the hovered option, else the chosen one.
  const target = hover ?? value;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !open || !target) { setPill(null); return; }
    const el = list.querySelector<HTMLElement>(`[data-team="${target}"]`);
    if (!el) { setPill(null); return; }
    setPill({ top: el.offsetTop, height: el.offsetHeight });
  }, [target, open]);

  // Click-away and Escape close it, but only once a team exists to fall back to.
  useEffect(() => {
    if (!open || value === null) return;
    const away = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open, value]);

  const chosen = TEAMS.find((t) => t.id === value);

  return (
    <div ref={rootRef} className="es-root" data-open={open || undefined}>
      <div className="es-morph">
        {/* Closed face: the pill */}
        <button
          type="button"
          className="es-pill"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          tabIndex={open ? -1 : 0}
        >
          {chosen ? (
            <>
              <Check size={14} className="es-pill-check" />
              <span>{chosen.label}</span>
            </>
          ) : (
            <span>Choose a team</span>
          )}
          <ChevronDown size={14} className="es-pill-chev" />
        </button>

        {/* Open face: the menu */}
        <div className="es-menu" aria-hidden={!open}>
          <div className="es-head">
            <span>Show employees from</span>
          </div>
          <div
            ref={listRef}
            className="es-list"
            role="listbox"
            aria-label="Team"
            onMouseLeave={() => setHover(null)}
          >
            {pill && (
              <span
                className="es-hover"
                data-pick={target === value || undefined}
                style={{ top: pill.top, height: pill.height }}
              />
            )}
            {TEAMS.map(({ id, label, hint, Icon }, i) => (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={value === id}
                data-team={id}
                className="es-item"
                style={{ '--i': i } as React.CSSProperties}
                tabIndex={open ? 0 : -1}
                onMouseEnter={() => setHover(id)}
                onFocus={() => setHover(id)}
                onClick={() => {
                  onChange(id);
                  setHover(null);
                  setOpen(false);
                }}
              >
                <Icon size={16} className="es-ico" />
                <span className="es-text">
                  <span className="es-label">{label}</span>
                  <span className="es-hint">{hint}</span>
                </span>
                <span className="es-count">
                  {counts?.[id] ?? ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
