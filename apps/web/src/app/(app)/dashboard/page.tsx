'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  Boxes, Users, Armchair, Smartphone, KeyRound, Wrench,
  IndianRupee, PackageCheck, type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useRealtime } from '@/hooks/use-realtime';
import { Avatar, PageHeader, ErrorNote, StatusBadge } from '@/components/ui';

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

/* ------------------------------------------------------------ primitives -- */

type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'rgb(var(--text))',
  ok: 'rgb(var(--ok))',
  warn: 'rgb(var(--warn))',
  bad: 'rgb(var(--bad))',
  info: 'rgb(var(--info))',
};

/**
 * A thin proportion meter under a labelled figure. This is the whole trick of
 * the redesign: the number stays primary, but the bar lets the eye compare
 * rows without reading a single digit.
 */
function MeterRow({
  label, value, total, tone = 'info', suffix,
}: {
  label: string; value: number; total: number; tone?: Tone; suffix?: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="py-1.5">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-[12px]">
        <span className="truncate text-[rgb(var(--text-2))]">{label}</span>
        <span className="shrink-0 tabular-nums">
          <span className="font-semibold text-[rgb(var(--text))]">
            {value.toLocaleString()}
          </span>
          <span className="text-[rgb(var(--muted))]">
            {suffix ?? ` of ${total.toLocaleString()}`}
          </span>
          <span className="ml-2 inline-block w-8 text-right text-[11px] font-medium"
                style={{ color: TONE_TEXT[tone] }}>
            {pct}%
          </span>
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-[rgb(var(--surface-3))]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.max(pct, 1)}%`, background: TONE_TEXT[tone], opacity: 0.85 }}
        />
      </div>
    </div>
  );
}

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

function Panel({
  icon, title, subtitle, children, className = '',
}: {
  icon: LucideIcon; title: string; subtitle?: string;
  children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`card p-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2.5">
        <IconTile icon={icon} />
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold leading-tight">{title}</h2>
          {subtitle && (
            <p className="mt-px truncate text-[11px] text-[rgb(var(--muted))]">{subtitle}</p>
          )}
        </div>
      </div>
      {children}
    </section>
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

const STATUS_TONE: Record<string, Tone> = {
  allocated: 'ok', 'in stock': 'info', 'in repair': 'warn', scrapped: 'bad',
  reported: 'warn', repaired: 'ok', 'in progress': 'info',
  'returned to stock': 'ok', unrepairable: 'bad', cancelled: 'neutral',
  'sent to vendor': 'info', 'awaiting parts': 'warn', approved: 'info',
};

export default function DashboardPage() {
  const queryClient = useQueryClient();

  const k = useQuery({ queryKey: ['kpis'], queryFn: () => api<Kpis>('/dashboard/kpis') });
  const activity = useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => api<Activity[]>('/dashboard/activity'),
  });

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

      {/* ------------------------------------------------------- panels ---- */}
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel icon={Boxes} title="Inventory by status"
               subtitle={d ? `${d.totals.assets.toLocaleString()} assets in total` : undefined}>
          <div className="divide-y divide-[rgb(var(--border))]">
            {(d?.assets.byStatus ?? []).map((s) => {
              const label = s.status.replace(/_/g, ' ').toLowerCase();
              return (
                <MeterRow key={s.status} label={label} value={s.count}
                          total={d?.totals.assets ?? 0}
                          tone={STATUS_TONE[label] ?? 'neutral'} suffix=" " />
              );
            })}
          </div>
        </Panel>

        <Panel icon={PackageCheck} title="Utilisation"
               subtitle="How much of each pool is in use">
          <div className="divide-y divide-[rgb(var(--border))]">
            <MeterRow label="Assets issued" tone="ok"
                      value={d?.assets.allocated ?? 0} total={d?.totals.assets ?? 0} />
            <MeterRow label="CUG lines allocated" tone="info"
                      value={d?.utilisation.cug.allocated ?? 0} total={d?.utilisation.cug.total ?? 0} />
            <MeterRow label="Lockers occupied" tone="info"
                      value={d?.utilisation.lockers.held ?? 0} total={d?.utilisation.lockers.total ?? 0} />
            <MeterRow label="Stations fully equipped"
                      tone={d && d.workstations.completionPct < 80 ? 'warn' : 'ok'}
                      value={d?.workstations.complete ?? 0} total={d?.workstations.total ?? 0} />
          </div>
        </Panel>

        <Panel icon={IndianRupee} title="Repairs"
               subtitle={d ? `Rs ${d.repairs.spend.toLocaleString('en-IN')} spent across ${d.repairs.total} tickets` : undefined}>
          <div className="divide-y divide-[rgb(var(--border))]">
            {(d?.repairs.byStatus ?? []).map((r) => {
              const label = r.status.replace(/_/g, ' ').toLowerCase();
              return (
                <MeterRow key={r.status} label={label} value={r.count}
                          total={d?.repairs.total ?? 0}
                          tone={STATUS_TONE[label] ?? 'neutral'} suffix=" " />
              );
            })}
          </div>
          {d && d.repairs.recoveredFromEmployees > 0 && (
            <p className="mt-2 text-[11px] text-[rgb(var(--muted))]">
              {d.repairs.recoveredFromEmployees} charged back to the holder.
            </p>
          )}
        </Panel>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Panel icon={Boxes} title="Inventory by category"
               subtitle="Where the equipment actually is">
          <div className="divide-y divide-[rgb(var(--border))]">
            {(d?.assets.byCategory ?? []).slice(0, 8).map((c) => (
              <MeterRow key={c.name} label={c.name} value={c.count}
                        total={d?.totals.assets ?? 0} tone="neutral" suffix=" " />
            ))}
          </div>
        </Panel>

        <Panel icon={Armchair} title="Station coverage by wing"
               subtitle={d ? `${d.workstations.withGaps} of ${d.workstations.total} stations are short of something` : undefined}>
          <div className="divide-y divide-[rgb(var(--border))]">
            {(d?.workstations.byWing ?? []).map((w) => (
              <MeterRow key={w.wing} label={w.wing} value={w.complete} total={w.total}
                        tone={w.gaps > w.total / 3 ? 'warn' : 'ok'} />
            ))}
          </div>
        </Panel>

        <Panel icon={Wrench} title="What is missing at stations"
               subtitle="Counted across every wing - the shopping list">
          <div className="divide-y divide-[rgb(var(--border))]">
            {(d?.workstations.missingByItem ?? []).slice(0, 8).map((m) => (
              <MeterRow key={m.item} label={m.item} value={m.count}
                        total={d?.workstations.total ?? 0} tone="warn"
                        suffix=" stations" />
            ))}
          </div>
        </Panel>
      </div>

      {/* ----------------------------------------------------- activity ---- */}
      <section className="card mt-3 p-4">
        <div className="mb-3 flex items-center gap-2.5">
          <IconTile icon={Users} />
          <div>
            <h2 className="text-[13px] font-semibold leading-tight">Recent activity</h2>
            <p className="mt-px text-[11px] text-[rgb(var(--muted))]">
              Straight from the change history - nothing here can be edited or removed
            </p>
          </div>
        </div>
        <ol className="relative space-y-3 border-l border-[rgb(var(--border))] pl-4">
          {(activity.data ?? []).slice(0, 8).map((a) => (
            <li key={a.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full
                               bg-[rgb(var(--border-hard))] ring-2 ring-[rgb(var(--surface))]" />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Avatar name={a.userName} />
                <span className="text-[12px] font-medium">{a.userName}</span>
                <StatusBadge status={a.action} />
                <span className="text-[11px] text-[rgb(var(--muted))]">
                  {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                </span>
              </div>
              <p className="mt-0.5 truncate pl-8 text-[12px] text-[rgb(var(--text-2))]">
                {a.summary ?? `${a.action} ${a.entityType}`}
              </p>
            </li>
          ))}
          {activity.data?.length === 0 && (
            <li className="text-[12px] text-[rgb(var(--muted))]">Nothing recorded yet.</li>
          )}
        </ol>
      </section>
    </>
  );
}
