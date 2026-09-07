'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import {
  RefreshCw, ShieldCheck, ShieldAlert, Cloud, CloudOff, ChevronDown, ChevronRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/hooks/use-realtime';
import { PageHeader, ErrorNote, StatCard } from '@/components/ui';

interface Finding { count: number; items: Array<Record<string, unknown>> }

interface Run {
  id: string;
  status: 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  sheetConnected: boolean;
  sourceNote: string | null;
  summary: {
    problems?: string[];
    ccc?: Record<string, unknown>;
    wingwise?: Record<string, unknown>;
    corrected?: Record<string, number>;
    exceptionCounts?: Record<string, number>;
  };
  exceptions: Record<string, Finding>;
  errorMessage: string | null;
}

interface Latest {
  latest: Run | null;
  recent: Array<Pick<Run, 'id' | 'status' | 'startedAt' | 'finishedAt' | 'durationMs' | 'trigger' | 'sheetConnected'>>;
  lastSyncAt: string | null;
  lastSyncSource: { name: string; workbookLabel: string | null } | null;
  successRate: number | null;
  running: boolean;
  schedule: string;
}

/** The checks, in the order the dashboard shows them, with the words people use. */
const CHECKS: Array<{ key: string; title: string; hint: string; tone: 'bad' | 'warn' | 'info' }> = [
  { key: 'assetsMissingFromWebsite', title: 'Assets missing from website', hint: 'On the sheet, not here - created by this run', tone: 'info' },
  { key: 'assetsMissingFromSheet', title: 'Assets missing from sheet', hint: 'Here from an earlier read, no longer on the sheet - flagged, kept', tone: 'warn' },
  { key: 'duplicateAssets', title: 'Duplicate assets', hint: 'One serial number on more than one record', tone: 'bad' },
  { key: 'assignmentMismatches', title: 'Assignment mismatches', hint: 'Status and holder disagree', tone: 'bad' },
  { key: 'unassignedAssets', title: 'Unassigned assets', hint: 'In stock, held by no one', tone: 'info' },
  { key: 'employeesMissingEquipment', title: 'Employees with missing equipment', hint: 'Active people holding nothing', tone: 'warn' },
  { key: 'employeesWithMultipleDevices', title: 'Employees with multiple devices', hint: 'More than one laptop or desktop', tone: 'info' },
  { key: 'missingModelNumbers', title: 'Missing model numbers', hint: 'Laptops, desktops, monitors, headphones, printers without a model', tone: 'warn' },
  { key: 'missingSerialNumbers', title: 'Missing serial numbers', hint: 'Laptops, desktops, monitors, printers without a serial', tone: 'warn' },
  { key: 'missingAssetIds', title: 'Missing asset IDs', hint: 'Records without a tag', tone: 'bad' },
  { key: 'missingSeatAssignments', title: 'Missing seat assignments', hint: 'Team seats with no owner, or an archived owner', tone: 'warn' },
  { key: 'missingEmployees', title: 'Missing employees', hint: 'Assets issued to a name with no employee record', tone: 'warn' },
  { key: 'orphanRecords', title: 'Orphan inventory records', hint: 'Active allocations to archived people or assets', tone: 'bad' },
];

const TONE_BADGE = { bad: 'badge-bad', warn: 'badge-warn', info: 'badge-info' } as const;

export default function ReconcilePage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ['reconcile', 'latest'],
    queryFn: () => api<Latest>('/reconcile/latest'),
    refetchInterval: (query) => (query.state.data?.running ? 3000 : 60_000),
  });
  useRealtime(['sync.completed'], () => queryClient.invalidateQueries({ queryKey: ['reconcile'] }));

  const runNow = useMutation({
    mutationFn: () => api<{ id: string }>('/reconcile/run', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reconcile'] }),
  });

  const d = q.data;
  const run = d?.latest ?? null;
  const total = run ? Object.values(run.exceptions ?? {}).reduce((a, f) => a + (f?.count ?? 0), 0) : null;
  const when = (iso: string | null | undefined) =>
    iso ? `${format(new Date(iso), 'd MMM yyyy, HH:mm')} (${formatDistanceToNow(new Date(iso), { addSuffix: true })})` : '-';

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="The master sheet against the website, four times a day. What the sheet has and the site lacked is created; what disagrees is listed here."
        actions={
          can('sync.run') ? (
            <button
              className="btn-primary"
              disabled={runNow.isPending || d?.running}
              onClick={() => runNow.mutate()}
            >
              <RefreshCw size={13} className={runNow.isPending || d?.running ? 'animate-spin' : ''} />
              {runNow.isPending || d?.running ? 'Validating...' : 'Validate now'}
            </button>
          ) : undefined
        }
      />

      {q.isError && <div className="mb-3"><ErrorNote error={q.error} /></div>}
      {runNow.isError && <div className="mb-3"><ErrorNote error={runNow.error} /></div>}

      {/* Sheet connection: the one thing that decides whether this is live */}
      {d && (
        <div
          className="card mb-3 flex items-start gap-3 p-3"
          style={run && !run.sheetConnected ? { borderColor: 'rgb(var(--warn) / 0.5)', background: 'rgb(var(--warn-bg))' } : undefined}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[rgb(var(--surface-3))] ring-1 ring-[rgb(var(--border))]">
            {run?.sheetConnected ? <Cloud size={15} /> : <CloudOff size={15} />}
          </span>
          <div className="text-[12.5px] leading-relaxed">
            {run?.sheetConnected ? (
              <p><span className="font-medium">Google Sheet connected.</span> Every run reads the master workbooks live.</p>
            ) : (
              <>
                <p className="font-medium">Google Sheet not connected.</p>
                <p className="text-[rgb(var(--text-2))]">
                  Runs read the last workbook files supplied instead
                  {run?.sourceNote ? <>: <span className="font-mono text-[11px]">{run.sourceNote}</span></> : null}.
                  To read the sheet live, add the service-account key and share both sheets with it (docs/GOOGLE-SYNC-SETUP.md).
                </p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Headline figures */}
      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Last synchronisation" value={d?.lastSyncAt ? format(new Date(d.lastSyncAt), 'd MMM, HH:mm') : '-'} />
        <StatCard label="Last validation" value={run ? format(new Date(run.startedAt), 'd MMM, HH:mm') : '-'}
                  tone={run?.status === 'FAILED' ? 'bad' : run?.status === 'PARTIAL' ? 'warn' : run ? 'ok' : undefined} />
        <StatCard label="Validation success rate" value={d?.successRate === null || d?.successRate === undefined ? '-' : `${d.successRate}%`}
                  tone={d?.successRate !== null && d?.successRate !== undefined ? (d.successRate >= 80 ? 'ok' : 'warn') : undefined} />
        <StatCard label="Open exceptions" value={total ?? '-'} tone={total === 0 ? 'ok' : total ? 'warn' : undefined} />
        <StatCard label="Schedule" value={d?.schedule === '0 9,12,15,18 * * *' ? '09:00 · 12:00 · 15:00 · 18:00' : d?.schedule ?? '-'} />
      </div>

      {run && (
        <div className="card mb-3 p-3 text-[12px] text-[rgb(var(--text-2))]">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-medium text-[rgb(var(--text))]">
              {run.status === 'SUCCESS' ? <ShieldCheck size={14} className="text-[rgb(var(--ok))]" /> : <ShieldAlert size={14} className="text-[rgb(var(--warn))]" />}
              Last run {run.status.toLowerCase()} · {run.trigger}
            </span>
            <span>started {when(run.startedAt)}</span>
            {run.durationMs !== null && <span>took {Math.round(run.durationMs / 1000)}s</span>}
            {run.summary?.corrected && (
              <span>
                auto-corrected {Object.values(run.summary.corrected).reduce((a, b) => a + b, 0)} record(s)
              </span>
            )}
          </div>
          {run.summary?.problems && run.summary.problems.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[rgb(var(--warn))]">
              {run.summary.problems.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}
          {run.errorMessage && <p className="mt-2 text-[rgb(var(--bad))]">{run.errorMessage}</p>}
          {(run.summary?.ccc || run.summary?.wingwise) && (
            <p className="mt-2 font-mono text-[11px] text-[rgb(var(--muted))]">
              {run.summary.ccc && <>Contact Center: {compact(run.summary.ccc)}. </>}
              {run.summary.wingwise && <>Wing Wise: {compact(run.summary.wingwise)}.</>}
            </p>
          )}
        </div>
      )}

      {/* The checks */}
      {!run ? (
        <div className="card p-6 text-center text-[13px] text-[rgb(var(--muted))]">
          {q.isLoading ? 'Loading...' : 'No validation has run yet. It runs at 09:00, 12:00, 15:00 and 18:00, or press Validate now.'}
        </div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {CHECKS.map((c) => (
            <CheckPanel key={c.key} check={c} finding={run.exceptions?.[c.key] ?? { count: 0, items: [] }} />
          ))}
        </div>
      )}

      {/* Recent runs */}
      {d && d.recent.length > 0 && (
        <div className="card mt-3 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="th">Run</th>
                <th className="th">Trigger</th>
                <th className="th">Status</th>
                <th className="th">Sheet</th>
                <th className="th">Took</th>
              </tr>
            </thead>
            <tbody>
              {d.recent.map((r) => (
                <tr key={r.id} className="row">
                  <td className="td whitespace-nowrap">{format(new Date(r.startedAt), 'd MMM yyyy, HH:mm')}</td>
                  <td className="td">{r.trigger}</td>
                  <td className="td">
                    <span className={r.status === 'SUCCESS' ? 'badge-ok' : r.status === 'FAILED' ? 'badge-bad' : r.status === 'PARTIAL' ? 'badge-warn' : 'badge-info'}>
                      {r.status.toLowerCase()}
                    </span>
                  </td>
                  <td className="td">{r.sheetConnected ? 'live' : 'file'}</td>
                  <td className="td">{r.durationMs === null ? '-' : `${Math.round(r.durationMs / 1000)}s`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function compact(o: Record<string, unknown>): string {
  return Object.entries(o)
    .filter(([, v]) => typeof v === 'number' && v !== 0)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ') || 'nothing changed';
}

function CheckPanel({ check, finding }: { check: (typeof CHECKS)[number]; finding: Finding }) {
  const [open, setOpen] = useState(false);
  const cols = finding.items[0] ? Object.keys(finding.items[0]) : [];
  const empty = finding.count === 0;
  return (
    <div className="card">
      <button
        type="button"
        className="flex w-full items-center gap-3 p-3 text-left"
        onClick={() => !empty && setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={empty ? 'badge-ok' : TONE_BADGE[check.tone]}>{finding.count}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">{check.title}</span>
          <span className="block text-[11px] text-[rgb(var(--muted))]">{check.hint}</span>
        </span>
        {!empty && (open ? <ChevronDown size={14} className="text-[rgb(var(--muted))]" /> : <ChevronRight size={14} className="text-[rgb(var(--muted))]" />)}
      </button>
      {open && !empty && (
        <div className="overflow-x-auto border-t border-[rgb(var(--border))]">
          <table className="table">
            <thead>
              <tr>{cols.map((c) => <th key={c} className="th">{label(c)}</th>)}</tr>
            </thead>
            <tbody>
              {finding.items.map((row, i) => (
                <tr key={i} className="row">
                  {cols.map((c) => (
                    <td key={c} className="td">{row[c] === null || row[c] === undefined || row[c] === '' ? <span className="text-[rgb(var(--muted))]">-</span> : String(row[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {finding.count > finding.items.length && (
            <p className="px-3 py-2 text-[11px] text-[rgb(var(--muted))]">
              Showing the first {finding.items.length} of {finding.count}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function label(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}
