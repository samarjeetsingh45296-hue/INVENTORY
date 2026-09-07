'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, KeyRound, Pencil, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
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
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Row | null>(null);
  const canEdit = can('locker.allocate');
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['lockers'] });
    queryClient.invalidateQueries({ queryKey: ['kpis'] });
  };

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
          <option value="">All keys</option>
          <option value="ALLOCATED">Allocated</option>
          <option value="AVAILABLE">Available</option>
          <option value="RETURNED">Returned</option>
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
                {canEdit && <th className="th text-right">Change</th>}
              </tr>
            </thead>
            {q.isLoading ? <TableSkeleton rows={10} cols={canEdit ? 7 : 6} /> : (
              <tbody>
                {(q.data?.items ?? []).map((r) => {
                  const a = r.allocations[0];
                  if (editing?.id === r.id) {
                    return (
                      <tr key={r.id} className="row">
                        <td className="td" colSpan={canEdit ? 7 : 6}>
                          <KeyEditor row={r} onDone={() => { setEditing(null); refresh(); }} onCancel={() => setEditing(null)} />
                        </td>
                      </tr>
                    );
                  }
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
                      {canEdit && (
                        <td className="td text-right">
                          <button className="btn-quiet btn-icon" title="Change status or holder" onClick={() => setEditing(r)}>
                            <Pencil size={13} />
                          </button>
                        </td>
                      )}
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

/**
 * The change control for one key: pick who holds it, or mark it returned
 * (available). A new holder replaces the current one in a single step.
 */
function KeyEditor({ row, onDone, onCancel }: { row: Row; onDone: () => void; onCancel: () => void }) {
  const current = row.allocations[0]?.employee ?? null;
  const [mode, setMode] = useState<'ALLOCATED' | 'AVAILABLE'>(current ? 'ALLOCATED' : 'AVAILABLE');
  const [who, setWho] = useState('');
  const [picked, setPicked] = useState<{ id: string; fullName: string; employeeCode: string } | null>(current);

  const people = useQuery({
    queryKey: ['employees', 'pick', who],
    queryFn: () => api<{ items: Array<{ id: string; fullName: string; employeeCode: string; level: string | null }> }>(
      `/employees?pageSize=8&search=${encodeURIComponent(who)}`,
    ),
    enabled: mode === 'ALLOCATED' && who.trim().length >= 2,
  });

  const save = useMutation({
    mutationFn: async () => {
      if (mode === 'AVAILABLE') {
        if (current) await api(`/lockers/${row.id}/release`, { method: 'POST', body: { keyReturned: true } });
        return;
      }
      if (!picked) throw new Error('Pick who holds the key.');
      if (picked.id === current?.id) return;
      await api(`/lockers/${row.id}/reassign`, { method: 'POST', body: { employeeId: picked.id, keyIssued: true } });
    },
    onSuccess: onDone,
  });

  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <span className="inline-flex items-center gap-1.5 font-medium text-[rgb(var(--text))]">
        <KeyRound size={12} className="text-[rgb(var(--muted))]" /> {row.lockerNo}
      </span>
      <select className="input max-w-[10rem]" value={mode} onChange={(e) => setMode(e.target.value as 'ALLOCATED' | 'AVAILABLE')}>
        <option value="ALLOCATED">Allocated to</option>
        <option value="AVAILABLE">Returned / available</option>
      </select>
      {mode === 'ALLOCATED' && (
        <div className="relative" style={{ minWidth: '16rem' }}>
          {picked ? (
            <span className="input flex items-center justify-between gap-2">
              <span className="truncate">{picked.fullName} <span className="font-mono text-[11px] text-[rgb(var(--muted))]">{picked.employeeCode}</span></span>
              <button type="button" className="text-[rgb(var(--muted))]" title="Choose someone else" onClick={() => { setPicked(null); setWho(''); }}>
                <X size={12} />
              </button>
            </span>
          ) : (
            <>
              <input className="input" placeholder="Type a name or code..." value={who} autoFocus
                     onChange={(e) => setWho(e.target.value)} />
              {people.data && people.data.items.length > 0 && (
                <ul className="card absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto py-1 text-[13px]">
                  {people.data.items.map((p) => (
                    <li key={p.id}>
                      <button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[rgb(var(--surface-3))]"
                              onClick={() => setPicked({ id: p.id, fullName: p.fullName, employeeCode: p.employeeCode })}>
                        <Person name={p.fullName} level={p.level} />
                        <span className="font-mono text-[11px] text-[rgb(var(--muted))]">{p.employeeCode}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
      <button className="btn-primary" disabled={save.isPending || (mode === 'ALLOCATED' && !picked)} onClick={() => save.mutate()}>
        {save.isPending ? 'Saving...' : 'Save'}
      </button>
      <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      {save.isError && <span className="text-[12px] text-[rgb(var(--bad))]">{save.error instanceof Error ? save.error.message : 'Could not save.'}</span>}
    </div>
  );
}
