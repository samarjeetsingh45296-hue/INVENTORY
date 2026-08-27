'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Search, Ticket, Pencil } from 'lucide-react';
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
  notes: string | null;
  issuedTo: { id: string; fullName: string; employeeCode: string } | null;
}

interface Page {
  items: Row[];
  summary: { byStatus: Array<{ status: string; count: number }> };
  page: number; total: number; totalPages: number;
}

const STATUSES = ['AVAILABLE', 'ISSUED', 'REDEEMED', 'EXPIRED', 'VOID', 'LOST'];

export default function VouchersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const params = new URLSearchParams({
    pageSize: '500',
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
  });

  const q = useQuery({
    queryKey: ['vouchers', params.toString()],
    queryFn: () => api<Page>(`/vouchers?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['vouchers'] });

  /** Status drives the record - the holder travels with it. */
  const setCardStatus = useMutation({
    mutationFn: (vars: { id: string; status: string; issuedToName?: string }) =>
      api(`/vouchers/${vars.id}/status`, {
        method: 'POST',
        body: { status: vars.status, issuedToName: vars.issuedToName },
      }),
    onSuccess: refresh,
  });

  const setHolder = useMutation({
    mutationFn: (vars: { id: string; issuedToName: string }) =>
      api(`/vouchers/${vars.id}/holder`, {
        method: 'POST',
        body: { issuedToName: vars.issuedToName },
      }),
    onSuccess: refresh,
  });

  const counts = Object.fromEntries(
    (q.data?.summary.byStatus ?? []).map((s) => [s.status, s.count]),
  );
  const canWrite = can('asset.update');

  function onStatusChange(row: Row, next: string) {
    if (next === row.status) return;
    // Issuing needs a name; nothing else does.
    if (next === 'ISSUED') {
      const who = window.prompt(
        `Issue card ${row.voucherNo} (no. ${row.serialNo ?? '-'}) to whom?`,
        row.issuedToName ?? '',
      );
      if (!who || !who.trim()) return;
      setCardStatus.mutate({ id: row.id, status: next, issuedToName: who.trim() });
      return;
    }
    if (next === 'AVAILABLE' && row.issuedToName) {
      const ok = window.confirm(
        `Put card ${row.voucherNo} back in the drawer?\n\n` +
          `${row.issuedToName} will be cleared from the card. The change stays on the audit trail.`,
      );
      if (!ok) return;
    }
    setCardStatus.mutate({ id: row.id, status: next });
  }

  return (
    <>
      <PageHeader
        title="PVR cards"
        description="Movie vouchers held for rewards. One row is one card - set its status and the holder travels with it."
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <StatCard label="Cards" value={q.data?.total ?? '-'} />
        <StatCard label="In the drawer" value={counts.AVAILABLE ?? 0} tone="ok" />
        <StatCard label="Issued" value={counts.ISSUED ?? 0} />
        <StatCard
          label="Used or gone"
          value={
            (counts.REDEEMED ?? 0) + (counts.EXPIRED ?? 0) +
            (counts.VOID ?? 0) + (counts.LOST ?? 0)
          }
        />
      </div>

      <div className="card mb-3 flex flex-wrap items-center gap-2 p-2">
        <div className="relative max-w-xs flex-1" style={{ minWidth: '13rem' }}>
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted))]" />
          <input
            className="input pl-7"
            placeholder="Card number or holder"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="input max-w-[10rem]"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.toLowerCase()}</option>
          ))}
        </select>
        {q.data && (
          <span className="ml-auto text-[11px] text-[rgb(var(--muted))]">
            showing {q.data.items.length} of {q.data.total} cards
          </span>
        )}
      </div>

      {q.isError && <div className="mb-3"><ErrorNote error={q.error} /></div>}
      {(setCardStatus.isError || setHolder.isError) && (
        <div className="mb-3">
          <ErrorNote error={setCardStatus.error ?? setHolder.error} />
        </div>
      )}

      {!q.isLoading && q.data?.items.length === 0 ? (
        <EmptyState message="No cards match" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table" style={{ minWidth: '46rem' }}>
            <thead>
              <tr>
                <th className="th">No.</th>
                <th className="th">Card number</th>
                <th className="th">Status</th>
                <th className="th">Issued to</th>
                <th className="th">Received</th>
                <th className="th">Issued</th>
              </tr>
            </thead>
            {q.isLoading ? <TableSkeleton rows={12} cols={6} /> : (
              <tbody>
                {(q.data?.items ?? []).map((v) => (
                  <tr key={v.id} className="row">
                    <td className="td num font-medium text-[rgb(var(--text))]">
                      {v.serialNo ?? '-'}
                    </td>
                    <td className="td font-mono text-[11px]">
                      <span className="inline-flex items-center gap-1.5">
                        <Ticket size={12} className="text-[rgb(var(--muted))]" />
                        {v.voucherNo}
                      </span>
                    </td>
                    <td className="td">
                      {canWrite ? (
                        <select
                          className="input"
                          style={{ maxWidth: '9rem' }}
                          value={v.status}
                          disabled={setCardStatus.isPending}
                          onChange={(e) => onStatusChange(v, e.target.value)}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>{s.toLowerCase()}</option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge status={v.status} />
                      )}
                    </td>
                    <td className="td">
                      {v.issuedTo ? (
                        <Link href={`/employees/${v.issuedTo.id}`} className="link">
                          {v.issuedTo.fullName}
                        </Link>
                      ) : v.issuedToName ? (
                        <span className="inline-flex items-center gap-1.5">
                          {v.issuedToName}
                          {canWrite && (
                            <button
                              className="btn-quiet btn-icon"
                              title="Change the name"
                              onClick={() => {
                                const who = window.prompt('Issued to', v.issuedToName ?? '');
                                if (who !== null) {
                                  setHolder.mutate({ id: v.id, issuedToName: who.trim() });
                                }
                              }}
                            >
                              <Pencil size={11} />
                            </button>
                          )}
                        </span>
                      ) : (
                        <span className="text-[rgb(var(--muted))]">-</span>
                      )}
                    </td>
                    <td className="td whitespace-nowrap">
                      {v.receivedAt ? format(new Date(v.receivedAt), 'd MMM yy') : '-'}
                    </td>
                    <td className="td whitespace-nowrap">
                      {v.issuedAt ? format(new Date(v.issuedAt), 'd MMM yy') : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      )}
    </>
  );
}
