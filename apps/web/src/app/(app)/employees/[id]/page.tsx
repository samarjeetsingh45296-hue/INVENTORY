'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ArrowLeft, Boxes, KeyRound, Smartphone, Armchair } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader, StatusBadge, ErrorNote, StatCard } from '@/components/ui';

interface Detail {
  id: string;
  employeeCode: string;
  fullName: string;
  officialEmail: string | null;
  phone: string | null;
  employmentStatus: string;
  process: string | null;
  remarks: string | null;
  branch: { name: string } | null;
  department: { name: string } | null;
  designation: { name: string } | null;
  allocations: Array<{
    id: string; allocatedAt: string;
    asset: { id: string; assetTag: string; model: string | null; serialNumber: string | null; category: { name: string } };
  }>;
  lockerAllocations: Array<{ id: string; allocatedAt: string; keyIssued: boolean; locker: { lockerNo: string; status: string } }>;
  cugAllocations: Array<{ id: string; allocatedAt: string; connection: { mobileNumber: string; operator: string | null; status: string } }>;
  workstationAllocations: Array<{ id: string; workstation: { seatCode: string; status: string } }>;
}

interface HistoryRow {
  id: string; allocatedAt: string; returnedAt: string | null; status: string;
  conditionIn: string | null; returnRemarks: string | null;
  asset: { assetTag: string; model: string | null; category: { name: string } };
}

/**
 * Everything one person currently holds, plus everything they have ever held.
 * That is the question the inventory team asks all day, so it is one page
 * rather than four lists to cross-reference by hand.
 */
export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const q = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api<Detail>(`/employees/${id}`),
  });

  const history = useQuery({
    queryKey: ['employee', id, 'history'],
    queryFn: () => api<HistoryRow[]>(`/employees/${id}/history`),
  });

  if (q.isError) return <ErrorNote error={q.error} />;
  const e = q.data;
  const returned = (history.data ?? []).filter((h) => h.returnedAt !== null);
  const noMis = e?.employeeCode.startsWith('NOMIS-');

  return (
    <>
      <button className="btn-quiet mb-2" onClick={() => router.back()}>
        <ArrowLeft size={13} /> Back
      </button>

      <PageHeader
        title={e?.fullName ?? 'Loading...'}
        description={
          e
            ? [e.employeeCode, e.designation?.name, e.department?.name, e.branch?.name, e.process]
                .filter(Boolean).join('  -  ')
            : undefined
        }
        actions={e ? <StatusBadge status={e.employmentStatus} /> : undefined}
      />

      {noMis && (
        <div
          className="mb-3 rounded-md border px-3 py-2 text-[12px]"
          style={{ borderColor: 'rgb(var(--warn) / 0.4)', background: 'rgb(var(--warn-bg))', color: 'rgb(var(--warn))' }}
        >
          This person had no MIS number in the source sheet, so a placeholder code
          was generated. Edit the record to set the real one.
        </div>
      )}

      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <StatCard label="Assets held" value={e?.allocations.length ?? '-'} />
        <StatCard label="CUG lines" value={e?.cugAllocations.length ?? '-'} />
        <StatCard label="Lockers" value={e?.lockerAllocations.length ?? '-'} />
        <StatCard label="Previously returned" value={returned.length} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card">
          <h2 className="flex items-center gap-1.5 border-b border-[rgb(var(--border))] px-3 py-2 text-[12px] font-semibold">
            <Boxes size={13} /> Equipment currently held
          </h2>
          {e && e.allocations.length === 0 ? (
            <p className="px-3 py-4 text-[12px] text-[rgb(var(--muted))]">Nothing issued.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th className="th">Tag</th>
                  <th className="th">Item</th>
                  <th className="th">Serial</th>
                  <th className="th">Since</th>
                </tr>
              </thead>
              <tbody>
                {(e?.allocations ?? []).map((a) => (
                  <tr key={a.id} className="row">
                    <td className="td font-medium text-[rgb(var(--text))]">{a.asset.assetTag}</td>
                    <td className="td">{a.asset.model ?? a.asset.category.name}</td>
                    <td className="td font-mono text-[11px]">{a.asset.serialNumber ?? '-'}</td>
                    <td className="td whitespace-nowrap">{format(new Date(a.allocatedAt), 'd MMM yy')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <div className="space-y-3">
          <section className="card">
            <h2 className="flex items-center gap-1.5 border-b border-[rgb(var(--border))] px-3 py-2 text-[12px] font-semibold">
              <Smartphone size={13} /> CUG lines
            </h2>
            {e && e.cugAllocations.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-[rgb(var(--muted))]">No mobile line issued.</p>
            ) : (
              <table className="table">
                <tbody>
                  {(e?.cugAllocations ?? []).map((c) => (
                    <tr key={c.id} className="row">
                      <td className="td font-medium text-[rgb(var(--text))]">{c.connection.mobileNumber}</td>
                      <td className="td">{c.connection.operator ?? '-'}</td>
                      <td className="td"><StatusBadge status={c.connection.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card">
            <h2 className="flex items-center gap-1.5 border-b border-[rgb(var(--border))] px-3 py-2 text-[12px] font-semibold">
              <KeyRound size={13} /> Locker
            </h2>
            {e && e.lockerAllocations.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-[rgb(var(--muted))]">No locker issued.</p>
            ) : (
              <table className="table">
                <tbody>
                  {(e?.lockerAllocations ?? []).map((l) => (
                    <tr key={l.id} className="row">
                      <td className="td font-medium text-[rgb(var(--text))]">{l.locker.lockerNo}</td>
                      <td className="td">{l.keyIssued ? 'key issued' : 'no key'}</td>
                      <td className="td whitespace-nowrap">{format(new Date(l.allocatedAt), 'd MMM yy')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {e && e.workstationAllocations.length > 0 && (
            <section className="card">
              <h2 className="flex items-center gap-1.5 border-b border-[rgb(var(--border))] px-3 py-2 text-[12px] font-semibold">
                <Armchair size={13} /> Seat
              </h2>
              <table className="table">
                <tbody>
                  {e.workstationAllocations.map((w) => (
                    <tr key={w.id} className="row">
                      <td className="td font-medium text-[rgb(var(--text))]">{w.workstation.seatCode}</td>
                      <td className="td"><StatusBadge status={w.workstation.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </div>

      <section className="card mt-3">
        <h2 className="border-b border-[rgb(var(--border))] px-3 py-2 text-[12px] font-semibold">
          Full custody history
        </h2>
        {returned.length === 0 ? (
          <p className="px-3 py-4 text-[12px] text-[rgb(var(--muted))]">
            Nothing returned yet. Items appear here permanently once handed back.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table" style={{ minWidth: '46rem' }}>
              <thead>
                <tr>
                  <th className="th">Asset</th>
                  <th className="th">Item</th>
                  <th className="th">Held from</th>
                  <th className="th">Returned</th>
                  <th className="th">Condition back</th>
                  <th className="th">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {returned.map((h) => (
                  <tr key={h.id} className="row">
                    <td className="td font-medium text-[rgb(var(--text))]">{h.asset.assetTag}</td>
                    <td className="td">{h.asset.model ?? h.asset.category.name}</td>
                    <td className="td whitespace-nowrap">{format(new Date(h.allocatedAt), 'd MMM yy')}</td>
                    <td className="td whitespace-nowrap">
                      {h.returnedAt ? format(new Date(h.returnedAt), 'd MMM yy') : '-'}
                    </td>
                    <td className="td">{h.conditionIn ? <StatusBadge status={h.conditionIn} /> : '-'}</td>
                    <td className="td max-w-[14rem] truncate">{h.returnRemarks ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
