'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { api } from '@/lib/api';
import { useRealtime } from '@/hooks/use-realtime';
import { PageHeader, StatCard, ErrorNote, StatusBadge } from '@/components/ui';

interface Summary {
  assets: { total: number; allocated: number; inStock: number; inRepair: number };
  employees: number;
  openRepairs: number;
  pendingApprovals: number;
  byCategory: Array<{ category: string; count: number }>;
  lastSync: { at: string; source: string; status: string; rowsRead: number } | null;
  lastBackup: { at: string; type: string; sizeBytes: number | null } | null;
}

interface Activity {
  id: string;
  action: string;
  entityType: string;
  entityLabel: string | null;
  userName: string;
  summary: string | null;
  createdAt: string;
}

export default function DashboardPage() {
  const queryClient = useQueryClient();

  const summary = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => api<Summary>('/dashboard/summary'),
  });

  const activity = useQuery({
    queryKey: ['dashboard', 'activity'],
    queryFn: () => api<Activity[]>('/dashboard/activity'),
  });

  // Any inventory change anywhere refreshes these figures with no page reload.
  useRealtime(
    ['asset.created', 'asset.updated', 'allocation.created', 'allocation.returned', 'sync.completed'],
    () => {
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  );

  if (summary.isError) return <ErrorNote error={summary.error} />;

  const s = summary.data;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Live figures from the application database."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total assets" value={s?.assets.total ?? '-'} />
        <StatCard label="Issued" value={s?.assets.allocated ?? '-'} hint="Currently with a holder" />
        <StatCard label="In stock" value={s?.assets.inStock ?? '-'} hint="Available to issue" />
        <StatCard label="In repair" value={s?.assets.inRepair ?? '-'} />
        <StatCard label="Active employees" value={s?.employees ?? '-'} />
        <StatCard label="Open repair tickets" value={s?.openRepairs ?? '-'} />
        <StatCard label="Pending approvals" value={s?.pendingApprovals ?? '-'} />
        <StatCard
          label="Last backup"
          value={
            s?.lastBackup
              ? formatDistanceToNow(new Date(s.lastBackup.at), { addSuffix: true })
              : 'never'
          }
          hint={
            s?.lastBackup?.sizeBytes
              ? `${(s.lastBackup.sizeBytes / 1024 / 1024).toFixed(1)} MB`
              : 'Configure the nightly backup'
          }
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Inventory by category</h2>
          {s?.byCategory.length ? (
            <ul className="space-y-2">
              {s.byCategory.slice(0, 10).map((c) => {
                const pct = s.assets.total ? (c.count / s.assets.total) * 100 : 0;
                return (
                  <li key={c.category}>
                    <div className="mb-1 flex justify-between text-sm">
                      <span>{c.category}</span>
                      <span className="tabular-nums text-[rgb(var(--muted))]">{c.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-black/5 dark:bg-white/10">
                      <div
                        className="h-1.5 rounded-full bg-brand-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-[rgb(var(--muted))]">
              No assets yet. Import a sheet from the Sheet Sync screen to get started.
            </p>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
          <ul className="space-y-3">
            {(activity.data ?? []).slice(0, 12).map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <StatusBadge status={a.action} />
                <div className="min-w-0">
                  <p className="truncate">
                    {a.summary ?? `${a.action} ${a.entityType}`}
                    {a.entityLabel && (
                      <span className="text-[rgb(var(--muted))]"> - {a.entityLabel}</span>
                    )}
                  </p>
                  <p className="text-xs text-[rgb(var(--muted))]">
                    {a.userName} - {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}
                  </p>
                </div>
              </li>
            ))}
            {activity.data?.length === 0 && (
              <li className="text-sm text-[rgb(var(--muted))]">Nothing recorded yet.</li>
            )}
          </ul>
        </section>
      </div>
    </>
  );
}
