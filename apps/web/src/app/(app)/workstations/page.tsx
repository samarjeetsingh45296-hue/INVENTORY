'use client';

import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search, Armchair, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, ErrorNote, EmptyState, TableSkeleton, StatCard } from '@/components/ui';

interface Row {
  id: string;
  seatCode: string;
  process: string | null;
  chair: string | null;
  equipment: string[];
  missing: string[];
  location: { id: string; name: string } | null;
}
interface Page {
  items: Row[];
  locations: Array<{ id: string; name: string }>;
  page: number; total: number; totalPages: number;
}

export default function WorkstationsPage() {
  const [search, setSearch] = useState('');
  const [locationId, setLocationId] = useState('');
  const [gapsOnly, setGapsOnly] = useState(false);
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({
    page: String(page), pageSize: '50',
    ...(search ? { search } : {}),
    ...(locationId ? { locationId } : {}),
    ...(gapsOnly ? { gapsOnly: 'true' } : {}),
  });

  const q = useQuery({
    queryKey: ['workstations', params.toString()],
    queryFn: () => api<Page>(`/workstations?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  const withGaps = (q.data?.items ?? []).filter((w) => w.missing.length > 0).length;

  return (
    <>
      <PageHeader
        title="Workstations"
        description="Seats on the floor and the equipment at each one. Anything missing is called out."
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <StatCard label="Stations" value={q.data?.total ?? '-'} />
        <StatCard label="Wings" value={q.data?.locations.length ?? '-'} />
        <StatCard label="With gaps (this page)" value={withGaps} tone={withGaps ? 'warn' : 'ok'} />
      </div>

      <div className="card mb-3 flex flex-wrap items-center gap-2 p-2">
        <div className="relative max-w-xs flex-1" style={{ minWidth: '13rem' }}>
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted))]" />
          <input
            className="input pl-7"
            placeholder="Station id or process"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="input max-w-[10rem]"
          value={locationId}
          onChange={(e) => { setLocationId(e.target.value); setPage(1); }}
        >
          <option value="">All wings</option>
          {(q.data?.locations ?? []).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <label className="flex select-none items-center gap-1.5 text-[12px] text-[rgb(var(--text-2))]">
          <input
            type="checkbox"
            checked={gapsOnly}
            onChange={(e) => { setGapsOnly(e.target.checked); setPage(1); }}
          />
          Only stations missing equipment
        </label>
      </div>

      {q.isError && <div className="mb-3"><ErrorNote error={q.error} /></div>}

      {!q.isLoading && q.data?.items.length === 0 ? (
        <EmptyState message="No stations match" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table" style={{ minWidth: '52rem' }}>
            <thead>
              <tr>
                <th className="th">Station</th>
                <th className="th">Wing</th>
                <th className="th">Process</th>
                <th className="th">Equipment present</th>
                <th className="th">Missing</th>
                <th className="th">Chair</th>
              </tr>
            </thead>
            {q.isLoading ? <TableSkeleton rows={10} cols={6} /> : (
              <tbody>
                {(q.data?.items ?? []).map((w) => (
                  <tr key={w.id} className="row">
                    <td className="td font-medium text-[rgb(var(--text))]">
                      <span className="inline-flex items-center gap-1.5">
                        <Armchair size={12} className="text-[rgb(var(--muted))]" />
                        {w.seatCode}
                      </span>
                    </td>
                    <td className="td">{w.location?.name ?? '-'}</td>
                    <td className="td">{w.process ?? '-'}</td>
                    <td className="td">
                      <div className="flex flex-wrap gap-1">
                        {w.equipment.length === 0
                          ? <span className="text-[rgb(var(--muted))]">none</span>
                          : w.equipment.map((e, i) => (
                              <span key={`${e}-${i}`} className="badge-mute">{e}</span>
                            ))}
                      </div>
                    </td>
                    <td className="td">
                      {w.missing.length === 0 ? (
                        <span className="badge-ok">complete</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[rgb(var(--warn))]">
                          <TriangleAlert size={12} />
                          {w.missing.join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="td">{w.chair ?? '-'}</td>
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
            {q.data.total} stations - page {q.data.page} of {q.data.totalPages}
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
