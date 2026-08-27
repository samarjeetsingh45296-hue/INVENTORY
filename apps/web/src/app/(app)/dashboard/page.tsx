'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Boxes, Users, Armchair, Smartphone, KeyRound, Wrench, type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRealtime } from '@/hooks/use-realtime';
import { PageHeader, ErrorNote } from '@/components/ui';

interface Kpis {
  totals: {
    assets: number; employees: number; workstations: number;
    cug: number; lockers: number; repairs: number; allocations: number;
  };
  assets: {
    byStatus: Array<{ status: string; count: number }>;
    byCategory: Array<{ name: string; count: number }>;
    allocated: number; inStock: number; inRepair: number; utilisationPct: number;
  };
  workstations: {
    total: number; complete: number; withGaps: number; completionPct: number;
    byWing: Array<{ wing: string; complete: number; gaps: number; total: number }>;
    missingByItem: Array<{ item: string; count: number }>;
  };
  utilisation: {
    cug: { total: number; allocated: number; available: number; pct: number };
    lockers: { total: number; held: number; free: number; pct: number };
  };
  repairs: {
    total: number; open: number; closed: number; spend: number;
    recoveredFromEmployees: number;
    byStatus: Array<{ status: string; count: number }>;
  };
  dataQuality: {
    employeesNeedingMisNumber: number;
    employeesWithEquipment: number;
    employeesWithoutEquipment: number;
    unassignedAssets: number;
    archivedAssets: number;
    duplicateLockerKeys: number;
  };
}

/* ------------------------------------------------------------ primitives -- */

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'rgb(var(--text))',
  ok: 'rgb(var(--ok))',
  warn: 'rgb(var(--warn))',
  bad: 'rgb(var(--bad))',
  info: 'rgb(var(--info))',
};

/** Icon in a soft tile - gives every card an anchor for the eye. */
function IconTile({ icon: Icon, tone = 'neutral' }: { icon: LucideIcon; tone?: Tone }) {
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg
                 bg-[rgb(var(--surface-3))] ring-1 ring-[rgb(var(--border))]"
      style={tone !== 'neutral' ? { color: TONE_TEXT[tone] } : undefined}
    >
      <Icon size={15} strokeWidth={1.9} aria-hidden />
    </span>
  );
}

/** Headline tile: icon, big figure, one qualifying line - and a live meter. */
function Kpi({
  href, icon, label, value, pct, sub, tone = 'info',
}: {
  href: string; icon: LucideIcon; label: string;
  value: number | undefined; pct?: number; sub?: string; tone?: Tone;
}) {
  return (
    <Link href={href} className="card card-hover flex flex-col gap-2 p-3.5">
      <div className="flex items-center justify-between gap-2">
        <IconTile icon={icon} tone={tone} />
        <span className="eyebrow">{label}</span>
      </div>
      <p className="text-[26px] font-semibold leading-none tracking-tight tabular-nums">
        {value === undefined ? '-' : value.toLocaleString()}
      </p>
      <div>
        {sub && <p className="mb-1 text-[11px] text-[rgb(var(--muted))]">{sub}</p>}
        {pct !== undefined && (
          <div className="h-1 w-full overflow-hidden rounded-full bg-[rgb(var(--surface-3))]">
            <div className="h-full rounded-full"
                 style={{ width: `${Math.max(pct, 2)}%`, background: TONE_TEXT[tone], opacity: 0.85 }} />
          </div>
        )}
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const queryClient = useQueryClient();

  const k = useQuery({ queryKey: ['kpis'], queryFn: () => api<Kpis>('/dashboard/kpis') });
  useRealtime(
    ['asset.created', 'asset.updated', 'asset.archived', 'asset.restored',
     'allocation.created', 'allocation.returned', 'repair.updated', 'sync.completed'],
    () => {
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  );

  if (k.isError) return <ErrorNote error={k.error} />;
  const d = k.data;

  return (
    <>
      <PageHeader title="Dashboard" description="Live figures from the application database." />

      {/* ------------------------------------------------- headline tiles -- */}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        <Kpi href="/assets" icon={Boxes} label="Assets" tone="ok"
             value={d?.totals.assets} pct={d?.assets.utilisationPct}
             sub={d ? `${d.assets.utilisationPct}% issued` : undefined} />
        <Kpi href="/employees" icon={Users} label="Employees" tone="info"
             value={d?.totals.employees}
             pct={d ? Math.round((d.dataQuality.employeesWithEquipment / Math.max(d.totals.employees, 1)) * 100) : undefined}
             sub={d ? `${d.dataQuality.employeesWithEquipment} hold equipment` : undefined} />
        <Kpi href="/workstations" icon={Armchair} label="Stations" tone={d && d.workstations.completionPct < 80 ? 'warn' : 'ok'}
             value={d?.totals.workstations} pct={d?.workstations.completionPct}
             sub={d ? `${d.workstations.completionPct}% fully equipped` : undefined} />
        <Kpi href="/cug" icon={Smartphone} label="CUG lines" tone="info"
             value={d?.totals.cug} pct={d?.utilisation.cug.pct}
             sub={d ? `${d.utilisation.cug.available} unassigned` : undefined} />
        <Kpi href="/lockers" icon={KeyRound} label="Lockers" tone="info"
             value={d?.totals.lockers} pct={d?.utilisation.lockers.pct}
             sub={d ? `${d.utilisation.lockers.free} free` : undefined} />
        <Kpi href="/repairs" icon={Wrench} label="Repairs" tone={d && d.repairs.open > 0 ? 'warn' : 'ok'}
             value={d?.totals.repairs}
             pct={d ? Math.round((d.repairs.closed / Math.max(d.repairs.total, 1)) * 100) : undefined}
             sub={d ? `${d.repairs.open} open` : undefined} />
      </div>

    </>
  );
}
