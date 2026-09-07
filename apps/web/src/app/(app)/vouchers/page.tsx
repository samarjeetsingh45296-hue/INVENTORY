'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Search, Ticket, Pencil } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  PageHeader, StatusBadge, ErrorNote, EmptyState, TableSkeleton, StatCard, Person,
} from '@/components/ui';
import { EmployeePicker, type PickedEmployee } from '@/components/employee-picker';

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
  issuedTo: { id: string; fullName: string; employeeCode: string; level: string | null } | null;
}

interface Page {
  items: Row[];
  summary: { byStatus: Array<{ status: string; count: number }> };
  page: number; total: number; totalPages: number;
}

/** A card is either in the drawer or with someone. */
const STATUSES = [
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'ISSUED', label: 'Issued' },
];

export default function VouchersPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  /** The card whose holder is being chosen. */
  const [issuing, setIssuing] = useState<Row | null>(null);

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
    mutationFn: (vars: { id: string; status: string; employeeId?: string; issuedToName?: string }) =>
      api(`/vouchers/${vars.id}/status`, {
        method: 'POST',
        body: { status: vars.status, employeeId: vars.employeeId, issuedToName: vars.issuedToName },
      }),
    onSuccess: () => { setIssuing(null); refresh(); },
  });

  const counts = Object.fromEntries(
    (q.data?.summary.byStatus ?? []).map((s) => [s.status, s.count]),
  );
  const canWrite = can('asset.update');

  function onStatusChange(row: Row, next: string) {
    if (next === row.status) return;
    // Issuing needs a person: the picker opens in the row.
    if (next === 'ISSUED') { setIssuing(row); return; }
    if (next === 'AVAILABLE' && row.issuedToName) {
      const ok = window.confirm(
        `Put card ${row.voucherNo} back in the drawer?\n\n` +
          `${row.issuedToName} will be cleared from the card. The change stays on the audit trail.`,
      );
      if (!ok) return;
    }
    setCardStatus.mutate({ id: row.id, status: next });
  }

  // Anything that is not "issued" reads as available on this page.
  const shown = (s: string) => (s === 'ISSUED' ? 'ISSUED' : 'AVAILABLE');

  return (
    <>
      <PageHeader
        title="PVR cards"
        description="Movie vouchers held for rewards. One row is one card - issue it to a person, or put it back in the drawer."
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <StatCard label="Cards" value={q.data?.total ?? '-'} />
        <StatCard label="In the drawer" value={(q.data?.total ?? 0) - (counts.ISSUED ?? 0)} tone="ok" />
        <StatCard label="Issued" value={counts.ISSUED ?? 0} />
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
          <option value="">All cards</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {q.data && (
          <span className="ml-auto text-[11px] text-[rgb(var(--muted))]">
            showing {q.data.items.length} of {q.data.total} cards
          </span>
        )}
      </div>

      {q.isError && <div className="mb-3"><ErrorNote error={q.error} /></div>}
      {setCardStatus.isError && (
        <div className="mb-3"><ErrorNote error={setCardStatus.error} /></div>
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
                    <td className="td whitespace-nowrap font-mono text-[14px] tracking-wide text-[rgb(var(--text))]">
                      <span className="inline-flex items-center gap-2">
                        <Ticket size={14} className="text-[rgb(var(--muted))]" />
                        {v.voucherNo}
                      </span>
                    </td>
                    <td className="td">
                      {canWrite ? (
                        <select
                          className="input"
                          style={{ maxWidth: '9rem' }}
                          value={issuing?.id === v.id ? 'ISSUED' : shown(v.status)}
                          disabled={setCardStatus.isPending}
                          onChange={(e) => onStatusChange(v, e.target.value)}
                        >
                          {STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge status={shown(v.status)} />
                      )}
                    </td>
                    <td className="td">
                      {issuing?.id === v.id ? (
                        <IssueTo
                          card={v}
                          pending={setCardStatus.isPending}
                          onPick={(p) => setCardStatus.mutate({ id: v.id, status: 'ISSUED', employeeId: p.id, issuedToName: p.fullName })}
                          onCancel={() => setIssuing(null)}
                        />
                      ) : v.issuedTo ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Link href={`/employees/${v.issuedTo.id}`} className="link">
                            <Person name={v.issuedTo.fullName} level={v.issuedTo.level} />
                          </Link>
                          {canWrite && (
                            <button className="btn-quiet btn-icon" title="Issue to someone else" onClick={() => setIssuing(v)}>
                              <Pencil size={11} />
                            </button>
                          )}
                        </span>
                      ) : v.issuedToName ? (
                        <span className="inline-flex items-center gap-1.5">
                          {v.issuedToName}
                          <span className="text-[11px] text-[rgb(var(--muted))]">not on record</span>
                          {canWrite && (
                            <button className="btn-quiet btn-icon" title="Link to a person on record" onClick={() => setIssuing(v)}>
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

/** The picker that appears in the Issued to cell while a card is being issued. */
function IssueTo({
  card, pending, onPick, onCancel,
}: { card: Row; pending: boolean; onPick: (p: PickedEmployee) => void; onCancel: () => void }) {
  const [picked, setPicked] = useState<PickedEmployee | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <EmployeePicker value={picked} onChange={setPicked} autoFocus placeholder={`Issue ${card.voucherNo} to...`} />
      <button className="btn-primary" disabled={!picked || pending} onClick={() => picked && onPick(picked)}>
        {pending ? 'Saving...' : 'Issue'}
      </button>
      <button className="btn-ghost" onClick={onCancel}>Cancel</button>
    </span>
  );
}
