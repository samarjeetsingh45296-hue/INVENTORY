'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Search, Wrench } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader, StatusBadge, ErrorNote, EmptyState, TableSkeleton, StatCard } from '@/components/ui';

interface Row {
  id: string;
  ticketNo: string;
  status: string;
  faultDescription: string;
  resolution: string | null;
  reportedAt: string;
  receivedBackAt: string | null;
  actualCost: number | null;
  chargedToEmployee: boolean;
  asset: { id: string; assetTag: string; model: string | null; serialNumber: string | null; category: { name: string } } | null;
}
interface Page { items: Row[]; page: number; total: number; totalPages: number }

const NEXT_STATUS = [
  'REPORTED', 'APPROVED', 'SENT_TO_VENDOR', 'IN_PROGRESS', 'AWAITING_PARTS',
  'REPAIRED', 'RETURNED_TO_STOCK', 'UNREPAIRABLE', 'CANCELLED',
];

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

  return (
    <>
      <PageHeader
        title="Repairs"
        description="Equipment sent for repair, what it cost, and whether it came back."
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <StatCard label="Tickets" value={q.data?.total ?? '-'} />
        <StatCard
          label="Still open (this page)"
          value={(q.data?.items ?? []).filter((r) => !['RETURNED_TO_STOCK', 'CANCELLED', 'UNREPAIRABLE'].includes(r.status)).length}
          tone="warn"
        />
        <StatCard label="Spend (this page)" value={spend ? `Rs ${spend.toLocaleString('en-IN')}` : '-'} />
      </div>

      <div className="card mb-3 flex flex-wrap items-center gap-2 p-2">
        <div className="relative max-w-xs flex-1" style={{ minWidth: '14rem' }}>
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted))]" />
          <input
            className="input pl-7"
            placeholder="Ticket, fault, asset tag or IMEI"
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
          <table className="table" style={{ minWidth: '58rem' }}>
            <thead>
              <tr>
                <th className="th">Ticket</th>
                <th className="th">Asset</th>
                <th className="th">Fault</th>
                <th className="th">Status</th>
                <th className="th">Reported</th>
                <th className="th">Back</th>
                <th className="th num">Cost</th>
                {can('repair.update') && <th className="th">Move to</th>}
              </tr>
            </thead>
            {q.isLoading ? <TableSkeleton rows={8} cols={8} /> : (
              <tbody>
                {(q.data?.items ?? []).map((r) => (
                  <tr key={r.id} className="row">
                    <td className="td font-medium text-[rgb(var(--text))]">
                      <span className="inline-flex items-center gap-1.5">
                        <Wrench size={12} className="text-[rgb(var(--muted))]" />
                        {r.ticketNo}
                      </span>
                    </td>
                    <td className="td">
                      {r.asset ? (
                        <>
                          <span className="font-medium text-[rgb(var(--text))]">{r.asset.assetTag}</span>
                          <div className="text-[11px] text-[rgb(var(--muted))]">{r.asset.model ?? r.asset.category.name}</div>
                        </>
                      ) : '-'}
                    </td>
                    <td className="td max-w-[16rem] truncate" title={r.faultDescription}>{r.faultDescription}</td>
                    <td className="td"><StatusBadge status={r.status} /></td>
                    <td className="td whitespace-nowrap">{format(new Date(r.reportedAt), 'd MMM yy')}</td>
                    <td className="td whitespace-nowrap">
                      {r.receivedBackAt ? format(new Date(r.receivedBackAt), 'd MMM yy') : '-'}
                    </td>
                    <td className="td num">
                      {r.actualCost ? r.actualCost.toLocaleString('en-IN') : '-'}
                      {r.chargedToEmployee && <div className="text-[10px] text-[rgb(var(--warn))]">recovered</div>}
                    </td>
                    {can('repair.update') && (
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
    </>
  );
}
