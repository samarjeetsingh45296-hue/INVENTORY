'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modal, Field, ErrorNote } from '@/components/ui';

interface Seat {
  id: string;
  seatCode: string;
  wing: string;
  process: string | null;
  missing: string[];
  equipment: Array<{
    id: string; assetTag: string; model: string | null;
    serialNumber: string | null; category: { name: string };
  }>;
}

/**
 * The floor is read straight off the seat codes: 1A001 means process area 1,
 * wing A, seat 1. Areas sit in the same arrangement as the building - three
 * across the top, the corridor, two below - and the plan shows seat numbers
 * only, never a name.
 */
const AREAS: Array<{ digit: string; label: string; row: 1 | 2 }> = [
  { digit: '1', label: 'CONNECT', row: 1 },
  { digit: '2', label: 'COMMUNICATE', row: 1 },
  { digit: '3', label: 'COLLABORATE', row: 1 },
  { digit: '5', label: 'CULTIVATE', row: 2 },
  { digit: '4', label: 'COORDINATE', row: 2 },
];

export function FloorView() {
  const { can } = useAuth();
  const [openSeat, setOpenSeat] = useState<Seat | null>(null);

  const q = useQuery({
    queryKey: ['floor'],
    queryFn: () => api<Seat[]>('/workstations/floor'),
  });

  const grouped = useMemo(() => {
    const byArea = new Map<string, Map<string, Seat[]>>();
    for (const s of q.data ?? []) {
      const digit = s.seatCode[0] ?? '?';
      const wing = /^\d([A-Z])/.exec(s.seatCode)?.[1] ?? '?';
      if (!byArea.has(digit)) byArea.set(digit, new Map());
      const wings = byArea.get(digit) as Map<string, Seat[]>;
      wings.set(wing, [...(wings.get(wing) ?? []), s]);
    }
    return byArea;
  }, [q.data]);

  // Keep the popup's seat fresh after an add or remove.
  const openSeatLive = useMemo(
    () => (openSeat ? (q.data ?? []).find((s) => s.id === openSeat.id) ?? null : null),
    [openSeat, q.data],
  );

  if (q.isError) return <ErrorNote error={q.error} />;

  return (
    <section className="card mt-3 p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[rgb(var(--surface-3))] ring-1 ring-[rgb(var(--border))]">
          <Building2 size={15} strokeWidth={1.9} />
        </span>
        <div>
          <h2 className="text-[13px] font-semibold leading-tight">Building - seat map</h2>
          <p className="mt-px text-[11px] text-[rgb(var(--muted))]">
            Click a seat to see and manage its equipment. Green is fully
            equipped, amber is short of something.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-[900px]">
          {[1, 2].map((row) => (
            <div key={row}>
              {row === 2 && (
                <div className="my-2 rounded bg-[rgb(var(--surface-3))] py-1 text-center
                                text-[10px] font-semibold uppercase tracking-[0.3em]
                                text-[rgb(var(--muted))]">
                  Corridor
                </div>
              )}
              <div
                className="grid gap-2"
                style={{ gridTemplateColumns: `repeat(${AREAS.filter((a) => a.row === row).length}, 1fr)` }}
              >
                {AREAS.filter((a) => a.row === row).map((area) => {
                  const wings = grouped.get(area.digit);
                  return (
                    <div key={area.digit} className="card-2 p-2">
                      <p className="mb-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.25em] text-[rgb(var(--muted))]">
                        {area.label}
                      </p>
                      {[...(wings ?? new Map())]
                        .sort((a, b) => (b[0] < a[0] ? 1 : -1))
                        .map(([wing, seats]) => (
                          <div key={wing} className="mb-2">
                            <p className="mb-1 text-[9px] font-medium uppercase tracking-wider text-[rgb(var(--muted))]">
                              Wing {wing}
                            </p>
                            {/* Uniform boxes, like the sheet's cells - the seat
                                number sits where the name used to be. */}
                            <div
                              className="grid gap-1"
                              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(62px, 1fr))' }}
                            >
                              {(seats as Seat[]).map((s) => (
                                <button
                                  key={s.id}
                                  onClick={() => setOpenSeat(s)}
                                  title={`${s.equipment.length} item(s)${s.missing.length ? ` - missing ${s.missing.join(', ')}` : ''}`}
                                  className="flex h-10 items-center justify-center rounded-md
                                             border font-mono text-[11px] font-medium
                                             transition-colors"
                                  style={{
                                    background: s.missing.length
                                      ? 'rgb(var(--warn-bg))' : 'rgb(var(--ok-bg))',
                                    color: s.missing.length
                                      ? 'rgb(var(--warn))' : 'rgb(var(--ok))',
                                    borderColor: 'rgb(var(--border))',
                                  }}
                                >
                                  {s.seatCode}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      {!wings && (
                        <p className="py-3 text-center text-[10px] text-[rgb(var(--muted))]">
                          no seats recorded
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {openSeatLive && (
        <SeatPopup
          seat={openSeatLive}
          canManage={can('workspace.manage')}
          onClose={() => setOpenSeat(null)}
        />
      )}
    </section>
  );
}

/**
 * The seat popup: its equipment, and for admins add/remove. Titled by the
 * seat code alone - no employee name appears here by design.
 */
function SeatPopup({
  seat, canManage, onClose,
}: { seat: Seat; canManage: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ categoryId: '', model: '', serialNumber: '' });

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/assets/categories'),
    enabled: canManage,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['floor'] });
    queryClient.invalidateQueries({ queryKey: ['kpis'] });
  };

  const add = useMutation({
    mutationFn: () =>
      api(`/workstations/${seat.id}/equipment`, { method: 'POST', body: form }),
    onSuccess: () => {
      setForm({ categoryId: '', model: '', serialNumber: '' });
      setAdding(false);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (assetId: string) =>
      api(`/workstations/${seat.id}/equipment/${assetId}/remove`, { method: 'POST' }),
    onSuccess: refresh,
  });

  return (
    <Modal
      title={`Seat ${seat.seatCode}`}
      description={[seat.process, seat.wing].filter(Boolean).join('  -  ')}
      onClose={onClose}
      footer={
        canManage ? (
          <button className="btn-primary" onClick={() => setAdding((a) => !a)}>
            <Plus size={13} /> Add item
          </button>
        ) : undefined
      }
    >
      {seat.missing.length > 0 && (
        <p className="mb-2 rounded-md px-3 py-1.5 text-[12px]"
           style={{ background: 'rgb(var(--warn-bg))', color: 'rgb(var(--warn))' }}>
          The sheet marked this seat short of: {seat.missing.join(', ')}
        </p>
      )}

      {seat.equipment.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-[rgb(var(--muted))]">
          Nothing recorded at this seat.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="th">Item</th>
              <th className="th">Tag</th>
              <th className="th">Model</th>
              {canManage && <th className="th text-right"></th>}
            </tr>
          </thead>
          <tbody>
            {seat.equipment.map((e) => (
              <tr key={e.id} className="row">
                <td className="td text-[rgb(var(--text))]">{e.category.name}</td>
                <td className="td font-mono text-[11px]">{e.assetTag}</td>
                <td className="td">{e.model ?? '-'}</td>
                {canManage && (
                  <td className="td text-right">
                    <button
                      className="btn-quiet btn-icon"
                      title="Remove from this seat (archived, recoverable)"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove ${e.category.name} ${e.assetTag} from seat ${seat.seatCode}? It is archived, not destroyed.`)) {
                          remove.mutate(e.id);
                        }
                      }}
                      style={{ color: 'rgb(var(--bad))' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {adding && canManage && (
        <div className="mt-3 grid gap-2 border-t border-[rgb(var(--border))] pt-3 sm:grid-cols-3">
          <Field label="Item" required>
            <select
              className="input"
              value={form.categoryId}
              onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
            >
              <option value="">Choose...</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Model">
            <input
              className="input" value={form.model}
              onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
            />
          </Field>
          <Field label="Serial">
            <input
              className="input" value={form.serialNumber}
              onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))}
            />
          </Field>
          <div className="sm:col-span-3">
            <button
              className="btn-primary"
              disabled={!form.categoryId || add.isPending}
              onClick={() => add.mutate()}
            >
              {add.isPending ? 'Adding...' : `Add to ${seat.seatCode}`}
            </button>
          </div>
        </div>
      )}

      {(add.isError || remove.isError) && (
        <div className="mt-2"><ErrorNote error={add.error ?? remove.error} /></div>
      )}
    </Modal>
  );
}
