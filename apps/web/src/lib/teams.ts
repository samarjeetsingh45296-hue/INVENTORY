/**
 * The teams people are grouped into across the app: the Employees screen's
 * selector, the chips beside names, and the seat map's ownership cards.
 */
export type Team = 'ops' | 'counselor' | 'system' | 'international';

export const TEAM_LABELS: Record<Team, string> = {
  ops: 'Operations Team',
  counselor: 'Counselor',
  system: 'System Team',
  international: 'International',
};

export function teamLabel(team: Team | null): string | null {
  return team ? TEAM_LABELS[team] : null;
}

/** A team id from its label as written on a sheet or a mapping ("Ops Team"). */
export function teamFromLabel(label: string | null | undefined): Team | null {
  const l = (label ?? '').trim().toLowerCase();
  if (!l) return null;
  if (/\bops\b|operation/.test(l)) return 'ops';
  if (/system/.test(l)) return 'system';
  if (/international/.test(l)) return 'international';
  if (/counsel|domestic/.test(l)) return 'counselor';
  return null;
}

/**
 * Which team a person belongs to, from the master-sheet fields the API
 * returns. Departments win over processes; anyone outside the four teams
 * shows their department name so nothing is left blank.
 */
export function teamOf(e: {
  department?: { name: string } | null;
  process?: string | null;
}): { id: Team | null; label: string } | null {
  const dept = e.department?.name?.trim().toLowerCase();
  const proc = e.process?.trim().toLowerCase();
  if (dept === 'ops team') return { id: 'ops', label: TEAM_LABELS.ops };
  if (dept === 'system team') return { id: 'system', label: TEAM_LABELS.system };
  if (proc === 'international') return { id: 'international', label: TEAM_LABELS.international };
  if (proc === 'domestic') return { id: 'counselor', label: TEAM_LABELS.counselor };
  if (e.department?.name) return { id: null, label: e.department.name };
  return null;
}
