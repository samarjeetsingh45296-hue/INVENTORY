'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, KeyRound } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, ErrorNote, EmptyState, TableSkeleton, StatCard, Person } from '@/components/ui';

interface Row {
  id: string;
  lockerNo: string;
  keyNumber: string | null;
  status: string;
  notes: string | null;
  branch: { name: string } | null;
  allocations: Array<{
    id: string;
    keyIssued: boolean;
    employee: { id: string; fullName: string; employeeCode: string; level: string | null } | null;
  }>;
}
interface Page { items: Row[]; page: number; total: number; totalPages: number }

export default function LockersPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({
    page: String(page), pageSize: '50',
    ...(search ? { search } : {}), ...(status ? { status } : {}),
  });

  const q = useQuery({
    queryKey: ['lockers', params.toString()],
    queryFn: () => api<Page>(`/lockers?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const held = q.data?.items.filter((r) => r.allocations.length > 0).length ?? 0;

  return (
    <>
      <PageHeader
        title="Lockers"
        description="Locker keys and who holds them. Search by key number or person."
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <StatCard label="Lockers" value={q.data?.total ?? '-'} />
        <StatCard label="Held (this page)" value={held} tone="ok" />
        <StatCard label="Free (this page)" value={(q.data?.items.length ?? 0) - held} tone="warn" />
      </div>

      <div className="card mb-3 flex flex-wrap items-center gap-2 p-2">
        <div className="relative max-w-xs flex-1" style={{ minWidth: '14rem' }}>
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted))]" />
          <input
            className="input pl-7"
            placeholder="Key number or holder"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select className="input max-w-[11rem]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {['AVAILABLE', 'ALLOCATED', 'UNDER_MAINTENANCE', 'DAMAGED', 'RETIRED'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>
          ))}
        </select>
      </div>

      {q.isError && <div className="mb-3"><ErrorNote error={q.error} /></div>}

      {!q.isLoading && q.data?.items.length === 0 ? (
        <EmptyState message="No lockers match" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table" style={{ minWidth: '40rem' }}>
            <thead>
              <tr>
                <th className="th">Key / locker</th>
                <th className="th">Status</th>
                <th className="th">Held by</th>
                <th className="th">Code</th>
                <th className="th">Key issued</th>
                <th className="th">Notes</th>
              </tr>
            </thead>
            {q.isLoading ? <TableSkeleton rows={10} cols={6} /> : (
              <tbody>
                {(q.data?.items ?? []).map((r) => {
                  const a = r.allocations[0];
                  return (
                    <tr key={r.id} className="row">
                      <td className="td font-medium text-[rgb(var(--text))]">
                        <span className="inline-flex items-center gap-1.5">
                          <KeyRound size={12} className="text-[rgb(var(--muted))]" />
                          {r.lockerNo}
                        </span>
                      </td>
                      <td className="td"><StatusBadge status={r.status} /></td>
                      <td className="td">
                        {a?.employee ? (
                          <Link href={`/employees/${a.employee.id}`} className="link">
                            <Person name={a.employee.fullName} level={a.employee.level} />
                          </Link>
                        ) : <span className="text-[rgb(var(--muted))]">free</span>}
                      </td>
                      <td className="td font-mono text-[11px]">{a?.employee?.employeeCode ?? '-'}</td>
                      <td className="td">{a ? (a.keyIssued ? 'yes' : 'no') : '-'}</td>
                      <td className="td max-w-[14rem] truncate">{r.notes ?? '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
      )}

      {q.data && q.data.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-[12px]">
          <p className="text-[rgb(var(--muted))]">
            {q.data.total} lockers - page {q.data.page} of {q.data.totalPages}
          </p>
          <div className="flex gap-1.5">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button className="btn-ghost" disabled={page >= q.data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </>
  );
}
