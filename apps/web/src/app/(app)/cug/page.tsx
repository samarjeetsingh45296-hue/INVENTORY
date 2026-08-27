'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, Smartphone } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, ErrorNote, EmptyState, TableSkeleton, StatCard } from '@/components/ui';

interface Row {
  id: string;
  mobileNumber: string;
  operator: string | null;
  status: string;
  notes: string | null;
  branch: { name: string } | null;
  allocations: Array<{
    id: string;
    employee: { id: string; fullName: string; employeeCode: string; process: string | null } | null;
  }>;
}

interface Page { items: Row[]; page: number; total: number; totalPages: number }

export default function CugPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({
    page: String(page), pageSize: '50',
    ...(search ? { search } : {}), ...(status ? { status } : {}),
  });

  const q = useQuery({
    queryKey: ['cug', params.toString()],
    queryFn: () => api<Page>(`/cug?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const allocated = q.data?.items.filter((r) => r.allocations.length > 0).length ?? 0;

  return (
    <>
      <PageHeader
        title="CUG connections"
        description="Mobile lines issued to staff. Search by number, operator or the person holding it."
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <StatCard label="Connections" value={q.data?.total ?? '-'} />
        <StatCard label="Issued (this page)" value={allocated} tone="ok" />
        <StatCard label="Unassigned (this page)" value={(q.data?.items.length ?? 0) - allocated} tone="warn" />
      </div>

      <div className="card mb-3 flex flex-wrap items-center gap-2 p-2">
        <div className="relative max-w-xs flex-1" style={{ minWidth: '14rem' }}>
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted))]" />
          <input
            className="input pl-7"
            placeholder="Number, operator or holder"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select className="input max-w-[11rem]" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {['AVAILABLE', 'ALLOCATED', 'SUSPENDED', 'BARRED', 'DEACTIVATED', 'LOST'].map((s) => (
            <option key={s} value={s}>{s.toLowerCase()}</option>
          ))}
        </select>
      </div>

      {q.isError && <div className="mb-3"><ErrorNote error={q.error} /></div>}

      {!q.isLoading && q.data?.items.length === 0 ? (
        <EmptyState message="No connections match" hint="Try a different number or name." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table" style={{ minWidth: '46rem' }}>
            <thead>
              <tr>
                <th className="th">Number</th>
                <th className="th">Operator</th>
                <th className="th">Status</th>
                <th className="th">Held by</th>
                <th className="th">Process</th>
                <th className="th">Handset / notes</th>
              </tr>
            </thead>
            {q.isLoading ? <TableSkeleton rows={10} cols={6} /> : (
              <tbody>
                {(q.data?.items ?? []).map((r) => {
                  const holder = r.allocations[0]?.employee;
                  return (
                    <tr key={r.id} className="row">
                      <td className="td font-medium text-[rgb(var(--text))]">
                        <span className="inline-flex items-center gap-1.5">
                          <Smartphone size={12} className="text-[rgb(var(--muted))]" />
                          {r.mobileNumber}
                        </span>
                      </td>
                      <td className="td">{r.operator ?? '-'}</td>
                      <td className="td"><StatusBadge status={r.status} /></td>
                      <td className="td">
                        {holder ? (
                          <Link href={`/employees/${holder.id}`} className="link">
                            {holder.fullName}
                          </Link>
                        ) : <span className="text-[rgb(var(--muted))]">unassigned</span>}
                      </td>
                      <td className="td">{holder?.process ?? '-'}</td>
                      <td className="td max-w-[16rem] truncate">{r.notes ?? '-'}</td>
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
            {q.data.total} connections - page {q.data.page} of {q.data.totalPages}
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
