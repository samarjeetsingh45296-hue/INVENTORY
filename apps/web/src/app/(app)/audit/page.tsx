'use client';

import { Fragment, useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, ErrorNote, EmptyState } from '@/components/ui';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  userName: string;
  userEmail: string | null;
  ipAddress: string | null;
  changedFields: string[];
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  summary: string | null;
  createdAt: string;
}

const ACTIONS = [
  'CREATE', 'UPDATE', 'SOFT_DELETE', 'RESTORE', 'ALLOCATE', 'RETURN',
  'TRANSFER', 'LOGIN', 'LOGIN_FAILED', 'SYNC', 'IMPORT', 'EXPORT',
  'BACKUP', 'ROLE_ASSIGNED', 'PERMISSION_CHANGED', 'SETTING_CHANGED',
];

export default function AuditPage() {
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = new URLSearchParams({
    page: String(page),
    pageSize: '50',
    ...(action ? { action } : {}),
    ...(search ? { search } : {}),
  });

  const query = useQuery({
    queryKey: ['audit', params.toString()],
    queryFn: () => api<{ items: AuditRow[]; total: number; totalPages: number }>(
      `/audit?${params.toString()}`,
    ),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Change History"
        description={
          'Who changed what, when, and from which address. This log is ' +
          'append-only: it cannot be edited or deleted by anyone, including a Super Admin.'
        }
      />

      <div className="card mb-4 flex flex-wrap gap-3 p-3">
        <input
          className="input max-w-xs"
          placeholder="Search record, user or summary..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          className="input max-w-[14rem]"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a.replace(/_/g, ' ').toLowerCase()}</option>
          ))}
        </select>
      </div>

      {query.isError && <ErrorNote error={query.error} />}

      {query.data?.items.length === 0 ? (
        <EmptyState message="No matching entries" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table min-w-[56rem]">
            <thead>
              <tr>
                <th className="th">When</th>
                <th className="th">Who</th>
                <th className="th">Action</th>
                <th className="th">Record</th>
                <th className="th">Changed</th>
                <th className="th">IP address</th>
              </tr>
            </thead>
            <tbody>
              {(query.data?.items ?? []).map((row) => (
                <Fragment key={row.id}>
                  <tr
                    className="cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                    onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                  >
                    <td className="td whitespace-nowrap">
                      {format(new Date(row.createdAt), 'd MMM yyyy, HH:mm')}
                    </td>
                    <td className="td">{row.userName}</td>
                    <td className="td"><StatusBadge status={row.action} /></td>
                    <td className="td">
                      {row.entityLabel ?? row.entityType}
                      <span className="ml-1 text-xs text-[rgb(var(--muted))]">
                        ({row.entityType})
                      </span>
                    </td>
                    <td className="td text-xs text-[rgb(var(--muted))]">
                      {row.changedFields.length ? row.changedFields.join(', ') : '-'}
                    </td>
                    <td className="td font-mono text-xs">{row.ipAddress ?? '-'}</td>
                  </tr>
                  {expanded === row.id && (
                    <tr>
                      <td className="td bg-black/[0.02] dark:bg-white/[0.03]" colSpan={6}>
                        {row.summary && <p className="mb-2 text-sm">{row.summary}</p>}
                        {row.changedFields.length > 0 ? (
                          <table className="table max-w-2xl">
                            <thead>
                              <tr>
                                <th className="th">Field</th>
                                <th className="th">Old value</th>
                                <th className="th">New value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.changedFields.map((f) => (
                                <tr key={f}>
                                  <td className="td font-medium">{f}</td>
                                  <td className="td font-mono text-xs">
                                    {String(row.oldValue?.[f] ?? '-')}
                                  </td>
                                  <td className="td font-mono text-xs">
                                    {String(row.newValue?.[f] ?? '-')}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="text-sm text-[rgb(var(--muted))]">
                            No field-level changes recorded for this entry.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {query.data && query.data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-[rgb(var(--muted))]">
            {query.data.total} entries - page {page} of {query.data.totalPages}
          </p>
          <div className="flex gap-2">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </button>
            <button
              className="btn-ghost"
              disabled={page >= query.data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
