/**
 * Importer for the Wing Wise workstation workbook.
 *
 *   pnpm --filter @inventory/api import:wingwise -- --file "C:\path\file.xlsx" [--dry-run]
 *
 * Each tab is a process (Collaborate-L1, Connect-Ops), split into Wing A/B/C
 * sections, listing stations and whether each has a monitor, keyboard, mouse,
 * CPU, LAN cable, headphone and chair.
 *
 * The wings become locations, the stations become workstations, and each "Yes"
 * becomes an asset allocated to that workstation. A "NO" is the interesting
 * case: it is a gap, so it is recorded on the workstation rather than dropped.
 */
import './load-env';
import {
  PrismaClient, AllocationHolderType, AllocationStatus, AssetCondition,
  AssetEventType, AssetStatus, AuditAction, LocationKind, SourceType,
  SyncMode, SyncRowStatus, SyncStatus, WorkstationStatus,
} from '@prisma/client';
import { FileAdapter } from '../src/modules/sync/adapters/file.adapter';

const prisma = new PrismaClient();
const adapter = new FileAdapter();

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes('--dry-run');
const S = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Columns that describe a piece of equipment, and the category each maps to. */
const ITEM_COLUMNS: Array<{ header: string; item: string; code: string; name: string }> = [
  { header: 'Monitor',    item: 'Monitor',    code: 'MON', name: 'Monitor' },
  { header: 'Keyboard',   item: 'Keyboard',   code: 'KB',  name: 'Keyboard' },
  { header: 'Mouse',      item: 'Mouse',      code: 'MSE', name: 'Mouse' },
  { header: 'CPU',        item: 'CPU',        code: 'DSK', name: 'Desktop' },
  { header: 'LAN Cable',  item: 'LAN Cable',  code: 'LAN', name: 'LAN Cable' },
  { header: 'Headphone',  item: 'Headphone',  code: 'HP',  name: 'Headphone' },
  { header: 'Chair',      item: 'Chair',      code: 'CHR', name: 'Chair' },
];

/** "Yes", "All in One" and a model name all mean present; "NO" and blank do not. */
function isPresent(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return !['no', 'n', 'nil', '-', 'none', 'no chair', 'false', '0'].includes(v);
}

const categoryCache = new Map<string, string>();
async function categoryId(code: string, name: string): Promise<string> {
  const key = code.toUpperCase();
  const hit = categoryCache.get(key);
  if (hit) return hit;
  let cat = await prisma.assetCategory.findFirst({ where: { code: key } });
  if (!cat) {
    cat = await prisma.assetCategory.create({
      data: { code: key, name, tagPrefix: key.slice(0, 4) },
    });
  }
  categoryCache.set(key, cat.id);
  return cat.id;
}

const tagSeq = new Map<string, number>();
async function nextTag(prefix: string): Promise<string> {
  let n = tagSeq.get(prefix);
  if (n === undefined) {
    n = 1000 + (await prisma.asset.count({ where: { assetTag: { startsWith: `${prefix}-` } } }));
  }
  for (;;) {
    n += 1;
    const candidate = `${prefix}-${n}`;
    if (!(await prisma.asset.findFirst({ where: { assetTag: candidate } }))) {
      tagSeq.set(prefix, n);
      return candidate;
    }
  }
}

interface Ctx {
  runId: string;
  branchId: string;
  counts: Record<string, number>;
  rows: Array<Record<string, unknown>>;
  /** wing name -> location id */
  wings: Map<string, string>;
}
const bump = (c: Ctx, k: string, n = 1) => { c.counts[k] = (c.counts[k] ?? 0) + n; };

/** Wings are locations under the branch, created once and reused. */
async function wingLocation(c: Ctx, wing: string): Promise<string | null> {
  const cached = c.wings.get(wing);
  if (cached) return cached;

  const code = wing.toUpperCase().replace(/\s+/g, '-');
  const existing = await prisma.location.findFirst({
    where: { branchId: c.branchId, code, deletedAt: undefined },
  });
  if (existing) { c.wings.set(wing, existing.id); return existing.id; }

  if (DRY) { c.wings.set(wing, 'dry-run'); bump(c, 'wingsCreated'); return 'dry-run'; }

  const created = await prisma.location.create({
    data: {
      branchId: c.branchId,
      kind: LocationKind.WING,
      code,
      name: wing,
      path: `CCC/${code}`,
      depth: 1,
    },
  });
  c.wings.set(wing, created.id);
  bump(c, 'wingsCreated');
  return created.id;
}

/** One station: a workstation row plus an asset per item marked present. */
async function importStation(
  c: Ctx,
  opts: {
    tab: string; process: string; wing: string; rowNumber: number;
    seatCode: string; raw: Record<string, string>;
  },
): Promise<void> {
  const locationId = await wingLocation(c, opts.wing);
  const missing: string[] = [];
  const present: Array<{ item: string; code: string; name: string; detail: string }> = [];

  for (const col of ITEM_COLUMNS) {
    const value = S(opts.raw[col.header]);
    if (isPresent(value)) {
      present.push({ ...col, detail: value });
    } else {
      missing.push(col.item);
    }
  }

  // The second "Chair" column is the chair type, not another chair.
  const chairType = S(opts.raw['Chair (2)']);

  let workstationId: string | null = null;
  if (!DRY) {
    const existing = await prisma.workstation.findFirst({
      where: { branchId: c.branchId, seatCode: opts.seatCode, deletedAt: undefined },
    });

    const notes = [
      `Process: ${opts.process}`,
      chairType ? `Chair: ${chairType}` : '',
      missing.length ? `Missing: ${missing.join(', ')}` : '',
    ].filter(Boolean).join(' | ');

    if (existing) {
      const updated = await prisma.workstation.update({
        where: { id: existing.id },
        data: { locationId, notes, hasDesktop: present.some((p) => p.code === 'DSK') },
      });
      workstationId = updated.id;
      bump(c, 'workstationsUnchanged');
    } else {
      const created = await prisma.workstation.create({
        data: {
          branchId: c.branchId,
          locationId,
          seatCode: opts.seatCode,
          status: WorkstationStatus.AVAILABLE,
          hasDesktop: present.some((p) => p.code === 'DSK'),
          notes,
        },
      });
      workstationId = created.id;
      bump(c, 'workstationsCreated');
    }
  } else {
    bump(c, 'workstationsCreated');
  }

  if (missing.length) bump(c, 'itemsMissing', missing.length);

  for (const p of present) {
    const importKey = `wingwise:${opts.tab}:${opts.rowNumber}:${p.item}`;

    if (!DRY) {
      const already = await prisma.asset.findFirst({
        where: { sourceRef: importKey, deletedAt: undefined },
      });
      if (already) { bump(c, 'assetsUnchanged'); continue; }
    } else {
      bump(c, 'assetsCreated');
      continue;
    }

    const catId = await categoryId(p.code, p.name);
    const asset = await prisma.asset.create({
      data: {
        assetTag: await nextTag(p.code),
        categoryId: catId,
        model: p.detail !== 'Yes' ? p.detail : null,
        status: AssetStatus.ALLOCATED,
        condition: AssetCondition.GOOD,
        branchId: c.branchId,
        locationId,
        notes: `${p.item} at station ${opts.seatCode} (${opts.process}, ${opts.wing})`,
        sourceType: SourceType.EXCEL_UPLOAD,
        sourceRef: importKey,
      },
    });
    bump(c, 'assetsCreated');

    await prisma.assetEvent.create({
      data: {
        assetId: asset.id,
        eventType: AssetEventType.IMPORTED,
        summary: `Imported from the Wing Wise workbook, station ${opts.seatCode}`,
        refType: 'SyncRun', refId: c.runId,
        actorName: 'Wing Wise import',
      },
    });

    // Station kit belongs to the seat, not to a person - which is exactly what
    // the WORKSTATION holder type is for.
    if (workstationId) {
      const allocation = await prisma.assetAllocation.create({
        data: {
          assetId: asset.id,
          holderType: AllocationHolderType.WORKSTATION,
          holderRefId: workstationId,
          holderLabel: `Station ${opts.seatCode}`,
          status: AllocationStatus.ACTIVE,
          allocatedAt: new Date(),
          conditionOut: AssetCondition.GOOD,
          remarks: 'Station equipment recorded during import',
          sourceType: SourceType.EXCEL_UPLOAD,
          sourceRef: importKey,
        },
      });
      await prisma.asset.update({
        where: { id: asset.id },
        data: { currentAllocationId: allocation.id },
      });
      bump(c, 'allocationsCreated');
    }
  }

  c.rows.push({
    runId: c.runId,
    rowNumber: opts.rowNumber,
    rawData: { __tab: opts.tab, __wing: opts.wing, __process: opts.process, ...opts.raw },
    rowHash: `wingwise:${opts.tab}:${opts.rowNumber}`,
    dedupeKey: opts.seatCode,
    status: SyncRowStatus.IMPORTED,
    entityType: 'Workstation',
    entityId: workstationId,
    messages: missing.length ? [`Missing at this station: ${missing.join(', ')}`] : [],
  });
  bump(c, 'rowsImported');
}

async function main(): Promise<void> {
  const file = arg('file');
  if (!file) {
    console.error('Usage: import:wingwise -- --file "C:\path\workbook.xlsx" [--dry-run]');
    process.exit(1);
  }

  const org = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!org) { console.error('No organisation. Run the seed first.'); process.exit(1); }
  const branch =
    (await prisma.branch.findFirst({ where: { organizationId: org.id, code: 'CCC' } })) ??
    (await prisma.branch.findFirst({ where: { organizationId: org.id } }));
  if (!branch) { console.error('No branch. Run the seed first.'); process.exit(1); }

  const source =
    (await prisma.syncSource.findFirst({
      where: { sourceType: SourceType.EXCEL_UPLOAD, name: 'Wing Wise workbook' },
    })) ??
    (await prisma.syncSource.create({
      data: {
        name: 'Wing Wise workbook',
        sourceType: SourceType.EXCEL_UPLOAD,
        targetEntity: 'workstation',
        workbookLabel: file,
        mode: SyncMode.MANUAL,
        dedupeKeys: ['seatCode'],
      },
    }));

  const run = await prisma.syncRun.create({
    data: {
      sourceId: source.id,
      mode: SyncMode.MANUAL,
      status: SyncStatus.RUNNING,
      dryRun: DRY,
      triggeredByName: 'Wing Wise importer (CLI)',
    },
  });

  const c: Ctx = { runId: run.id, branchId: branch.id, counts: {}, rows: [], wings: new Map() };

  console.log(`Importing ${file}`);
  console.log(`  branch: ${branch.name}${DRY ? '   DRY RUN - nothing will be written' : ''}`);

  const TABS = ['Connect', 'Communicate', 'Collaborate', 'Coordinate', 'Cultivate'];

  try {
    for (const tab of TABS) {
      process.stdout.write(`  ${tab} ... `);
      try {
        // Row 1 is the process title, row 2 the first wing, row 3 the headers.
        const titleTable = await adapter.read({ filePath: file, sheetName: tab, headerRow: 1 });
        const process_ = titleTable.headers[0] ?? tab;

        const table = await adapter.read({ filePath: file, sheetName: tab, headerRow: 3 });
        let wing = 'Wing A';
        let stations = 0;

        for (const row of table.rows) {
          const seat = S(row.raw['Station Id']);
          if (!seat) continue;

          // A "Wing B" row is a section marker, not a station.
          if (/^wing\b/i.test(seat)) { wing = seat; continue; }

          await importStation(c, {
            tab, process: process_, wing, rowNumber: row.rowNumber,
            seatCode: seat, raw: row.raw,
          });
          stations += 1;
        }
        console.log(`${stations} stations`);
      } catch (err) {
        console.log(`FAILED: ${(err as Error).message}`);
        bump(c, 'tabsFailed');
      }
    }

    if (!DRY && c.rows.length) {
      for (let i = 0; i < c.rows.length; i += 500) {
        await prisma.syncRow.createMany({ data: c.rows.slice(i, i + 500) as never });
      }
    }

    await prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: (c.counts.tabsFailed ?? 0) > 0 ? SyncStatus.PARTIAL : SyncStatus.SUCCESS,
        finishedAt: new Date(),
        durationMs: Date.now() - run.startedAt.getTime(),
        rowsRead: c.rows.length,
        rowsNew: c.counts.rowsImported ?? 0,
      },
    });

    if (!DRY) {
      await prisma.auditLog.create({
        data: {
          action: AuditAction.IMPORT,
          entityType: 'SyncSource',
          entityId: source.id,
          entityLabel: source.name,
          userName: 'Wing Wise importer (CLI)',
          roleKeys: [],
          summary:
            'Imported the Wing Wise workbook: ' +
            Object.entries(c.counts).map(([k, v]) => `${k}=${v}`).join(', '),
          refType: 'SyncRun',
          refId: run.id,
        },
      });
    }

    console.log('\nSummary');
    for (const [k, v] of Object.entries(c.counts).sort()) {
      console.log(`  ${k.padEnd(24)} ${v}`);
    }
    console.log(`\nRun id ${run.id}${DRY ? ' (dry run)' : ''}`);
  } catch (err) {
    await prisma.syncRun.update({
      where: { id: run.id },
      data: { status: SyncStatus.FAILED, finishedAt: new Date(), errorMessage: (err as Error).message },
    });
    throw err;
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
