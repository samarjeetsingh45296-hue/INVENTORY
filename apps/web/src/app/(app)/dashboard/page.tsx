'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  Boxes, Users, Armchair, Smartphone, KeyRound, Wrench, TriangleAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRealtime } from '@/hooks/use-realtime';
import { PageHeader, ErrorNote, StatusBadge } from '@/components/ui';
import { ChartCard, BarList, StackedBars, Meter, StatusBar, SERIES } from '@/components/charts';

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

interface Activity {
  id: string; action: string; entityType: string; entityLabel: string | null;
  userName: string; summary: string | null; createdAt: string;
}

/** Hero figure with a one-line qualifier underneath. */
function Kpi({
  href, icon: Icon, label, value, sub,
}: {
  href: string;
  icon: typeof Boxes;
  label: string;
  value: number | string;
  sub?: string;
}) {
  return (
    <Link
      href={href}
      className="card px-3 py-2.5 transition-colors hover:bg-[rgb(var(--surface-2))]"
    >
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-[rgb(var(--muted))]">
        <Icon size={12} aria-hidden />
        {label}
      </div>
      <p className="mt-1 text-2xl font-semibold leading-none tabular-nums">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-[rgb(var(--muted))]">{sub}</p>}
    </Link>
  );
}

export default function DashboardPage() {
  const queryClient = useQueryClient();

  const k = useQuery({ queryKey: ['kpis'], queryFn: () => api<Kpis>('/dashboard/kpis') });
  const activity = useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => api<Activity[]>('/dashboard/activity'),
  });

  // Any change anywhere refreshes the figures, with no page reload.
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
  const dash = (v?: number) => (v === undefined ? '-' : v);

  const issues = d
    ? [
        d.dataQuality.employeesNeedingMisNumber && {
          label: `${d.dataQuality.employeesNeedingMisNumber} employees have no MIS number`,
          href: '/employees?search=NOMIS-',
        },
        d.workstations.withGaps && {
          label: `${d.workstations.withGaps} stations are missing equipment`,
          href: '/workstations',
        },
        d.dataQuality.duplicateLockerKeys && {
          label: `${d.dataQuality.duplicateLockerKeys} locker keys are recorded more than once`,
          href: '/lockers',
        },
        d.repairs.open && {
          label: `${d.repairs.open} repair tickets are still open`,
          href: '/repairs',
        },
      ].filter(Boolean) as Array<{ label: string; href: string }>
    : [];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live figures from the application database."
      />

      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          href="/assets" icon={Boxes} label="Assets"
          value={dash(d?.totals.assets)}
          sub={d ? `${d.assets.utilisationPct}% issued` : undefined}
        />
        <Kpi
          href="/employees" icon={Users} label="Employees"
          value={dash(d?.totals.employees)}
          sub={d ? `${d.dataQuality.employeesWithEquipment} hold equipment` : undefined}
        />
        <Kpi
          href="/workstations" icon={Armchair} label="Workstations"
          value={dash(d?.totals.workstations)}
          sub={d ? `${d.workstations.completionPct}% fully equipped` : undefined}
        />
        <Kpi
          href="/cug" icon={Smartphone} label="CUG lines"
          value={dash(d?.totals.cug)}
          sub={d ? `${d.utilisation.cug.available} unassigned` : undefined}
        />
        <Kpi
          href="/lockers" icon={KeyRound} label="Lockers"
          value={dash(d?.totals.lockers)}
          sub={d ? `${d.utilisation.lockers.free} free` : undefined}
        />
        <Kpi
          href="/repairs" icon={Wrench} label="Repairs"
          value={dash(d?.totals.repairs)}
          sub={d ? `${d.repairs.open} open` : undefined}
        />
      </div>

      {issues.length > 0 && (
        <section className="card mt-3 p-3">
          <h2 className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold">
            <TriangleAlert size={13} style={{ color: 'var(--viz-warn)' }} />
            Needs attention
          </h2>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {issues.map((i) => (
              <li key={i.href + i.label}>
                <Link
                  href={i.href}
                  className="flex items-center justify-between gap-2 rounded-md border border-[rgb(var(--border))] px-2.5 py-1.5 text-[12px] transition-colors hover:bg-[rgb(var(--surface-2))]"
                >
                  <span className="text-[rgb(var(--text-2))]">{i.label}</span>
                  <span className="text-[rgb(var(--muted))]">view</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <ChartCard
          title="Inventory by status"
          subtitle={d ? `${d.totals.assets.toLocaleString()} assets` : undefined}
        >
          <StatusBar data={d?.assets.byStatus ?? []} />
        </ChartCard>

        <ChartCard title="Utilisation" subtitle="How much of each pool is in use">
          <div className="space-y-3">
            <Meter
              label="Assets issued"
              value={d?.assets.allocated ?? 0}
              total={d?.totals.assets ?? 0}
              tone="good"
            />
            <Meter
              label="CUG lines allocated"
              value={d?.utilisation.cug.allocated ?? 0}
              total={d?.utilisation.cug.total ?? 0}
            />
            <Meter
              label="Lockers occupied"
              value={d?.utilisation.lockers.held ?? 0}
              total={d?.utilisation.lockers.total ?? 0}
            />
            <Meter
              label="Stations fully equipped"
              value={d?.workstations.complete ?? 0}
              total={d?.workstations.total ?? 0}
              tone={d && d.workstations.completionPct < 80 ? 'warn' : 'good'}
            />
          </div>
        </ChartCard>

        <ChartCard
          title="Repairs"
          subtitle={
            d ? `Rs ${d.repairs.spend.toLocaleString('en-IN')} spent across ${d.repairs.total} tickets` : undefined
          }
        >
          <BarList
            data={(d?.repairs.byStatus ?? []).map((r) => ({
              label: r.status.replace(/_/g, ' ').toLowerCase(),
              value: r.count,
            }))}
            fill={SERIES.two}
          />
          {d && d.repairs.recoveredFromEmployees > 0 && (
            <p className="mt-2 text-[11px] text-[rgb(var(--muted))]">
              {d.repairs.recoveredFromEmployees} charged back to the holder.
            </p>
          )}
        </ChartCard>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="Inventory by category"
          subtitle="Where the equipment actually is"
        >
          <BarList
            data={(d?.assets.byCategory ?? []).slice(0, 12).map((c) => ({
              label: c.name,
              value: c.count,
            }))}
          />
        </ChartCard>

        <ChartCard
          title="Station coverage by wing"
          subtitle={
            d ? `${d.workstations.withGaps} of ${d.workstations.total} stations are short of something` : undefined
          }
        >
          <StackedBars
            data={(d?.workstations.byWing ?? []).map((w) => ({
              label: w.wing, a: w.complete, b: w.gaps,
            }))}
            labels={['Fully equipped', 'Missing something']}
          />
        </ChartCard>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="What is missing at stations"
          subtitle="Counted across every wing - the shopping list"
        >
          <BarList
            data={(d?.workstations.missingByItem ?? []).map((m) => ({
              label: m.item,
              value: m.count,
              hint: 'stations',
            }))}
            fill={SERIES.two}
          />
        </ChartCard>

        <ChartCard title="Recent activity" subtitle="Straight from the audit trail">
          <ul className="space-y-2">
            {(activity.data ?? []).slice(0, 10).map((a) => (
              <li key={a.id} className="flex gap-2 text-[12px]">
                <StatusBadge status={a.action} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[rgb(var(--text-2))]">
                    {a.summary ?? `${a.action} ${a.entityType}`}
                  </p>
                  <p className="text-[11px] text-[rgb(var(--muted))]">
                    {a.userName} - {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </li>
            ))}
            {activity.data?.length === 0 && (
              <li className="text-[12px] text-[rgb(var(--muted))]">Nothing recorded yet.</li>
            )}
          </ul>
        </ChartCard>
      </div>
    </>
  );
}
