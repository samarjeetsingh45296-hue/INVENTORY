/**
 * Where the master workbooks are read from.
 *
 * The Google Sheet is the source of truth. When a service-account key is
 * present (docs/GOOGLE-SYNC-SETUP.md) every tab is read live from Google;
 * until then the most recently supplied copy of each workbook (the .xlsx
 * the sync sources point at) stands in, and every run says so.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

/**
 * Tab names drift: "CUG" becomes "CUG Master ", "Locker Key" becomes
 * "Locker Keys", a typo gets fixed. The importer asks by the name it knows
 * and the closest real tab answers - exact first, then the same letters,
 * then the shortest tab that starts with them.
 */
export function resolveTabName(wanted: string, titles: string[]): string | null {
  const norm = (s: string) =>
    s.toLowerCase().replace(/headfhone/g, 'headphone').replace(/[^a-z0-9]/g, '');
  if (titles.includes(wanted)) return wanted;
  const w = norm(wanted);
  const same = titles.find((t) => norm(t) === w);
  if (same) return same;
  const starts = titles.filter((t) => norm(t).startsWith(w)).sort((a, b) => a.length - b.length);
  if (starts[0]) return starts[0];
  const within = titles.filter((t) => w.startsWith(norm(t)) && norm(t).length >= 4).sort((a, b) => b.length - a.length);
  return within[0] ?? null;
}

export function googleSource(spreadsheetId: string, adapter: GoogleSheetsAdapter): SheetSource {
  return {
    kind: 'google',
    label: `google-sheet:${spreadsheetId}`,
    read: async (sheetName, headerRow) => {
      const titles = await adapter.listTabs(spreadsheetId);
      const tab = resolveTabName(sheetName, titles);
      if (!tab) {
        throw new Error(`No tab like "${sheetName}" in the sheet (it has: ${titles.join(', ')})`);
      }
      // Google occasionally answers a good request with "not found" or a
      // timeout; three tries a few seconds apart ride that out.
      let lastErr: unknown;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          return await adapter.read({ spreadsheetId, sheetName: tab, headerRow });
        } catch (err) {
          lastErr = err;
          if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 4000));
        }
      }
      throw lastErr;
    },
  };
}

export interface ResolvedSources {
  /** True when the workbooks are read live from Google (by key or by link). */
  connected: boolean;
  /** How they were read. */
  mode: 'google-api' | 'link' | 'file' | 'none';
  /** Why not live, when not. */
  reason: string | null;
  ccc: SheetSource | null;
  wingwise: SheetSource | null;
  /** The employee master (TL Attendance workbook); Google only. */
  master: SheetSource | null;
}

export function googleConfigured(): boolean {
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  return Boolean(keyFile && existsSync(keyFile));
}

/**
 * The link route: a sheet shared as "Anyone with the link - Viewer" can be
 * fetched as a whole Excel workbook, every tab with its name, from a plain
 * URL - no key, no account. The download is kept under backups/sheets and
 * read like any workbook file. A private sheet answers with a sign-in page
 * instead; that is reported, never mistaken for data.
 */
export async function fetchByLink(
  spreadsheetId: string,
  stem: string,
): Promise<{ path: string } | { error: string }> {
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: controller.signal });
    const type = res.headers.get('content-type') ?? '';
    if (res.status === 401 || res.status === 403 || type.includes('text/html')) {
      return {
        error:
          'the sheet is private. In Google Sheets choose Share, then under General access pick ' +
          '"Anyone with the link" as Viewer, and the site will read it by itself.',
      };
    }
    if (!res.ok) return { error: `Google answered ${res.status} ${res.statusText}` };
    const buf = Buffer.from(await res.arrayBuffer());
    // An .xlsx is a zip: it starts with "PK".
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      return { error: 'Google did not return a workbook (unexpected content)' };
    }
    const dir = keptCopiesDir();
    mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const path = join(dir, `${stem}-live-${day}.xlsx`);
    writeFileSync(path, buf);
    return { path };
  } catch (err) {
    return { error: (err as Error).name === 'AbortError' ? 'timed out after 90s' : (err as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Live from Google when it can be - by service-account key, else by link -
 * else the newest workbook file on this machine.
 */
export async function resolveSources(
  prisma: PrismaClient,
  sheets: GoogleSheetsAdapter,
): Promise<ResolvedSources> {
  const cccId = process.env.SHEET_CONTACT_CENTER_ID;
  const wingId = process.env.SHEET_WINGWISE_ID;

  const masterId = process.env.SHEET_MASTER_ID;
  if (googleConfigured()) {
    return {
      connected: true,
      mode: 'google-api',
      reason: null,
      ccc: cccId ? googleSource(cccId, sheets) : null,
      wingwise: wingId ? googleSource(wingId, sheets) : null,
      master: masterId ? googleSource(masterId, sheets) : null,
    };
  }

  // By link: needs nothing but the sheet being viewable by link.
  if (process.env.SHEET_LINK_READ !== 'false' && (cccId || wingId)) {
    const [ccc, wing] = await Promise.all([
      cccId ? fetchByLink(cccId, 'central-contact-center') : Promise.resolve(null),
      wingId ? fetchByLink(wingId, 'wing-wise') : Promise.resolve(null),
    ]);
    const cccOk = ccc && 'path' in ccc ? ccc.path : null;
    const wingOk = wing && 'path' in wing ? wing.path : null;
    if (cccOk || wingOk) {
      const problems = [
        ccc && 'error' in ccc ? `Contact Center sheet: ${ccc.error}` : null,
        wing && 'error' in wing ? `Wing Wise sheet: ${wing.error}` : null,
      ].filter(Boolean) as string[];
      const fallback = await localFiles(prisma);
      return {
        connected: true,
        mode: 'link',
        reason: problems.length ? problems.join(' | ') : null,
        ccc: cccOk ? fileSource(cccOk) : fallback.ccc,
        wingwise: wingOk ? fileSource(wingOk) : fallback.wingwise,
        master: null,
      };
    }
    const why = [
      ccc && 'error' in ccc ? `Contact Center sheet: ${ccc.error}` : null,
      wing && 'error' in wing ? `Wing Wise sheet: ${wing.error}` : null,
    ].filter(Boolean).join(' | ');
    const local = await localFiles(prisma);
    return {
      ...local,
      reason:
        `Google Sheets could not be read by link (${why}). ` +
        'Reading the newest workbook files on this machine instead (Downloads, then backups/sheets).',
    };
  }

  const local = await localFiles(prisma);
  return {
    ...local,
    reason:
      'Google Sheets is not connected: no service-account key at GOOGLE_SERVICE_ACCOUNT_JSON and ' +
      'link reading is off. Reading the newest workbook files on this machine instead.',
  };
}

/** The newest workbook files on this machine, for when Google cannot be read. */
async function localFiles(prisma: PrismaClient): Promise<ResolvedSources> {

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

  const ccc = await lastFile('Central Contact Center workbook', /central.?contact.?cent.*\.xlsx$/i, process.env.CCC_WORKBOOK_FILE);
  const wingwise = await lastFile('Wing Wise workbook', /wing.?wise.*\.xlsx$/i, process.env.WINGWISE_WORKBOOK_FILE);
  return {
    connected: false,
    mode: ccc || wingwise ? 'file' : 'none',
    reason: null,
    ccc,
    wingwise,
    master: null,
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
