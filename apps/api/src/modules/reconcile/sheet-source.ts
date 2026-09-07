/**
 * Where the master workbooks are read from.
 *
 * The Google Sheet is the source of truth. When a service-account key is
 * present (docs/GOOGLE-SYNC-SETUP.md) every tab is read live from Google;
 * until then the most recently supplied copy of each workbook (the .xlsx
 * the sync sources point at) stands in, and every run says so.
 */
import { existsSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';
import { FileAdapter } from '../sync/adapters/file.adapter';
import { GoogleSheetsAdapter } from '../sync/adapters/google-sheets.adapter';
import type { SourceTable } from '../sync/adapters/source-adapter';

export interface SheetSource {
  kind: 'google' | 'file';
  /** Human-readable: the sheet id or the file path. */
  label: string;
  read(sheetName: string, headerRow: number): Promise<SourceTable>;
}

export function fileSource(filePath: string, adapter = new FileAdapter()): SheetSource {
  return {
    kind: 'file',
    label: filePath,
    read: (sheetName, headerRow) => adapter.read({ filePath, sheetName, headerRow }),
  };
}

export function googleSource(spreadsheetId: string, adapter: GoogleSheetsAdapter): SheetSource {
  return {
    kind: 'google',
    label: `google-sheet:${spreadsheetId}`,
    read: (sheetName, headerRow) => adapter.read({ spreadsheetId, sheetName, headerRow }),
  };
}

export interface ResolvedSources {
  /** True when the workbooks are read live from Google. */
  connected: boolean;
  /** Why not, when not. */
  reason: string | null;
  ccc: SheetSource | null;
  wingwise: SheetSource | null;
}

export function googleConfigured(): boolean {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  return Boolean(keyFile && existsSync(keyFile));
}

/**
 * Google when it can be, else the last workbook file each importer was run
 * on (recorded on its sync source), else nothing for that workbook.
 */
export async function resolveSources(
  prisma: PrismaClient,
  sheets: GoogleSheetsAdapter,
): Promise<ResolvedSources> {
  const cccId = process.env.SHEET_CONTACT_CENTER_ID;
  const wingId = process.env.SHEET_WINGWISE_ID;

  if (googleConfigured()) {
    return {
      connected: true,
      reason: null,
      ccc: cccId ? googleSource(cccId, sheets) : null,
      wingwise: wingId ? googleSource(wingId, sheets) : null,
    };
  }

  const lastFile = async (name: string): Promise<SheetSource | null> => {
    const env = name === 'Central Contact Center workbook'
      ? process.env.CCC_WORKBOOK_FILE
      : process.env.WINGWISE_WORKBOOK_FILE;
    const src = await prisma.syncSource.findFirst({ where: { name }, orderBy: { updatedAt: 'desc' } });
    const path = env || src?.workbookLabel;
    return path && existsSync(path) ? fileSource(path) : null;
  };

  return {
    connected: false,
    reason:
      'Google Sheets is not connected: no service-account key at GOOGLE_SERVICE_ACCOUNT_JSON. ' +
      'Reading the last workbook files supplied instead. See docs/GOOGLE-SYNC-SETUP.md.',
    ccc: await lastFile('Central Contact Center workbook'),
    wingwise: await lastFile('Wing Wise workbook'),
  };
}
