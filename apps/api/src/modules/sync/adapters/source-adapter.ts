/**
 * A sync source is anything that can hand us a table of rows: a Google Sheet
 * tab, an uploaded .xlsx, a .csv. The engine knows nothing about where the
 * rows came from, which is why deleting a Google Sheet cannot break it.
 */
export interface SourceRow {
  /** 1-based row number in the original sheet, for error reporting. */
  rowNumber: number;
  /** Cell values keyed by the header text, verbatim. */
  raw: Record<string, string>;
}

export interface SourceTable {
  headers: string[];
  rows: SourceRow[];
  /** Human-readable description of where this came from, stored on the run. */
  origin: string;
}

export interface SourceAdapter {
  readonly kind: 'GOOGLE_SHEET' | 'EXCEL_UPLOAD' | 'CSV_UPLOAD';
  read(params: {
    spreadsheetId?: string | null;
    sheetGid?: string | null;
    sheetName?: string | null;
    filePath?: string | null;
    headerRow: number;
  }): Promise<SourceTable>;
}

/**
 * Sheet headers are messy in practice: trailing spaces, line breaks pasted
 * from elsewhere, "Emp. Code " vs "Emp Code". Normalising once here means the
 * saved column mapping keeps working when somebody tidies the header row.
 */
export function normaliseHeader(header: string): string {
  return header
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width joiners and BOM
    .replace(/\s+/g, ' ')
    .trim();
}

/** Blank rows are extremely common at the bottom of a sheet - skip silently. */
export function isBlankRow(raw: Record<string, string>): boolean {
  return Object.values(raw).every((v) => !v || v.trim() === '');
}

/**
 * Sheets frequently contain repeated header rows part-way down (one per
 * section). Treat a row that exactly repeats the header as a separator.
 */
export function isRepeatedHeader(
  raw: Record<string, string>,
  headers: string[],
): boolean {
  const values = headers.map((h) => (raw[h] ?? '').trim().toLowerCase());
  const expected = headers.map((h) => h.trim().toLowerCase());
  const nonEmpty = values.filter(Boolean).length;
  return nonEmpty > 1 && values.every((v, i) => !v || v === expected[i]);
}
