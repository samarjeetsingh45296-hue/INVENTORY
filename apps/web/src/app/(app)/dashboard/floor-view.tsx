'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Field, ErrorNote } from '@/components/ui';

interface Item {
  id: string; assetTag: string; model: string | null;
  serialNumber: string | null; category: { name: string };
}
interface Seat {
  id: string; seatCode: string; wing: string; process: string | null;
  missing: string[]; equipment: Item[];
}
interface Plate { name: string; employeeId: string | null; level: string | null; equipment: Item[] }
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
  // 19 sits up in the top row beside 20, not below it, so the parity rule
  // does not hold here either.
  '1B': { cols: 6, topParity: 0, dir: -1, top: [22, 20, 19, 18, 16, 14] },
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
  /** Team level, for cabins that are a person. */
  level?: string | null;
}

/** Where a click happened, and the box of the thing that was clicked. */
interface Anchor {
  x: number;
  y: number;
  rect: { left: number; top: number; width: number; height: number };
}
type OpenFn = (o: Opened, e: React.MouseEvent<HTMLElement>) => void;

const anchorFrom = (e: React.MouseEvent<HTMLElement>): Anchor => {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: e.clientX, y: e.clientY, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
};

/** The refId of whatever is open, so its box can keep glowing under the card. */
const SelectedCtx = createContext<string | null>(null);

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

function SeatBox({ seat, onOpen }: { seat: Seat; onOpen: OpenFn }) {
  const selected = useContext(SelectedCtx) === seat.id;
  return (
    <button
      onClick={(e) =>
        onOpen({
          title: `Seat ${seat.seatCode}`,
          description: [seat.process, seat.wing].filter(Boolean).join('  -  '),
          missing: seat.missing,
          equipment: seat.equipment,
          base: `/workstations/${seat.id}/equipment`,
          kind: 'seat',
          refId: seat.id,
        }, e)
      }
      title={`${seat.equipment.length} item(s)${seat.missing.length ? ` - missing ${seat.missing.join(', ')}` : ''}`}
      data-selected={selected || undefined}
      className="fv-target flex h-8 w-full items-center justify-center rounded border font-mono
                 text-[10px] font-semibold shadow-sm transition hover:scale-[1.08] hover:shadow"
      style={{
        // Status lives in the tint and border; the code itself stays in the
        // page's text color so it is legible in the light theme too.
        background: seat.missing.length ? 'rgb(var(--warn-bg))' : 'rgb(var(--ok-bg))',
        color: 'rgb(var(--text))',
        borderColor: seat.missing.length
          ? 'rgb(var(--warn) / 0.5)'
          : 'rgb(var(--ok) / 0.5)',
      }}
    >
      {seat.seatCode}
    </button>
  );
}

/** A row of seat boxes; empty slots keep the sheet's footprint. */
function SeatRow({ seats, cols, onOpen }: { seats: Seat[]; cols: number; onOpen: OpenFn }) {
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
}: { wingKey: string; seats: Seat[]; onOpen: OpenFn; grow?: boolean }) {
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
}: { name: string; plate?: Plate; onOpen: OpenFn; tall?: boolean }) {
  const selected = useContext(SelectedCtx) === name.toLowerCase();
  return (
    <button
      onClick={(e) =>
        onOpen({
          title: name,
          description: 'Cabin',
          level: plate?.level ?? null,
          missing: [],
          equipment: plate?.equipment ?? [],
          base: plate?.employeeId ? `/workstations/plates/${plate.employeeId}/equipment` : null,
          kind: 'plate',
          refId: name.toLowerCase(),
        }, e)
      }
      title={`${plate?.equipment.length ?? 0} item(s) - click to view`}
      data-selected={selected || undefined}
      className={`fv-target grid h-full w-full place-items-center rounded-md border
                  border-[rgb(var(--border-hard))] bg-[rgb(var(--surface))] px-2
                  text-center text-[12px] font-semibold leading-tight
                  text-[rgb(var(--text))] shadow-sm transition
                  hover:border-[rgb(var(--ring))] ${tall ? 'min-h-24' : ''}`}
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
         style={{
           background: 'rgb(var(--viz-2) / 0.16)',
           // Pulled toward the page's text color so the label holds up on the
           // pale tint in the light theme.
           color: 'color-mix(in srgb, rgb(var(--viz-2)) 55%, rgb(var(--text)))',
         }}>
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
  onOpen: OpenFn;
}) {
  const selectedId = useContext(SelectedCtx);
  /**
   * Every row in a zone runs on one shared column grid, sized to the widest
   * wing in that zone. A cabin then spans exactly the columns its wing does
   * not use, so a short wing's seats sit squarely above the columns of the
   * wings below instead of drifting wherever a flexing cabin left them.
   */
  const zoneCols = Math.max(
    ...zone.segments.map((s) => WING[s.wing]?.cols ?? 6),
  );

  const segmentRow = (seg: Segment) => {
    const cols = WING[seg.wing]?.cols ?? 6;
    const cabinSpan = Math.max(1, zoneCols - cols);
    return (
      <div
        key={seg.wing}
        className="grid items-stretch gap-1"
        style={{ gridTemplateColumns: `repeat(${zoneCols}, 58px)` }}
      >
        {seg.cabin && (
          <div style={{ gridColumn: `span ${cabinSpan}` }}>
            <CabinBox
              name={seg.cabin}
              plate={plates.get(seg.cabin.toLowerCase())}
              onOpen={onOpen}
            />
          </div>
        )}
        <div style={{ gridColumn: `span ${cols}` }}>
          <WingStack
            wingKey={seg.wing}
            seats={seatsByWing.get(seg.wing) ?? []}
            grow={false}
            onOpen={onOpen}
          />
        </div>
      </div>
    );
  };

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
              onClick={(e) =>
                indSeat &&
                onOpen({
                  title: zone.rightSpan?.label ?? '',
                  description: 'Shared space',
                  missing: [],
                  equipment: indSeat.equipment,
                  base: `/workstations/${indSeat.id}/equipment`,
                  kind: 'seat',
                  refId: indSeat.id,
                }, e)
              }
              title={indSeat ? `${indSeat.equipment.length} item(s) - click to view` : 'Not recorded yet'}
              data-selected={(indSeat && selectedId === indSeat.id) || undefined}
              className="fv-target grid min-w-40 flex-1 place-items-center self-stretch rounded-md border
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
        .map((g) => segmentRow(g))}
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
  const [opened, setOpened] = useState<(Opened & { anchor: Anchor }) | null>(null);
  const open: OpenFn = (o, e) => setOpened({ ...o, anchor: anchorFrom(e) });
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
                       indSeat={indSeat} onOpen={open} />
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

      <SelectedCtx.Provider value={opened?.refId ?? null}>
        {/* The whole map softens while a card is open; the clicked box stays
            sharp because its glow is drawn on top, outside the blurred layer. */}
        <div ref={outer} className="fv-map w-full" data-dim={!!opened} style={{ height }}>
          <div
            ref={inner}
            className="w-max space-y-1.5"
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
          >
            {renderRow(ROW1, true)}
            <div className="rounded-sm py-1 text-center text-[10px] font-bold uppercase tracking-[0.4em]"
                 style={{
                   background: 'rgb(var(--viz-2) / 0.10)',
                   color: 'color-mix(in srgb, rgb(var(--viz-2)) 55%, rgb(var(--text)))',
                 }}>
              Corridor
            </div>
            {renderRow(ROW2, false)}
          </div>
        </div>
      </SelectedCtx.Provider>

      {openedLive && opened && (
        <ContextCard
          key={opened.refId}
          opened={openedLive}
          anchor={opened.anchor}
          canManage={can('workspace.manage')}
          onClose={() => setOpened(null)}
        />
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------
   The floating card. It grows out of the clicked box - scaling up from 0.85
   at the click point, drifting up 24px, overshooting to 1.03 and settling -
   over 450ms on a spring curve, with its sections arriving 100ms apart.
   Closing runs the same path backwards, faster. Never a centred modal.
------------------------------------------------------------------------- */
const CARD_W = 440;
const GAP = 14;
const MARGIN = 12;

function placeCard(anchor: Anchor, cardH: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const r = anchor.rect;
  // Beside the box, to the right; flip left when there is no room.
  let left = r.left + r.width + GAP;
  if (left + CARD_W > vw - MARGIN) left = r.left - GAP - CARD_W;
  if (left < MARGIN) left = Math.min(Math.max(MARGIN, anchor.x - CARD_W / 2), vw - MARGIN - CARD_W);
  // Level with the box's centre, kept on screen.
  let top = r.top + r.height / 2 - cardH / 2;
  top = Math.max(MARGIN, Math.min(top, vh - MARGIN - cardH));
  // Transform origin: the click point, expressed inside the card.
  const ox = Math.max(0, Math.min(CARD_W, anchor.x - left));
  const oy = Math.max(0, Math.min(cardH, anchor.y - top));
  return { left, top, ox, oy };
}

function ContextCard({
  opened, anchor, canManage, onClose,
}: { opened: Opened; anchor: Anchor; canManage: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [closing, setClosing] = useState(false);
  const [showList, setShowList] = useState(false);
  const [pos, setPos] = useState(() => placeCard(anchor, 320));

  // The one action: Add Item. First click reveals the form, second confirms.
  const queryClient = useQueryClient();
  const manageable = canManage && opened.base !== null;
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ categoryId: '', model: '', serialNumber: '' });
  const categories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<Array<{ id: string; name: string }>>('/assets/categories'),
    enabled: manageable && adding,
  });
  const add = useMutation({
    mutationFn: () => api(opened.base as string, { method: 'POST', body: form }),
    onSuccess: () => {
      setForm({ categoryId: '', model: '', serialNumber: '' });
      setAdding(false);
      queryClient.invalidateQueries({ queryKey: ['floor'] });
      queryClient.invalidateQueries({ queryKey: ['kpis'] });
    },
  });

  // Measure once mounted (and whenever the card grows) so it stays on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fix = () => setPos(placeCard(anchor, el.offsetHeight));
    fix();
    const ro = new ResizeObserver(fix);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor]);

  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 220);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const items = opened.equipment;
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) m.set(it.category.name, (m.get(it.category.name) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items]);
  const maxCat = byCategory[0]?.[1] ?? 1;

  const status = items.length === 0
    ? { label: 'Nothing recorded', tone: 'muted' as const }
    : opened.missing.length
      ? { label: `Short of ${opened.missing.length}`, tone: 'warn' as const }
      : { label: 'Fully equipped', tone: 'ok' as const };

  return (
    <>
      {/* Click-away layer: transparent on purpose - the dashboard stays visible. */}
      <div className="fixed inset-0 z-40" onMouseDown={close} aria-hidden />

      <div
        ref={ref}
        role="dialog"
        aria-label={opened.title}
        className="fv-card fixed z-50"
        data-closing={closing}
        style={{ left: pos.left, top: pos.top, width: CARD_W, transformOrigin: `${pos.ox}px ${pos.oy}px` }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="fv-sec flex items-start gap-3 px-5 pt-5" style={{ '--i': 0 } as React.CSSProperties}>
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-white">
              <span className="truncate">{opened.title}</span>
              {opened.level && (
                <span className="inline-flex h-[18px] shrink-0 items-center rounded-[5px] border border-white/15 bg-white/10 px-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-white/85"
                      title={`Level ${opened.level}`}>
                  {opened.level}
                </span>
              )}
            </h3>
            <div className="mt-1 flex items-center gap-2 text-[12px] text-white/55">
              <span className={`fv-dot fv-dot-${status.tone}`} />
              <span>{status.label}</span>
              {opened.description && <span className="text-white/30">- {opened.description}</span>}
            </div>
          </div>
          <button className="fv-x" onClick={close} aria-label="Close"><X size={14} /></button>
        </div>

        {/* KPIs */}
        <div className="fv-sec grid grid-cols-3 gap-2 px-5 pt-4" style={{ '--i': 1 } as React.CSSProperties}>
          <Kpi label="Items" value={items.length} onClick={() => setShowList((s) => !s)} active={showList} />
          <Kpi label="Categories" value={byCategory.length} />
          <Kpi label="Missing" value={opened.missing.length} tone={opened.missing.length ? 'warn' : undefined} />
        </div>

        {/* Breakdown */}
        <div className="fv-sec px-5 pt-4" style={{ '--i': 2 } as React.CSSProperties}>
          {byCategory.length === 0 ? (
            <p className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-[12px] text-white/45">
              {opened.base === null
                ? 'No employee record matches this name yet.'
                : 'No equipment recorded here yet.'}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {byCategory.slice(0, 5).map(([name, n]) => (
                <li key={name} className="flex items-center gap-2.5 text-[12px]">
                  <span className="w-24 truncate text-white/60">{name}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                    <span className="fv-bar block h-full rounded-full" style={{ width: `${(n / maxCat) * 100}%` }} />
                  </span>
                  <span className="w-4 text-right tabular-nums text-white/80">{n}</span>
                </li>
              ))}
              {byCategory.length > 5 && (
                <li className="text-[11px] text-white/35">+{byCategory.length - 5} more</li>
              )}
            </ul>
          )}
          {opened.missing.length > 0 && (
            <p className="mt-2.5 rounded-xl px-3 py-2 text-[11.5px]"
               style={{ background: 'rgb(253 224 71 / 0.10)', color: '#fde047' }}>
              Sheet marks this short of: {opened.missing.join(', ')}
            </p>
          )}
        </div>

        {/* Add-item form: revealed by the one action below; the same button
            then confirms it, so the footer never holds more than one CTA. */}
        {adding && manageable && (
          <div className="fv-sec fv-form mx-5 mt-4 grid gap-2.5 rounded-2xl bg-white/[0.04] p-3.5 ring-1 ring-white/[0.06] sm:grid-cols-3"
               style={{ '--i': 0 } as React.CSSProperties}>
            <label className="block sm:col-span-3">
              <span className="fv-label">Item</span>
              <select
                className="fv-input"
                value={form.categoryId}
                autoFocus
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              >
                <option value="">Choose what kind of item...</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="fv-label">Model</span>
              <input className="fv-input" value={form.model} placeholder="Optional"
                     onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
            </label>
            <label className="block">
              <span className="fv-label">Serial</span>
              <input className="fv-input" value={form.serialNumber} placeholder="Optional"
                     onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))} />
            </label>
            {add.isError && (
              <p className="text-[11.5px] text-[#ffb4b4] sm:col-span-3">
                {add.error instanceof Error ? add.error.message : 'Could not add the item.'}
              </p>
            )}
          </div>
        )}

        {/* Footer: one action, bottom-right */}
        {manageable && (
          <div className="fv-sec flex items-center justify-end px-5 pb-5 pt-4" style={{ '--i': 3 } as React.CSSProperties}>
            <button
              type="button"
              className="fv-cta"
              data-loading={add.isPending}
              disabled={add.isPending || (adding && !form.categoryId)}
              aria-expanded={adding}
              onClick={() => {
                if (!adding) { setAdding(true); return; }
                add.mutate();
              }}
            >
              <span className="fv-cta-icon" aria-hidden>
                {add.isPending ? <span className="fv-spin" /> : <Plus size={15} strokeWidth={2.4} />}
              </span>
              <span>{add.isPending ? 'Adding...' : adding && form.categoryId ? 'Add Item' : 'Add Item'}</span>
              <span className="fv-cta-shine" aria-hidden />
            </button>
          </div>
        )}
        {!manageable && <div className="pb-5" />}

        {showList && (
          <div className="fv-sec fv-details border-t border-white/[0.07] px-5 pb-5 pt-4"
               style={{ '--i': 0 } as React.CSSProperties}>
            <EquipmentManager opened={opened} canManage={canManage} />
          </div>
        )}
      </div>
    </>
  );
}

function Kpi({
  label, value, tone, onClick, active,
}: { label: string; value: number; tone?: 'warn'; onClick?: () => void; active?: boolean }) {
  const inner = (
    <>
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-white/40">
        {label}{onClick && <span className="ml-1 text-white/30">{active ? '▾' : '▸'}</span>}
      </p>
      <p className={`mt-0.5 text-[20px] font-semibold tabular-nums leading-none ${tone === 'warn' ? 'text-[#fde047]' : 'text-white'}`}>
        {value}
      </p>
    </>
  );
  const cls = 'rounded-2xl bg-white/[0.05] px-3 py-2.5 ring-1 ring-white/[0.06] text-left';
  return onClick ? (
    <button type="button" onClick={onClick} aria-expanded={active}
            className={`${cls} transition hover:bg-white/[0.09] hover:ring-white/[0.12]`}
            title={active ? 'Hide the item list' : 'Show the item list'}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** The equipment list with add / edit / remove, shown under "Inventory details". */
function EquipmentManager({
  opened, canManage,
}: { opened: Opened; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Item | null>(null);
  const [editForm, setEditForm] = useState({ model: '', serialNumber: '' });

  const manageable = canManage && opened.base !== null;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['floor'] });
    queryClient.invalidateQueries({ queryKey: ['kpis'] });
  };

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
    <div className="dark">
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

      {(remove.isError || edit.isError) && (
        <div className="mt-2">
          <ErrorNote error={remove.error ?? edit.error} />
        </div>
      )}
    </div>
  );
}
