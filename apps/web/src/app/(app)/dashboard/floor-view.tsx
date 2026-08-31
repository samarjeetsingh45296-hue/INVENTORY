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
 * The floor, arranged as the building actually is - taken from the team's
 * own plan. Seat codes carry the geography (1A001 = area 1, wing A, seat 1);
 * Collaborate and Coordinate each continue across a lobby, and the zone
 * name-plates (Zalak Dani, Yash Shah, ...) sit where the plan places them.
 * Seats themselves show numbers only.
 */
interface Zone {
  digit: string;
  label: string;
  accent: string; // css token name
  /** Wings top-to-bottom as on the plan, with an optional name-plate above. */
  wings: Array<{ w: string; plate?: string }>;
  plate?: string;
  induction?: boolean;
}

const ROW1: Zone[] = [
  { digit: '1', label: 'Connect', accent: '--info', plate: 'Zalak Dani',
    wings: [{ w: 'C' }, { w: 'B' }, { w: 'A' }] },
  { digit: '2', label: 'Communicate', accent: '--ok', plate: 'Bhagirathsinh Chauhan',
    wings: [{ w: 'C' }, { w: 'B' }, { w: 'A' }] },
  { digit: '3', label: 'Collaborate', accent: '--bad', plate: 'Vaide Odedara',
    wings: [{ w: 'F' }, { w: 'D' }, { w: 'B' }] },
  { digit: '3', label: 'Collaborate', accent: '--bad',
    wings: [{ w: 'E' }, { w: 'C' }, { w: 'A' }] },
];

const ROW2: Zone[] = [
  { digit: '5', label: 'Cultivate', accent: '--viz-1', plate: 'Anushka Joshi',
    wings: [{ w: 'A' }, { w: 'B' }, { w: 'C' }] },
  { digit: '4', label: 'Coordinate', accent: '--warn',
    wings: [{ w: 'A', plate: 'Yash Shah' }, { w: 'C' }, { w: 'E', plate: 'Hemal Patel' }] },
  { digit: '4', label: 'Coordinate', accent: '--warn', induction: true,
    wings: [{ w: 'B' }, { w: 'D' }, { w: 'F' }] },
];

function Lobby() {
  return (
    <div className="flex items-center justify-center rounded-md bg-[rgb(var(--surface-3))]">
      <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[rgb(var(--muted))]"
            style={{ writingMode: 'vertical-rl' }}>
        Lobby
      </span>
    </div>
  );
}

function ZoneBlock({
  zone, grouped, onOpen,
}: {
  zone: Zone;
  grouped: Map<string, Map<string, Seat[]>>;
  onOpen: (s: Seat) => void;
}) {
  const wings = grouped.get(zone.digit);
  return (
    <div
      className="rounded-lg border p-2"
      style={{
        borderColor: `rgb(var(${zone.accent}) / 0.35)`,
        background: `rgb(var(${zone.accent}) / 0.05)`,
      }}
    >
      <p className="mb-1.5 text-center text-[10px] font-bold uppercase tracking-[0.3em]"
         style={{ color: `rgb(var(${zone.accent}))` }}>
        {zone.label}
      </p>
      {zone.plate && (
        <p className="mb-1.5 rounded-md bg-[rgb(var(--surface))] px-2 py-1 text-center
                      text-[12px] font-semibold text-[rgb(var(--text))] ring-1 ring-[rgb(var(--border))]">
          {zone.plate}
        </p>
      )}
      {zone.wings.map(({ w, plate }) => {
        const seats = (wings?.get(w) ?? []) as Seat[];
        return (
          <div key={w} className="mb-1.5">
            {plate && (
              <p className="mb-1 rounded-md bg-[rgb(var(--surface))] px-2 py-1 text-center
                            text-[12px] font-semibold text-[rgb(var(--text))] ring-1 ring-[rgb(var(--border))]">
                {plate}
              </p>
            )}
            <p className="mb-1 text-center text-[9px] font-medium uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
              Wing {w}
            </p>
            {seats.length === 0 ? (
              <p className="py-1 text-center text-[9px] text-[rgb(var(--muted))]">no seats recorded</p>
            ) : (
              <div className="grid gap-1"
                   style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(58px, 1fr))' }}>
                {seats.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onOpen(s)}
                    title={`${s.equipment.length} item(s)${s.missing.length ? ` - missing ${s.missing.join(', ')}` : ''}`}
                    className="flex h-9 items-center justify-center rounded-md border
                               font-mono text-[11px] font-medium shadow-sm transition
                               hover:scale-[1.06] hover:shadow"
                    style={{
                      background: s.missing.length ? 'rgb(var(--warn-bg))' : 'rgb(var(--ok-bg))',
                      color: s.missing.length ? 'rgb(var(--warn))' : 'rgb(var(--ok))',
                      borderColor: 'rgb(var(--border))',
                    }}
                  >
                    {s.seatCode}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {zone.induction && (
        <div className="mt-2 grid h-16 place-items-center rounded-md border border-dashed
                        border-[rgb(var(--border-hard))] bg-[rgb(var(--surface))]">
          <span className="text-[13px] font-semibold text-[rgb(var(--muted))]">Induction Space</span>
        </div>
      )}
    </div>
  );
}

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
            Laid out as the floor really is. Click a seat for its equipment -
            green is fully equipped, amber is short of something.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="min-w-[1000px] space-y-2">
          <div className="grid gap-2"
               style={{ gridTemplateColumns: '1fr 26px 1fr 26px 1fr 26px 1fr' }}>
            {ROW1.map((zone, i) => (
              <div key={i} className="contents">
                {i > 0 && <Lobby />}
                <ZoneBlock zone={zone} grouped={grouped} onOpen={setOpenSeat} />
              </div>
            ))}
          </div>

          <div className="rounded-md py-1.5 text-center text-[10px] font-bold uppercase
                          tracking-[0.4em]"
               style={{ background: 'rgb(var(--viz-2) / 0.12)', color: 'rgb(var(--viz-2))' }}>
            Corridor
          </div>

          <div className="grid gap-2"
               style={{ gridTemplateColumns: '1fr 26px 1.3fr 26px 1fr' }}>
            {ROW2.map((zone, i) => (
              <div key={i} className="contents">
                {i > 0 && <Lobby />}
                <ZoneBlock zone={zone} grouped={grouped} onOpen={setOpenSeat} />
              </div>
            ))}
          </div>
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
