'use client';

import { useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useRealtime } from '@/hooks/use-realtime';
import { useAuth } from '@/lib/auth';
import { PageHeader, StatusBadge, ErrorNote, EmptyState } from '@/components/ui';

interface Asset {
  id: string;
  assetTag: string;
  serialNumber: string | null;
  make: string | null;
  model: string | null;
  status: string;
  condition: string;
  category: { name: string };
  branch: { name: string } | null;
  location: { name: string; path: string } | null;
  allocations: Array<{
    id: string;
    holderLabel: string | null;
    employee: { fullName: string; employeeCode: string } | null;
  }>;
}

interface Page {
  items: Asset[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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

  const params = new URLSearchParams({
    page: String(page),
    pageSize: '25',
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
    ['asset.created', 'asset.updated', 'asset.archived', 'allocation.created', 'allocation.returned'],
    () => queryClient.invalidateQueries({ queryKey: ['assets'] }),
  );

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Every asset held in the database, with its current holder."
      />

      <div className="card mb-4 flex flex-wrap gap-3 p-3">
        <input
          className="input max-w-xs"
          placeholder="Search tag, serial, model..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="input max-w-[12rem]"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </select>

        {can('asset.restore') && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => {
                setIncludeArchived(e.target.checked);
                setPage(1);
              }}
            />
            Show archived
          </label>
        )}
      </div>

      {query.isError && <ErrorNote error={query.error} />}

      {query.data?.items.length === 0 ? (
        <EmptyState
          message="No assets match this view"
          hint="Import a sheet from the Sheet Sync screen, or add an asset manually."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[52rem]">
            <thead>
              <tr>
                <th className="th">Asset tag</th>
                <th className="th">Category</th>
                <th className="th">Make / model</th>
                <th className="th">Serial</th>
                <th className="th">Status</th>
                <th className="th">Issued to</th>
                <th className="th">Location</th>
              </tr>
            </thead>
            <tbody>
              {(query.data?.items ?? []).map((a) => {
                const holder = a.allocations[0];
                return (
                  <tr key={a.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                    <td className="td font-medium">{a.assetTag}</td>
                    <td className="td">{a.category.name}</td>
                    <td className="td">
                      {[a.make, a.model].filter(Boolean).join(' ') || '-'}
                    </td>
                    <td className="td font-mono text-xs">{a.serialNumber ?? '-'}</td>
                    <td className="td"><StatusBadge status={a.status} /></td>
                    <td className="td">
                      {holder?.employee
                        ? `${holder.employee.fullName} (${holder.employee.employeeCode})`
                        : (holder?.holderLabel ?? '-')}
                    </td>
                    <td className="td text-[rgb(var(--muted))]">
                      {a.location?.name ?? a.branch?.name ?? '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {query.data && query.data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-[rgb(var(--muted))]">
            {query.data.total} assets - page {query.data.page} of {query.data.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              className="btn-ghost"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
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
    </>
  );
}
