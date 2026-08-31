'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Modal, Field, ErrorNote } from '@/components/ui';

interface Item {
  id: string; assetTag: string; model: string | null;
  serialNumber: string | null; category: { name: string };
}
interface Seat {
  id: string; seatCode: string; wing: string; process: string | null;
  missing: string[]; equipment: Item[];
}
interface Plate { name: string; employeeId: string | null; equipment: Item[] }
interface FloorData { seats: Seat[]; plates: Plate[] }

/**
 * The plan, box for box. Column counts per wing are taken from the team's
 * own sheet, so rows break exactly where the picture breaks them. Every seat
 * is the same-sized box; the name-plates and the Induction Space are cabins
 * with equipment of their own, and open the same popup.
 */
interface WingSpec { w: string; cols: number; plate?: string }
interface ZoneSpec {
  digit: string; label: string; accent: string;
  plate?: string; platePos?: 'top' | 'bottom';
  wings: WingSpec[]; induction?: boolean;
}

const ROW1: ZoneSpec[] = [
  { digit: '1', label: 'Connect', accent: '--info', plate: 'Zalak Dani',
    wings: [{ w: 'C', cols: 3 }, { w: 'B', cols: 3 }, { w: 'A', cols: 6 }] },
  { digit: '2', label: 'Communicate', accent: '--ok', plate: 'Bhagirathsinh Chauhan',
    wings: [{ w: 'C', cols: 4 }, { w: 'B', cols: 6 }, { w: 'A', cols: 6 }] },
  { digit: '3', label: 'Collaborate', accent: '--bad', plate: 'Vaide Odedara',
    wings: [{ w: 'F', cols: 3 }, { w: 'D', cols: 6 }, { w: 'B', cols: 6 }] },
  { digit: '3', label: 'Collaborate', accent: '--bad',
    wings: [{ w: 'E', cols: 7 }, { w: 'C', cols: 7 }, { w: 'A', cols: 7 }] },
];

const ROW2: ZoneSpec[] = [
  { digit: '5', label: 'Cultivate', accent: '--viz-1',
    plate: 'Anushka Joshi', platePos: 'bottom',
    wings: [{ w: 'A', cols: 6 }, { w: 'B', cols: 6 }, { w: 'C', cols: 3 }] },
  { digit: '4', label: 'Coordinate', accent: '--warn',
    wings: [
      { w: 'A', cols: 5, plate: 'Yash Shah' },
      { w: 'C', cols: 7 },
      { w: 'E', cols: 5, plate: 'Hemal Patel' },
    ] },
  { digit: '4', label: 'Coordinate', accent: '--warn', induction: true,
    wings: [{ w: 'B', cols: 6 }, { w: 'D', cols: 3 }, { w: 'F', cols: 6 }] },
];

/** What the popup needs, whichever kind of cabin was clicked. */
interface Opened {
  title: string;
  description?: string;
  missing: string[];
  equipment: Item[];
  /** POST here to add; POST `${base}/${assetId}/remove` to remove. */
  base: string | null;
  /** For refreshing from live data after a mutation. */
  kind: 'seat' | 'plate';
  refId: string;
}

function Lobby() {
  return (
    <div className="flex w-6 items-center justify-center self-stretch rounded-md bg-[rgb(var(--surface-3))]">
      <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[rgb(var(--muted))]"
            style={{ writingMode: 'vertical-rl' }}>
        Lobby
      </span>
    </div>
  );
}

function NamePlate({ name, onClick, count }: { name: string; onClick: () => void; count: number }) {
  return (
    <button
      onClick={onClick}
      title={`${count} item(s) - click to view`}
      className="mb-1.5 w-full rounded-md bg-[rgb(var(--surface))] px-2 py-1.5 text-center
                 text-[12px] font-semibold text-[rgb(var(--text))] ring-1
                 ring-[rgb(var(--border-hard))] transition hover:ring-[rgb(var(--ring))]"
    >
      {name}
    </button>
  );
}

function ZoneBlock({
  zone, seatsByWing, plates, onOpen,
}: {
  zone: ZoneSpec;
  seatsByWing: Map<string, Seat[]>;
  plates: Map<string, Plate>;
  onOpen: (o: Opened) => void;
}) {
  const openPlate = (name: string) => {
    const p = plates.get(name.toLowerCase());
    onOpen({
      title: name,
      description: `${zone.label} cabin`,
      missing: [],
      equipment: p?.equipment ?? [],
      base: p?.employeeId ? `/workstations/plates/${p.employeeId}/equipment` : null,
      kind: 'plate',
      refId: name.toLowerCase(),
    });
  };

  const plateFor = (name: string) => (
    <NamePlate
      name={name}
      count={plates.get(name.toLowerCase())?.equipment.length ?? 0}
      onClick={() => openPlate(name)}
    />
  );

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
      {zone.plate && zone.platePos !== 'bottom' && plateFor(zone.plate)}

      {zone.wings.map(({ w, cols, plate }) => {
        const key = `${zone.digit}${w}`;
        const seats = seatsByWing.get(key) ?? [];
        return (
          <div key={key} className="mb-1.5">
            {plate && plateFor(plate)}
            <p className="mb-1 text-center text-[9px] font-medium uppercase tracking-[0.2em] text-[rgb(var(--muted))]">
              Wing {w}
            </p>
            {seats.length === 0 ? (
              <p className="py-1 text-center text-[9px] text-[rgb(var(--muted))]">no seats recorded</p>
            ) : (
              <div className="grid justify-center gap-1"
                   style={{ gridTemplateColumns: `repeat(${cols}, 58px)` }}>
                {seats.map((s) => (
                  <button
                    key={s.id}
                    onClick={() =>
                      onOpen({
                        title: `Seat ${s.seatCode}`,
                        description: [s.process, s.wing].filter(Boolean).join('  -  '),
                        missing: s.missing,
                        equipment: s.equipment,
                        base: `/workstations/${s.id}/equipment`,
                        kind: 'seat',
                        refId: s.id,
                      })
                    }
                    title={`${s.equipment.length} item(s)${s.missing.length ? ` - missing ${s.missing.join(', ')}` : ''}`}
                    className="flex h-8 items-center justify-center rounded border font-mono
                               text-[10px] font-medium shadow-sm transition
                               hover:scale-[1.08] hover:shadow"
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

      {zone.plate && zone.platePos === 'bottom' && plateFor(zone.plate)}
      {zone.induction && <InductionBox seatsByWing={seatsByWing} onOpen={onOpen} />}
    </div>
  );
}

function InductionBox({
  seatsByWing, onOpen,
}: { seatsByWing: Map<string, Seat[]>; onOpen: (o: Opened) => void }) {
  const station = seatsByWing.get('INDUCTION')?.[0];
  return (
    <button
      className="mt-2 grid h-16 w-full place-items-center rounded-md border border-dashed
                 border-[rgb(var(--border-hard))] bg-[rgb(var(--surface))] transition
                 hover:border-[rgb(var(--ring))]"
      title={station ? `${station.equipment.length} item(s) - click to view` : 'Not recorded yet'}
      onClick={() =>
        station &&
        onOpen({
          title: 'Induction Space',
          description: 'Shared space',
          missing: [],
          equipment: station.equipment,
          base: `/workstations/${station.id}/equipment`,
          kind: 'seat',
          refId: station.id,
        })
      }
    >
      <span className="text-[13px] font-semibold text-[rgb(var(--muted))]">Induction Space</span>
    </button>
  );
}

export function FloorView() {
  const { can } = useAuth();
  const [opened, setOpened] = useState<Opened | null>(null);

  const q = useQuery({
    queryKey: ['floor'],
    queryFn: () => api<FloorData>('/workstations/floor'),
  });

  const seatsByWing = useMemo(() => {
    const map = new Map<string, Seat[]>();
    for (const s of q.data?.seats ?? []) {
      const m = /^(\d)([A-Z])/.exec(s.seatCode);
      const key = s.seatCode === 'INDUCTION' ? 'INDUCTION' : m ? `${m[1]}${m[2]}` : '?';
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [q.data]);

  const plates = useMemo(() => {
    const map = new Map<string, Plate>();
    for (const p of q.data?.plates ?? []) map.set(p.name.toLowerCase(), p);
    return map;
  }, [q.data]);

  // Rebuild the open popup from fresh data after add/remove.
  const openedLive = useMemo(() => {
    if (!opened) return null;
    if (opened.kind === 'plate') {
      const p = plates.get(opened.refId);
      return p ? { ...opened, equipment: p.equipment } : opened;
    }
    const s = (q.data?.seats ?? []).find((x) => x.id === opened.refId);
    return s ? { ...opened, equipment: s.equipment, missing: s.missing } : opened;
  }, [opened, plates, q.data]);

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
            Box for box as the floor plan. Seats, name-plate cabins and the
            Induction Space all open on click.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="w-max min-w-full space-y-2">
          <div className="flex items-stretch gap-2">
            {ROW1.map((zone, i) => (
              <div key={i} className="contents">
                {i > 0 && <Lobby />}
                <ZoneBlock zone={zone} seatsByWing={seatsByWing} plates={plates} onOpen={setOpened} />
              </div>
            ))}
          </div>

          <div className="rounded-md py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.4em]"
               style={{ background: 'rgb(var(--viz-2) / 0.12)', color: 'rgb(var(--viz-2))' }}>
            Corridor
          </div>

          <div className="flex items-stretch gap-2">
            {ROW2.map((zone, i) => (
              <div key={i} className="contents">
                {i > 0 && <Lobby />}
                <ZoneBlock zone={zone} seatsByWing={seatsByWing} plates={plates} onOpen={setOpened} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {openedLive && (
        <EquipmentPopup
          opened={openedLive}
          canManage={can('workspace.manage')}
          onClose={() => setOpened(null)}
        />
      )}
    </section>
  );
}

/** One popup for every kind of cabin: seats, name-plates, Induction Space. */
function EquipmentPopup({
  opened, canManage, onClose,
}: { opened: Opened; canManage: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ categoryId: '', model: '', serialNumber: '' });

  const manageable = canManage && opened.base !== null;

  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/assets/categories'),
    enabled: manageable,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['floor'] });
    queryClient.invalidateQueries({ queryKey: ['kpis'] });
  };

  const add = useMutation({
    mutationFn: () => api(opened.base as string, { method: 'POST', body: form }),
    onSuccess: () => {
      setForm({ categoryId: '', model: '', serialNumber: '' });
      setAdding(false);
      refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (assetId: string) =>
      api(`${opened.base}/${assetId}/remove`, { method: 'POST' }),
    onSuccess: refresh,
  });

  return (
    <Modal
      title={opened.title}
      description={opened.description}
      onClose={onClose}
      footer={
        manageable ? (
          <button className="btn-primary" onClick={() => setAdding((a) => !a)}>
            <Plus size={13} /> Add item
          </button>
        ) : undefined
      }
    >
      {opened.missing.length > 0 && (
        <p className="mb-2 rounded-md px-3 py-1.5 text-[12px]"
           style={{ background: 'rgb(var(--warn-bg))', color: 'rgb(var(--warn))' }}>
          The sheet marked this seat short of: {opened.missing.join(', ')}
        </p>
      )}
      {opened.base === null && (
        <p className="mb-2 rounded-md px-3 py-1.5 text-[12px]"
           style={{ background: 'rgb(var(--warn-bg))', color: 'rgb(var(--warn))' }}>
          No employee record matches this name yet, so items cannot be added here.
        </p>
      )}

      {opened.equipment.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-[rgb(var(--muted))]">
          Nothing recorded here.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="th">Item</th>
              <th className="th">Tag</th>
              <th className="th">Model</th>
              {manageable && <th className="th text-right"></th>}
            </tr>
          </thead>
          <tbody>
            {opened.equipment.map((e) => (
              <tr key={e.id} className="row">
                <td className="td text-[rgb(var(--text))]">{e.category.name}</td>
                <td className="td font-mono text-[11px]">{e.assetTag}</td>
                <td className="td">{e.model ?? '-'}</td>
                {manageable && (
                  <td className="td text-right">
                    <button
                      className="btn-quiet btn-icon"
                      title="Remove (archived, recoverable)"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (window.confirm(`Remove ${e.category.name} ${e.assetTag} from ${opened.title}? It is archived, not destroyed.`)) {
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

      {adding && manageable && (
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
            <input className="input" value={form.model}
                   onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
          </Field>
          <Field label="Serial">
            <input className="input" value={form.serialNumber}
                   onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))} />
          </Field>
          <div className="sm:col-span-3">
            <button
              className="btn-primary"
              disabled={!form.categoryId || add.isPending}
              onClick={() => add.mutate()}
            >
              {add.isPending ? 'Adding...' : `Add to ${opened.title}`}
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
