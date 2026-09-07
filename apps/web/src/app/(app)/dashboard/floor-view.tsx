'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Armchair, Building2, Cpu, Headphones, Keyboard, Laptop, Monitor, Mouse, Pencil, Plus, Trash2, X,
  type LucideIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Field, ErrorNote } from '@/components/ui';
import { teamFromLabel, teamOf, type Team } from '@/lib/teams';

interface Item {
  id: string; assetTag: string; model: string | null;
  serialNumber: string | null; category: { name: string };
  make?: string | null;
  status?: string;
}

/** "Dell Latitude 5440", or the category when the sheet gave no model. */
const itemName = (it: Item) => [it.make, it.model].filter(Boolean).join(' ') || it.category.name;
/** The person a seat is mapped to, with everything issued to them. */
interface Occupant {
  employeeId: string; fullName: string; employeeCode: string;
  level: string | null; process: string | null;
  department: { name: string } | null;
  /** The team that owns the seat, as written on the mapping. */
  team: string | null;
  equipment: Item[];
}
interface Seat {
  id: string; seatCode: string; wing: string; process: string | null;
  missing: string[]; equipment: Item[];
  occupant: Occupant | null;
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
/**
 * `top` pins the top row's order; a null in it is a deliberately empty desk,
 * drawn as a blank slot so the seats either side keep their places.
 */
interface WingCfg { cols: number; topParity: 0 | 1; dir: 1 | -1; top?: Array<number | null> }

const WING: Record<string, WingCfg> = {
  '1C': { cols: 3, topParity: 1, dir: -1 },
  // 19 has moved down to the facing row; its old desk between 20 and 18
  // stays empty, so the top row keeps a gap there.
  '1B': { cols: 6, topParity: 0, dir: -1, top: [22, 20, null, 18, 16, 14] },
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

/**
 * What a place is allowed to hold. Counsellor seats carry the basic kit
 * only; Ops and System seats, the cabins and the Induction Space carry
 * custom items on top of it.
 */
type Tier = 'basic' | 'custom';

interface Opened {
  title: string;
  description?: string;
  missing: string[];
  equipment: Item[];
  base: string | null;
  kind: 'seat' | 'plate';
  refId: string;
  tier: Tier;
  /** Team level, for cabins that are a person. */
  level?: string | null;
  /** Set when the seat is mapped to a person: the card is theirs. */
  occupant?: Occupant | null;
  seatCode?: string;
}

/**
 * What a person at a mapped seat is expected to hold. The computer slot is
 * satisfied by a laptop, a desktop or an all-in-one.
 */
const PERSON_SLOTS: Slot[] = [
  { key: 'computer', label: 'Laptop / Desktop', icon: Laptop, match: /^(laptop|desktop|cpu|all[ -]?in[ -]?one)$/i },
  { key: 'monitor', label: 'Monitor', icon: Monitor, match: /^monitor$/i },
  { key: 'keyboard', label: 'Keyboard', icon: Keyboard, match: /^keyboard$/i },
  { key: 'mouse', label: 'Mouse', icon: Mouse, match: /^mouse$/i },
  { key: 'headset', label: 'Headset', icon: Headphones, match: /^(headphone|headphones|headset)$/i },
];

/** The team a mapped seat belongs to: the mapping's word first, then the person's record. */
function occupantTeam(o: Occupant): { id: Team | null; label: string } {
  const fromMapping = teamFromLabel(o.team);
  if (fromMapping) return { id: fromMapping, label: o.team as string };
  return teamOf(o) ?? { id: null, label: o.team ?? 'Unassigned' };
}

/** The seat's process line from the sheet decides its tier. */
function tierOf(process: string | null): Tier {
  const p = (process ?? '').toLowerCase();
  return /\bops\b|system|\bit\b|admin|induction/.test(p) ? 'custom' : 'basic';
}

/**
 * The basic kit every seat is expected to have. Each slot names the
 * categories that satisfy it (a monitor or an all-in-one both fill the
 * screen slot; the CPU slot is the Desktop category).
 */
interface Slot { key: string; label: string; icon: LucideIcon; match: RegExp }
const BASIC_SLOTS: Slot[] = [
  { key: 'screen', label: 'Monitor / All-in-one', icon: Monitor, match: /^(monitor|all[ -]?in[ -]?one)$/i },
  { key: 'cpu', label: 'CPU', icon: Cpu, match: /^(desktop|cpu)$/i },
  { key: 'keyboard', label: 'Keyboard', icon: Keyboard, match: /^keyboard$/i },
  { key: 'mouse', label: 'Mouse', icon: Mouse, match: /^mouse$/i },
  { key: 'headphone', label: 'Headphone', icon: Headphones, match: /^(headphone|headphones|headset)$/i },
  { key: 'chair', label: 'Chair', icon: Armchair, match: /^chair$/i },
];
const isBasicCategory = (name: string) => BASIC_SLOTS.some((s) => s.match.test(name.trim()));

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
function splitRows(seats: Seat[], cfg: WingCfg): [Array<Seat | null>, Seat[]] {
  const num = (s: Seat) => parseInt(s.seatCode.slice(2), 10) || 0;
  const sorted = [...seats].sort((a, b) => (num(a) - num(b)) * cfg.dir);
  if (cfg.top) {
    // A pinned number that is not on the floor is dropped; a null is kept as
    // an empty desk.
    const top = cfg.top
      .map((n) => (n === null ? null : sorted.find((s) => num(s) === n) ?? undefined))
      .filter((s): s is Seat | null => s !== undefined);
    const bottom = sorted.filter((s) => !cfg.top?.includes(num(s)));
    return [top, bottom];
  }
  const top = sorted.filter((s) => num(s) % 2 === cfg.topParity);
  const bottom = sorted.filter((s) => num(s) % 2 !== cfg.topParity);
  return [top, bottom];
}

function SeatBox({ seat, onOpen }: { seat: Seat; onOpen: OpenFn }) {
  const selected = useContext(SelectedCtx) === seat.id;
  const who = seat.occupant;
  return (
    <button
      onClick={(e) =>
        onOpen(who
          ? {
              // A mapped seat is this person's inventory location: the card
              // is theirs, and Add Item issues to them.
              title: who.fullName,
              description: [seat.wing].filter(Boolean).join('  -  '),
              missing: [],
              equipment: who.equipment,
              base: `/workstations/plates/${who.employeeId}/equipment`,
              kind: 'seat',
              refId: seat.id,
              tier: 'custom',
              level: who.level,
              occupant: who,
              seatCode: seat.seatCode,
            }
          : {
              title: `Seat ${seat.seatCode}`,
              description: [seat.process, seat.wing].filter(Boolean).join('  -  '),
              missing: seat.missing,
              equipment: seat.equipment,
              base: `/workstations/${seat.id}/equipment`,
              kind: 'seat',
              refId: seat.id,
              tier: tierOf(seat.process),
            }, e)
      }
      title={who
        ? `${who.fullName} - ${occupantTeam(who).label} - ${who.equipment.length} item(s)`
        : `${seat.equipment.length} item(s)${seat.missing.length ? ` - missing ${seat.missing.join(', ')}` : ''}`}
      data-selected={selected || undefined}
      data-team={who ? occupantTeam(who).id ?? 'other' : undefined}
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
function SeatRow({ seats, cols, onOpen }: { seats: Array<Seat | null>; cols: number; onOpen: OpenFn }) {
  const blanks = Math.max(0, cols - seats.length);
  const blank = (key: string) => (
    <div key={key} className="h-8 rounded border border-dashed border-[rgb(var(--border))] opacity-40" />
  );
  return (
    // Left-aligned, never centred: a 3-column wing must line up with its
    // 6-column neighbours, and a part-filled row with the row facing it.
    <div className="grid justify-start gap-1" style={{ gridTemplateColumns: `repeat(${cols}, 58px)` }}>
      {seats.map((s, i) => (s ? <SeatBox key={s.id} seat={s} onOpen={onOpen} /> : blank(`e${i}`)))}
      {Array.from({ length: blanks }).map((_, i) => blank(`b${i}`))}
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
          tier: 'custom',
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
                  tier: 'custom',
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
    if (!s) return opened;
    if (opened.occupant && s.occupant) {
      return { ...opened, occupant: s.occupant, equipment: s.occupant.equipment, level: s.occupant.level };
    }
    return { ...opened, equipment: s.equipment, missing: s.missing };
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

  // Every item on the card can be edited in place: the pencil on a basic
  // slot or a custom row opens one small form for its model and serial,
  // with Remove alongside. Same endpoints the full list uses.
  const [editing, setEditing] = useState<Item | null>(null);
  const [editForm, setEditForm] = useState({ model: '', serialNumber: '' });
  const openEdit = (it: Item) => {
    setAdding(false);
    setEditing(it);
    setEditForm({ model: it.model ?? '', serialNumber: it.serialNumber ?? '' });
  };
  const edit = useMutation({
    mutationFn: () =>
      api(`/workstations/equipment/${(editing as Item).id}/update`, { method: 'POST', body: editForm }),
    onSuccess: () => { setEditing(null); refresh(); },
  });
  const remove = useMutation({
    mutationFn: (assetId: string) => api(`${opened.base}/${assetId}/remove`, { method: 'POST' }),
    onSuccess: () => { setEditing(null); refresh(); },
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

  // Each basic slot takes the first item whose category fills it; whatever
  // is left over is custom kit (or, on a basic-only seat, a note).
  const { slots, extraItems } = useMemo(() => {
    const used = new Set<string>();
    const sheet = new Set(opened.missing.map((m) => m.trim().toLowerCase()));
    const slots = BASIC_SLOTS.map((slot) => {
      const item = items.find((it) => !used.has(it.id) && slot.match.test(it.category.name.trim()));
      if (item) used.add(item.id);
      const sheetMissing = [...sheet].some((m) => slot.match.test(m) || slot.label.toLowerCase().includes(m));
      return { slot, item: item ?? null, sheetMissing };
    });
    const extraItems = items.filter((it) => !used.has(it.id));
    return { slots, extraItems };
  }, [items, opened.missing]);
  const customItems = extraItems;
  const basicHave = slots.filter((s) => s.item).length;
  const basicShort = BASIC_SLOTS.length - basicHave;

  // What Add Item may add here: the basic categories only on a counsellor
  // seat, anything elsewhere.
  const addable = (categories.data ?? []).filter((c) =>
    opened.tier === 'custom' || opened.occupant || isBasicCategory(c.name));

  /** A missing basic slot opens the form with that kind of item chosen. */
  const startAdd = (slot: Slot) => {
    const c = (categories.data ?? []).find((x) => slot.match.test(x.name.trim()));
    setForm((f) => ({ ...f, categoryId: c?.id ?? '' }));
    setAdding(true);
  };

  // A mapped seat: the person's core kit, and the verdict on it.
  const person = opened.occupant ?? null;
  const team = person ? occupantTeam(person) : null;
  const personSlots = useMemo(() => {
    if (!person) return [];
    const used = new Set<string>();
    return PERSON_SLOTS.map((slot) => {
      const item = items.find((it) => !used.has(it.id) && slot.match.test(it.category.name.trim()));
      if (item) used.add(item.id);
      return { slot, item: item ?? null };
    });
  }, [person, items]);
  const personHave = personSlots.filter((s) => s.item).length;
  const personMissing = personSlots.filter((s) => !s.item).map((s) => s.slot.label);
  // A second laptop or monitor is excess only once the core kit is complete;
  // before that it is still a gap somewhere else.
  const personExcess = person
    ? PERSON_SLOTS.filter((slot) => items.filter((it) => slot.match.test(it.category.name.trim())).length > 1)
        .map((slot) => slot.label)
    : [];
  const personStatus = !person ? null
    : personHave === PERSON_SLOTS.length && personExcess.length
      ? { label: 'Excess Assets', tone: 'ok' as const, detail: `Core kit complete; more than one ${personExcess.join(', ').toLowerCase()}` }
      : personHave === PERSON_SLOTS.length
        ? { label: 'Fully Equipped', tone: 'ok' as const, detail: `All ${PERSON_SLOTS.length} core items assigned` }
        : personHave >= 3
          ? { label: 'Missing Assets', tone: 'warn' as const, detail: `Missing: ${personMissing.join(', ')}` }
          : { label: 'Partially Equipped', tone: 'warn' as const, detail: `${personHave} of ${PERSON_SLOTS.length} core items assigned` };

  const status = personStatus ?? (items.length === 0
    ? { label: 'Nothing recorded', tone: 'muted' as const }
    : basicShort
      ? { label: `Short of ${basicShort} basic item${basicShort === 1 ? '' : 's'}`, tone: 'warn' as const }
      : { label: opened.tier === 'custom' ? 'Basic kit complete' : 'Fully equipped', tone: 'ok' as const });

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
              {person && team ? (
                <span className="fv-tier" data-team={team.id ?? 'other'}>{team.label}</span>
              ) : (
                <span className="fv-tier" data-tier={opened.tier}>
                  {opened.tier === 'custom' ? 'Basic + Custom' : 'Basic'}
                </span>
              )}
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
              {person && (
                <span className="text-white/70">
                  - Seat <span className="font-mono text-white/90">{opened.seatCode}</span>
                </span>
              )}
              {opened.description && <span className="text-white/30">- {opened.description}</span>}
            </div>
          </div>
          <button className="fv-x" onClick={close} aria-label="Close"><X size={14} /></button>
        </div>

        {person && (
          <>
            {/* Assigned assets: everything issued to this person */}
            <div className="fv-sec px-5 pt-4" style={{ '--i': 1 } as React.CSSProperties}>
              <div className="mb-2 flex items-center justify-between">
                <p className="fv-h">Assigned assets</p>
                <p className="text-[11px] tabular-nums text-white/40">{items.length}</p>
              </div>
              {items.length === 0 ? (
                <p className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-[12px] text-white/45">
                  Nothing is issued to {person.fullName.split(' ')[0]} yet.
                </p>
              ) : (
                <ul className="grid grid-cols-2 gap-1.5">
                  {items.map((it) => (
                    <li key={it.id} className="fv-asset" data-editing={editing?.id === it.id || undefined}
                        title={[it.category.name, itemName(it), it.assetTag, it.serialNumber].filter(Boolean).join(' - ')}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-white/90">
                          {itemName(it)}
                          {itemName(it) !== it.category.name && (
                            <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-white/40">{it.category.name}</span>
                          )}
                        </span>
                        <span className="block truncate font-mono text-[10.5px] text-white/45">
                          ID {it.assetTag}{it.serialNumber ? ` · SN ${it.serialNumber}` : ' · no serial'}
                          {it.status && it.status !== 'ALLOCATED' ? ` · ${it.status.replace(/_/g, ' ').toLowerCase()}` : ''}
                        </span>
                      </span>
                      {manageable ? (
                        <button type="button" className="fv-slot-btn" aria-label={`Edit ${it.category.name}`}
                                title={`Edit ${it.category.name} (${it.assetTag})`} onClick={() => openEdit(it)}>
                          <Pencil size={12} strokeWidth={2.2} />
                        </button>
                      ) : (
                        <span className="fv-slot-mark" data-state="ok">✓</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Asset status: the core kit, item by item, and the verdict */}
            <div className="fv-sec px-5 pt-4" style={{ '--i': 2 } as React.CSSProperties}>
              <div className="mb-2 flex items-center justify-between">
                <p className="fv-h">Asset status</p>
                <p className="text-[11px] tabular-nums text-white/40">{personHave}/{PERSON_SLOTS.length} core</p>
              </div>
              <div className="fv-status" data-tone={status.tone}>
                <span className={`fv-dot fv-dot-${status.tone}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold">{status.label}</span>
                  <span className="block text-[11px] opacity-75">{personStatus?.detail}</span>
                </span>
              </div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {personSlots.map(({ slot, item }) => {
                  const Icon = slot.icon;
                  return (
                    <li key={slot.key}>
                      {item || !manageable ? (
                        <span className="fv-core" data-state={item ? 'ok' : 'missing'}>
                          <Icon size={12} strokeWidth={2} /> {slot.label}
                        </span>
                      ) : (
                        <button type="button" className="fv-core" data-state="missing"
                                title={`Issue a ${slot.label.toLowerCase()} to ${person.fullName}`}
                                onClick={() => startAdd(slot)}>
                          <Icon size={12} strokeWidth={2} /> {slot.label} <Plus size={11} strokeWidth={2.6} />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}

        {!person && (
          <>
        {/* Basic kit: one slot per expected item, filled or not */}
        <div className="fv-sec px-5 pt-4" style={{ '--i': 1 } as React.CSSProperties}>
          <div className="mb-2 flex items-center justify-between">
            <p className="fv-h">Basic</p>
            <p className="text-[11px] tabular-nums text-white/40">{basicHave}/{BASIC_SLOTS.length}</p>
          </div>
          <ul className="grid grid-cols-2 gap-1.5">
            {slots.map(({ slot, item, sheetMissing }) => {
              const Icon = slot.icon;
              const body = (
                <>
                  <span className="fv-slot-ico"><Icon size={14} strokeWidth={2} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-white/90">{slot.label}</span>
                    <span className="block truncate text-[10.5px] text-white/45">
                      {item
                        ? (item.model || item.assetTag)
                        : sheetMissing ? 'Missing - on the sheet too' : 'Missing'}
                    </span>
                  </span>
                </>
              );
              if (!item) {
                return (
                  <li key={slot.key}>
                    <button
                      type="button"
                      className="fv-slot"
                      data-state="missing"
                      disabled={!manageable}
                      title={manageable ? `Add a ${slot.label.toLowerCase()} here` : 'Missing'}
                      onClick={() => startAdd(slot)}
                    >
                      {body}
                      <span className="fv-slot-mark" data-state="missing">
                        {manageable ? <Plus size={12} strokeWidth={2.6} /> : '!'}
                      </span>
                    </button>
                  </li>
                );
              }
              return (
                <li key={slot.key}>
                  <div
                    className="fv-slot"
                    data-state="ok"
                    data-editing={editing?.id === item.id || undefined}
                    title={[item.assetTag, item.model].filter(Boolean).join(' - ')}
                  >
                    {body}
                    {manageable ? (
                      <button
                        type="button"
                        className="fv-slot-btn"
                        title={`Edit ${slot.label.toLowerCase()} (${item.assetTag})`}
                        aria-label={`Edit ${slot.label}`}
                        onClick={() => openEdit(item)}
                      >
                        <Pencil size={12} strokeWidth={2.2} />
                      </button>
                    ) : (
                      <span className="fv-slot-mark" data-state="ok">✓</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Custom kit: anything beyond the basics, for the places allowed it */}
        {opened.tier === 'custom' && (
          <div className="fv-sec px-5 pt-4" style={{ '--i': 2 } as React.CSSProperties}>
            <div className="mb-2 flex items-center justify-between">
              <p className="fv-h">Custom</p>
              <p className="text-[11px] tabular-nums text-white/40">{customItems.length}</p>
            </div>
            {customItems.length === 0 ? (
              <p className="rounded-xl bg-white/[0.04] px-3 py-2.5 text-[12px] text-white/45">
                {opened.base === null
                  ? 'No employee record matches this name yet.'
                  : manageable ? 'Nothing custom yet. Add Item puts one here.' : 'Nothing custom recorded.'}
              </p>
            ) : (
              <ul className="space-y-1">
                {customItems.map((it) => (
                  <li key={it.id} className="fv-custom" data-editing={editing?.id === it.id || undefined}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-white/90">{it.category.name}</span>
                      <span className="block truncate text-[10.5px] text-white/45">
                        {[it.assetTag, it.model].filter(Boolean).join(' - ')}
                      </span>
                    </span>
                    {manageable && (
                      <button
                        type="button"
                        className="fv-slot-btn"
                        title={`Edit ${it.category.name} (${it.assetTag})`}
                        aria-label={`Edit ${it.category.name}`}
                        onClick={() => openEdit(it)}
                      >
                        <Pencil size={12} strokeWidth={2.2} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {opened.tier === 'basic' && extraItems.length > 0 && (
          <p className="fv-sec mx-5 mt-3 rounded-xl px-3 py-2 text-[11.5px]"
             style={{ '--i': 2, background: 'rgb(253 224 71 / 0.10)', color: '#fde047' } as React.CSSProperties}>
            Also here, beyond the basic kit: {extraItems.map((i) => i.category.name).join(', ')}
          </p>
        )}

          </>
        )}

        {/* Edit form: one item at a time, opened from its pencil */}
        {editing && manageable && (
          <div className="fv-sec fv-form mx-5 mt-4 grid gap-2.5 rounded-2xl bg-white/[0.04] p-3.5 ring-1 ring-white/[0.06] sm:grid-cols-2"
               style={{ '--i': 0 } as React.CSSProperties}>
            <p className="text-[12px] font-medium text-white/85 sm:col-span-2">
              Editing {editing.category.name}{' '}
              <span className="font-mono text-[11px] text-white/45">{editing.assetTag}</span>
            </p>
            <label className="block">
              <span className="fv-label">Model</span>
              <input className="fv-input" value={editForm.model} placeholder="Optional" autoFocus
                     onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
                     onKeyDown={(e) => { if (e.key === 'Enter') edit.mutate(); }} />
            </label>
            <label className="block">
              <span className="fv-label">Serial</span>
              <input className="fv-input" value={editForm.serialNumber} placeholder="Optional"
                     onChange={(e) => setEditForm((f) => ({ ...f, serialNumber: e.target.value }))}
                     onKeyDown={(e) => { if (e.key === 'Enter') edit.mutate(); }} />
            </label>
            {(edit.isError || remove.isError) && (
              <p className="text-[11.5px] text-[#ffb4b4] sm:col-span-2">
                {(edit.error ?? remove.error) instanceof Error
                  ? ((edit.error ?? remove.error) as Error).message
                  : 'Could not save the change.'}
              </p>
            )}
            <div className="flex items-center gap-2 sm:col-span-2">
              <button type="button" className="fv-save" disabled={edit.isPending} onClick={() => edit.mutate()}>
                {edit.isPending ? 'Saving...' : 'Save changes'}
              </button>
              <button type="button" className="fv-quiet" onClick={() => setEditing(null)}>Cancel</button>
              <button
                type="button"
                className="fv-quiet ml-auto text-[#ffb4b4]"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(`Remove ${editing.category.name} ${editing.assetTag} from ${opened.title}? It is archived, not destroyed.`)) {
                    remove.mutate(editing.id);
                  }
                }}
              >
                <span className="inline-flex items-center gap-1"><Trash2 size={12} /> {remove.isPending ? 'Removing...' : 'Remove'}</span>
              </button>
            </div>
          </div>
        )}

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
                {addable.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {opened.tier === 'basic' && (
                <span className="mt-1 block text-[10.5px] text-white/40">
                  Counsellor seats hold the basic kit only.
                </span>
              )}
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
          <div className="fv-sec flex items-center justify-between px-5 pb-5 pt-4" style={{ '--i': 3 } as React.CSSProperties}>
            <button
              type="button"
              className="fv-quiet"
              aria-expanded={showList}
              onClick={() => setShowList((v) => !v)}
            >
              {showList ? 'Hide items' : `Manage ${items.length} item${items.length === 1 ? '' : 's'}`}
            </button>
            <button
              type="button"
              className="fv-cta"
              data-loading={add.isPending}
              disabled={add.isPending || (adding && !form.categoryId)}
              aria-expanded={adding}
              onClick={() => {
                if (!adding) { setEditing(null); setAdding(true); return; }
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
        {!manageable && (
          <div className="fv-sec flex items-center justify-start px-5 pb-5 pt-4" style={{ '--i': 3 } as React.CSSProperties}>
            <button type="button" className="fv-quiet" aria-expanded={showList} onClick={() => setShowList((v) => !v)}>
              {showList ? 'Hide items' : `All ${items.length} item${items.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}

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
