'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/hooks/use-realtime';
import { PageHeader, StatusBadge, ErrorNote } from '@/components/ui';
import { MappingEditor } from './mapping-editor';
import { ResultPanel } from './result-panel';

export interface SyncSource {
  id: string;
  name: string;
  workbookLabel: string | null;
  spreadsheetId: string | null;
  sheetGid: string | null;
  targetEntity: string;
  mode: string;
  schedule: string;
  isDisconnected: boolean;
  disconnectedAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastRowCount: number | null;
  lastError: string | null;
  mappings: Array<{ id: string }>;
  _count: { runs: number };
}

const SCHEDULES = [
  { value: 'OFF', label: 'Manual only' },
  { value: 'HOURLY', label: 'Every hour' },
  { value: 'SIX_HOURLY', label: 'Every 6 hours' },
  { value: 'DAILY', label: 'Once daily' },
];

export default function SyncPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<SyncSource | null>(null);
  const [lastResult, setLastResult] = useState<any>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const sources = useQuery({
    queryKey: ['sync', 'sources'],
    queryFn: () => api<SyncSource[]>('/sync/sources'),
  });

  useRealtime(['sync.progress', 'sync.completed'], (event, payload: any) => {
    if (event === 'sync.progress') {
      setProgress(
        payload.phase === 'read'
          ? `Read ${payload.rows} rows from the sheet...`
          : `Processing ${payload.done} of ${payload.total}...`,
      );
    } else {
      setProgress(null);
      queryClient.invalidateQueries({ queryKey: ['sync'] });
    }
  });

  const preview = useMutation({
    mutationFn: (id: string) => api(`/sync/sources/${id}/preview`, { method: 'POST' }),
    onSuccess: (data, id) =>
      setLastResult({ kind: 'preview', sourceId: id, ...(data as object) }),
  });

  const run = useMutation({
    mutationFn: (vars: { id: string; confirmationToken?: string }) =>
      api(`/sync/sources/${vars.id}/run`, {
        method: 'POST',
        body: { dryRun: false, confirmationToken: vars.confirmationToken },
      }),
    onSuccess: (data, vars) => {
      setLastResult({ kind: 'run', sourceId: vars.id, ...(data as object) });
      queryClient.invalidateQueries({ queryKey: ['sync'] });
    },
  });

  const setSchedule = useMutation({
    mutationFn: (vars: { id: string; schedule: string }) =>
      api(`/sync/sources/${vars.id}/schedule`, {
        method: 'PATCH',
        body: { schedule: vars.schedule },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sync'] }),
  });

  const disconnect = useMutation({
    mutationFn: (id: string) => api(`/sync/sources/${id}/disconnect`, { method: 'POST' }),
    onSuccess: (data) => {
      setLastResult({ kind: 'disconnect', ...(data as object) });
      queryClient.invalidateQueries({ queryKey: ['sync'] });
    },
  });

  const migrate = useMutation({
    mutationFn: (id: string) => api(`/sync/sources/${id}/migrate`, { method: 'POST' }),
    onSuccess: (data, id) => {
      setLastResult({ kind: 'migrate', sourceId: id, ...(data as object) });
      queryClient.invalidateQueries({ queryKey: ['sync'] });
    },
  });

  const busy =
    preview.isPending || run.isPending || disconnect.isPending || migrate.isPending;

  return (
    <>
      <PageHeader
        title="Sheet Sync"
        description={
          'Google Sheets are an import source only. Everything imported is stored ' +
          'permanently in this database, so deleting a sheet never removes a record here.'
        }
      />

      {progress && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3
                        text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950
                        dark:text-blue-300">
          {progress}
        </div>
      )}

      {(preview.isError || run.isError || migrate.isError || disconnect.isError) && (
        <div className="mb-4">
          <ErrorNote error={preview.error ?? run.error ?? migrate.error ?? disconnect.error} />
        </div>
      )}

      {lastResult && (
        <ResultPanel
          result={lastResult}
          onDismiss={() => setLastResult(null)}
          onConfirm={(token) =>
            run.mutate({ id: lastResult.sourceId as string, confirmationToken: token })
          }
        />
      )}

      {sources.isError && <ErrorNote error={sources.error} />}

      <div className="space-y-3">
        {(sources.data ?? []).map((s) => (
          <article key={s.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-medium">{s.name}</h2>
                  {s.isDisconnected && <StatusBadge status="DISCONNECTED" />}
                  {s.mappings.length === 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs
                                     font-medium text-amber-800 dark:bg-amber-950
                                     dark:text-amber-300">
                      columns not mapped
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-[rgb(var(--muted))]">
                  imports into <strong>{s.targetEntity}</strong>
                  {' - '}
                  {s.lastSuccessAt
                    ? `last imported ${formatDistanceToNow(new Date(s.lastSuccessAt), { addSuffix: true })} (${s.lastRowCount ?? 0} rows)`
                    : 'never imported'}
                  {' - '}
                  {s._count.runs} run(s)
                </p>
                {s.lastError && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                    Last error: {s.lastError}
                  </p>
                )}
                {s.isDisconnected && s.disconnectedAt && (
                  <p className="mt-1 text-xs text-[rgb(var(--muted))]">
                    Disconnected on {format(new Date(s.disconnectedAt), 'd MMM yyyy')}.
                    Imported data is unaffected and remains fully available.
                  </p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {can('sync.configure') && (
                  <button className="btn-ghost" onClick={() => setEditing(s)}>
                    Map columns
                  </button>
                )}
                {can('sync.read') && !s.isDisconnected && (
                  <button
                    className="btn-ghost"
                    disabled={busy || s.mappings.length === 0}
                    onClick={() => preview.mutate(s.id)}
                    title={
                      s.mappings.length === 0
                        ? 'Map the columns first'
                        : 'Shows what would change without writing anything'
                    }
                  >
                    Preview
                  </button>
                )}
                {can('sync.run') && !s.isDisconnected && (
                  <button
                    className="btn-primary"
                    disabled={busy || s.mappings.length === 0}
                    onClick={() => run.mutate({ id: s.id })}
                  >
                    Sync now
                  </button>
                )}
              </div>
            </div>

            {!s.isDisconnected && can('sync.configure') && (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t
                              border-[rgb(var(--border))] pt-3 text-sm">
                <label className="flex items-center gap-2">
                  <span className="text-[rgb(var(--muted))]">Schedule</span>
                  <select
                    className="input max-w-[11rem]"
                    value={s.schedule}
                    onChange={(e) => setSchedule.mutate({ id: s.id, schedule: e.target.value })}
                  >
                    {SCHEDULES.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                {can('sync.migrate') && (
                  <>
                    <button
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        const ok = confirm(
                          'Import everything once, then disconnect this sheet permanently?\n\n' +
                            'A full database backup is taken first. No imported record is ever removed.',
                        );
                        if (ok) migrate.mutate(s.id);
                      }}
                    >
                      One-time migration
                    </button>
                    <button
                      className="btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        const ok = confirm(
                          'Stop syncing from this sheet?\n\n' +
                            'Every record already imported stays in the database and the ' +
                            'site continues to work exactly as it does now.',
                        );
                        if (ok) disconnect.mutate(s.id);
                      }}
                    >
                      Disconnect
                    </button>
                  </>
                )}
              </div>
            )}
          </article>
        ))}
      </div>

      {editing && (
        <MappingEditor
          source={editing}
          onClose={() => {
            setEditing(null);
            queryClient.invalidateQueries({ queryKey: ['sync'] });
          }}
        />
      )}
    </>
  );
}
