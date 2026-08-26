/**
 * Value transformation for imported cells.
 *
 * Real inventory sheets contain "15-Aug-2026", "15/08/2026", "  YES ",
 * "9876543210 ", "Rs. 45,000/-" and blank-but-not-empty cells. Everything is
 * coerced here, once, with a clear error when it cannot be.
 */

export interface TransformResult<T = unknown> {
  ok: boolean;
  value: T | null;
  error?: string;
}

const ok = <T>(value: T): TransformResult<T> => ({ ok: true, value });
const fail = <T = never>(error: string): TransformResult<T> => ({
  ok: false,
  value: null,
  error,
});

const TRUE_WORDS = new Set(['y', 'yes', 'true', '1', 'active', 'working', 'ok', 'available']);
const FALSE_WORDS = new Set(['n', 'no', 'false', '0', 'inactive', 'na', 'n/a', '-']);

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

/** Treated as "no value", not as the literal text. */
export function isEmptyish(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === '' || v === '-' || v === '--' || v === 'na' || v === 'n/a' ||
         v === 'nil' || v === 'null' || v === 'none' || v === '#n/a';
}

export function toTitleCase(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Indian mobile numbers arrive as "+91 98765 43210", "098765-43210",
 * "9876543210.0" (Excel numeric coercion). Reduced to 10 digits where possible.
 */
export function normalisePhone(raw: string): TransformResult<string> {
  const digits = raw.replace(/\.0+$/, '').replace(/\D/g, '');
  if (digits.length === 0) return ok('');
  const local = digits.length > 10 ? digits.slice(-10) : digits;
  if (local.length !== 10) {
    return fail(`"${raw}" is not a usable phone number`);
  }
  return ok(local);
}

/** Accepts dd-MMM-yyyy, dd/MM/yyyy, yyyy-MM-dd and Excel serial numbers. */
export function parseFlexibleDate(raw: string): TransformResult<Date> {
  const v = raw.trim();
  if (isEmptyish(v)) return ok(null as unknown as Date);

  // Excel stores dates as days since 1899-12-30.
  if (/^\d{5}(\.\d+)?$/.test(v)) {
    const serial = Number(v);
    const ms = Math.round((serial - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? fail(`"${raw}" is not a date`) : ok(d);
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  if (iso) {
    return ok(new Date(Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!)));
  }

  // dd-MMM-yyyy / dd MMM yy
  const named = /^(\d{1,2})[-/ ]([A-Za-z]{3,4})[-/ ](\d{2,4})$/.exec(v);
  if (named) {
    const month = MONTHS[named[2]!.toLowerCase()];
    if (month === undefined) return fail(`"${raw}" has an unknown month`);
    const year = normaliseYear(+named[3]!);
    return ok(new Date(Date.UTC(year, month, +named[1]!)));
  }

  // dd/MM/yyyy - day first, which is the convention in these sheets.
  const numeric = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(v);
  if (numeric) {
    const day = +numeric[1]!;
    const month = +numeric[2]!;
    if (month > 12) return fail(`"${raw}" has month ${month}`);
    return ok(new Date(Date.UTC(normaliseYear(+numeric[3]!), month - 1, day)));
  }

  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? fail(`"${raw}" is not a date`) : ok(parsed);
}

function normaliseYear(y: number): number {
  if (y >= 1000) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

/** Strips currency symbols, thousands separators and trailing "/-". */
export function parseNumber(raw: string): TransformResult<number> {
  if (isEmptyish(raw)) return ok(null as unknown as number);
  const cleaned = raw
    .replace(/[^\d.\-]/g, '')
    .replace(/(?!^)-/g, '');
  if (cleaned === '' || cleaned === '-') return fail(`"${raw}" is not a number`);
  const n = Number(cleaned);
  return Number.isFinite(n) ? ok(n) : fail(`"${raw}" is not a number`);
}

export function parseBoolean(raw: string): TransformResult<boolean> {
  const v = raw.trim().toLowerCase();
  if (v === '') return ok(null as unknown as boolean);
  if (TRUE_WORDS.has(v)) return ok(true);
  if (FALSE_WORDS.has(v)) return ok(false);
  return fail(`"${raw}" is not yes/no`);
}

/**
 * Maps free text onto an enum using a lookup table, case- and
 * punctuation-insensitively. Unknown values are reported rather than silently
 * defaulted, so bad data is visible instead of buried.
 */
export function parseEnum(
  raw: string,
  lookup: Record<string, string>,
  fallback?: string,
): TransformResult<string> {
  if (isEmptyish(raw)) {
    return fallback ? ok(fallback) : ok(null as unknown as string);
  }
  const key = raw.trim().toLowerCase().replace(/[\s_-]+/g, '');
  for (const [candidate, mapped] of Object.entries(lookup)) {
    if (candidate.toLowerCase().replace(/[\s_-]+/g, '') === key) return ok(mapped);
  }
  if (fallback) return ok(fallback);
  return fail(`"${raw}" is not one of: ${Object.keys(lookup).join(', ')}`);
}

export type TransformName =
  | 'none' | 'trim' | 'upper' | 'lower' | 'title'
  | 'date' | 'number' | 'boolean' | 'phone' | 'email' | 'enum';

export function applyTransform(
  name: TransformName,
  raw: string,
  arg: Record<string, unknown> = {},
): TransformResult {
  const v = (raw ?? '').trim();
  switch (name) {
    case 'none':    return ok(raw);
    case 'trim':    return ok(isEmptyish(v) ? null : v);
    case 'upper':   return ok(isEmptyish(v) ? null : v.toUpperCase());
    case 'lower':   return ok(isEmptyish(v) ? null : v.toLowerCase());
    case 'title':   return ok(isEmptyish(v) ? null : toTitleCase(v));
    case 'date':    return parseFlexibleDate(v);
    case 'number':  return parseNumber(v);
    case 'boolean': return parseBoolean(v);
    case 'phone':   return normalisePhone(v);
    case 'email': {
      if (isEmptyish(v)) return ok(null);
      const e = v.toLowerCase();
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? ok(e) : fail(`"${raw}" is not an email address`);
    }
    case 'enum':
      return parseEnum(
        v,
        (arg.lookup as Record<string, string>) ?? {},
        arg.fallback as string | undefined,
      );
    default:
      return ok(isEmptyish(v) ? null : v);
  }
}
