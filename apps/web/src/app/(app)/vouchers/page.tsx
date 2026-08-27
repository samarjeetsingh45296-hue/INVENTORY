'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Search, Ticket } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  PageHeader, StatusBadge, ErrorNote, EmptyState, TableSkeleton, StatCard,
} from '@/components/ui';

interface Row {
  id: string;
  voucherNo: string;
  serialNo: number | null;
  status: string;
  receivedAt: string | null;
  issuedAt: string | null;
  issuedToName: string | null;
  issuedByName: string | null;
  purpose: string | null;
  notes: string | null;
  issuedTo: { id: string; fullName: string; employeeCode: string } | null;
}

interface Page {
  items: Row[];
  summary: {
    byStatus: Array<{ status: string; count: number }>;
    books: Array<{ voucherNo: string; total: number; available: number }>;
  };
  page: number; total: number; totalPages: number;
}

const STATUSES = ['AVAILABLE', 'ISSUED', 'REDEEMED', 'EXPIRED', 'VOID', 'LOST'];

export default function VouchersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({
    page: String(page), pageSize: '50',
    ...(search ? { search } : {}), ...(status ? { status } : {}),
  });

  const q = useQuery({
    queryKey: ['vouchers', params.toString()],
    queryFn: () => api<Page>(`/vouchers?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vouchers'] });

  const issue = useMutation({
    mutationFn: (vars: { id: string; issuedToName: string; purpose: string }) =>
      api(`/vouchers/${vars.id}/issue`, {
        method: 'POST',
        body: { issuedToName: vars.issuedToName, purpose: vars.purpose },
      }),
    onSuccess: refresh,
  });

  const unissue = useMutation({
    mutationFn: (id: string) => api(`/vouchers/${id}/return`, { method: 'POST' }),
    onSuccess: refresh,
  });

  const counts = Object.fromEntries(
    (q.data?.summary.byStatus ?? []).map((s) => [s.status, s.count]),
  );
  const canWrite = can('asset.update');

  return (
    <>
      <PageHeader
        title="PVR cards"
        description="Movie vouchers held for rewards. One row is one card; the printed number repeats across a book of ten."
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <StatCard label="Cards" value={q.data?.total ?? '-'} />
        <StatCard label="In the drawer" value={counts.AVAILABLE ?? 0} tone="ok" />
        <StatCard label="Issued" value={counts.ISSUED ?? 0} />
        <StatCard label="Books" value={q.data?.summary.books.length ?? '-'} />
      </div>

      {q.data && q.data.summary.books.length > 0 && (
        <section className="card mb-3 p-3">
          <h2 className="mb-2 text-[12px] font-semibold">Books</h2>
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {q.data.summary.books.map((b) => (
              <li
                key={b.voucherNo}
                className="flex items-baseline justify-between gap-2 rounded-md border border-[rgb(var(--border))] px-2.5 py-1.5 text-[12px]"
              >
                <span className="font-mono text-[11px] text-[rgb(var(--text-2))]">
                  {b.voucherNo}
                </span>
                <span className="tabular-nums">
                  <span
                    className="font-medium"
                    style={{ color: b.available === 0 ? 'rgb(var(--muted))' : 'rgb(var(--text))' }}
                  >
                    {b.available}
                  </span>
                  <span className="text-[rgb(var(--muted))]"> of {b.total} left</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="card mb-3 flex flex-wrap items-center gap-2 p-2">
        <div className="relative max-w-xs flex-1" style={{ minWidth: '13rem' }}>
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted))]" />
          <input
            className="input pl-7"
            placeholder="Card number, holder or purpose"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="input max-w-[10rem]"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.toLowerCase()}</option>
          ))}
        </select>
      </div>

      {q.isError && <div className="mb-3"><ErrorNote error={q.error} /></div>}
      {(issue.isError || unissue.isError) && (
        <div className="mb-3"><ErrorNote error={issue.error ?? unissue.error} /></div>
      )}

      {!q.isLoading && q.data?.items.length === 0 ? (
        <EmptyState message="No cards match" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table" style={{ minWidth: '50rem' }}>
            <thead>
              <tr>
                <th className="th">Card number</th>
                <th className="th">No.</th>
                <th className="th">Status</th>
                <th className="th">Issued to</th>
                <th className="th">Purpose</th>
                <th className="th">Received</th>
                <th className="th">Issued</th>
                {canWrite && <th className="th text-right">Action</th>}
              </tr>
            </thead>
            {q.isLoading ? <TableSkeleton rows={10} cols={canWrite ? 8 : 7} /> : (
              <tbody>
                {(q.data?.items ?? []).map((v) => (
                  <tr key={v.id} className="row">
                    <td className="td font-mono text-[11px] text-[rgb(var(--text))]">
                      <span className="inline-flex items-center gap-1.5">
                        <Ticket size={12} className="text-[rgb(var(--muted))]" />
                        {v.voucherNo}
                      </span>
                    </td>
                    <td className="td num">{v.serialNo ?? '-'}</td>
                    <td className="td"><StatusBadge status={v.status} /></td>
                    <td className="td">
                      {v.issuedTo ? (
                        <Link href={`/employees/${v.issuedTo.id}`} className="link">
                          {v.issuedTo.fullName}
                        </Link>
                      ) : v.issuedToName ? (
                        <span title="Name recorded in the sheet, not matched to an employee on file">
                          {v.issuedToName}
                          <span className="ml-1 text-[rgb(var(--warn))]">unmatched</span>
                        </span>
                      ) : (
                        <span className="text-[rgb(var(--muted))]">-</span>
                      )}
                    </td>
                    <td className="td">{v.purpose ?? '-'}</td>
                    <td className="td whitespace-nowrap">
                      {v.receivedAt ? format(new Date(v.receivedAt), 'd MMM yy') : '-'}
                    </td>
                    <td className="td whitespace-nowrap">
                      {v.issuedAt ? format(new Date(v.issuedAt), 'd MMM yy') : '-'}
                    </td>
                    {canWrite && (
                      <td className="td text-right">
                        {v.status === 'AVAILABLE' ? (
                          <button
                            className="btn-ghost"
                            onClick={() => {
                              const who = window.prompt(`Issue card ${v.voucherNo} to whom?`);
                              if (!who) return;
                              const why = window.prompt('Purpose (optional)', v.purpose ?? '') ?? '';
                              issue.mutate({ id: v.id, issuedToName: who, purpose: why });
                            }}
                          >
                            Issue
                          </button>
                        ) : v.status === 'ISSUED' ? (
                          <button
                            className="btn-quiet"
                            onClick={() => {
                              if (window.confirm(`Put card ${v.voucherNo} back in the drawer?`)) {
                                unissue.mutate(v.id);
                              }
                            }}
                          >
                            Return
                          </button>
                        ) : null}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      )}

      {q.data && q.data.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-[12px]">
          <p className="text-[rgb(var(--muted))]">
            {q.data.total} cards - page {q.data.page} of {q.data.totalPages}
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
