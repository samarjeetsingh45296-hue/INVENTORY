'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Plus, Pencil, Archive, RotateCcw, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useRealtime } from '@/hooks/use-realtime';
import { useAuth } from '@/lib/auth';
import {
  PageHeader, StatusBadge, ErrorNote, EmptyState, TableSkeleton,
} from '@/components/ui';
import { AssetForm, type AssetRow } from './asset-form';

interface Row extends AssetRow {
  deletedAt: string | null;
  branch: { name: string } | null;
  location: { name: string } | null;
  allocations: Array<{
    id: string;
    holderLabel: string | null;
    employee: { fullName: string; employeeCode: string } | null;
  }>;
}

interface Page {
  items: Row[];
  page: number; pageSize: number; total: number; totalPages: number;
}

const STATUSES = [
  'IN_STOCK', 'ALLOCATED', 'IN_REPAIR', 'RESERVED',
  'LOST', 'RETIRED', 'SCRAPPED',
];

export default function AssetsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [creating, setCreating] = useState(false);

  const params = new URLSearchParams({
    page: String(page), pageSize: '25',
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(includeArchived ? { includeArchived: 'true' } : {}),
  });

  const query = useQuery({
    queryKey: ['assets', params.toString()],
    queryFn: () => api<Page>(`/assets?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  useRealtime(
    ['asset.created', 'asset.updated', 'asset.archived', 'asset.restored',
     'allocation.created', 'allocation.returned'],
    () => queryClient.invalidateQueries({ queryKey: ['assets'] }),
  );

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['assets'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const archive = useMutation({
    mutationFn: (vars: { id: string; reason: string }) =>
      api<{ applied: boolean; message: string }>(`/assets/${vars.id}/archive-request`, {
        method: 'POST', body: { reason: vars.reason },
      }),
    onSuccess: (res) => { refresh(); alert(res.message); },
  });

  const restore = useMutation({
    mutationFn: (id: string) => api(`/assets/${id}/restore`, { method: 'POST' }),
    onSuccess: refresh,
  });

  const canWrite = can('asset.create');
  const cols = canWrite ? 8 : 7;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Every asset held in the database, with its current holder."
        actions={
          canWrite ? (
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus size={13} /> Add asset
            </button>
          ) : undefined
        }
      />

      <div className="card mb-3 flex flex-wrap items-center gap-2 p-2">
        <div className="relative max-w-xs flex-1" style={{ minWidth: '14rem' }}>
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted))]"
          />
          <input
            className="input pl-7"
            placeholder="Search tag, serial, make or model"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        <select
          className="input max-w-[11rem]"
          value={status}
          onChange={(e) => { setStatus(e.target.value); setPage(1); }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ').toLowerCase()}</option>
          ))}
        </select>

        {can('asset.restore') && (
          <label className="flex select-none items-center gap-1.5 text-[12px] text-[rgb(var(--text-2))]">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => { setIncludeArchived(e.target.checked); setPage(1); }}
            />
            Show archived
          </label>
        )}

        {query.data && (
          <span className="ml-auto text-[11px] text-[rgb(var(--muted))]">
            {query.data.total} record{query.data.total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {query.isError && <div className="mb-3"><ErrorNote error={query.error} /></div>}

      {!query.isLoading && query.data?.items.length === 0 ? (
        <EmptyState
          message="No assets match this view"
          hint="Import a sheet from Sheet Sync, or add one by hand."
          action={
            canWrite ? (
              <button className="btn-primary" onClick={() => setCreating(true)}>
                <Plus size={13} /> Add the first asset
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table" style={{ minWidth: '54rem' }}>
            <thead>
              <tr>
                <th className="th">Asset tag</th>
                <th className="th">Category</th>
                <th className="th">Make / model</th>
                <th className="th">Serial</th>
                <th className="th">Status</th>
                <th className="th">Issued to</th>
                <th className="th">Location</th>
                {canWrite && <th className="th text-right">Actions</th>}
              </tr>
            </thead>

            {query.isLoading ? (
              <TableSkeleton rows={8} cols={cols} />
            ) : (
              <tbody>
                {(query.data?.items ?? []).map((a) => {
                  const holder = a.allocations?.[0];
                  const archived = a.deletedAt !== null;
                  return (
                    <tr key={a.id} className={archived ? 'row opacity-50' : 'row'}>
                      <td className="td font-medium text-[rgb(var(--text))]">
                        {a.assetTag}
                        {archived && <span className="badge-mute ml-1.5">archived</span>}
                      </td>
                      <td className="td">{a.category?.name ?? '-'}</td>
                      <td className="td">{[a.make, a.model].filter(Boolean).join(' ') || '-'}</td>
                      <td className="td font-mono text-[11px]">{a.serialNumber ?? '-'}</td>
                      <td className="td"><StatusBadge status={a.status} /></td>
                      <td className="td">
                        {holder?.employee
                          ? `${holder.employee.fullName} (${holder.employee.employeeCode})`
                          : (holder?.holderLabel ?? '-')}
                      </td>
                      <td className="td">{a.location?.name ?? a.branch?.name ?? '-'}</td>
                      {canWrite && (
                        <td className="td">
                          <div className="flex justify-end gap-1">
                            {!archived && can('asset.update') && (
                              <button
                                className="btn-quiet btn-icon"
                                title="Edit"
                                onClick={() => setEditing(a)}
                              >
                                <Pencil size={13} />
                              </button>
                            )}
                            {!archived && can('asset.delete') && (
                              <button
                                className="btn-quiet btn-icon"
                                title="Archive"
                                style={{ color: 'rgb(var(--bad))' }}
                                onClick={() => {
                                  const reason = window.prompt(
                                    'Archive ' + a.assetTag + '?\n\n' +
                                      'Nothing is deleted. The record, its allocation history ' +
                                      'and its timeline are kept, and it can be restored.\n\nReason:',
                                  );
                                  if (reason) archive.mutate({ id: a.id, reason });
                                }}
                              >
                                <Archive size={13} />
                              </button>
                            )}
                            {archived && can('asset.restore') && (
                              <button
                                className="btn-quiet btn-icon"
                                title="Restore"
                                onClick={() => restore.mutate(a.id)}
                              >
                                <RotateCcw size={13} />
                              </button>
                            )}
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

      {query.data && query.data.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-[12px]">
          <p className="text-[rgb(var(--muted))]">
            Page {query.data.page} of {query.data.totalPages}
          </p>
          <div className="flex gap-1.5">
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

      {(creating || editing) && (
        <AssetForm
          asset={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
        />
      )}
    </>
  );
}
