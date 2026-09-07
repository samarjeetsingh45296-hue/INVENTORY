/**
 * Where the master workbooks are read from.
 *
 * The Google Sheet is the source of truth. When a service-account key is
 * present (docs/GOOGLE-SYNC-SETUP.md) every tab is read live from Google;
 * until then the most recently supplied copy of each workbook (the .xlsx
 * the sync sources point at) stands in, and every run says so.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
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

  // Without Google, the newest matching workbook wins: an explicit path from
  // the environment, else the newest export in Downloads (download the sheet
  // as Excel and it is picked up), else the kept copy under backups/sheets,
  // else wherever the importer last ran.
  const lastFile = async (name: string, pattern: RegExp, env?: string): Promise<SheetSource | null> => {
    if (env && existsSync(env)) return fileSource(env);
    const found = newestMatching(pattern, [downloadsDir(), keptCopiesDir()]);
    if (found) return fileSource(found);
    const src = await prisma.syncSource.findFirst({ where: { name }, orderBy: { updatedAt: 'desc' } });
    return src?.workbookLabel && existsSync(src.workbookLabel) ? fileSource(src.workbookLabel) : null;
  };

  return {
    connected: false,
    reason:
      'Google Sheets is not connected: no service-account key at GOOGLE_SERVICE_ACCOUNT_JSON. ' +
      'Reading the newest workbook files on this machine instead (Downloads, then backups/sheets). ' +
      'See docs/GOOGLE-SYNC-SETUP.md.',
    ccc: await lastFile('Central Contact Center workbook', /central.?contact.?cent.*\.xlsx$/i, process.env.CCC_WORKBOOK_FILE),
    wingwise: await lastFile('Wing Wise workbook', /wing.?wise.*\.xlsx$/i, process.env.WINGWISE_WORKBOOK_FILE),
  };
}

export function downloadsDir(): string {
  return join(process.env.USERPROFILE ?? homedir(), 'Downloads');
}

/** Where a workbook that was read from a file is kept, so it is never lost again. */
export function keptCopiesDir(): string {
  return resolve(process.env.BACKUP_DIR ?? './backups', 'sheets');
}

function newestMatching(pattern: RegExp, dirs: string[]): string | null {
  let best: { path: string; mtime: number } | null = null;
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!pattern.test(f) || f.startsWith('~$')) continue;
      const path = join(dir, f);
      const mtime = statSync(path).mtimeMs;
      if (!best || mtime > best.mtime) best = { path, mtime };
    }
  }
  return best?.path ?? null;
}

/**
 * Copies a workbook that was just read into backups/sheets, stamped with the
 * day, unless an identical copy is already there. Returns the kept path.
 */
export function keepCopy(filePath: string, stem: string): string | null {
  try {
    const dir = keptCopiesDir();
    mkdirSync(dir, { recursive: true });
    const size = statSync(filePath).size;
    const day = new Date().toISOString().slice(0, 10);
    const target = join(dir, `${stem}-${day}.xlsx`);
    if (existsSync(target) && statSync(target).size === size) return target;
    copyFileSync(filePath, target);
    return target;
  } catch {
    return null;
  }
}
