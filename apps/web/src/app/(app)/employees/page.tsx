'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import {
  Avatar, PageHeader, StatusBadge, ErrorNote, EmptyState, LevelChip, TableSkeleton,
} from '@/components/ui';
import { TeamSelector, TEAMS, teamLabel, type Team } from './team-selector';

interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  level: string | null;
  officialEmail: string | null;
  phone: string | null;
  employmentStatus: string;
  branch: { name: string } | null;
  department: { name: string } | null;
  designation: { name: string } | null;
}

interface Page { items: Employee[]; total: number; totalPages: number }

function parseTeam(raw: string | null): Team | null {
  return TEAMS.some((t) => t.id === raw) ? (raw as Team) : null;
}

export default function EmployeesPage() {
  return (
    <Suspense fallback={null}>
      <Employees />
    </Suspense>
  );
}

function Employees() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const team = parseTeam(searchParams.get('team'));

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  function chooseTeam(next: Team) {
    setPage(1);
    setSearch('');
    router.replace(`${pathname}?team=${next}`);
  }

  // Headcount per team for the selector, cheap: one row each.
  const counts = useQuery({
    queryKey: ['employees', 'team-counts'],
    queryFn: async () => {
      const pairs = await Promise.all(
        TEAMS.map(async (t) => {
          const r = await api<Page>(`/employees?team=${t.id}&pageSize=1`);
          return [t.id, r.total] as const;
        }),
      );
      return Object.fromEntries(pairs) as Record<Team, number>;
    },
    staleTime: 60_000,
  });

  const params = new URLSearchParams({
    page: String(page),
    pageSize: '25',
    ...(team ? { team } : {}),
    ...(search ? { search } : {}),
  });

  // Nothing is listed until a team is chosen.
  const query = useQuery({
    queryKey: ['employees', params.toString()],
    queryFn: () => api<Page>(`/employees?${params.toString()}`),
    placeholderData: keepPreviousData,
    enabled: team !== null,
  });

  return (
    <>
      <PageHeader
        title="Employees"
        description={
          team
            ? `${teamLabel(team)} on record, with the equipment they hold.`
            : 'Pick a team to see its people and the equipment they hold.'
        }
      />

      <div className="mb-4 flex flex-wrap items-start gap-3">
        <TeamSelector value={team} counts={counts.data} onChange={chooseTeam} />

        {team && (
          <div className="es-body relative max-w-xs flex-1" style={{ minWidth: '14rem' }}>
            <Search
              size={13}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted))]"
            />
            <input
              className="input h-11 pl-7"
              placeholder="Search name, code, email or phone..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        )}

        {team && query.data && (
          <span className="es-body ml-auto self-center text-[11px] text-[rgb(var(--muted))]">
            {query.data.total} {query.data.total === 1 ? 'person' : 'people'} in {teamLabel(team)}
          </span>
        )}
      </div>

      {team === null ? null : (
        <div key={team} className="es-body">
          {query.isError && <ErrorNote error={query.error} />}

          {!query.isLoading && query.data?.items.length === 0 ? (
            <EmptyState
              message={`No one in ${teamLabel(team)} matches`}
              hint="Import an employee sheet from the Sheet Sync screen."
            />
          ) : (
            <div className="card overflow-x-auto">
              <table className="table min-w-[46rem]">
                <thead>
                  <tr>
                    <th className="th">Code</th>
                    <th className="th">Name</th>
                    <th className="th">Level</th>
                    <th className="th">Department</th>
                    <th className="th">Designation</th>
                    <th className="th">Branch</th>
                    <th className="th">Contact</th>
                    <th className="th">Status</th>
                  </tr>
                </thead>
                {query.isLoading ? <TableSkeleton rows={8} cols={8} /> : (
                  <tbody>
                    {(query.data?.items ?? []).map((e) => (
                      <tr key={e.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03]">
                        <td className="td font-mono text-xs">{e.employeeCode}</td>
                        <td className="td font-medium">
                          <Link
                            href={`/employees/${e.id}`}
                            className="link inline-flex items-center gap-2 text-[rgb(var(--text))]"
                          >
                            <Avatar name={e.fullName} />
                            {e.fullName}
                          </Link>
                        </td>
                        <td className="td">{e.level ? <LevelChip level={e.level} /> : <span className="text-[rgb(var(--muted))]">-</span>}</td>
                        <td className="td">{e.department?.name ?? '-'}</td>
                        <td className="td">{e.designation?.name ?? '-'}</td>
                        <td className="td">{e.branch?.name ?? '-'}</td>
                        <td className="td text-xs">
                          {e.officialEmail ?? '-'}
                          {e.phone && <div className="text-[rgb(var(--muted))]">{e.phone}</div>}
                        </td>
                        <td className="td"><StatusBadge status={e.employmentStatus} /></td>
                      </tr>
                    ))}
                  </tbody>
                )}
              </table>
            </div>
          )}

          {query.data && query.data.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <p className="text-[rgb(var(--muted))]">
                {query.data.total} employees - page {page} of {query.data.totalPages}
              </p>
              <div className="flex gap-2">
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
        </div>
      )}
    </>
  );
}
