'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Avatar, PageHeader, StatusBadge, ErrorNote, EmptyState } from '@/components/ui';

interface Employee {
  id: string;
  employeeCode: string;
  fullName: string;
  officialEmail: string | null;
  phone: string | null;
  employmentStatus: string;
  branch: { name: string } | null;
  department: { name: string } | null;
  designation: { name: string } | null;
}

export default function EmployeesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const params = new URLSearchParams({
    page: String(page),
    pageSize: '25',
    ...(search ? { search } : {}),
  });

  const query = useQuery({
    queryKey: ['employees', params.toString()],
    queryFn: () =>
      api<{ items: Employee[]; total: number; totalPages: number }>(
        `/employees?${params.toString()}`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Employees"
        description="People on record, with the equipment they hold."
      />

      <div className="card mb-4 p-3">
        <input
          className="input max-w-xs"
          placeholder="Search name, code, email or phone..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      {query.isError && <ErrorNote error={query.error} />}

      {query.data?.items.length === 0 ? (
        <EmptyState
          message="No employees found"
          hint="Import an employee sheet from the Sheet Sync screen."
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="table min-w-[46rem]">
            <thead>
              <tr>
                <th className="th">Code</th>
                <th className="th">Name</th>
                <th className="th">Department</th>
                <th className="th">Designation</th>
                <th className="th">Branch</th>
                <th className="th">Contact</th>
                <th className="th">Status</th>
              </tr>
            </thead>
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
          </table>
        </div>
      )}

      {query.data && query.data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <p className="text-[rgb(var(--muted))]">
            {query.data.total} employees - page {page} of {query.data.totalPages}
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
