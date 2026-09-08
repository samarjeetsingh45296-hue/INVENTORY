'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader, StatusBadge, ErrorNote, EmptyState, TableSkeleton, StatCard, Person } from '@/components/ui';

/** One repair, with the same columns the sheet's Repair tab carries. */
interface Row {
  id: string;
  ticketNo: string;
  status: string;
  reporterName: string | null;
  department: string | null;
  faultDescription: string;
  resolution: string | null;
  reportedAt: string;
  sentToVendorAt: string | null;
  receivedBackAt: string | null;
  closedAt: string | null;
  actualCost: number | null;
  chargedToEmployee: boolean;
  imei2: string | null;
  reportedBy: { id: string; fullName: string; employeeCode: string; level: string | null } | null;
  asset: { id: string; assetTag: string; model: string | null; serialNumber: string | null; category: { name: string } } | null;
}
interface Page { items: Row[]; page: number; total: number; totalPages: number }

const NEXT_STATUS = [
  'REPORTED', 'APPROVED', 'SENT_TO_VENDOR', 'IN_PROGRESS', 'AWAITING_PARTS',
  'REPAIRED', 'RETURNED_TO_STOCK', 'UNREPAIRABLE', 'CANCELLED',
];

const day = (iso: string | null) => (iso ? format(new Date(iso), 'd MMM yy') : '-');

export default function RepairsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({
    page: String(page), pageSize: '50',
    ...(search ? { search } : {}), ...(openOnly ? { openOnly: 'true' } : {}),
  });

  const q = useQuery({
    queryKey: ['repairs', params.toString()],
    queryFn: () => api<Page>(`/repairs?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const progress = useMutation({
    mutationFn: (vars: { id: string; status: string }) =>
      api(`/repairs/${vars.id}`, { method: 'PATCH', body: { status: vars.status } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repairs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
  });

  const spend = (q.data?.items ?? []).reduce((sum, r) => sum + (r.actualCost ?? 0), 0);
  const canMove = can('repair.update');
  const cols = 13 + (canMove ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Repairs"
        description="Phones sent for repair, as the sheet's Repair tab records them: who, which phone, what was wrong, the dates, and the cost."
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <StatCard label="Tickets" value={q.data?.total ?? '-'} />
        <StatCard
          label="Still open (this page)"
          value={(q.data?.items ?? []).filter((r) => !['REPAIRED', 'RETURNED_TO_STOCK', 'CANCELLED', 'UNREPAIRABLE'].includes(r.status)).length}
          tone="warn"
        />
        <StatCard label="Spend (this page)" value={spend ? `Rs ${spend.toLocaleString('en-IN')}` : '-'} />
      </div>

      <div className="card mb-3 flex flex-wrap items-center gap-2 p-2">
        <div className="relative max-w-xs flex-1" style={{ minWidth: '14rem' }}>
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted))]" />
          <input
            className="input pl-7"
            placeholder="Name, IMEI, phone model, damage or department"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <label className="flex select-none items-center gap-1.5 text-[12px] text-[rgb(var(--text-2))]">
          <input type="checkbox" checked={openOnly} onChange={(e) => { setOpenOnly(e.target.checked); setPage(1); }} />
          Open tickets only
        </label>
      </div>

      {q.isError && <div className="mb-3"><ErrorNote error={q.error} /></div>}
      {progress.isError && <div className="mb-3"><ErrorNote error={progress.error} /></div>}

      {!q.isLoading && q.data?.items.length === 0 ? (
        <EmptyState message="No repair tickets match" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table" style={{ minWidth: '96rem' }}>
            <thead>
              <tr>
                <th className="th">BDE name</th>
                <th className="th">IMEI 1</th>
                <th className="th">IMEI 2</th>
                <th className="th">Phone model</th>
                <th className="th">Department</th>
                <th className="th">Damage</th>
                <th className="th">Given date</th>
                <th className="th">Received date</th>
                <th className="th">Return date</th>
                <th className="th">Note</th>
                <th className="th">Deduction</th>
                <th className="th num">Price</th>
                <th className="th">Status</th>
                {canMove && <th className="th">Move to</th>}
              </tr>
            </thead>
            {q.isLoading ? <TableSkeleton rows={8} cols={cols} /> : (
              <tbody>
                {(q.data?.items ?? []).map((r) => (
                  <tr key={r.id} className="row">
                    <td className="td whitespace-nowrap font-medium text-[rgb(var(--text))]">
                      {r.reportedBy ? (
                        <Link href={`/employees/${r.reportedBy.id}`} className="link">
                          <Person name={r.reportedBy.fullName} level={r.reportedBy.level} />
                        </Link>
                      ) : (r.reporterName ?? '-')}
                    </td>
                    <td className="td whitespace-nowrap font-mono text-[12.5px]">{r.asset?.serialNumber ?? '-'}</td>
                    <td className="td whitespace-nowrap font-mono text-[12.5px]">{r.imei2 ?? '-'}</td>
                    <td className="td whitespace-nowrap">{r.asset?.model ?? r.asset?.category.name ?? '-'}</td>
                    <td className="td whitespace-nowrap">{r.department ?? '-'}</td>
                    <td className="td max-w-[18rem]" title={r.faultDescription}>{r.faultDescription}</td>
                    <td className="td whitespace-nowrap">{day(r.sentToVendorAt ?? r.reportedAt)}</td>
                    <td className="td whitespace-nowrap">{day(r.receivedBackAt)}</td>
                    <td className="td whitespace-nowrap">{day(r.closedAt)}</td>
                    <td className="td max-w-[14rem]" title={r.resolution ?? ''}>{r.resolution ?? '-'}</td>
                    <td className="td">{r.chargedToEmployee ? <span className="badge-warn">yes</span> : <span className="text-[rgb(var(--muted))]">-</span>}</td>
                    <td className="td num">{r.actualCost ? r.actualCost.toLocaleString('en-IN') : '-'}</td>
                    <td className="td"><StatusBadge status={r.status} /></td>
                    {canMove && (
                      <td className="td">
                        <select
                          className="input"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) progress.mutate({ id: r.id, status: e.target.value });
                          }}
                        >
                          <option value="">change...</option>
                          {NEXT_STATUS.filter((s) => s !== r.status).map((s) => (
                            <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>
                          ))}
                        </select>
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
          <p className="text-[rgb(var(--muted))]">{q.data.total} tickets - page {q.data.page} of {q.data.totalPages}</p>
          <div className="flex gap-1.5">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button className="btn-ghost" disabled={page >= q.data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </>
  );
}
