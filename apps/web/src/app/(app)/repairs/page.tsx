'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Search, Pencil, Trash2, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader, ErrorNote, EmptyState, TableSkeleton, StatCard, Person } from '@/components/ui';

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

/** The form's fields: the sheet's columns, as text. */
interface Entry {
  bdeName: string; imei1: string; imei2: string; phoneModel: string; department: string; damage: string;
  givenDate: string; receivedDate: string; returnDate: string; note: string; deduction: boolean; price: string;
  repaired: boolean;
}

const EMPTY: Entry = {
  bdeName: '', imei1: '', imei2: '', phoneModel: '', department: 'Central Contact Center', damage: '',
  givenDate: '', receivedDate: '', returnDate: '', note: '', deduction: false, price: '', repaired: false,
};

const day = (iso: string | null) => (iso ? format(new Date(iso), 'd MMM yy') : '-');
const ymd = (iso: string | null) => (iso ? format(new Date(iso), 'yyyy-MM-dd') : '');

function toEntry(r: Row): Entry {
  return {
    bdeName: r.reportedBy?.fullName ?? r.reporterName ?? '',
    imei1: r.asset?.serialNumber ?? '',
    imei2: r.imei2 ?? '',
    phoneModel: r.asset?.model ?? '',
    department: r.department ?? '',
    damage: r.faultDescription === 'Not recorded' ? '' : r.faultDescription,
    givenDate: ymd(r.sentToVendorAt ?? r.reportedAt),
    receivedDate: ymd(r.receivedBackAt),
    returnDate: ymd(r.closedAt),
    note: r.resolution ?? '',
    deduction: r.chargedToEmployee,
    price: r.actualCost ? String(r.actualCost) : '',
    repaired: r.status === 'REPAIRED' || r.status === 'RETURNED_TO_STOCK',
  };
}

function toBody(e: Entry) {
  return {
    ...e,
    givenDate: e.givenDate || null,
    receivedDate: e.receivedDate || null,
    returnDate: e.returnDate || null,
    price: e.price.trim() === '' ? null : Number(e.price.replace(/[^\d.]/g, '')),
  };
}

export default function RepairsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const params = new URLSearchParams({
    page: String(page), pageSize: '50',
    ...(search ? { search } : {}), ...(openOnly ? { openOnly: 'true' } : {}),
  });

  const q = useQuery({
    queryKey: ['repairs', params.toString()],
    queryFn: () => api<Page>(`/repairs?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['repairs'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['assets'] });
  };

  const create = useMutation({
    mutationFn: (e: Entry) => api('/repairs/entry', { method: 'POST', body: toBody(e) }),
    onSuccess: () => { setAdding(false); refresh(); },
  });
  const update = useMutation({
    mutationFn: (vars: { id: string; e: Entry }) => api(`/repairs/${vars.id}/entry`, { method: 'PATCH', body: toBody(vars.e) }),
    onSuccess: () => { setEditing(null); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/repairs/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  const spend = (q.data?.items ?? []).reduce((sum, r) => sum + (r.actualCost ?? 0), 0);
  const canEdit = can('repair.update');
  const canAdd = can('repair.create');
  const cols = 13 + (canEdit ? 1 : 0);

  return (
    <>
      <PageHeader
        title="Repairs"
        description="Phones sent for repair, as the sheet's Repair tab records them: who, which phone, what was wrong, the dates, and the cost."
        actions={canAdd ? (
          <button className="btn-primary" onClick={() => { setEditing(null); setAdding(true); }} disabled={adding}>
            <Plus size={13} /> Add repair
          </button>
        ) : undefined}
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <StatCard label="Entries" value={q.data?.total ?? '-'} />
        <StatCard
          label="Not repaired (this page)"
          value={(q.data?.items ?? []).filter((r) => !['REPAIRED', 'RETURNED_TO_STOCK'].includes(r.status)).length}
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
          Not repaired only
        </label>
      </div>

      {q.isError && <div className="mb-3"><ErrorNote error={q.error} /></div>}
      {(create.isError || update.isError || remove.isError) && (
        <div className="mb-3"><ErrorNote error={create.error ?? update.error ?? remove.error} /></div>
      )}

      {adding && (
        <div className="card mb-3 p-3">
          <p className="mb-2 text-[13px] font-medium">New repair entry</p>
          <RepairForm initial={EMPTY} pending={create.isPending} saveLabel="Add entry"
                      onSave={(e) => create.mutate(e)} onCancel={() => setAdding(false)} />
        </div>
      )}

      {!q.isLoading && q.data?.items.length === 0 && !adding ? (
        <EmptyState message="No repair entries match" />
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
                {canEdit && <th className="th text-right">Edit</th>}
              </tr>
            </thead>
            {q.isLoading ? <TableSkeleton rows={8} cols={cols} /> : (
              <tbody>
                {(q.data?.items ?? []).map((r) => {
                  if (editing?.id === r.id) {
                    return (
                      <tr key={r.id} className="row">
                        <td className="td" colSpan={cols}>
                          <RepairForm initial={toEntry(r)} pending={update.isPending} saveLabel="Save changes"
                                      onSave={(e) => update.mutate({ id: r.id, e })} onCancel={() => setEditing(null)} />
                        </td>
                      </tr>
                    );
                  }
                  const repaired = r.status === 'REPAIRED' || r.status === 'RETURNED_TO_STOCK';
                  return (
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
                      <td className="td">
                        {canEdit ? (
                          <select
                            className="input rp-status"
                            data-repaired={repaired ? 'yes' : 'no'}
                            style={{ maxWidth: '9.5rem' }}
                            value={repaired ? 'yes' : 'no'}
                            disabled={update.isPending}
                            onChange={(e) => update.mutate({ id: r.id, e: { ...toEntry(r), repaired: e.target.value === 'yes' } })}
                          >
                            <option value="yes">Repaired</option>
                            <option value="no">Not repaired</option>
                          </select>
                        ) : (
                          <span className={repaired ? 'badge-ok' : 'badge-warn'}>{repaired ? 'repaired' : 'not repaired'}</span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="td text-right">
                          <div className="flex justify-end gap-0.5">
                            <button className="btn-quiet btn-icon" title="Edit this entry" onClick={() => { setAdding(false); setEditing(r); }}>
                              <Pencil size={13} />
                            </button>
                            <button
                              className="btn-quiet btn-icon"
                              title="Remove this entry"
                              style={{ color: 'rgb(var(--bad))' }}
                              disabled={remove.isPending}
                              onClick={() => {
                                if (window.confirm(`Remove this repair entry (${r.reporterName ?? 'no name'}: ${r.faultDescription})? It is archived, not destroyed.`)) {
                                  remove.mutate(r.id);
                                }
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
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
          <p className="text-[rgb(var(--muted))]">{q.data.total} entries - page {q.data.page} of {q.data.totalPages}</p>
          <div className="flex gap-1.5">
            <button className="btn-ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button className="btn-ghost" disabled={page >= q.data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}
    </>
  );
}

/** The sheet's columns as a form, used both to add an entry and to edit one. */
function RepairForm({
  initial, pending, saveLabel, onSave, onCancel,
}: { initial: Entry; pending: boolean; saveLabel: string; onSave: (e: Entry) => void; onCancel: () => void }) {
  const [e, setE] = useState<Entry>(initial);
  const set = (k: keyof Entry, v: string | boolean) => setE((cur) => ({ ...cur, [k]: v }));
  const field = (label: string, k: keyof Entry, props: Record<string, unknown> = {}) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" value={String(e[k] ?? '')} onChange={(ev) => set(k, ev.target.value)} {...props} />
    </label>
  );
  return (
    <form
      className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6"
      onSubmit={(ev) => { ev.preventDefault(); onSave(e); }}
    >
      {field('BDE name', 'bdeName', { placeholder: 'Who had the phone', autoFocus: true })}
      {field('IMEI 1', 'imei1', { inputMode: 'numeric', placeholder: '15 digits' })}
      {field('IMEI 2', 'imei2', { inputMode: 'numeric', placeholder: 'Optional' })}
      {field('Phone model', 'phoneModel', { placeholder: 'e.g. Samsung M02s' })}
      {field('Department', 'department')}
      {field('Damage', 'damage', { placeholder: 'What was wrong' })}
      {field('Given date', 'givenDate', { type: 'date' })}
      {field('Received date', 'receivedDate', { type: 'date' })}
      {field('Return date', 'returnDate', { type: 'date' })}
      {field('Note', 'note', { placeholder: 'e.g. Repaired' })}
      <label className="block">
        <span className="label">Deduction</span>
        <select className="input" value={e.deduction ? 'yes' : 'no'} onChange={(ev) => set('deduction', ev.target.value === 'yes')}>
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select>
      </label>
      {field('Price', 'price', { inputMode: 'decimal', placeholder: 'Rs' })}
      <label className="block">
        <span className="label">Status</span>
        <select className="input" value={e.repaired ? 'yes' : 'no'} onChange={(ev) => set('repaired', ev.target.value === 'yes')}>
          <option value="no">Not repaired</option>
          <option value="yes">Repaired</option>
        </select>
      </label>
      <div className="flex items-end gap-1.5 sm:col-span-2 lg:col-span-5">
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? 'Saving...' : saveLabel}</button>
        <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
