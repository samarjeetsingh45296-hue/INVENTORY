'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
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
 * The plan, reproduced structurally: every wing is TWO facing rows of seats
 * with its "Wing X" band between them, exactly as the desks face each other
 * on the sheet. Which seat lands in which row follows the sheet's own
 * numbering (odd opposite even), and the reading direction flips where the
 * sheet flips it. The cabin boxes sit beside the wings the sheet puts them
 * beside, and the zone names live in the orange corridor bands - not as
 * headers.
 */
interface WingCfg { cols: number; topParity: 0 | 1; dir: 1 | -1; top?: number[] }

const WING: Record<string, WingCfg> = {
  '1C': { cols: 3, topParity: 1, dir: -1 },
  '1B': { cols: 6, topParity: 0, dir: -1 },
  '1A': { cols: 6, topParity: 0, dir: -1 },
  '2C': { cols: 4, topParity: 1, dir: -1 },
  '2B': { cols: 6, topParity: 1, dir: -1 },
  '2A': { cols: 6, topParity: 1, dir: -1 },
  '3F': { cols: 3, topParity: 1, dir: -1 },
  '3D': { cols: 6, topParity: 1, dir: -1 },
  '3B': { cols: 6, topParity: 1, dir: -1 },
  '3E': { cols: 7, topParity: 1, dir: 1 },
  '3C': { cols: 7, topParity: 1, dir: 1 },
  '3A': { cols: 7, topParity: 1, dir: 1 },
  '5A': { cols: 6, topParity: 1, dir: -1 },
  '5B': { cols: 6, topParity: 1, dir: -1 },
  '5C': { cols: 3, topParity: 1, dir: -1 },
  '4A': { cols: 5, topParity: 0, dir: -1 },
  '4C': { cols: 7, topParity: 1, dir: -1 },
  '4E': { cols: 5, topParity: 0, dir: -1 },
  // The sheet's top row here is irregular: 151 sits beside 150, not below.
  '4B': { cols: 6, topParity: 0, dir: 1, top: [144, 146, 148, 150, 151, 152] },
  '4D': { cols: 3, topParity: 0, dir: 1 },
  '4F': { cols: 6, topParity: 1, dir: 1 },
};

/** One horizontal slice of a zone: an optional cabin beside one wing. */
interface Segment { wing: string; cabin?: string }
interface ZoneSpec {
  segments: Segment[];
  bandLabel: string;
  /**
   * A tall box on the right, as the Induction Space is on the sheet: the
   * splitWing's top row and band span the full width above it, then the box
   * runs beside that wing's bottom row and the listed wings below.
   */
  rightSpan?: { label: string; splitWing: string; wings: string[] };
}

const ROW1: ZoneSpec[] = [
  { bandLabel: 'CONNECT',
    segments: [{ wing: '1C', cabin: 'Zalak Dani' }, { wing: '1B' }, { wing: '1A' }] },
  { bandLabel: 'COMMUNICATE',
    segments: [{ wing: '2C', cabin: 'Bhagirathsinh Chauhan' }, { wing: '2B' }, { wing: '2A' }] },
  { bandLabel: 'COLLABORATE',
    segments: [{ wing: '3F', cabin: 'Vaide Odedara' }, { wing: '3D' }, { wing: '3B' }] },
  { bandLabel: '',
    segments: [{ wing: '3E' }, { wing: '3C' }, { wing: '3A' }] },
];

const ROW2: ZoneSpec[] = [
  { bandLabel: 'CULTIVATE',
    segments: [{ wing: '5A' }, { wing: '5B' }, { wing: '5C', cabin: 'Anushka Joshi' }] },
  { bandLabel: 'COORDINATE',
    segments: [{ wing: '4A', cabin: 'Yash Shah' }, { wing: '4C' }, { wing: '4E', cabin: 'Hemal Patel' }] },
  { bandLabel: '',
    segments: [{ wing: '4B' }, { wing: '4D' }, { wing: '4F' }],
    rightSpan: { label: 'Induction Space', splitWing: '4B', wings: ['4D'] } },
];

interface Opened {
  title: string;
  description?: string;
  missing: string[];
  equipment: Item[];
  base: string | null;
  kind: 'seat' | 'plate';
  refId: string;
}

/** Splits a wing's seats into the two facing rows, ordered as the sheet is. */
function splitRows(seats: Seat[], cfg: WingCfg): [Seat[], Seat[]] {
  const num = (s: Seat) => parseInt(s.seatCode.slice(2), 10) || 0;
  const sorted = [...seats].sort((a, b) => (num(a) - num(b)) * cfg.dir);
  if (cfg.top) {
    const top = cfg.top
      .map((n) => sorted.find((s) => num(s) === n))
      .filter((s): s is Seat => Boolean(s));
    const bottom = sorted.filter((s) => !cfg.top?.includes(num(s)));
    return [top, bottom];
  }
  const top = sorted.filter((s) => num(s) % 2 === cfg.topParity);
  const bottom = sorted.filter((s) => num(s) % 2 !== cfg.topParity);
  return [top, bottom];
}

function SeatBox({ seat, onOpen }: { seat: Seat; onOpen: (o: Opened) => void }) {
  return (
    <button
      onClick={() =>
        onOpen({
          title: `Seat ${seat.seatCode}`,
          description: [seat.process, seat.wing].filter(Boolean).join('  -  '),
          missing: seat.missing,
          equipment: seat.equipment,
          base: `/workstations/${seat.id}/equipment`,
          kind: 'seat',
          refId: seat.id,
        })
      }
      title={`${seat.equipment.length} item(s)${seat.missing.length ? ` - missing ${seat.missing.join(', ')}` : ''}`}
      className="flex h-8 w-full items-center justify-center rounded border font-mono
                 text-[10px] font-medium shadow-sm transition hover:scale-[1.08] hover:shadow"
      style={{
        background: seat.missing.length ? 'rgb(var(--warn-bg))' : 'rgb(var(--ok-bg))',
        color: seat.missing.length ? 'rgb(var(--warn))' : 'rgb(var(--ok))',
        borderColor: 'rgb(var(--border))',
      }}
    >
      {seat.seatCode}
    </button>
  );
}

/** A row of seat boxes; empty slots keep the sheet's footprint. */
function SeatRow({ seats, cols, onOpen }: { seats: Seat[]; cols: number; onOpen: (o: Opened) => void }) {
  const blanks = Math.max(0, cols - seats.length);
  return (
    // Left-aligned, never centred: a 3-column wing must line up with its
    // 6-column neighbours, and a part-filled row with the row facing it.
    <div className="grid justify-start gap-1" style={{ gridTemplateColumns: `repeat(${cols}, 58px)` }}>
      {seats.map((s) => <SeatBox key={s.id} seat={s} onOpen={onOpen} />)}
      {Array.from({ length: blanks }).map((_, i) => (
        <div key={`b${i}`} className="h-8 rounded border border-dashed border-[rgb(var(--border))] opacity-40" />
      ))}
    </div>
  );
}

/** The full wing: top row, "Wing X" band, bottom row - desks facing. */
function WingStack({
  wingKey, seats, onOpen, grow = true,
}: { wingKey: string; seats: Seat[]; onOpen: (o: Opened) => void; grow?: boolean }) {
  const cfg = WING[wingKey] ?? { cols: 6, topParity: 1, dir: -1 as const };
  const [top, bottom] = splitRows(seats, cfg);
  return (
    // When a cabin shares the row, the wing keeps its natural width and the
    // cabin grows to fill whatever is left - so nothing sits empty.
    <div className={`space-y-1 ${grow ? 'flex-1' : 'flex-none'}`}>
      <SeatRow seats={top} cols={cfg.cols} onOpen={onOpen} />
      <div className="rounded-sm bg-[rgb(var(--surface-3))] py-0.5 text-center text-[9px]
                      font-semibold uppercase tracking-[0.25em] text-[rgb(var(--muted))]">
        Wing {wingKey.slice(1)}
      </div>
      <SeatRow seats={bottom} cols={cfg.cols} onOpen={onOpen} />
    </div>
  );
}

function CabinBox({
  name, plate, onOpen, tall = false,
}: { name: string; plate?: Plate; onOpen: (o: Opened) => void; tall?: boolean }) {
  return (
    <button
      onClick={() =>
        onOpen({
          title: name,
          description: 'Cabin',
          missing: [],
          equipment: plate?.equipment ?? [],
          base: plate?.employeeId ? `/workstations/plates/${plate.employeeId}/equipment` : null,
          kind: 'plate',
          refId: name.toLowerCase(),
        })
      }
      title={`${plate?.equipment.length ?? 0} item(s) - click to view`}
      className={`grid shrink-0 place-items-center rounded-md border border-[rgb(var(--border-hard))]
                  bg-[rgb(var(--surface))] px-2 text-center text-[12px] font-semibold
                  text-[rgb(var(--text))] shadow-sm transition hover:border-[rgb(var(--ring))]
                  ${tall ? 'min-w-32 flex-1 self-stretch' : 'min-w-28 flex-1 self-stretch'}`}
    >
      {name}
    </button>
  );
}

function Lobby() {
  return (
    <div className="flex w-6 items-center justify-center self-stretch rounded-md bg-[rgb(var(--viz-2)/0.10)]">
      <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[rgb(var(--muted))]"
            style={{ writingMode: 'vertical-rl' }}>
        Lobby
      </span>
    </div>
  );
}

/** The orange strips carrying the zone names, as on the sheet. */
function Band({ label }: { label: string }) {
  return (
    <div className="rounded-sm py-1 text-center text-[10px] font-bold uppercase tracking-[0.3em]"
         style={{ background: 'rgb(var(--viz-2) / 0.16)', color: 'rgb(var(--viz-2))' }}>
      {label || ' '}
    </div>
  );
}

function ZoneBlock({
  zone, seatsByWing, plates, indSeat, onOpen,
}: {
  zone: ZoneSpec;
  seatsByWing: Map<string, Seat[]>;
  plates: Map<string, Plate>;
  indSeat?: Seat;
  onOpen: (o: Opened) => void;
}) {
  const segmentRow = (seg: Segment, grow: boolean) => (
    <div key={seg.wing} className="flex items-stretch gap-1.5">
      {seg.cabin && (
        <CabinBox name={seg.cabin} plate={plates.get(seg.cabin.toLowerCase())} onOpen={onOpen} />
      )}
      <WingStack wingKey={seg.wing} seats={seatsByWing.get(seg.wing) ?? []}
                 grow={grow && !seg.cabin} onOpen={onOpen} />
    </div>
  );

  const splitCfg = zone.rightSpan
    ? WING[zone.rightSpan.splitWing] ?? { cols: 6, topParity: 1 as const, dir: 1 as const }
    : null;
  const splitSeats = zone.rightSpan
    ? splitRows(seatsByWing.get(zone.rightSpan.splitWing) ?? [], splitCfg as WingCfg)
    : null;

  return (
    <div className="card-2 space-y-2 p-2">
      {zone.rightSpan && splitCfg && splitSeats && (
        <div className="space-y-1">
          {/* The split wing's top row and band run the full width... */}
          <SeatRow seats={splitSeats[0]} cols={splitCfg.cols} onOpen={onOpen} />
          <div className="rounded-sm bg-[rgb(var(--surface-3))] py-0.5 text-center text-[9px]
                          font-semibold uppercase tracking-[0.25em] text-[rgb(var(--muted))]">
            Wing {zone.rightSpan.splitWing.slice(1)}
          </div>
          {/* ...then the tall box starts beside its bottom row and spans the
              wings beneath, exactly as the sheet draws the Induction Space. */}
          <div className="flex items-stretch gap-1.5 pt-1">
            <div className="space-y-2">
              <SeatRow
                seats={splitSeats[1]}
                cols={Math.max(splitSeats[1].length, 1)}
                onOpen={onOpen}
              />
              {zone.segments
                .filter((g) => zone.rightSpan?.wings.includes(g.wing))
                .map((g) => (
                  <WingStack key={g.wing} wingKey={g.wing}
                             seats={seatsByWing.get(g.wing) ?? []}
                             grow={false} onOpen={onOpen} />
                ))}
            </div>
            <button
              onClick={() =>
                indSeat &&
                onOpen({
                  title: zone.rightSpan?.label ?? '',
                  description: 'Shared space',
                  missing: [],
                  equipment: indSeat.equipment,
                  base: `/workstations/${indSeat.id}/equipment`,
                  kind: 'seat',
                  refId: indSeat.id,
                })
              }
              title={indSeat ? `${indSeat.equipment.length} item(s) - click to view` : 'Not recorded yet'}
              className="grid min-w-40 flex-1 place-items-center self-stretch rounded-md border
                         border-dashed border-[rgb(var(--border-hard))] bg-[rgb(var(--surface))]
                         text-[13px] font-semibold text-[rgb(var(--muted))] transition
                         hover:border-[rgb(var(--ring))]"
            >
              {zone.rightSpan.label}
            </button>
          </div>
        </div>
      )}
      {zone.segments
        .filter((g) =>
          !zone.rightSpan ||
          (g.wing !== zone.rightSpan.splitWing && !zone.rightSpan.wings.includes(g.wing)))
        .map((g) => segmentRow(g, true))}
    </div>
  );
}

/** Past this the seat boxes read as oversized rather than generous. */
const MAX_SCALE = 1.4;

/**
 * Scales the map so the whole floor is visible at once and fills its card.
 *
 * The plan has a fixed natural width - 58px seat boxes in fixed grids - and
 * that is deliberately kept, because uniform boxes are what make it read
 * like the sheet. Rather than reflow it, the drawn map is measured and scaled
 * to whatever width the page gives it - down on a laptop, up on a wide
 * monitor - so it always fits exactly, with no scrolling and no gap beside it.
 */
function useFitToWidth() {
  const outer = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  const measure = useCallback(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const natural = i.scrollWidth;
    const available = o.clientWidth;
    if (!natural || !available) return;
    // Grow into spare width as well as shrink, so the map never leaves a gap
    // beside it. Capped, because past a point the boxes just look oversized.
    const next = Math.min(MAX_SCALE, available / natural);
    setScale(next);
    // The wrapper must claim the scaled height, or the transform leaves a gap.
    setHeight(i.scrollHeight * next);
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return { outer, inner, scale, height, measure };
}

export function FloorView() {
  const { can } = useAuth();
  const [opened, setOpened] = useState<Opened | null>(null);
  const { outer, inner, scale, height, measure } = useFitToWidth();

  const q = useQuery({
    queryKey: ['floor'],
    queryFn: () => api<FloorData>('/workstations/floor'),
  });

  // Seats arriving changes the natural width, so measure again.
  useEffect(() => { measure(); }, [q.data, measure]);

  const seatsByWing = useMemo(() => {
    const map = new Map<string, Seat[]>();
    for (const s of q.data?.seats ?? []) {
      const m = /^(\d)([A-Z])/.exec(s.seatCode);
      const key = s.seatCode === 'INDUCTION' ? 'INDUCTION' : m ? `${m[1]}${m[2]}` : '?';
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [q.data]);

  const indSeat = seatsByWing.get('INDUCTION')?.[0];

  const plates = useMemo(() => {
    const map = new Map<string, Plate>();
    for (const p of q.data?.plates ?? []) map.set(p.name.toLowerCase(), p);
    return map;
  }, [q.data]);

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

  const renderRow = (zones: ZoneSpec[], bandBelow: boolean) => (
    <div className="flex items-stretch gap-2">
      {zones.map((zone, i) => (
        <div key={i} className="contents">
          {i > 0 && <Lobby />}
          <div className="flex flex-col gap-1">
            {!bandBelow && <Band label={zone.bandLabel} />}
            <ZoneBlock zone={zone} seatsByWing={seatsByWing} plates={plates}
                       indSeat={indSeat} onOpen={setOpened} />
            {bandBelow && <Band label={zone.bandLabel} />}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <section className="card mt-3 p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-[rgb(var(--surface-3))] ring-1 ring-[rgb(var(--border))]">
          <Building2 size={15} strokeWidth={1.9} />
        </span>
        <div>
          <h2 className="text-[13px] font-semibold leading-tight">Building - seat map</h2>
          <p className="mt-px text-[11px] text-[rgb(var(--muted))]">
            As the floor plan: desks face each other across each wing band.
            Seats, cabins and the Induction Space all open on click.
          </p>
        </div>
      </div>

      <div ref={outer} className="w-full" style={{ height }}>
        <div
          ref={inner}
          className="w-max space-y-1.5"
          style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
        >
          {renderRow(ROW1, true)}
          <div className="rounded-sm py-1 text-center text-[10px] font-bold uppercase tracking-[0.4em]"
               style={{ background: 'rgb(var(--viz-2) / 0.10)', color: 'rgb(var(--viz-2))' }}>
            Corridor
          </div>
          {renderRow(ROW2, false)}
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
  const [editing, setEditing] = useState<Item | null>(null);
  const [editForm, setEditForm] = useState({ model: '', serialNumber: '' });

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

  const edit = useMutation({
    mutationFn: () =>
      api(`/workstations/equipment/${(editing as Item).id}/update`, {
        method: 'POST', body: editForm,
      }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });

  return (
    <Modal
      title={opened.title}
      description={opened.description}
      onClose={onClose}
      footer={
        manageable ? (
          <button
            className="btn-primary"
            onClick={() => { setEditing(null); setAdding((a) => !a); }}
          >
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
                    <div className="flex justify-end gap-0.5">
                      <button
                        className="btn-quiet btn-icon"
                        title="Edit model and serial"
                        onClick={() => {
                          setAdding(false);
                          setEditing(e);
                          setEditForm({
                            model: e.model ?? '',
                            serialNumber: e.serialNumber ?? '',
                          });
                        }}
                      >
                        <Pencil size={13} />
                      </button>
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
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && manageable && (
        <div className="mt-3 border-t border-[rgb(var(--border))] pt-3">
          <p className="mb-2 text-[12px] font-medium">
            Editing {editing.category.name}{' '}
            <span className="font-mono text-[11px] text-[rgb(var(--muted))]">
              {editing.assetTag}
            </span>
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Model">
              <input
                className="input"
                value={editForm.model}
                onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
              />
            </Field>
            <Field label="Serial">
              <input
                className="input"
                value={editForm.serialNumber}
                onChange={(e) => setEditForm((f) => ({ ...f, serialNumber: e.target.value }))}
              />
            </Field>
          </div>
          <div className="mt-2 flex gap-1.5">
            <button
              className="btn-primary"
              disabled={edit.isPending}
              onClick={() => edit.mutate()}
            >
              {edit.isPending ? 'Saving...' : 'Save changes'}
            </button>
            <button className="btn-ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
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

      {(add.isError || remove.isError || edit.isError) && (
        <div className="mt-2">
          <ErrorNote error={add.error ?? remove.error ?? edit.error} />
        </div>
      )}
    </Modal>
  );
}
